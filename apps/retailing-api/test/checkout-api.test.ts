import {
  apiErrorSchema,
  checkoutValidateResponseSchema,
  orderResponseSchema,
  paymentOptionsResponseSchema,
  prepareCheckoutResponseSchema,
  seatsOf,
  sessionSeatMapResponseSchema,
  shoppingSessionResponseSchema,
  validateBookingResponseSchema,
} from '@velasia/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADULT,
  ADULT_2,
  CHILD,
  CONTACT,
  INBOUND,
  INFANT,
  MNL_SIN,
  OUTBOUND,
  newGuestToken,
  newKey,
  pay,
  prepare,
  prepared,
  readyCheckout,
  startHarness,
  type CallResult,
  type Harness,
  type ReadyCheckout,
} from './checkout-harness';

/*
 * Checkout through the HTTP API: the final validation, the pending order and its seat hold,
 * idempotency, the immutable snapshot, and who may see what. Synthetic travellers only.
 */

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

function expectError(response: CallResult, status: number, code: string) {
  expect(response.statusCode, response.body).toBe(status);
  expect(String(response.headers['cache-control'])).toContain('no-store');
  const body = apiErrorSchema.parse(response.json());
  expect(body.error.code).toBe(code);
  expect(response.body).not.toMatch(/at \w+ \(|node_modules|stack/i);
  // Error messages never echo personal details.
  for (const detail of [ADULT.givenName, ADULT.familyName, CONTACT.email]) {
    expect(response.body).not.toContain(detail);
  }
  return body;
}

const orderCount = () => h.app.persistence.orders.count();
const orderOf = (response: CallResult) => orderResponseSchema.parse(response.json()).data;
const seatMapFor = async (ready: ReadyCheckout, flightId: string) =>
  sessionSeatMapResponseSchema.parse(
    (
      await h.call(`/v1/shopping-sessions/${ready.id}/seatmaps/${flightId}`, { token: ready.token })
    ).json(),
  ).data;
const availability = async (flightId: string, cabin = 'economy') => {
  const body = (await h.call(`/v1/flights/${flightId}/availability`)).json();
  return body.data.segments[0].cabins.find((c: { cabin: string }) => c.cabin === cabin)
    .available as number;
};

describe('checkout: creating the pending order', () => {
  it('validates, then creates a pending order that holds the seats in one durable write', async () => {
    const ready = await readyCheckout(h, {
      passengers: [ADULT, CHILD],
      search: { passengers: { adults: 1, children: 1, infants: 0 } },
      extras: [
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_15' },
        { category: 'MEAL', travellerId: 'CHD1', flightId: OUTBOUND, productId: 'MEAL_CHILD' },
      ],
    });
    const before = await availability(OUTBOUND);
    const guest = newGuestToken();
    const response = await prepare(h, ready, guest);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const { order, replayed } = prepareCheckoutResponseSchema.parse(response.json()).data;
    expect(replayed).toBe(false);
    expect(order).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentStatus: 'NOT_STARTED',
      currency: 'PHP',
      totalMinor: ready.totalMinor,
      hold: { status: 'HELD', seatsPerFlight: 2, flightIds: [OUTBOUND] },
      payment: { canPay: true, awaitingResult: false, attemptsRemaining: 5 },
    });
    expect(order.reference).toMatch(/^VEL-[A-HJKMNP-Z2-9]{6}$/);
    expect(order.id).toMatch(/^ord_/);
    expect(Date.parse(order.hold.expiresAt) - Date.parse(order.createdAt)).toBe(10 * 60_000);

    // The snapshot: itemised, priced, and adding up to the authoritative quote.
    const kinds = order.items.map((item) => item.kind).sort();
    expect(kinds).toEqual(['BAGGAGE', 'FLIGHT', 'FLIGHT', 'MEAL', 'SEAT', 'SEAT']);
    expect(order.items.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(order.totalMinor);
    for (const item of order.items)
      expect(item.amountMinor).toBe(item.unitPriceMinor * item.quantity);
    expect(order.totals.totalMinor).toBe(order.totalMinor);
    expect(order.passengers.map((p) => p.id)).toEqual(['ADT1', 'CHD1']);
    expect(order.seats).toHaveLength(2);
    expect(order.baggage.find((b) => b.travellerId === 'ADT1')?.extraKg).toBe(15);
    expect(order.journeys[0]).toMatchObject({ direction: 'outbound', family: 'CLASSIC' });

    // The seats are held for real: another guest sees them taken and the inventory is lower.
    expect(await availability(OUTBOUND)).toBe(before - 2);
    const other = await readyCheckout(h, { seats: 'none' });
    const map = await seatMapFor(other, OUTBOUND);
    for (const seat of order.seats) {
      expect(seatsOf(map.seatMap).find((s) => s.id === seat.seatId)?.status).toBe('OCCUPIED');
    }
    // Durable: in TalaDB as one document with its hold.
    const stored = await h.app.persistence.orders.byId(order.id);
    expect(stored).toMatchObject({ status: 'PENDING_PAYMENT', hold: { status: 'HELD' } });
    expect(stored!.events.map((e) => e.type)).toEqual(['ORDER_CREATED', 'INVENTORY_HELD']);
  });

  it('holds every flight of a round trip in one allocation', async () => {
    const ready = await readyCheckout(h, {
      legs: [
        { itineraryId: OUTBOUND, family: 'LIGHT' },
        { itineraryId: INBOUND, family: 'LIGHT' },
      ],
      search: { tripType: 'round-trip', returnDate: '2026-12-20' },
    });
    const order = await prepared(h, ready, newGuestToken());
    expect(order.hold.flightIds).toEqual([OUTBOUND, INBOUND]);
    expect(order.journeys.map((j) => j.direction)).toEqual(['outbound', 'inbound']);
    const stored = await h.app.persistence.orders.byId(order.id);
    expect(stored!.hold.allocations.map((a) => [a.flightId, a.seats, a.seatIds.length])).toEqual([
      [OUTBOUND, 1, 1],
      [INBOUND, 1, 1],
    ]);
  });

  it('takes no seat for a lap infant', async () => {
    const ready = await readyCheckout(h, {
      passengers: [ADULT, INFANT],
      search: { passengers: { adults: 1, children: 0, infants: 1 } },
    });
    const order = await prepared(h, ready, newGuestToken());
    expect(order.hold.seatsPerFlight).toBe(1);
    expect(order.passengers).toHaveLength(2);
  });

  it('validate re-checks without creating anything, and reports a stale total', async () => {
    const ready = await readyCheckout(h);
    const before = await orderCount();
    const response = await h.call('/v1/checkout/validate', {
      method: 'POST',
      token: ready.token,
      body: { sessionId: ready.id, acceptedTotalMinor: ready.totalMinor - 100 },
    });
    expect(response.statusCode, response.body).toBe(200);
    const result = checkoutValidateResponseSchema.parse(response.json()).data;
    expect(result.status).toBe('READY');
    expect(result.priceChange).toEqual({
      previousTotalMinor: ready.totalMinor - 100,
      currentTotalMinor: ready.totalMinor,
    });
    expect(result.holdMinutes).toBe(10);
    expect(await orderCount()).toBe(before);
  });
});

describe('checkout: what is refused', () => {
  it('a total the traveller didn’t agree to (PRICE_CHANGED), creating nothing', async () => {
    const ready = await readyCheckout(h);
    const before = await orderCount();
    const body = expectError(
      await prepare(h, ready, newGuestToken(), { acceptedTotalMinor: ready.totalMinor - 1 }),
      409,
      'PRICE_CHANGED',
    );
    expect(body.error.message).toMatch(/changed from ₱.* to ₱/);
    expect(await orderCount()).toBe(before);
  });

  it('a higher price after the offer expired, until the traveller accepts it', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const refused = expectError(
      await prepare(h, ready, guest, { scenario: 'price-increase' }),
      409,
      'CHECKOUT_NOT_READY',
    );
    expect(refused.error.issues?.[0]?.path).toBe('flights');
    // The M4 review now holds the new price for acceptance.
    const session = shoppingSessionResponseSchema.parse(
      (await h.call(`/v1/shopping-sessions/${ready.id}`, { token: ready.token })).json(),
    ).data;
    const pending = session.selections.outbound!.pendingOffer!;
    expect(pending.price.totalMinor).toBeGreaterThan(
      session.selections.outbound!.offer.price.totalMinor,
    );
    // Accept it, re-validate, and check out at the new total.
    const accepted = await h.call(`/v1/shopping-sessions/${ready.id}/select`, {
      method: 'POST',
      token: ready.token,
      scenario: 'price-increase',
      body: { direction: 'outbound', offerId: pending.id },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const validated = validateBookingResponseSchema.parse(
      (
        await h.call(`/v1/shopping-sessions/${ready.id}/validate`, {
          method: 'POST',
          token: ready.token,
          scenario: 'price-increase',
          body: {},
        })
      ).json(),
    ).data;
    expect(validated.review.status).toBe('READY');
    const order = await prepared(h, ready, guest, {
      scenario: 'price-increase',
      expectedVersion: validated.session.version,
      acceptedTotalMinor: validated.quote.totals.totalMinor,
    });
    expect(order.totalMinor).toBe(validated.quote.totals.totalMinor);
    expect(order.totalMinor).toBeGreaterThan(ready.totalMinor);
  });

  it('an expired offer is refreshed at the same price, so checkout goes ahead', async () => {
    const ready = await readyCheckout(h);
    const order = await prepared(h, ready, newGuestToken(), { scenario: 'offer-expired' });
    expect(order.totalMinor).toBe(ready.totalMinor);
    expect(order.journeys[0]!.offerId).not.toBe(ready.session.selections.outbound!.offer.id);
  });

  it('a seat taken meanwhile: the seat is released and the traveller sent back to seats', async () => {
    const ready = await readyCheckout(h);
    const before = await orderCount();
    const body = expectError(
      await prepare(h, ready, newGuestToken(), { scenario: 'seat-taken' }),
      409,
      'CHECKOUT_NOT_READY',
    );
    expect(body.error.issues?.[0]?.path).toBe('seats');
    expect(await orderCount()).toBe(before);
  });

  it('flights that sold out meanwhile', async () => {
    const ready = await readyCheckout(h);
    expectError(
      await prepare(h, ready, newGuestToken(), { scenario: 'sold-out' }),
      409,
      'CHECKOUT_NOT_READY',
    );
  });

  it('a booking with missing traveller details, or steps not finished', async () => {
    const created = await h.call('/v1/shopping-sessions', {
      method: 'POST',
      body: { search: MNL_SIN },
    });
    const { session, token } = created.json().data;
    const body = expectError(
      await h.call('/v1/checkout/prepare', {
        method: 'POST',
        token,
        guest: newGuestToken(),
        body: {
          sessionId: session.id,
          idempotencyKey: newKey(),
          expectedVersion: session.version,
          acceptedTotalMinor: 0,
        },
      }),
      409,
      'BOOKING_STEP_UNAVAILABLE',
    );
    expect(body.error.message).toMatch(/flights/i);
  });

  it('a session changed since it was reviewed (stale version)', async () => {
    const ready = await readyCheckout(h);
    expectError(
      await prepare(h, ready, newGuestToken(), { expectedVersion: ready.version - 1 }),
      409,
      'SESSION_CONFLICT',
    );
  });

  it('prices, totals, or unknown fields in the request body', async () => {
    const ready = await readyCheckout(h);
    for (const extra of [{ totalMinor: 1 }, { priceMinor: 1 }, { items: [] }]) {
      expectError(await prepare(h, ready, newGuestToken(), { extra }), 400, 'BAD_REQUEST');
    }
    expectError(
      await h.call('/v1/checkout/prepare', {
        method: 'POST',
        token: ready.token,
        guest: newGuestToken(),
        body: {
          sessionId: ready.id,
          idempotencyKey: 'short',
          expectedVersion: 1,
          acceptedTotalMinor: 1,
        },
      }),
      400,
      'BAD_REQUEST',
    );
  });

  it('a checkout without a guest token, or for someone else’s session', async () => {
    const ready = await readyCheckout(h);
    expectError(
      await h.call('/v1/checkout/prepare', {
        method: 'POST',
        token: ready.token,
        body: {
          sessionId: ready.id,
          idempotencyKey: newKey(),
          expectedVersion: ready.version,
          acceptedTotalMinor: ready.totalMinor,
        },
      }),
      400,
      'BAD_REQUEST',
    );
    const stranger = await readyCheckout(h);
    expectError(
      await prepare(h, { ...ready, token: stranger.token }, newGuestToken()),
      404,
      'SESSION_NOT_FOUND',
    );
  });
});

describe('checkout: idempotency', () => {
  it('the same key returns the same order; a reused key with other parameters is refused', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const key = newKey();
    const first = await prepared(h, ready, guest, { key });
    const again = await prepare(h, ready, guest, { key });
    expect(again.statusCode).toBe(200);
    expect(prepareCheckoutResponseSchema.parse(again.json()).data).toMatchObject({
      replayed: true,
      order: { id: first.id, reference: first.reference },
    });
    expectError(
      await prepare(h, ready, guest, { key, acceptedTotalMinor: ready.totalMinor + 1 }),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
    // Another guest can't claim the order by replaying its key.
    expectError(await prepare(h, ready, newGuestToken(), { key }), 409, 'IDEMPOTENCY_CONFLICT');
    expect(await h.app.persistence.orders.pendingForSession(ready.id)).toHaveLength(1);
  });

  it('a double submission creates one order and one hold', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const key = newKey();
    const before = await availability(OUTBOUND);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => prepare(h, ready, guest, { key })),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    const ids = new Set(
      responses.map((r) => prepareCheckoutResponseSchema.parse(r.json()).data.order.id),
    );
    expect(ids.size).toBe(1);
    expect(await availability(OUTBOUND)).toBe(before - 1);
  });

  it('the same request from another tab (another key) returns the same pending order', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const first = await prepared(h, ready, guest);
    const second = await prepare(h, ready, guest); // same version and total, new key
    expect(second.statusCode).toBe(200);
    expect(prepareCheckoutResponseSchema.parse(second.json()).data.order.id).toBe(first.id);
  });

  it('checking out the same trip again keeps one hold; a changed trip replaces it', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const first = await prepared(h, ready, guest);
    // Back to the review and forward again: same content, newer session version.
    const revalidated = validateBookingResponseSchema.parse(
      (
        await h.call(`/v1/shopping-sessions/${ready.id}/validate`, {
          method: 'POST',
          token: ready.token,
          body: {},
        })
      ).json(),
    ).data;
    const again = await prepare(h, ready, guest, { expectedVersion: revalidated.session.version });
    expect(again.statusCode, again.body).toBe(200);
    expect(prepareCheckoutResponseSchema.parse(again.json()).data.order.id).toBe(first.id);

    // Change the seat: a different trip. The old hold is released, a new one created.
    const map = await seatMapFor(ready, OUTBOUND);
    const newSeat = seatsOf(map.seatMap).find(
      (s) =>
        s.status === 'AVAILABLE' &&
        s.cabin === 'economy' &&
        s.id !== first.seats[0]!.seatId &&
        s.category === 'STANDARD',
    )!;
    const base = `/v1/shopping-sessions/${ready.id}`;
    await h.call(`${base}/seats`, {
      method: 'PUT',
      token: ready.token,
      body: { assignments: [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: newSeat.id }] },
    });
    const validated = validateBookingResponseSchema.parse(
      (await h.call(`${base}/validate`, { method: 'POST', token: ready.token, body: {} })).json(),
    ).data;
    expect(validated.review.status).toBe('READY');
    const replaced = await prepared(h, ready, guest, {
      expectedVersion: validated.session.version,
      acceptedTotalMinor: validated.quote.totals.totalMinor,
    });
    expect(replaced.id).not.toBe(first.id);
    expect(replaced.seats[0]!.seatId).toBe(newSeat.id);
    const old = await h.app.persistence.orders.byId(first.id);
    expect(old).toMatchObject({
      status: 'CANCELLED',
      hold: { status: 'RELEASED', releaseReason: 'superseded' },
    });
    // The old seat is free again; the new one is taken.
    const other = await readyCheckout(h, { seats: 'none' });
    const seats = seatsOf((await seatMapFor(other, OUTBOUND)).seatMap);
    expect(seats.find((s) => s.id === first.seats[0]!.seatId)?.status).toBe('AVAILABLE');
    expect(seats.find((s) => s.id === newSeat.id)?.status).toBe('OCCUPIED');
  });
});

describe('orders: immutability and privacy', () => {
  it('a confirmed order never changes, and its session can’t be booked twice', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const order = await prepared(h, ready, guest);
    expect((await pay(h, order.id, guest, { outcome: 'SUCCESS' })).statusCode).toBe(201);
    const confirmed = orderOf(await h.call(`/v1/orders/${order.id}`, { token: guest }));
    expect(confirmed.status).toBe('CONFIRMED');
    expectError(await prepare(h, ready, guest), 409, 'SESSION_ORDERED');
    // Re-validating the session can't touch the order's snapshot.
    await h.call(`/v1/shopping-sessions/${ready.id}/validate`, {
      method: 'POST',
      token: ready.token,
      body: {},
    });
    const later = orderOf(await h.call(`/v1/orders/${order.id}`, { token: guest }));
    expect({ ...later, serverTime: '' }).toEqual({ ...confirmed, serverTime: '' });
  });

  it('only the owning guest can read an order; the reference alone is not a credential', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const order = await prepared(h, ready, guest);
    const own = await h.call(`/v1/orders/${order.id}`, { token: guest });
    expect(own.statusCode).toBe(200);
    expect(own.headers['cache-control']).toBe('private, no-store');
    const byReference = await h.call(`/v1/orders/reference/${order.reference}`, { token: guest });
    expect(orderOf(byReference).id).toBe(order.id);

    const unknown = expectError(
      await h.call('/v1/orders/ord_AAAAAAAAAAAAAAAAAAAAAA', { token: guest }),
      404,
      'ORDER_NOT_FOUND',
    );
    for (const attempt of [
      await h.call(`/v1/orders/${order.id}`, { token: newGuestToken() }),
      await h.call(`/v1/orders/${order.id}`),
      await h.call(`/v1/orders/${order.id}`, { token: ready.token }), // the session token isn't the guest token
      await h.call(`/v1/orders/reference/${order.reference}`),
      await h.call(`/v1/orders/reference/${order.reference}`, { token: newGuestToken() }),
    ]) {
      // Exactly the same answer as an order that doesn't exist.
      expect(expectError(attempt, 404, 'ORDER_NOT_FOUND')).toEqual(unknown);
    }
    expectError(await h.call('/v1/orders/not-an-order', { token: guest }), 400, 'BAD_REQUEST');
    // Another guest can't pay for it either, and nothing is recorded.
    expectError(
      await pay(h, order.id, newGuestToken(), { outcome: 'SUCCESS' }),
      404,
      'ORDER_NOT_FOUND',
    );
    expect((await h.app.persistence.orders.byId(order.id))!.attempts).toHaveLength(0);
  });

  it('never returns internal fields', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const order = await prepared(h, ready, guest);
    const stored = (await h.app.persistence.orders.byId(order.id))!;
    const body = (await h.call(`/v1/orders/${order.id}`, { token: guest })).body;
    for (const internal of [
      stored.ownerTokenHash,
      stored.guestId,
      stored.checkoutKey,
      stored.contentHash,
      guest,
    ]) {
      expect(body).not.toContain(internal);
    }
    expect(body).not.toMatch(/"rev"|"events"|"idempotencyKey"|"simulatedOutcome"/);
  });

  it('publishes the demo payment options', async () => {
    const response = await h.call('/v1/payments/options');
    const options = paymentOptionsResponseSchema.parse(response.json()).data;
    expect(options.methods.map((m) => m.code)).toEqual([
      'DEMO_CARD',
      'DEMO_WALLET',
      'DEMO_BANK_TRANSFER',
    ]);
    expect(options.outcomeControls).toBe(true);
    expect(options.outcomes.map((o) => o.code)).toEqual([
      'SUCCESS',
      'DECLINED',
      'TIMEOUT',
      'PENDING',
    ]);
    expect(options.disclaimer).toMatch(/simulated/i);
  });

  it('reports database readiness', async () => {
    const response = await h.call('/health/ready');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: { ok: true } });
    expect(response.body).not.toContain('velasia.db');
  });
});

describe('checkout with two adults', () => {
  it('holds one seat per traveller on each flight', async () => {
    const ready = await readyCheckout(h, {
      passengers: [ADULT, ADULT_2],
      search: { passengers: { adults: 2, children: 0, infants: 0 } },
    });
    const order = await prepared(h, ready, newGuestToken());
    expect(order.hold.seatsPerFlight).toBe(2);
    expect(order.seats.map((s) => s.travellerId).sort()).toEqual(['ADT1', 'ADT2']);
  });
});

describe('booking references', () => {
  it('a colliding reference is retried, never stored twice', async () => {
    const drawn = ['VEL-AAAAAA', 'VEL-AAAAAA', 'VEL-BBBBBB'];
    const local = await startHarness({ testHooks: { referenceGenerator: () => drawn.shift()! } });
    try {
      const first = await prepared(local, await readyCheckout(local), newGuestToken());
      const second = await prepared(local, await readyCheckout(local), newGuestToken());
      expect([first.reference, second.reference]).toEqual(['VEL-AAAAAA', 'VEL-BBBBBB']);
      expect(drawn).toEqual([]); // the duplicate was drawn, checked, and discarded
    } finally {
      await local.close();
    }
  });
});
