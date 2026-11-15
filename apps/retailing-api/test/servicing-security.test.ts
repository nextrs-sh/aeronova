import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrderRepository } from '../src/db/repositories/order-repository';
import { MAX_SERVICING_OPERATIONS, type StoredOrder } from '../src/db/schema';
import { FAST_PAYMENTS, newGuestToken, newKey, startHarness, type Harness } from './checkout-harness';
import {
  assertDurableConsistency,
  confirmedBooking,
  getOrder,
  resultOf,
  seatQuote,
  confirmSeats,
  refreshed,
} from './servicing-harness';

/*
 * Milestone 6 security and persistence: ownership on every servicing route, non-enumerating
 * answers, no client prices, no caching, no secrets in logs; schema v1 → v2 upgrade, CAS, and the
 * size bound of one order document.
 */

const FLIGHT = 'NV501-20261215';
let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await assertDurableConsistency(h);
  await h.close();
});

const routes = (orderId: string) => [
  ['GET', `/v1/orders/${orderId}`, undefined],
  ['GET', `/v1/orders/${orderId}/servicing`, undefined],
  ['GET', `/v1/orders/${orderId}/events`, undefined],
  ['GET', `/v1/orders/${orderId}/refunds`, undefined],
  ['GET', `/v1/orders/${orderId}/ancillaries`, undefined],
  ['GET', `/v1/orders/${orderId}/seatmaps/${FLIGHT}`, undefined],
  ['GET', `/v1/orders/${orderId}/servicing-status`, undefined],
  ['POST', `/v1/orders/${orderId}/change-quotes`, { direction: 'outbound', date: '2026-12-16' }],
  ['POST', `/v1/orders/${orderId}/cancellation-quotes`, {}],
  ['POST', `/v1/orders/${orderId}/seat-quotes`, { changes: [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '15C' }] }],
  ['POST', `/v1/orders/${orderId}/ancillary-quotes`, { changes: [{ category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' }] }],
  ['POST', `/v1/orders/${orderId}/cancellations`, { idempotencyKey: newKey(), expectedRevision: 2, acceptedRefundMinor: 0 }],
  ['POST', `/v1/orders/${orderId}/seat-changes`, { idempotencyKey: newKey(), expectedRevision: 2, acceptedAmountMinor: 0, changes: [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '15C' }] }],
  ['POST', `/v1/orders/${orderId}/refunds/retry`, {}],
] as const;

describe('ownership on every servicing route', { timeout: 60_000 }, () => {
  it('guest B, no token, and a forged order id all get the same 404 as an unknown order', async () => {
    const a = await confirmedBooking(h, { seats: 'none' });
    const unknownId = `ord_${'Z'.repeat(22)}`;
    for (const [method, url, body] of routes(a.order.id)) {
      const asOther = await h.call(url, { method, token: newGuestToken(), body });
      const asNobody = await h.call(url, { method, body });
      const unknown = await h.call(url.replace(a.order.id, unknownId), { method, token: a.guest, body });
      for (const response of [asOther, asNobody, unknown]) {
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json()).toEqual({ error: { code: 'ORDER_NOT_FOUND', message: 'We couldn’t find this booking.' } });
      }
    }
    // Nothing changed.
    expect((await getOrder(h, a.order.id, { token: a.guest })).revision).toBe(a.order.revision);
  });

  it('a booking reference grants nothing: guessing or knowing one reveals no data', async () => {
    const a = await confirmedBooking(h, { seats: 'none' });
    const real = await h.call(`/v1/orders/reference/${a.order.reference}`, { token: newGuestToken() });
    const fake = await h.call('/v1/orders/reference/VEL-ZZZZZZ', { token: newGuestToken() });
    expect(real.statusCode).toBe(404);
    expect(real.body).toBe(fake.body);
    expect(real.body).not.toContain(a.order.passengers[0]!.familyName);
    expect((await h.call(`/v1/orders/reference/${a.order.reference}`)).statusCode).toBe(404);
    expect((await h.call('/v1/orders/reference/not-a-reference')).statusCode).toBe(400);
  });

  it('every servicing answer is private and never stored by a cache', async () => {
    const a = await confirmedBooking(h, { seats: 'none' });
    for (const [method, url, body] of routes(a.order.id).slice(0, 11)) {
      const response = await h.call(url, { method, token: a.guest, body });
      expect(response.headers['cache-control'], `${method} ${url}`).toMatch(/no-store/);
    }
  });

  it('strict bodies: price, status, and owner fields are rejected', async () => {
    const a = await confirmedBooking(h, { seats: 'none' });
    const base = { idempotencyKey: newKey(), expectedRevision: a.order.revision, acceptedAmountMinor: 0 };
    for (const [url, body] of [
      [`/v1/orders/${a.order.id}/changes`, { ...base, direction: 'outbound', itineraryId: 'NV503-20261215', netMinor: 0 }],
      [`/v1/orders/${a.order.id}/changes`, { ...base, direction: 'outbound', itineraryId: 'NV503-20261215', payment: { method: 'DEMO_CARD', amountMinor: 1 } }],
      [`/v1/orders/${a.order.id}/ancillary-purchases`, { ...base, changes: [{ category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10', priceMinor: 0 }] }],
      [`/v1/orders/${a.order.id}/cancellations`, { idempotencyKey: newKey(), expectedRevision: 1, acceptedRefundMinor: 0, refundMinor: 999999 }],
      [`/v1/me/orders/link`, { orderIds: [a.order.id], ownerAccountId: 'acc_x' }],
    ] as const) {
      const response = await h.call(url, { method: 'POST', token: a.guest, body });
      expect([400, 401], url).toContain(response.statusCode);
    }
  });

  it('simulated outcomes are refused where outcome controls are off', async () => {
    const closed = await startHarness({ config: { payments: { ...FAST_PAYMENTS, outcomeControls: false } } });
    const booking = await confirmedBooking(closed, { seats: 'none' }, newGuestToken(), null);
    const changes = [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '8C' }];
    const quote = (await seatQuote(closed, booking, changes)).json().data;
    const response = await confirmSeats(closed, booking, changes, quote, { outcome: 'DECLINED' });
    expect(response.statusCode).toBe(400);
    await closed.close();
  });
});

describe('no credentials or personal data in logs', { timeout: 60_000 }, () => {
  it('registration, sign-in, linking, and servicing log no password, token, email, or name', async () => {
    let logs = '';
    const stream = new Writable({
      write(chunk, _encoding, done) {
        logs += chunk;
        done();
      },
    });
    const harness = await startHarness({ logger: { level: 'trace', stream } });
    const { app } = harness;
    const call = (url: string, options: Parameters<Harness['call']>[1] = {}) => harness.call(url, options);
    const booking = await confirmedBooking(harness, { seats: 'none' });
    const password = 'a-secret-passphrase-123';
    const email = 'logcheck@example.com';
    const registered = await call('/v1/accounts', { method: 'POST', body: { email, password, givenName: 'Logcheck', familyName: 'Person' } });
    const token = registered.json().data.session.token;
    await call('/v1/sessions', { method: 'POST', body: { email, password: 'wrong-password' } });
    await call('/v1/me/orders/link', { method: 'POST', token: booking.guest, account: token, body: { orderIds: [booking.order.id] } });
    await call(`/v1/orders/${booking.order.id}/cancellation-quotes`, { method: 'POST', account: token, body: {} });
    await app.close();
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [password, 'wrong-password', token, booking.guest, email, booking.order.contact.email, booking.order.passengers[0]!.familyName]) {
      expect(logs, secret).not.toContain(secret);
    }
  });
});

describe('TalaDB: servicing persistence', { timeout: 60_000 }, () => {
  it('a Milestone 5 document (schema 1) is read as version 2, serviced, and rewritten as version 2', async () => {
    const booking = await confirmedBooking(h, { seats: { [FLIGHT]: { ADT1: '14B' } } });
    const { orders } = h.app.persistence.database;
    const stored = await h.app.persistence.orders.byId(booking.order.id);
    // Write it back exactly as M5 stored it.
    const v1 = { ...(stored as StoredOrder) } as Record<string, unknown>;
    for (const key of ['ownerAccountId', 'ownership', 'current', 'servicing', 'cancelledAt', 'servicingAttemptIds', 'servicingState', 'listing', 'tripStartsAt', 'tripEndsAt']) delete v1[key];
    v1.schemaVersion = 1;
    await orders.deleteOne({ orderId: booking.order.id });
    await orders.insert(v1 as never);
    const upgraded = await new OrderRepository(orders).byId(booking.order.id);
    expect(upgraded).toMatchObject({ schemaVersion: 2, servicing: [], ownerAccountId: null, current: { version: 1 } });
    expect(upgraded!.current.items).toEqual(upgraded!.items);
    const changes = [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '15C' }];
    const quote = (await seatQuote(h, booking, changes)).json().data;
    const response = await confirmSeats(h, booking, changes, quote);
    expect(response.statusCode, response.body).toBe(201);
    const raw = await orders.findOne({ orderId: booking.order.id });
    expect(raw!.schemaVersion).toBe(2);
  });

  it('compare-and-set: two writers from one revision, exactly one wins', async () => {
    const booking = await confirmedBooking(h, { seats: 'none' });
    const repository = h.app.persistence.orders;
    const read = (await repository.byId(booking.order.id))!;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => repository.replace(read, { ...read, updatedAt: read.updatedAt + i + 1 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await repository.byId(booking.order.id))!.rev).toBe(read.rev + 1);
  });

  it('bounds one order document: at most 30 operations; the document stays small', async () => {
    let booking = await confirmedBooking(h, { seats: { [FLIGHT]: { ADT1: '14B' } } });
    const seats = ['15C', '14B'];
    for (let i = 0; i < MAX_SERVICING_OPERATIONS; i += 1) {
      const changes = [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: seats[i % 2]! }];
      const quote = (await seatQuote(h, booking, changes)).json().data;
      const response = await confirmSeats(h, booking, changes, quote);
      expect(response.statusCode, response.body).toBe(201);
      booking = { ...booking, order: resultOf(response).order };
    }
    booking = await refreshed(h, booking);
    const changes = [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '15C' }];
    const quote = (await seatQuote(h, booking, changes)).json().data;
    const limited = await confirmSeats(h, booking, changes, quote);
    expect(limited.json().error.code).toBe('LIMIT_REACHED');
    const raw = await h.app.persistence.database.orders.findOne({ orderId: booking.order.id });
    const bytes = Buffer.byteLength(JSON.stringify(raw));
    expect(raw!.events.length).toBeLessThanOrEqual(300);
    expect(bytes).toBeLessThan(256 * 1024);
  });
});
