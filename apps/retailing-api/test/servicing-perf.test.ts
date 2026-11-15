import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newGuestToken, startHarness, type Harness } from './checkout-harness';
import {
  confirmedBooking,
  confirmSeats,
  resultOf,
  seatQuote,
  type Booking,
} from './servicing-harness';

/*
 * Milestone 6 measurements (not a benchmark): opt in with `VELASIA_PERF=1`. Uses a real TalaDB
 * file with immediate durability, in process (app.inject), and prints a table for
 * MILESTONE-6-REPORT.md. Nothing is asserted beyond sanity.
 */

const enabled = process.env.VELASIA_PERF === '1';
const FLIGHT = 'NV501-20261215';

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    n: samples.length,
    p50: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +sorted.at(-1)!.toFixed(1),
  };
}

async function time<T>(fn: () => Promise<T>) {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}

describe.skipIf(!enabled)('servicing measurements', { timeout: 600_000 }, () => {
  it('measures reads, quotes, writes, contention, lists, document size, recovery, sessions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'velasia-perf-'));
    const h: Harness = await startHarness({
      config: { persistence: { path: join(dir, 'velasia.db') } },
    });
    const rows: Record<string, unknown> = {};
    const guest = newGuestToken();

    // 40 confirmed bookings for one guest (each has its own seat on NV501 or nothing).
    const bookings: Booking[] = [];
    for (let i = 0; i < 40; i += 1)
      bookings.push(await confirmedBooking(h, { seats: 'none' }, guest));
    const target = bookings[0]!;

    const reads = [];
    for (let i = 0; i < 200; i += 1)
      reads.push((await time(() => h.call(`/v1/orders/${target.order.id}`, { token: guest }))).ms);
    rows['order lookup (GET /v1/orders/:id)'] = stats(reads);

    const overview = [];
    for (let i = 0; i < 100; i += 1)
      overview.push(
        (await time(() => h.call(`/v1/orders/${target.order.id}/servicing`, { token: guest }))).ms,
      );
    rows['servicing overview'] = stats(overview);

    const quotes = [];
    for (let i = 0; i < 50; i += 1) {
      quotes.push(
        (
          await time(() =>
            h.call(`/v1/orders/${target.order.id}/change-quotes`, {
              method: 'POST',
              token: guest,
              body: { direction: 'outbound', date: '2026-12-16' },
            }),
          )
        ).ms,
      );
    }
    rows['change quotes (one date, all alternatives)'] = stats(quotes);

    const map = (
      await h.call(`/v1/orders/${target.order.id}/seatmaps/${FLIGHT}`, { token: guest })
    ).json().data;
    const free: string[] = map.seatMap.cabins
      .filter((cabin: { cabin: string }) => cabin.cabin === 'economy')
      .flatMap(
        (cabin: {
          rows: {
            seats: ({
              id: string;
              status: string;
              category: string;
              restrictions: string[];
            } | null)[];
          }[];
        }) => cabin.rows.flatMap((row) => row.seats),
      )
      .filter(
        (seat: { status: string; category: string; restrictions: string[] } | null) =>
          seat &&
          seat.status === 'AVAILABLE' &&
          seat.category === 'STANDARD' &&
          seat.restrictions.length === 0,
      )
      .map((seat: { id: string }) => seat.id);
    expect(free.length).toBeGreaterThanOrEqual(22);

    // Sequential servicing writes: free seat swaps on one booking (one CAS write each).
    let booking = target;
    const writes = [];
    for (let i = 0; i < 20; i += 1) {
      const changes = [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: free[i % 2]! }];
      const quoted = await seatQuote(h, booking, changes);
      expect(quoted.statusCode, quoted.body).toBe(200);
      const quote = quoted.json().data;
      const { ms, value } = await time(() => confirmSeats(h, booking, changes, quote));
      expect(value.statusCode).toBe(201);
      booking = { ...booking, order: resultOf(value).order };
      writes.push(ms);
    }
    rows['servicing confirm (seat change, no payment)'] = stats(writes);

    // Contention: 30 different bookings change seats at once; the serial writer orders them.
    const seats = free.slice(2, 22);
    let maxQueue = 0;
    const watcher = setInterval(
      () => (maxQueue = Math.max(maxQueue, h.app.persistence.queue.size)),
      1,
    );
    const contended = await time(() =>
      Promise.all(
        bookings.slice(1, 21).map(async (b, i) => {
          const changes = [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: seats[i]! }];
          const quote = await seatQuote(h, b, changes);
          if (quote.statusCode !== 200) return 'quote-refused';
          const response = await confirmSeats(h, b, changes, quote.json().data);
          return response.statusCode === 201 ? 'ok' : response.json().error.code;
        }),
      ),
    );
    clearInterval(watcher);
    const outcomes = contended.value.reduce<Record<string, number>>(
      (acc, o) => ((acc[o] = (acc[o] ?? 0) + 1), acc),
      {},
    );
    rows['20 concurrent seat changes'] = {
      wallMs: +contended.ms.toFixed(0),
      perSecond: +(20_000 / contended.ms).toFixed(1),
      maxQueue,
      outcomes,
    };

    // My Trips: link all 40 to an account, then page through.
    const account = (
      await h.call('/v1/accounts', {
        method: 'POST',
        body: {
          email: 'perf@example.com',
          password: 'perf-passphrase-123',
          givenName: 'Perf',
          familyName: 'Person',
        },
      })
    ).json().data.session.token;
    for (let i = 0; i < 40; i += 10) {
      await h.call('/v1/me/orders/link', {
        method: 'POST',
        account,
        token: guest,
        body: { orderIds: bookings.slice(i, i + 10).map((b) => b.order.id) },
      });
    }
    const pages = [];
    for (let page = 1; page <= 7; page += 1)
      pages.push(
        (
          await time(() =>
            h.call(`/v1/me/orders?section=upcoming&page=${page}&pageSize=6`, { account }),
          )
        ).ms,
      );
    rows['My Trips page (40 bookings, 6 per page)'] = stats(pages);

    // Document size of the booking with 20 operations.
    const raw = await h.app.persistence.database.orders.findOne({ orderId: booking.order.id });
    const fresh = await h.app.persistence.database.orders.findOne({
      orderId: bookings[39]!.order.id,
    });
    rows['order document size'] = {
      freshBytes: Buffer.byteLength(JSON.stringify(fresh)),
      after20OpsBytes: Buffer.byteLength(JSON.stringify(raw)),
      events: (raw!.events as unknown[]).length,
    };

    // Reconciliation over everything (nothing pending: the cost of the scan itself).
    const checkout = await time(() => h.app.persistence.orderService.reconcile(h.time.clock.now()));
    const servicing = await time(() => h.app.persistence.servicing.reconcile(h.time.clock.now()));
    rows['reconcile (41 orders, none pending)'] = {
      checkoutMs: +checkout.ms.toFixed(1),
      servicingMs: +servicing.ms.toFixed(1),
    };

    // Account sessions live in TalaDB, not memory: 300 sign-ins.
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;
    const signIns = [];
    for (let i = 0; i < 300; i += 1) {
      signIns.push(
        (
          await time(() =>
            h.call('/v1/sessions', {
              method: 'POST',
              client: `perf-client-${i}`,
              body: { email: 'perf@example.com', password: 'perf-passphrase-123' },
            }),
          )
        ).ms,
      );
    }
    if (global.gc) global.gc();
    rows['sign-in (Argon2id verify + session write)'] = stats(signIns);
    rows['heap after 300 sign-ins'] = {
      deltaMiB: +((process.memoryUsage().heapUsed - before) / 1024 / 1024).toFixed(2),
      sessionsStored: await h.app.persistence.sessions.count({}),
      rateLimitKeys: h.app.persistence.accounts.stats().rateLimitKeys,
    };

    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
