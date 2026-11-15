import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADULT, ADULT_2, INFANT, startHarness, type Harness } from './checkout-harness';
import {
  ancillaryQuote,
  assertDurableConsistency,
  confirmAncillaries,
  confirmSeats,
  confirmedBooking,
  getOrder,
  refreshed,
  resultOf,
  seatQuote,
  type Booking,
} from './servicing-harness';

/*
 * Seat changes and post-booking services (Milestone 6). MNL → SIN NV501 on 15 Dec (A321neo,
 * medium band): Classic includes standard seats; preferred ₱600, extra legroom ₱1,000. Free
 * economy seats used below: 14B / 14D / 14E / 15B / 15C / 15F standard, 8C extra legroom,
 * 12C preferred; exit row 24C; 1C Business, 4A premium economy; 8A taken by seeded demand. Services (medium band): extra 20 kg ₱1,800, hot meal
 * ₱350, premium meal ₱750, priority boarding ₱350.
 */

const PESO = 100;
const FLIGHT = 'NV501-20261215';
const CLASSIC = { legs: [{ itineraryId: FLIGHT, family: 'CLASSIC' as const }], seats: { [FLIGHT]: { ADT1: '14B' } } };

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await assertDurableConsistency(h);
  await h.close();
});

async function quoteFor(booking: Booking, changes: object[]) {
  const response = await seatQuote(h, booking, changes);
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data;
}

async function changeSeats(booking: Booking, changes: object[], options: Parameters<typeof confirmSeats>[4] = {}) {
  return confirmSeats(h, booking, changes, await quoteFor(booking, changes), options);
}

describe('seat changes', { timeout: 60_000 }, () => {
  it('shows the booking’s own seat as theirs, with what was paid for it', async () => {
    const booking = await confirmedBooking(h, CLASSIC);
    const response = await h.call(`/v1/orders/${booking.order.id}/seatmaps/${FLIGHT}`, { token: booking.guest });
    expect(response.statusCode).toBe(200);
    const map = response.json().data;
    expect(map.assignments).toMatchObject([{ travellerId: 'ADT1', seatId: '14B', included: true }]);
    const own = map.seatMap.cabins.flatMap((c: { rows: { seats: { id: string; status: string }[] }[] }) => c.rows.flatMap((r) => r.seats)).find((s: { id: string } | null) => s?.id === '14B');
    expect(own.status).toBe('AVAILABLE');
    expect(map.paid).toEqual([{ travellerId: 'ADT1', amountMinor: 0 }]);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('a standard seat for a standard seat costs nothing and applies at once', async () => {
    const booking = await confirmedBooking(h, CLASSIC);
    const response = await changeSeats(booking, [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '15C' }]);
    expect(response.statusCode, response.body).toBe(201);
    const { order, operation } = resultOf(response);
    expect(operation.adjustment.kind).toBe('NONE');
    expect(order.seats).toMatchObject([{ seatId: '15C' }]);
    const occupancy = h.app.persistence.ledger.occupancy(FLIGHT).seatIds;
    expect(occupancy.has('15C')).toBe(true);
    expect(occupancy.has('14B')).toBe(false);
  });

  it('a paid seat charges the difference; a cheaper seat later is not refunded', async () => {
    const booking = await confirmedBooking(h, CLASSIC);
    const up = resultOf(await changeSeats(booking, [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '8C' }]));
    expect(up.operation.adjustment).toEqual({ kind: 'CHARGE', amountMinor: 1000 * PESO });
    expect(up.order.seats[0]).toMatchObject({ seatId: '8C', category: 'EXTRA_LEGROOM', priceMinor: 1000 * PESO });
    const next = await refreshed(h, booking);
    const quote = await quoteFor(next, [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '12C' }]);
    expect(quote.netMinor).toBe(0);
    expect(quote.lines.map((line: { kind: string; amountMinor: number }) => [line.kind, line.amountMinor])).toEqual([
      ['SEAT', 600 * PESO],
      ['ALREADY_PAID', -600 * PESO],
    ]);
    expect(quote.notes.join(' ')).toMatch(/isn’t refunded/);
    const down = resultOf(await confirmSeats(h, next, [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '12C' }], quote));
    expect(down.order.financial.refundedMinor).toBe(0);
    expect(down.order.currentTotalMinor).toBe(booking.order.totalMinor + 1000 * PESO);
  });

  it('refuses seats in another cabin, exit rows for an adult with an infant, and lap infants', async () => {
    const booking = await confirmedBooking(h, {
      legs: [{ itineraryId: FLIGHT, family: 'CLASSIC' }],
      search: { passengers: { adults: 1, children: 0, infants: 1 } },
      passengers: [ADULT, INFANT],
      seats: 'none',
    });
    for (const [seatId, travellerId] of [
      ['1C', 'ADT1'],
      ['4A', 'ADT1'],
      ['24C', 'ADT1'],
      ['15C', 'INF1'],
    ] as const) {
      const response = await seatQuote(h, booking, [{ travellerId, flightId: FLIGHT, seatId }]);
      expect(response.statusCode, seatId).toBe(422);
      expect(response.json().error.code).toBe('SEAT_INELIGIBLE');
    }
  });

  it('refuses an occupied seat, a companion’s seat, and one seat for two travellers', async () => {
    const booking = await confirmedBooking(h, {
      legs: [{ itineraryId: FLIGHT, family: 'CLASSIC' }],
      search: { passengers: { adults: 2, children: 0, infants: 0 } },
      passengers: [ADULT, ADULT_2],
      seats: { [FLIGHT]: { ADT1: '14B', ADT2: '14D' } },
    });
    const occupied = await seatQuote(h, booking, [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '8A' }]);
    expect(occupied.json().error.code).toBe('SEAT_UNAVAILABLE');
    const companion = await seatQuote(h, booking, [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '14D' }]);
    expect(companion.json().error.code).toBe('SEAT_UNAVAILABLE');
    const twice = await seatQuote(h, booking, [
      { travellerId: 'ADT1', flightId: FLIGHT, seatId: '15C' },
      { travellerId: 'ADT2', flightId: FLIGHT, seatId: '15C' },
    ]);
    expect(twice.json().error.code).toBe('SEAT_UNAVAILABLE');
    // Both travellers moved together in one change; nobody else's seat moves.
    const both = resultOf(
      await changeSeats(booking, [
        { travellerId: 'ADT1', flightId: FLIGHT, seatId: '15C' },
        { travellerId: 'ADT2', flightId: FLIGHT, seatId: '15F' },
      ]),
    );
    expect(both.order.seats.map((seat) => `${seat.travellerId}:${seat.seatId}`).sort()).toEqual(['ADT1:15C', 'ADT2:15F']);
  });

  it('connecting flights: a seat changes on one flight and the other flight keeps its seat', async () => {
    const booking = await confirmedBooking(h, {
      legs: [{ itineraryId: 'NV101-20261216_NV701-20261216', family: 'CLASSIC' }],
      search: { departDate: '2026-12-16' },
    });
    const before = booking.order.seats.find((seat) => seat.flightId === 'NV101-20261216')!;
    const map = (await h.call(`/v1/orders/${booking.order.id}/seatmaps/NV701-20261216`, { token: booking.guest })).json().data;
    const target = map.seatMap.cabins
      .flatMap((c: { cabin: string; rows: { seats: ({ id: string; status: string; category: string; restrictions: string[] } | null)[] }[] }) => (c.cabin === 'economy' ? c.rows.flatMap((r) => r.seats) : []))
      .find((s: { id: string; status: string; category: string; restrictions: string[] } | null) => s && s.status === 'AVAILABLE' && s.category === 'STANDARD' && s.restrictions.length === 0 && !map.assignments.some((a: { seatId: string }) => a.seatId === s.id))!;
    const { order } = resultOf(await changeSeats(booking, [{ travellerId: 'ADT1', flightId: 'NV701-20261216', seatId: target.id }]));
    expect(order.seats.find((seat) => seat.flightId === 'NV101-20261216')).toEqual(before);
    expect(order.seats.find((seat) => seat.flightId === 'NV701-20261216')?.seatId).toBe(target.id);
  });

  it('a failed payment keeps the original seat; the new seat is held for the change meanwhile', async () => {
    const booking = await confirmedBooking(h, CLASSIC);
    const response = await changeSeats(booking, [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '8C' }], { outcome: 'DECLINED' });
    const { order, operation } = resultOf(response);
    expect(operation.status).toBe('AWAITING_PAYMENT');
    expect(order.seats).toMatchObject([{ seatId: '14B' }]);
    const occupancy = h.app.persistence.ledger.occupancy(FLIGHT).seatIds;
    expect(occupancy.has('14B') && occupancy.has('8C')).toBe(true);
    // Another traveller can't take the claimed seat.
    const other = await confirmedBooking(h, { ...CLASSIC, seats: { [FLIGHT]: { ADT1: '14E' } } });
    const taken = await seatQuote(h, other, [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '8C' }]);
    expect(taken.json().error.code).toBe('SEAT_UNAVAILABLE');
  });

  it('two bookings race for the same seat: exactly one gets it', async () => {
    const a = await confirmedBooking(h, CLASSIC);
    const b = await confirmedBooking(h, { ...CLASSIC, seats: { [FLIGHT]: { ADT1: '15B' } } });
    const changes = [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '8C' }];
    const [qa, qb] = await Promise.all([quoteFor(a, changes), quoteFor(b, changes)]);
    const results = await Promise.all([confirmSeats(h, a, changes, qa), confirmSeats(h, b, changes, qb)]);
    const outcomes = results.map((r) => (r.statusCode === 201 ? 'ok' : r.json().error.code)).sort();
    expect(outcomes).toEqual(['SEAT_UNAVAILABLE', 'ok']);
  });

  it('a client-supplied price is rejected: there is no price field', async () => {
    const booking = await confirmedBooking(h, CLASSIC);
    const changes = [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '8C' }];
    const quote = await quoteFor(booking, changes);
    const response = await confirmSeats(h, booking, changes, quote, { extra: { amountMinor: 1 } });
    expect(response.statusCode).toBe(400);
    const priced = await seatQuote(h, booking, [{ ...changes[0], priceMinor: 0 }]);
    expect(priced.statusCode).toBe(400);
    const cheap = await confirmSeats(h, booking, changes, quote, { accepted: 0 });
    expect(cheap.json().error.code).toBe('PRICE_CHANGED');
  });
});

describe('services after booking', { timeout: 60_000 }, () => {
  const LIGHT = { legs: [{ itineraryId: FLIGHT, family: 'LIGHT' as const }], seats: 'none' as const };

  async function buy(booking: Booking, changes: object[], options: Parameters<typeof confirmAncillaries>[4] = {}) {
    const quote = await ancillaryQuote(h, booking, changes);
    expect(quote.statusCode, quote.body).toBe(200);
    return confirmAncillaries(h, booking, changes, quote.json().data, options);
  }

  it('adds checked baggage to a Light fare, charged once, with the allowance updated', async () => {
    const booking = await confirmedBooking(h, LIGHT);
    const offers = (await h.call(`/v1/orders/${booking.order.id}/ancillaries`, { token: booking.guest })).json().data;
    const bag = offers.offers.find((offer: { productId: string }) => offer.productId === 'BAG_20');
    expect(bag).toMatchObject({ payableMinor: 1800 * PESO, owned: false, unavailableReason: null });
    const changes = [{ category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_20' }];
    const { order, operation } = resultOf(await buy(booking, changes));
    expect(operation.adjustment).toEqual({ kind: 'CHARGE', amountMinor: 1800 * PESO });
    expect(order.baggage[0]).toMatchObject({ extraKg: 20, totalKg: 20 });
    expect(order.items.filter((item) => item.kind === 'BAGGAGE')).toHaveLength(1);
    // Buying it again is a duplicate, not a second charge.
    const again = await ancillaryQuote(h, await refreshed(h, booking), changes);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ANCILLARY_UNAVAILABLE');
  });

  it('a meal upgrade pays only the difference', async () => {
    const booking = await confirmedBooking(h, LIGHT);
    const hot = [{ category: 'MEAL', travellerId: 'ADT1', flightId: FLIGHT, productId: 'MEAL_HOT' }];
    resultOf(await buy(booking, hot));
    const premium = [{ category: 'MEAL', travellerId: 'ADT1', flightId: FLIGHT, productId: 'MEAL_PREMIUM' }];
    const next = await refreshed(h, booking);
    const { order, operation } = resultOf(await buy(next, premium));
    expect(operation.adjustment).toEqual({ kind: 'CHARGE', amountMinor: (750 - 350) * PESO });
    expect(order.ancillaries).toMatchObject([{ productId: 'MEAL_PREMIUM', priceMinor: 750 * PESO }]);
    expect(order.items.filter((item) => item.kind === 'MEAL').map((item) => item.amountMinor)).toEqual([750 * PESO]);
  });

  it('never sells what the fare includes, and complimentary Business meals cost nothing', async () => {
    const flex = await confirmedBooking(h, { legs: [{ itineraryId: FLIGHT, family: 'FLEX' }], seats: 'none' });
    const priority = await ancillaryQuote(h, flex, [{ category: 'PRIORITY', travellerId: 'ADT1', direction: 'outbound', productId: 'PRIORITY_BOARDING' }]);
    expect(priority.statusCode).toBe(422);
    expect(priority.json().error.message).toMatch(/already included in your Velasia Flex fare/);
    const business = await confirmedBooking(h, { legs: [{ itineraryId: FLIGHT, family: 'BUSINESS' }], search: { cabin: 'business' }, seats: 'none' });
    const { operation } = resultOf(await buy(business, [{ category: 'MEAL', travellerId: 'ADT1', flightId: FLIGHT, productId: 'MEAL_VEGAN' }]));
    expect(operation.adjustment.kind).toBe('NONE');
    expect(operation.payment).toBeNull();
  });

  it('rejects unsupported services, unknown travellers, and the same slot twice', async () => {
    const booking = await confirmedBooking(h, LIGHT);
    const unsupported = await ancillaryQuote(h, booking, [{ category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'LOUNGE_PASS' }]);
    expect(unsupported.json().error.code).toBe('ANCILLARY_UNAVAILABLE');
    const stranger = await ancillaryQuote(h, booking, [{ category: 'BAGGAGE', travellerId: 'ADT2', direction: 'outbound', productId: 'BAG_10' }]);
    expect(stranger.json().error.code).toBe('TRAVELLER_MISSING');
    const twice = await ancillaryQuote(h, booking, [
      { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' },
      { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_20' },
    ]);
    expect(twice.statusCode).toBe(422);
  });

  it('a declined payment adds nothing; a timed-out one is found by the status check, charged once', async () => {
    const booking = await confirmedBooking(h, LIGHT);
    const changes = [{ category: 'PRIORITY', travellerId: 'ADT1', direction: 'outbound', productId: 'PRIORITY_BOARDING' }];
    const declined = resultOf(await buy(booking, changes, { outcome: 'DECLINED' }));
    expect(declined.order.ancillaries).toEqual([]);
    await h.call(`/v1/orders/${booking.order.id}/servicing/${declined.operation.id}/abandon`, { method: 'POST', token: booking.guest, body: {} });
    const next = await refreshed(h, booking);
    const timedOut = await buy(next, changes, { outcome: 'TIMEOUT' });
    expect(timedOut.statusCode).toBe(202);
    const pending = resultOf(timedOut);
    expect(pending.operation.payment!.attempts.at(-1)!.status).toBe('UNKNOWN');
    expect(pending.order.ancillaries).toEqual([]);
    // Retrying the payment is refused while the result is unknown.
    const retry = await h.call(`/v1/orders/${booking.order.id}/servicing/${pending.operation.id}/payment-attempts`, {
      method: 'POST',
      token: booking.guest,
      body: { idempotencyKey: crypto.randomUUID(), method: 'DEMO_CARD' },
    });
    expect(retry.json().error.code).toBe('PAYMENT_PENDING');
    const status = await h.call(`/v1/orders/${booking.order.id}/servicing-status`, { token: booking.guest });
    const order = status.json().data;
    expect(order.ancillaries).toMatchObject([{ productId: 'PRIORITY_BOARDING' }]);
    const charges = (await h.app.persistence.provider.all()).filter((charge) => charge.orderId === booking.order.id);
    expect(charges.filter((charge) => charge.status === 'SUCCEEDED')).toHaveLength(2); // checkout + this
  });

  it('closes 3 hours before departure for bags (meals 24 hours)', async () => {
    const booking = await confirmedBooking(h, LIGHT);
    h.time.advance(Date.parse('2026-12-14T02:00:00Z') - h.time.clock.now()); // 14 Dec 10:00 Manila
    const meal = await ancillaryQuote(h, booking, [{ category: 'MEAL', travellerId: 'ADT1', flightId: FLIGHT, productId: 'MEAL_HOT' }]);
    expect(meal.json().error.message).toMatch(/24 hours before departure/);
    const bag = await ancillaryQuote(h, booking, [{ category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' }]);
    expect(bag.statusCode).toBe(200);
    h.time.advance(21 * 60 * 60_000); // 15 Dec 07:00, under 3 hours to go
    const late = await ancillaryQuote(h, booking, [{ category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' }]);
    expect(late.json().error.message).toMatch(/3 hours before departure/);
  });

  it('every successful change is in the history, and the original purchase is untouched', async () => {
    const booking = await confirmedBooking(h, LIGHT);
    resultOf(await buy(booking, [{ category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' }]));
    const order = await getOrder(h, booking.order.id, { token: booking.guest });
    expect(order.original.items).toEqual(booking.order.items);
    expect(order.servicing).toHaveLength(1);
    const events = (await h.call(`/v1/orders/${booking.order.id}/events`, { token: booking.guest })).json();
    const types = events.data.map((event: { type: string }) => event.type);
    expect(types).toEqual(expect.arrayContaining(['SERVICES_ADDED', 'SERVICING_PAYMENT_SUCCEEDED', 'SERVICING_COMPLETED']));
    expect(JSON.stringify(events)).not.toContain(booking.order.passengers[0]!.familyName);
  });
});
