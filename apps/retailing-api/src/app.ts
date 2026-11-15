import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { createClock } from './clock';
import type { ApiConfig } from './config';
import { registerFaultInjection } from './faults';
import { sendError } from './http';
import { airlineRoutes } from './routes/airline';
import { airportRoutes } from './routes/airports';
import { destinationRoutes } from './routes/destinations';
import { flightRoutes } from './routes/flights';
import { healthRoutes } from './routes/health';
import { networkRoutes } from './routes/network';
import { offerRoutes } from './routes/offers';
import { shoppingRoutes } from './routes/shopping';
import { createRetailingService, DEFAULT_RETAILING_CONFIG } from './offers/retailing-service';
import { createCatalog } from './services/catalog';
import { createFlightService } from './services/flights';

export const API_VERSION = '0.3.0';

export interface BuildAppOptions extends FastifyServerOptions {
  /** Defaults are deterministic apart from "today", which follows the system clock unless pinned. */
  config?: Partial<ApiConfig>;
}

const DEFAULT_CONFIG: ApiConfig = {
  // Pre-rebrand seed kept on purpose: it keeps deterministic inventory identical (see config.ts).
  inventory: { seed: 'aeronova', horizonDays: 120 },
  faults: { enabled: false, timeoutMs: 15_000 },
  retailing: DEFAULT_RETAILING_CONFIG,
};

/** Build the app without listening, so tests can use `app.inject()`. */
export function buildApp({ config = {}, ...options }: BuildAppOptions = {}): FastifyInstance {
  const settings: ApiConfig = { ...DEFAULT_CONFIG, ...config };
  const app = Fastify({ logger: false, ...options });

  const clock = createClock(settings.today);
  const flights = createFlightService({ clock, ...settings.inventory });
  const retailing = createRetailingService({ flights, clock, config: settings.retailing });
  // Generate inventory at startup, off the request path.
  flights.current();
  const catalog = createCatalog(flights);
  // Derive destination routes and fares now, so the first request doesn't pay for it.
  catalog.listDestinations();

  registerFaultInjection(app, settings.faults, {
    offerValidityMs: settings.retailing.offerValidityMs,
    sessionMaxMs: settings.retailing.sessionMaxMs,
  });
  app.register(healthRoutes, { version: API_VERSION });
  app.register(airlineRoutes);
  app.register(airportRoutes, { catalog });
  app.register(destinationRoutes, { catalog });
  app.register(flightRoutes, { flights });
  app.register(networkRoutes, { flights });
  app.register(offerRoutes, { retailing });
  app.register(shoppingRoutes, { retailing });

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, 404, 'NOT_FOUND', `Route ${request.method} ${request.url} not found.`),
  );

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) {
      return sendError(reply, status, 'BAD_REQUEST', (error as Error).message);
    }
    request.log.error(error);
    return sendError(reply, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  });

  return app;
}
