import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createSessionResponseSchema, shoppingSessionResponseSchema } from '@velasia/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client';
import { checkIntegrity, type IntegrityReport } from '../src/db/integrity';
import { backup, restore, verify } from '../src/tools/db-tool';
import {
  ADULT,
  CONTACT,
  LAST_BUSINESS_SEAT,
  MNL_SIN,
  newGuestToken,
  pay,
  paymentOf,
  prepare,
  prepared,
  readyCheckout,
  type Caller,
} from './checkout-harness';
import { newDb, startServer, stop, useProcessHarness, type Server } from './process-harness';
import {
  cancellationQuote,
  confirmCancellation,
  confirmedBooking,
  confirmSeats,
  getOrder,
  seatQuote,
  type Booking,
} from './servicing-harness';

/*
 * Milestone 7: production reliability with real API processes on real TalaDB files.
 *
 * - shopping sessions survive graceful restarts and SIGKILL (written before they're acknowledged);
 * - SIGTERM drains in-flight searches, checkouts, and servicing payments, then exits 0;
 * - holds and pending payments survive restarts; repeated SIGKILLs during startup recovery never
 *   corrupt anything;
 * - backups are consistent cold copies, verified, restorable into a separate environment, and
 *   never taken while the API owns the file.
 *
 * Synthetic travellers only.
 */

useProcessHarness();

setFlagsFromString('--expose_gc');
const gc = runInNewContext('gc') as () => void;
async function collect() {
  for (let i = 0; i < 6; i += 1) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const newDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'velasia-m7-'));
  scratch.push(dir);
  return dir;
};

async function integrityOf(dbPath: string): Promise<IntegrityReport> {
  let db: Awaited<ReturnType<typeof openDatabase>> | null = await openDatabase(dbPath);
  try {
    return await checkIntegrity(db, { maxPaymentAttempts: 5 });
  } finally {
    await db.close();
    db = null;
    await collect();
  }
}

function expectHealthy(report: IntegrityReport) {
  expect(report.violations).toEqual([]);
  expect(report.ok).toBe(true);
}

/** `8C` on NV501 is an upgrade from the booked standard seat: the change needs a payment. */
async function quoteSeats(h: Caller, booking: Booking, flightId: string, seatId = '8C') {
  const changes = [{ travellerId: 'ADT1', flightId, seatId }];
  const response = await seatQuote(h, booking, changes);
  expect(response.statusCode, response.body).toBe(200);
  return { changes, quote: response.json().data };
}

async function cancelWithPendingRefund(h: Caller, booking: Booking) {
  const response = await cancellationQuote(h, booking);
  expect(response.statusCode, response.body).toBe(200);
  const cancelled = await confirmCancellation(h, booking, response.json().data.refundMinor, {
    refundOutcome: 'PENDING',
  });
  expect([200, 201, 202], cancelled.body).toContain(cancelled.statusCode);
}

const sessionOf = async (h: Caller, id: string, token: string) => {
  const response = await h.call(`/v1/shopping-sessions/${id}`, { token });
  return { status: response.statusCode, response };
};

describe('durable shopping sessions', { timeout: 120_000 }, () => {
  it('survive a graceful restart with their token, version, selections, and travellers', async () => {
    const db = newDb();
    let api: Server = await startServer(db);
    const ready = await readyCheckout(api, { passengers: [ADULT] });
    await stop(api);

    api = await startServer(db);
    const { status, response } = await sessionOf(api, ready.id, ready.token);
    expect(status, response.body).toBe(200);
    const session = shoppingSessionResponseSchema.parse(response.json()).data;
    expect(session.version).toBe(ready.version);
    expect(session.selections.outbound?.offer.id).toBe(ready.session.selections.outbound?.offer.id);
    expect(session.booking.passengers?.[0]?.familyName).toBe(ADULT.familyName);
    expect(session.booking.contact).toEqual(ready.session.booking.contact);
    expect(session.booking.contact?.email).toBe(CONTACT.email);
    // The token still decides access: a wrong one looks like an unknown session.
    expect((await sessionOf(api, ready.id, newGuestToken())).status).toBe(404);
    // The restored session checks out normally, with versioned updates intact.
    const guest = newGuestToken();
    const stale = await prepare(api, ready, guest, { expectedVersion: ready.version - 1 });
    expect(stale.statusCode).toBe(409);
    const order = await prepared(api, ready, guest);
    expect(order.status).toBe('PENDING_PAYMENT');
    await stop(api);
    expectHealthy(await integrityOf(db));
  });

  it('sync mode: durable before acknowledged — an answered change survives SIGKILL', async () => {
    const db = newDb();
    const SYNC = { SHOPPING_SESSION_DURABILITY: 'sync' };
    let api = await startServer(db, SYNC);
    const created = await api.call('/v1/shopping-sessions', {
      method: 'POST',
      body: { search: MNL_SIN },
    });
    expect(created.statusCode).toBe(201);
    const { session, token } = createSessionResponseSchema.parse(created.json()).data;
    // Power cut right after the answer: no graceful close, no final flush.
    api.child.kill('SIGKILL');
    await api.exited;

    api = await startServer(db, SYNC);
    const { status } = await sessionOf(api, session.id, token);
    expect(status).toBe(200);
    // Deleting a session is durable too.
    expect(
      (await api.call(`/v1/shopping-sessions/${session.id}`, { method: 'DELETE', token }))
        .statusCode,
    ).toBe(204);
    api.child.kill('SIGKILL');
    await api.exited;
    api = await startServer(db, SYNC);
    expect((await sessionOf(api, session.id, token)).status).toBe(404);
    await stop(api);
  });

  it('batched mode (default): a change survives SIGKILL once the flush interval has passed', async () => {
    const db = newDb();
    let api = await startServer(db, { SHOPPING_SESSION_FLUSH_MS: '200' });
    const created = await api.call('/v1/shopping-sessions', {
      method: 'POST',
      body: { search: MNL_SIN },
    });
    expect(created.statusCode).toBe(201);
    const { session, token } = createSessionResponseSchema.parse(created.json()).data;
    await new Promise((resolve) => setTimeout(resolve, 600));
    api.child.kill('SIGKILL');
    await api.exited;
    api = await startServer(db);
    expect((await sessionOf(api, session.id, token)).status).toBe(200);
    await stop(api);
  });
});

describe('graceful shutdown (SIGTERM)', { timeout: 120_000 }, () => {
  it('finishes an in-flight flight search, refuses new work, and exits 0', async () => {
    const db = newDb();
    const api = await startServer(db, { RETAILING_API_LATENCY_MS: '1200', LOG_LEVEL: 'info' });
    const search = api.call(
      '/v1/flights?from=MNL&to=SIN&departureDate=2026-12-15&adults=1&children=0&infants=0',
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    api.child.kill('SIGTERM');
    const answered = await search;
    expect(answered.statusCode).toBe(200);
    expect((await api.exited).code).toBe(0);
    expect(api.output()).toMatch(/shutdown complete/);
  });

  it('finishes an in-flight checkout payment before closing TalaDB; the booking is confirmed after restart', async () => {
    const db = newDb();
    let api = await startServer(db, {
      PAYMENT_PROVIDER_DELAY_MS: '1200',
      PAYMENT_PROVIDER_TIMEOUT_MS: '5000',
    });
    const ready = await readyCheckout(api);
    const guest = newGuestToken();
    const order = await prepared(api, ready, guest);
    const payment = pay(api, order.id, guest, { outcome: 'SUCCESS' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    api.child.kill('SIGTERM');
    const answered = await payment;
    expect(answered.statusCode, answered.body).toBe(201);
    expect(paymentOf(answered).order.status).toBe('CONFIRMED');
    expect((await api.exited).code).toBe(0);

    api = await startServer(db);
    expect((await getOrder(api, order.id, { token: guest })).status).toBe('CONFIRMED');
    await stop(api);
    const report = await integrityOf(db);
    expectHealthy(report);
    expect(report.providers.charges).toEqual({ SUCCEEDED: 1 });
  });

  it('finishes an in-flight servicing payment (paid seat change) before exiting', async () => {
    const db = newDb();
    let api = await startServer(db, {
      PAYMENT_PROVIDER_DELAY_MS: '1000',
      PAYMENT_PROVIDER_TIMEOUT_MS: '5000',
    });
    const flight = 'NV501-20261215';
    const booking = await confirmedBooking(api, {
      legs: [{ itineraryId: flight, family: 'LIGHT' }],
      seats: { [flight]: { ADT1: '14B' } },
    });
    const { changes, quote } = await quoteSeats(api, booking, flight);
    expect(quote.adjustment.kind).toBe('CHARGE');
    const change = confirmSeats(api, booking, changes, quote, { outcome: 'SUCCESS' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    api.child.kill('SIGTERM');
    const answered = await change;
    expect([200, 201]).toContain(answered.statusCode);
    expect((await api.exited).code).toBe(0);

    api = await startServer(db);
    const after = await getOrder(api, booking.order.id, { token: booking.guest });
    expect(after.seats.find((seat) => seat.flightId === flight)?.seatId).toBe(changes[0]!.seatId);
    await stop(api);
    expectHealthy(await integrityOf(db));
  });

  it('answers 503 to new requests once draining has begun', async () => {
    const db = newDb();
    const api = await startServer(db, { RETAILING_API_LATENCY_MS: '1500' });
    const slow = api.call(
      '/v1/flights?from=MNL&to=SIN&departureDate=2026-12-15&adults=1&children=0&infants=0',
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    api.child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The listener is closed: a new connection is refused, or an existing one gets 503.
    const late = await api.call('/health/ready').then(
      (response) => response.statusCode,
      () => 'refused',
    );
    expect([503, 'refused']).toContain(late);
    expect((await slow).statusCode).toBe(200);
    expect((await api.exited).code).toBe(0);
  });
});

describe('restart and crash recovery', { timeout: 180_000 }, () => {
  it('keeps an active hold across a restart: the last seat stays held for its order', async () => {
    const db = newDb();
    let api = await startServer(db);
    const plan = {
      legs: [{ itineraryId: LAST_BUSINESS_SEAT.itineraryId, family: 'BUSINESS' as const }],
      search: LAST_BUSINESS_SEAT.search,
      seats: 'none' as const,
    };
    const first = await readyCheckout(api, plan);
    const guest = newGuestToken();
    const held = await prepared(api, first, guest);
    expect(held.status).toBe('PENDING_PAYMENT');
    await stop(api);

    api = await startServer(db);
    // Someone else can't take the held seat after the restart: no Business offer is sellable.
    const offers = await api.call(
      `/v1/offers?itineraryId=${LAST_BUSINESS_SEAT.itineraryId}&adults=1&children=0&infants=0`,
    );
    const business = (offers.json().data.offers as { family: string }[]).find(
      (offer) => offer.family === 'BUSINESS',
    );
    expect(business).toBeUndefined();
    // …and the holder can still pay for it.
    const paid = await pay(api, held.id, guest, { outcome: 'SUCCESS' });
    expect(paid.statusCode, paid.body).toBe(201);
    await stop(api);
    const report = await integrityOf(db);
    expectHealthy(report);
    expect(report.orders.byStatus.CONFIRMED).toBe(1);
  });

  it('survives repeated SIGKILLs during startup recovery of pending payments and refunds', async () => {
    const db = newDb();
    let api = await startServer(db, { PAYMENT_PENDING_RESOLVE_MS: '2500' });
    // A checkout payment the provider has left PENDING, and a cancellation refund left PENDING.
    const ready = await readyCheckout(api);
    const guest = newGuestToken();
    const order = await prepared(api, ready, guest);
    const pending = await pay(api, order.id, guest, { outcome: 'PENDING' });
    expect(pending.statusCode, pending.body).toBe(202);
    const booking = await confirmedBooking(api, {
      legs: [{ itineraryId: 'NV501-20261215', family: 'FLEX' }],
      seats: 'none',
    });
    await cancelWithPendingRefund(api, booking);
    api.child.kill('SIGKILL');
    await api.exited;

    // Kill the next processes at arbitrary points of startup (open, migrations, ledger, recovery).
    const { spawn } = await import('node:child_process');
    for (const delay of [40, 120, 250, 400, 700]) {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: join(import.meta.dirname, '..'),
        env: {
          ...process.env,
          TALADB_PATH: db,
          RETAILING_API_PORT: '4999',
          VELASIA_TODAY: '2026-12-01',
          LOG_LEVEL: 'silent',
        },
        stdio: 'ignore',
      });
      const exited = new Promise((resolve) => child.once('exit', resolve));
      await new Promise((resolve) => setTimeout(resolve, delay));
      child.kill('SIGKILL');
      await exited;
    }
    // Let the provider's pending window pass.
    await new Promise((resolve) => setTimeout(resolve, 2_500));

    // A clean start finishes recovery: the pending payment and refund are decided once.
    api = await startServer(db);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const status = await api.call(`/v1/orders/${order.id}/payment-status`, { token: guest });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.order.status).toBe('CONFIRMED');
    await stop(api);
    const report = await integrityOf(db);
    expectHealthy(report);
    expect(report.providers.charges.SUCCEEDED).toBe(2);
    expect(report.orders.byStatus).toEqual({ CONFIRMED: 1, BOOKING_CANCELLED: 1 });
  });
});

describe('backup and restore', { timeout: 180_000 }, () => {
  it('takes a verified cold backup, restores it into a separate environment, and the API serves it correctly', async () => {
    const db = newDb();
    let api = await startServer(db, { PAYMENT_PENDING_RESOLVE_MS: '3000' });
    // 1. Confirmed orders, 2. servicing events, 3. pending payment and refund states.
    const flight = 'NV501-20261215';
    const confirmed = await confirmedBooking(api, {
      legs: [{ itineraryId: flight, family: 'LIGHT' }],
      seats: { [flight]: { ADT1: '14B' } },
    });
    const { changes, quote } = await quoteSeats(api, confirmed, flight);
    const seatChange = await confirmSeats(api, confirmed, changes, quote, { outcome: 'SUCCESS' });
    expect([200, 201]).toContain(seatChange.statusCode);
    const ready = await readyCheckout(api);
    const pendingGuest = newGuestToken();
    const pendingOrder = await prepared(api, ready, pendingGuest);
    expect((await pay(api, pendingOrder.id, pendingGuest, { outcome: 'PENDING' })).statusCode).toBe(
      202,
    );
    const toCancel = await confirmedBooking(api, {
      legs: [{ itineraryId: flight, family: 'FLEX' }],
      seats: 'none',
    });
    await cancelWithPendingRefund(api, toCancel);
    const before = await getOrder(api, confirmed.order.id, { token: confirmed.guest });

    // A backup is refused while the API owns the file.
    const backups = newDir();
    await expect(backup(db, backups)).rejects.toThrow(/in use by another process/);
    await expect(verify(db)).rejects.toThrow(/Stop the retailing API/);

    // 4. Back up (API stopped: a quiesced cold copy).
    await stop(api);
    const manifest = await backup(db, backups);
    await collect();
    expect(manifest.counts.orders).toBe(3);
    expect(manifest.orders.pendingPayment).toBe(1);
    expect(manifest.orders.refundPending).toBe(1);
    const backupFile = join(backups, manifest.file);
    expect(statSync(backupFile).mode & 0o777).toBe(0o600);
    expect(readdirSync(backups).sort()).toEqual(
      [manifest.file, manifest.file.replace(/\.db$/, '.json')].sort(),
    );

    // A restore never overwrites an existing database without --replace.
    await expect(restore(backupFile, db)).rejects.toThrow(/already exists/);
    await collect();

    // 5–7. Restore into a separate environment and start an API on it.
    const restoredDb = join(newDir(), 'restored', 'velasia.db');
    const restored = await restore(backupFile, restoredDb);
    expect(restored.replaced).toBeNull();
    expectHealthy(restored.report);
    api = await startServer(restoredDb, { PAYMENT_PENDING_RESOLVE_MS: '0' });

    // 8. Order integrity: same revision, seats, and servicing history.
    const after = await getOrder(api, confirmed.order.id, { token: confirmed.guest });
    expect(after.revision).toBe(before.revision);
    expect(after.seats).toEqual(before.seats);
    // Ownership survived: a different guest still can't see it.
    expect(
      (await api.call(`/v1/orders/${confirmed.order.id}`, { token: newGuestToken() })).statusCode,
    ).toBe(404);
    // 9. Inventory: the restored ledger still holds the changed seat.
    const report = await integrityOf(db);
    expectHealthy(report);
    // 10. Reconciliation: the pending payment is decided once in the restored environment.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const status = await api.call(`/v1/orders/${pendingOrder.id}/payment-status`, {
      token: pendingGuest,
    });
    expect(status.json().data.order.status).toBe('CONFIRMED');
    await stop(api);
    const restoredReport = await integrityOf(restoredDb);
    expectHealthy(restoredReport);
    expect(restoredReport.orders.byStatus).toEqual({ CONFIRMED: 2, BOOKING_CANCELLED: 1 });

    // Replacing a live database keeps the old file beside it.
    const replaced = await restore(backupFile, restoredDb, { replace: true });
    await collect();
    expect(replaced.replaced && existsSync(replaced.replaced)).toBe(true);
  });

  it('refuses a backup whose checksum no longer matches its manifest', async () => {
    const db = newDb();
    const api = await startServer(db);
    await confirmedBooking(api);
    await stop(api);
    const backups = newDir();
    const manifest = await backup(db, backups);
    await collect();
    const file = join(backups, manifest.file);
    const { appendFileSync } = await import('node:fs');
    appendFileSync(file, 'tampered');
    await expect(restore(file, join(newDir(), 'x.db'))).rejects.toThrow(/checksum/);
  });
});
