import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { createClock, type Clock } from './clock';
import { DEFAULT_CHECKOUT_CONFIG, DEFAULT_PAYMENTS_CONFIG, type ApiConfig } from './config';
import { openDatabase, type Database } from './db/client';
import { OrderRepository } from './db/repositories/order-repository';
import { PaymentProviderRepository } from './db/repositories/payment-provider-repository';
import { registerFaultInjection } from './faults';
import { sendError } from './http';
import { AllocationLedger } from './inventory/ledger';
import { createCheckoutService, type CheckoutService } from './orders/checkout-service';
import { newBookingReference } from './orders/ids';
import { createOrderService, type OrderService } from './orders/order-service';
import { OrderStore } from './orders/order-store';
import { PaymentSimulator } from './orders/payment-simulator';
import { SerialQueue } from './orders/serial-queue';
import { airlineRoutes } from './routes/airline';
import { airportRoutes } from './routes/airports';
import { bookingRoutes } from './routes/booking';
import { checkoutRoutes } from './routes/checkout';
import { destinationRoutes } from './routes/destinations';
import { flightRoutes } from './routes/flights';
import { healthRoutes } from './routes/health';
import { networkRoutes } from './routes/network';
import { offerRoutes } from './routes/offers';
import { orderRoutes } from './routes/orders';
import { shoppingRoutes } from './routes/shopping';
import { createRetailingService, DEFAULT_RETAILING_CONFIG } from './offers/retailing-service';
import { createCatalog } from './services/catalog';
import { createFlightService } from './services/flights';

export const API_VERSION = '0.5.0';

/** Hooks for tests: control time and randomness that production takes from the system. */
export interface TestHooks {
  clock?: Clock;
  /** Wall clock of the simulated payment provider. */
  wallClock?: () => number;
  referenceGenerator?: () => string;
}

export interface BuildAppOptions extends FastifyServerOptions {
  /** Defaults are deterministic apart from "today", which follows the system clock unless pinned. */
  config?: Partial<ApiConfig>;
  testHooks?: TestHooks;
}

/** Checkout and order internals, for graceful shutdown, diagnostics, and tests. */
export interface Persistence {
  database: Database;
  orders: OrderRepository;
  provider: PaymentProviderRepository;
  ledger: AllocationLedger;
  queue: SerialQueue;
  checkout: CheckoutService;
  orderService: OrderService;
  /** What startup reconciliation did. */
  recovered: { resolved: number; expired: number; confirmed: number };
}

declare module 'fastify' {
  interface FastifyInstance {
    persistence: Persistence;
  }
}

const DEFAULT_CONFIG: ApiConfig = {
  // Pre-rebrand seed kept on purpose: it keeps deterministic inventory identical (see config.ts).
  inventory: { seed: 'aeronova', horizonDays: 120 },
  faults: { enabled: false, timeoutMs: 15_000 },
  retailing: DEFAULT_RETAILING_CONFIG,
  persistence: {},
  checkout: DEFAULT_CHECKOUT_CONFIG,
  payments: DEFAULT_PAYMENTS_CONFIG,
};

/** Build the app without listening, so tests can use `app.inject()`. Await `app.ready()`. */
export function buildApp({
  config = {},
  testHooks = {},
  ...options
}: BuildAppOptions = {}): FastifyInstance {
  const settings: ApiConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    checkout: { ...DEFAULT_CHECKOUT_CONFIG, ...config.checkout },
    payments: { ...DEFAULT_PAYMENTS_CONFIG, ...config.payments },
  };
  const app = Fastify({ logger: false, ...options });

  const clock = testHooks.clock ?? createClock(settings.today);
  // Seats held by orders; filled from the database before the app is ready.
  const ledger = new AllocationLedger(() => clock.now());
  const flights = createFlightService({ clock, ...settings.inventory, ledger });
  const retailing = createRetailingService({
    flights,
    clock,
    config: settings.retailing,
    ledger,
  });
  // Generate inventory at startup, off the request path.
  flights.current();
  const catalog = createCatalog(flights);
  // Derive destination routes and fares now, so the first request doesn't pay for it.
  catalog.listDestinations();

  registerFaultInjection(app, settings.faults, {
    offerValidityMs: settings.retailing.offerValidityMs,
    sessionMaxMs: settings.retailing.sessionMaxMs,
    holdMs: settings.checkout.holdMs,
  });
  app.register(healthRoutes, { version: API_VERSION });
  app.register(airlineRoutes);
  app.register(airportRoutes, { catalog });
  app.register(destinationRoutes, { catalog });
  app.register(flightRoutes, { flights });
  app.register(networkRoutes, { flights });
  app.register(offerRoutes, { retailing });
  app.register(shoppingRoutes, { retailing });
  app.register(bookingRoutes, { retailing });

  // Milestone 5: TalaDB, checkout, orders, simulated payments.
  app.decorate('persistence', null as unknown as Persistence);
  app.register(async (scope) => {
    // Without a configured path (tests), use a private temporary file.
    const tempDir = settings.persistence.path
      ? null
      : mkdtempSync(join(tmpdir(), 'velasia-retailing-'));
    const database = await openDatabase(settings.persistence.path ?? join(tempDir!, 'velasia.db'));
    const orders = new OrderRepository(database.orders);
    const provider = new PaymentProviderRepository(database.provider);
    const queue = new SerialQueue();
    const store = new OrderStore(orders, ledger, queue, settings.checkout.maxPaymentAttempts);
    // Inventory held by orders comes from durable state only.
    ledger.rebuild(await orders.withActiveHolds());
    const simulator = new PaymentSimulator(provider, {
      responseDelayMs: settings.payments.responseDelayMs,
      timeoutMs: settings.payments.timeoutMs,
      pendingResolveMs: settings.payments.pendingResolveMs,
      wallClock: testHooks.wallClock,
    });
    const orderService = createOrderService({
      store,
      provider: simulator,
      retailing,
      config: {
        maxPaymentAttempts: settings.checkout.maxPaymentAttempts,
        outcomeControls: settings.payments.outcomeControls,
      },
      log: app.log,
    });
    const checkout = createCheckoutService({
      retailing,
      flights,
      store,
      config: settings.checkout,
      referenceGenerator: testHooks.referenceGenerator ?? newBookingReference,
    });
    // Finish what a previous process left undecided, and release holds that ended meanwhile.
    const recovered = await orderService.reconcile(clock.now());
    app.persistence = {
      database,
      orders,
      provider,
      ledger,
      queue,
      checkout,
      orderService,
      recovered,
    };

    // Expiry is also checked on every access; the sweep releases holds nobody looks at.
    const sweep = setInterval(() => {
      orderService.reconcile(clock.now()).catch((error: unknown) => {
        app.log.error({ err: error }, 'order sweep failed');
      });
    }, settings.checkout.sweepIntervalMs);
    sweep.unref();

    scope.get('/health/ready', async (_request, reply) => {
      const db = await database.health();
      return reply
        .code(db.ok ? 200 : 503)
        .header('cache-control', 'no-store')
        .send({
          status: db.ok ? 'ok' : 'unavailable',
          database: db,
          checkoutQueue: queue.size,
        });
    });
    scope.register(checkoutRoutes, { checkout, orders: orderService, retailing });
    scope.register(orderRoutes, { orders: orderService, retailing });

    scope.addHook('onClose', async () => {
      clearInterval(sweep);
      await queue.drain();
      await database.close();
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, 404, 'NOT_FOUND', `Route ${request.method} ${request.url} not found.`),
  );

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) {
      return sendError(reply, status, 'BAD_REQUEST', (error as Error).message);
    }
    const name = (error as Error).name;
    if (name === 'QueueFullError' || name === 'QueueTimeoutError' || name === 'QueueClosedError') {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', (error as Error).message);
    }
    request.log.error(error);
    return sendError(reply, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  });

  return app;
}
