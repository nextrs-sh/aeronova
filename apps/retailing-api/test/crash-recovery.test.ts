import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { orderResponseSchema, seatsOf, sessionSeatMapResponseSchema } from '@velasia/contracts';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client';
import { OrderRepository } from '../src/db/repositories/order-repository';
import { PaymentProviderRepository } from '../src/db/repositories/payment-provider-repository';
import type { ProviderCharge, StoredOrder } from '../src/db/schema';
import type { CrashPoint } from '../src/crash';
import {
  httpCaller,
  newGuestToken,
  newKey,
  pay,
  paymentOf,
  prepare,
  readyCheckout,
  type Caller,
  type ReadyCheckout,
} from './checkout-harness';
import { TODAY } from './helpers';

/*
 * Fault injection with real processes. Each test runs the API as a child process on its own
 * TalaDB file, kills it with SIGKILL at a checkout boundary (no cleanup, like a power cut),
 * starts a new process on the same file, and checks the durable invariants:
 *
 * - no order is lost once its creation was acknowledged, and none appears that wasn't written;
 * - no payment is confirmed unless the provider recorded it as succeeded, and none twice;
 * - held seats are restored from durable state, and released when their hold has ended.
 */

const API_DIR = join(import.meta.dirname, '..');
const dirs: string[] = [];
const children = new Set<ChildProcess>();

setFlagsFromString('--expose_gc');
const gc = runInNewContext('gc') as () => void;

afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
});
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

interface Server extends Caller {
  child: ChildProcess;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => string;
}

async function startServer(dbPath: string, env: Record<string, string> = {}): Promise<Server> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      RETAILING_API_PORT: String(port),
      RETAILING_API_HOST: '127.0.0.1',
      TALADB_PATH: dbPath,
      VELASIA_TODAY: TODAY,
      RETAILING_API_FAULTS: 'enabled',
      RETAILING_API_CRASH_TESTS: 'enabled',
      RETAILING_API_FAULT_TIMEOUT_MS: '300',
      PAYMENT_PROVIDER_DELAY_MS: '0',
      PAYMENT_PROVIDER_TIMEOUT_MS: '1500',
      PAYMENT_PENDING_RESOLVE_MS: '0',
      LOG_LEVEL: 'warn',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  child.stdout!.on('data', (chunk) => (output += chunk));
  child.stderr!.on('data', (chunk) => (output += chunk));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => {
      children.delete(child);
      resolve({ code, signal });
    }),
  );
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`API exited during startup:\n${output}`);
    try {
      const response = await fetch(`${base}/health/ready`);
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`API didn't start:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { ...httpCaller(base), child, exited, output: () => output };
}

/** Graceful stop (SIGTERM): what a deployment does. */
async function stop(server: Server) {
  server.child.kill('SIGTERM');
  const { code } = await server.exited;
  expect(code).toBe(0);
}

/** Read the durable state directly, between processes. */
async function inspect(
  dbPath: string,
): Promise<{ orders: StoredOrder[]; charges: ProviderCharge[] }> {
  let db: Awaited<ReturnType<typeof openDatabase>> | null = await openDatabase(dbPath);
  const orders = await new OrderRepository(db.orders).all();
  const charges = await new PaymentProviderRepository(db.provider).all();
  await db.close();
  db = null;
  for (let i = 0; i < 6; i += 1) {
    gc(); // TalaDB releases the file lock once its handles are collected
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { orders, charges };
}

/** The invariants that must hold in any durable state. */
function expectConsistent({
  orders,
  charges,
}: {
  orders: StoredOrder[];
  charges: ProviderCharge[];
}) {
  for (const order of orders) {
    const succeeded = charges.filter(
      (c) => c.orderId === order.orderId && c.status === 'SUCCEEDED',
    );
    if (order.status === 'CONFIRMED') {
      expect(order.hold.status).toBe('COMMITTED');
      expect(order.attempts.filter((a) => a.status === 'SUCCEEDED')).toHaveLength(1);
      expect(succeeded).toHaveLength(1);
    } else {
      expect(order.attempts.some((a) => a.status === 'SUCCEEDED')).toBe(false);
    }
    expect(succeeded.length).toBeLessThanOrEqual(1);
  }
  // Each attempt was charged at most once.
  const attempts = charges.map((c) => c.attemptId);
  expect(new Set(attempts).size).toBe(attempts.length);
}

function newDb() {
  const dir = mkdtempSync(join(tmpdir(), 'velasia-crash-'));
  dirs.push(dir);
  return join(dir, 'velasia.db');
}

async function killedBy(server: Server, request: Promise<unknown>) {
  await expect(request).rejects.toThrow(); // the connection dies with the process
  const { signal } = await server.exited;
  expect(signal).toBe('SIGKILL');
}

async function seatStatus(server: Caller, ready: ReadyCheckout, flightId: string, seatId: string) {
  const map = sessionSeatMapResponseSchema.parse(
    (
      await server.call(`/v1/shopping-sessions/${ready.id}/seatmaps/${flightId}`, {
        token: ready.token,
      })
    ).json(),
  ).data;
  return seatsOf(map.seatMap).find((seat) => seat.id === seatId)?.status;
}

const FLIGHT = 'NV501-20261215';

describe('restart', { timeout: 120_000 }, () => {
  it('keeps a confirmed order retrievable after a graceful stop and restart', async () => {
    const db = newDb();
    let server = await startServer(db);
    const ready = await readyCheckout(server);
    const guest = newGuestToken();
    const created = (await prepare(server, ready, guest)).json().data.order;
    const confirmed = paymentOf(await pay(server, created.id, guest, { outcome: 'SUCCESS' })).order;
    await stop(server);

    server = await startServer(db);
    const read = orderResponseSchema.parse(
      (await server.call(`/v1/orders/${created.id}`, { token: guest })).json(),
    ).data;
    expect({ ...read, serverTime: '' }).toEqual({ ...confirmed, serverTime: '' });
    const byReference = orderResponseSchema.parse(
      (await server.call(`/v1/orders/reference/${created.reference}`, { token: guest })).json(),
    ).data;
    expect(byReference.id).toBe(created.id);
    // Still private after the restart.
    expect(
      (await server.call(`/v1/orders/${created.id}`, { token: newGuestToken() })).statusCode,
    ).toBe(404);
    // Its seat is still taken for everyone else.
    const observer = await readyCheckout(server, { seats: 'none' });
    expect(await seatStatus(server, observer, FLIGHT, created.seats[0].seatId)).toBe('OCCUPIED');
    await stop(server);
    expectConsistent(await inspect(db));
  });

  it('restores held seats from TalaDB, and releases holds that ended while it was down', async () => {
    const db = newDb();
    let server = await startServer(db);
    const ready = await readyCheckout(server);
    const guest = newGuestToken();
    const order = (await prepare(server, ready, guest)).json().data.order;
    await stop(server);

    // Same day: the hold is restored and still blocks the seat.
    server = await startServer(db);
    const observer = await readyCheckout(server, { seats: 'none' });
    expect(await seatStatus(server, observer, FLIGHT, order.seats[0].seatId)).toBe('OCCUPIED');
    await stop(server);

    // A day later the hold has long ended: startup reconciliation releases it.
    server = await startServer(db, { VELASIA_TODAY: '2026-12-02' });
    expect(server.output()).not.toMatch(/error/i);
    await stop(server);
    const { orders } = await inspect(db);
    expect(orders.find((o) => o.orderId === order.id)).toMatchObject({
      status: 'EXPIRED',
      hold: { status: 'EXPIRED' },
    });
  });
});

describe('process killed at a checkout boundary', { timeout: 120_000 }, () => {
  async function crashDuringPrepare(point: CrashPoint) {
    const db = newDb();
    const server = await startServer(db);
    const ready = await readyCheckout(server);
    const seat = ready.session.booking.seats[0]!.seatId;
    await killedBy(server, prepare(server, ready, newGuestToken(), { crash: point }));
    return { db, seat };
  }

  it('before the order is written: nothing exists, nothing is held', async () => {
    const { db, seat } = await crashDuringPrepare('prepare:before-insert');
    const state = await inspect(db);
    expect(state.orders).toHaveLength(0);
    const server = await startServer(db);
    const observer = await readyCheckout(server, { seats: 'none' });
    expect(await seatStatus(server, observer, FLIGHT, seat)).toBe('AVAILABLE');
    await stop(server);
  });

  it('after the pending order and hold are written: both survive, the seat stays held, and it can be paid', async () => {
    const { db, seat } = await crashDuringPrepare('prepare:after-insert');
    const [order] = (await inspect(db)).orders;
    expect(order).toMatchObject({ status: 'PENDING_PAYMENT', hold: { status: 'HELD' } });
    expect(order!.hold.allocations[0]!.seatIds).toEqual([seat]);

    const server = await startServer(db);
    const observer = await readyCheckout(server, { seats: 'none' });
    expect(await seatStatus(server, observer, FLIGHT, seat)).toBe('OCCUPIED');
    await stop(server);
  });

  async function crashDuringPayment(
    point: CrashPoint,
    outcome: 'SUCCESS' | 'DECLINED' = 'SUCCESS',
  ) {
    const db = newDb();
    const server = await startServer(db);
    const ready = await readyCheckout(server);
    const guest = newGuestToken();
    const order = (await prepare(server, ready, guest)).json().data.order;
    const key = newKey();
    await killedBy(server, pay(server, order.id, guest, { outcome, key, crash: point }));
    return { db, order, guest, key };
  }

  it('after the attempt is recorded, before the provider is called: the attempt fails, nothing was charged', async () => {
    const { db, order, guest } = await crashDuringPayment('payment:after-attempt');
    const before = await inspect(db);
    expect(before.orders[0]!.attempts[0]!.status).toBe('PROCESSING');
    expect(before.charges).toHaveLength(0);

    const server = await startServer(db);
    const read = orderResponseSchema.parse(
      (await server.call(`/v1/orders/${order.id}`, { token: guest })).json(),
    ).data;
    expect(read).toMatchObject({ status: 'PENDING_PAYMENT', payment: { canPay: true } });
    expect(read.payment.attempts[0]).toMatchObject({ status: 'FAILED' });
    expect(read.payment.attempts[0]!.failureReason).toMatch(/nothing was charged/);
    // The guest can simply pay again.
    expect(paymentOf(await pay(server, order.id, guest, { outcome: 'SUCCESS' })).order.status).toBe(
      'CONFIRMED',
    );
    await stop(server);
    expectConsistent(await inspect(db));
  });

  it('after the provider charged, before the order knew: recovery confirms it, once', async () => {
    const { db, order, guest, key } = await crashDuringPayment('payment:after-provider');
    const before = await inspect(db);
    expect(before.orders[0]!.status).toBe('PENDING_PAYMENT');
    expect(before.charges.map((c) => c.status)).toEqual(['SUCCEEDED']);

    const server = await startServer(db);
    const read = orderResponseSchema.parse(
      (await server.call(`/v1/orders/${order.id}`, { token: guest })).json(),
    ).data;
    expect(read).toMatchObject({ status: 'CONFIRMED', hold: { status: 'COMMITTED' } });
    // The browser retries the same payment: it gets the result, not a second charge.
    const retry = await pay(server, order.id, guest, { outcome: 'SUCCESS', key });
    expect(retry.statusCode).toBe(200);
    expect(paymentOf(retry)).toMatchObject({ replayed: true, order: { status: 'CONFIRMED' } });
    await stop(server);
    const after = await inspect(db);
    expect(after.charges).toHaveLength(1);
    expect(after.orders[0]!.events.filter((e) => e.type === 'ORDER_CONFIRMED')).toHaveLength(1);
    expectConsistent(after);
  });

  it('after the provider declined, before the order knew: recovery records the decline', async () => {
    const { db, order, guest } = await crashDuringPayment('payment:after-provider', 'DECLINED');
    const server = await startServer(db);
    const read = orderResponseSchema.parse(
      (await server.call(`/v1/orders/${order.id}`, { token: guest })).json(),
    ).data;
    expect(read).toMatchObject({ status: 'PENDING_PAYMENT', payment: { canPay: true } });
    expect(read.payment.attempts[0]!.status).toBe('FAILED');
    await stop(server);
    expectConsistent(await inspect(db));
  });

  it('after the order was confirmed, before the answer was sent: nothing is redone', async () => {
    const { db, order, guest } = await crashDuringPayment('payment:after-confirm');
    const before = await inspect(db);
    expect(before.orders[0]).toMatchObject({ status: 'CONFIRMED', hold: { status: 'COMMITTED' } });

    const server = await startServer(db);
    const read = orderResponseSchema.parse(
      (await server.call(`/v1/orders/${order.id}`, { token: guest })).json(),
    ).data;
    expect(read.status).toBe('CONFIRMED');
    await stop(server);
    const after = await inspect(db);
    expect(after.orders[0]!.rev).toBe(before.orders[0]!.rev); // recovery changed nothing
    expect(after.charges).toHaveLength(1);
    expectConsistent(after);
  });

  it('with an uncertain (timed-out) result: recovery asks the provider instead of guessing', async () => {
    const db = newDb();
    let server = await startServer(db);
    const ready = await readyCheckout(server);
    const guest = newGuestToken();
    const order = (await prepare(server, ready, guest)).json().data.order;
    const response = await pay(server, order.id, guest, { outcome: 'TIMEOUT' });
    expect(response.statusCode).toBe(202);
    expect(paymentOf(response).attempt?.status).toBe('UNKNOWN');
    server.child.kill('SIGKILL');
    await server.exited;

    server = await startServer(db);
    const read = orderResponseSchema.parse(
      (await server.call(`/v1/orders/${order.id}`, { token: guest })).json(),
    ).data;
    expect(read.status).toBe('CONFIRMED');
    await stop(server);
    expectConsistent(await inspect(db));
  });
});
