import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './checkout-harness';
import {
  assertDurableConsistency,
  changeQuote,
  changeQuotes,
  confirmChange,
  confirmedBooking,
  getOrder,
  refreshed,
  resultOf,
} from './servicing-harness';

/*
 * Flight changes (Milestone 6) against a real app and its own TalaDB file. Prices come from the
 * deterministic inventory (pinned "today" 2026-12-01): MNL → SIN, one adult.
 *
 *   15 Dec  NV501 08:15  Light 7,540  Classic 8,730  Flex 10,380  Business 21,040
 *   15 Dec  NV503 14:40  Light 7,690  Classic 8,890  Flex 10,580
 *   16 Dec  NV501        Flex 9,940   Business 18,480
 *   16 Dec  NV503        Flex 9,510
 *   16 Dec  NV505 19:30  Classic 7,830  Business 18,480
 *   16 Dec  NV101 + NV701 via Cebu   Classic 11,208
 */

/** One adult, one way, no seat chosen (so no paid seat is released by a change). */
const ONE_WAY = (family: 'LIGHT' | 'CLASSIC' | 'FLEX' | 'BUSINESS', itineraryId = 'NV501-20261215') => ({
  legs: [{ itineraryId, family }],
  seats: 'none' as const,
  search: {
    departDate: `${itineraryId.slice(6, 10)}-${itineraryId.slice(10, 12)}-${itineraryId.slice(12, 14)}`,
    ...(family === 'BUSINESS' ? { cabin: 'business' as const } : {}),
  },
});
const PESO = 100;

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await assertDurableConsistency(h);
  await h.close();
});

describe('change flight: eligibility and quotes', { timeout: 60_000 }, () => {
  it('Classic: the new fare minus the current fare, plus the ₱1,200 change fee, to pay', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('CLASSIC'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-15', 'NV503-20261215');
    expect(quote.priceDifferenceMinor).toBe((8890 - 8730) * PESO);
    expect(quote.lines.find((line) => line.kind === 'CHANGE_FEE')?.amountMinor).toBe(1200 * PESO);
    expect(quote.netMinor).toBe((8890 - 8730 + 1200) * PESO);
    expect(quote.adjustment).toEqual({ kind: 'CHARGE', amountMinor: 1360 * PESO });
    expect(quote.lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(quote.netMinor);
    expect(quote.orderRevision).toBe(booking.order.revision);
  });

  it('Light: allowed for ₱2,500, but restricted within 24 hours of departure', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('LIGHT'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-15', 'NV503-20261215');
    expect(quote.lines.find((line) => line.kind === 'CHANGE_FEE')?.amountMinor).toBe(2500 * PESO);
    // NV501 leaves 15 Dec 08:15 Manila; move the clock to 14 Dec 09:00 (under 24 hours).
    h.time.advance(Date.parse('2026-12-14T01:00:00Z') - h.time.clock.now());
    const late = await changeQuotes(h, booking, 'outbound', '2026-12-15');
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toMatchObject({ code: 'CHANGE_NOT_ALLOWED' });
    expect(late.json().error.message).toMatch(/24 hours before departure/);
    const overview = await h.call(`/v1/orders/${booking.order.id}/servicing`, { token: booking.guest });
    expect(overview.json().data.servicing.changeFlight[0]).toMatchObject({ allowed: false });
  });

  it('rejects an invalid date, a date outside the schedule, the same flight, and another route', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('CLASSIC'));
    for (const date of ['2026-11-20', '2027-06-01']) {
      const response = await changeQuotes(h, booking, 'outbound', date);
      expect(response.statusCode, date).toBe(422);
      expect(response.json().error.code).toBe('CHANGE_NOT_ALLOWED');
    }
    expect((await changeQuotes(h, booking, 'outbound', '2026-13-40')).statusCode).toBe(400);
    expect((await changeQuotes(h, booking, 'inbound', '2026-12-16')).statusCode).toBe(422);
    const sameFlight = await changeQuotes(h, booking, 'outbound', '2026-12-15');
    const ids = sameFlight.json().data.alternatives.map((a: { itineraryId: string }) => a.itineraryId);
    expect(ids).not.toContain('NV501-20261215');
    const other = await h.call(`/v1/orders/${booking.order.id}/changes`, {
      method: 'POST',
      token: booking.guest,
      body: {
        idempotencyKey: crypto.randomUUID(),
        expectedRevision: booking.order.revision,
        acceptedAmountMinor: 0,
        direction: 'outbound',
        itineraryId: 'NV101-20261215',
      },
    });
    expect(other.statusCode).toBe(422);
    expect(other.json().error.message).toMatch(/same origin and destination/);
  });

  it('a sold-out replacement is unavailable and changes nothing', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('CLASSIC'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-15', 'NV503-20261215');
    const response = await confirmChange(h, booking, 'outbound', 'NV503-20261215', quote, {
      options: { scenario: 'sold-out' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVENTORY_UNAVAILABLE');
    const after = await getOrder(h, booking.order.id, { token: booking.guest });
    expect(after.revision).toBe(booking.order.revision);
    expect(after.journeys[0]!.itinerary.id).toBe('NV501-20261215');
  });

  it('a changed price is refused until the traveller accepts the new amount', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('CLASSIC'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-15', 'NV503-20261215');
    const stale = await confirmChange(h, booking, 'outbound', 'NV503-20261215', quote, {
      options: { scenario: 'price-increase' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('PRICE_CHANGED');
    // Nothing is charged silently: the order didn't move and no charge exists.
    expect((await h.app.persistence.provider.all()).length).toBe(1);
    const after = await getOrder(h, booking.order.id, { token: booking.guest });
    expect(after.servicing).toEqual([]);
  });
});

describe('change flight: the three money outcomes', { timeout: 60_000 }, () => {
  it('additional payment: original seats stay committed until the payment succeeds, then swap in one write', async () => {
    const booking = await confirmedBooking(h, { ...ONE_WAY('CLASSIC'), seats: { 'NV501-20261215': { ADT1: '14B' } } });
    const originalSeat = booking.order.seats[0]!;
    expect(originalSeat.included).toBe(true);
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-15', 'NV503-20261215');
    const response = await confirmChange(h, booking, 'outbound', 'NV503-20261215', quote);
    expect(response.statusCode, response.body).toBe(201);
    const { order, operation } = resultOf(response);
    expect(operation).toMatchObject({
      operation: 'CHANGE_FLIGHT',
      status: 'COMPLETED',
      previousRevision: booking.order.revision,
      adjustment: { kind: 'CHARGE', amountMinor: 1360 * PESO },
    });
    expect(operation.newRevision).toBe(order.revision);
    expect(order.journeys[0]!.itinerary.id).toBe('NV503-20261215');
    expect(order.original.journeys[0]!.itinerary.id).toBe('NV501-20261215');
    expect(order.original.totalMinor).toBe(booking.order.totalMinor);
    expect(order.currentTotalMinor).toBe(booking.order.totalMinor + 1360 * PESO);
    expect(order.financial.paidMinor).toBe(booking.order.totalMinor + 1360 * PESO);
    expect(order.items.find((item) => item.kind === 'CHANGE_FEE')?.amountMinor).toBe(1200 * PESO);
    // The old flight's seat is released; the new flight holds the party.
    expect(order.seats).toEqual([]);
    expect(order.hold.flightIds).toEqual(['NV503-20261215']);
    expect(h.app.persistence.ledger.occupancy('NV501-20261215').seatIds.has(originalSeat.seatId)).toBe(false);
    expect(h.app.persistence.ledger.seatsTaken('NV503-20261215', 'economy')).toBe(1);
  });

  it('a declined payment leaves the original booking exactly as it was, with its seat', async () => {
    const booking = await confirmedBooking(h, { ...ONE_WAY('CLASSIC'), seats: { 'NV501-20261215': { ADT1: '14B' } } });
    const seat = booking.order.seats[0]!;
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-15', 'NV503-20261215');
    const declined = await confirmChange(h, booking, 'outbound', 'NV503-20261215', quote, { outcome: 'DECLINED' });
    expect(declined.statusCode).toBe(201);
    const { order, operation } = resultOf(declined);
    expect(operation.status).toBe('AWAITING_PAYMENT');
    expect(operation.payment).toMatchObject({ canPay: true, attemptsRemaining: 2 });
    expect(order.journeys[0]!.itinerary.id).toBe('NV501-20261215');
    expect(order.seats).toEqual(booking.order.seats);
    expect(order.currentTotalMinor).toBe(booking.order.currentTotalMinor);
    // Both the original seat and the claimed replacement take inventory meanwhile.
    expect(h.app.persistence.ledger.occupancy('NV501-20261215').seatIds.has(seat.seatId)).toBe(true);
    expect(h.app.persistence.ledger.seatsTaken('NV503-20261215', 'economy')).toBe(1);
    // Another change is refused while this one waits; discarding releases the claim.
    const again = await changeQuotes(h, booking, 'outbound', '2026-12-15');
    expect(again.json().error.code).toBe('PAYMENT_PENDING');
    const abandon = await h.call(`/v1/orders/${order.id}/servicing/${operation.id}/abandon`, {
      method: 'POST',
      token: booking.guest,
      body: {},
    });
    expect(abandon.statusCode).toBe(201);
    expect(resultOf(abandon).operation.status).toBe('FAILED');
    expect(h.app.persistence.ledger.seatsTaken('NV503-20261215', 'economy')).toBe(0);
    const after = await getOrder(h, order.id, { token: booking.guest });
    expect(after.journeys[0]!.itinerary.id).toBe('NV501-20261215');
    expect(after.seats).toEqual(booking.order.seats);
    expect(after.financial.paidMinor).toBe(booking.order.totalMinor);
  });

  it('a declined payment can be retried; success then applies the change', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('CLASSIC'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-15', 'NV503-20261215');
    const declined = resultOf(await confirmChange(h, booking, 'outbound', 'NV503-20261215', quote, { outcome: 'DECLINED' }));
    const retry = await h.call(`/v1/orders/${booking.order.id}/servicing/${declined.operation.id}/payment-attempts`, {
      method: 'POST',
      token: booking.guest,
      body: { idempotencyKey: crypto.randomUUID(), method: 'DEMO_WALLET' },
    });
    expect(retry.statusCode, retry.body).toBe(201);
    const { order, operation } = resultOf(retry);
    expect(operation.status).toBe('COMPLETED');
    expect(operation.payment!.attempts.map((a) => a.status)).toEqual(['FAILED', 'SUCCEEDED']);
    expect(order.journeys[0]!.itinerary.id).toBe('NV503-20261215');
  });

  it('a claim that ends unpaid expires and releases the replacement seats', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('CLASSIC'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-15', 'NV503-20261215');
    const { operation } = resultOf(await confirmChange(h, booking, 'outbound', 'NV503-20261215', quote, { outcome: 'DECLINED' }));
    h.time.advance(11 * 60_000);
    // Expired before any sweep: it no longer takes seats…
    expect(h.app.persistence.ledger.seatsTaken('NV503-20261215', 'economy')).toBe(0);
    // …and the next read records it.
    const order = await getOrder(h, booking.order.id, { token: booking.guest });
    expect(order.servicing.find((op) => op.id === operation.id)?.status).toBe('EXPIRED');
    expect(order.journeys[0]!.itinerary.id).toBe('NV501-20261215');
  });

  it('refund outcome: a cheaper flight on a refundable fare (Flex) refunds the difference', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('FLEX'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-16', 'NV503-20261216');
    expect(quote.netMinor).toBe((9510 - 10380) * PESO);
    expect(quote.adjustment).toEqual({ kind: 'REFUND', amountMinor: 870 * PESO });
    const response = await confirmChange(h, booking, 'outbound', 'NV503-20261216', quote);
    expect(response.statusCode, response.body).toBe(201);
    const { order, operation } = resultOf(response);
    expect(operation.status).toBe('COMPLETED');
    expect(operation.refunds).toHaveLength(1);
    expect(operation.refunds[0]).toMatchObject({ status: 'SUCCEEDED', amountMinor: 870 * PESO });
    expect(order.financial).toMatchObject({ refundedMinor: 870 * PESO, refundPendingMinor: 0 });
    expect((await h.app.persistence.refundProvider.all()).length).toBe(1);
  });

  it('credit outcome: on a non-refundable fare the balance is kept as travel credit', async () => {
    // Classic with a paid extra-legroom seat (₱1,000): NV505 on 16 Dec is ₱900 cheaper, the seat
    // is released and credited, and the ₱1,200 fee applies: −900 − 1,000 + 1,200 = −700.
    const booking = await confirmedBooking(h, ONE_WAY('CLASSIC'));
    const legroom = await h.call(`/v1/orders/${booking.order.id}/seatmaps/NV501-20261215`, { token: booking.guest });
    const seatId = legroom
      .json()
      .data.seatMap.cabins.flatMap((cabin: { rows: unknown[] }) => cabin.rows).flatMap((row: { seats: ({ id: string; status: string; category: string; restrictions: string[] } | null)[] }) => row.seats)
      .find((seat: { status: string; category: string; restrictions: string[] } | null) => seat?.status === 'AVAILABLE' && seat.category === 'EXTRA_LEGROOM' && seat.restrictions.length === 0)!.id;
    const changes = [{ travellerId: 'ADT1', flightId: 'NV501-20261215', seatId }];
    const seatQuote = (await h.call(`/v1/orders/${booking.order.id}/seat-quotes`, { method: 'POST', token: booking.guest, body: { changes } })).json().data;
    const seated = await h.call(`/v1/orders/${booking.order.id}/seat-changes`, {
      method: 'POST',
      token: booking.guest,
      body: { idempotencyKey: crypto.randomUUID(), expectedRevision: booking.order.revision, acceptedAmountMinor: seatQuote.netMinor, changes, payment: { method: 'DEMO_CARD' } },
    });
    expect(seated.statusCode, seated.body).toBe(201);
    const next = await refreshed(h, booking);
    const quote = await changeQuote(h, next, 'outbound', '2026-12-16', 'NV505-20261216');
    expect(quote.lines.find((line) => line.kind === 'RELEASED_EXTRA')?.amountMinor).toBe(-1000 * PESO);
    expect(quote.adjustment).toEqual({ kind: 'CREDIT', amountMinor: 700 * PESO });
    const response = await confirmChange(h, next, 'outbound', 'NV505-20261216', quote);
    expect(response.statusCode, response.body).toBe(201);
    const { order } = resultOf(response);
    expect(order.financial.creditMinor).toBe(700 * PESO);
    expect(order.financial.refundedMinor).toBe(0);
    expect(order.seats).toEqual([]);
  });

  it('no difference: Business NV501 → NV505 on 16 Dec costs nothing and applies at once', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('BUSINESS', 'NV501-20261216'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-16', 'NV505-20261216');
    expect(quote.netMinor).toBe(0);
    expect(quote.adjustment.kind).toBe('NONE');
    const response = await confirmChange(h, booking, 'outbound', 'NV505-20261216', quote);
    expect(response.statusCode).toBe(201);
    const { order, operation } = resultOf(response);
    expect(operation.payment).toBeNull();
    expect(order.journeys[0]!.itinerary.id).toBe('NV505-20261216');
    expect(order.financial.paidMinor).toBe(booking.order.totalMinor);
  });
});

describe('change flight: trip shapes', { timeout: 60_000 }, () => {
  it('round trip: changes one direction and keeps the return; refuses an impossible return', async () => {
    const booking = await confirmedBooking(h, {
      legs: [
        { itineraryId: 'NV501-20261215', family: 'FLEX' },
        { itineraryId: 'NV502-20261220', family: 'FLEX' },
      ],
      search: { tripType: 'round-trip', returnDate: '2026-12-20' },
    });
    const quote = await changeQuote(h, booking, 'inbound', '2026-12-20', 'NV504-20261220');
    const { order } = resultOf(await confirmChange(h, booking, 'inbound', 'NV504-20261220', quote));
    expect(order.journeys.map((journey) => journey.itinerary.id)).toEqual(['NV501-20261215', 'NV504-20261220']);
    expect(order.hold.flightIds.sort()).toEqual(['NV501-20261215', 'NV504-20261220']);
    // Moving the outbound after the return is impossible.
    const next = await refreshed(h, { ...booking, order });
    const late = await changeQuotes(h, next, 'outbound', '2026-12-21');
    expect(late.json().data?.alternatives ?? []).toEqual([]);
  });

  it('connecting itinerary: both flights are claimed and committed together (all or nothing)', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('CLASSIC'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-16', 'NV101-20261216_NV701-20261216');
    expect(quote.netMinor).toBe((11208 - 8730 + 1200) * PESO);
    const response = await confirmChange(h, booking, 'outbound', 'NV101-20261216_NV701-20261216', quote, { outcome: 'DECLINED' });
    const pending = resultOf(response);
    expect(h.app.persistence.ledger.seatsTaken('NV101-20261216', 'economy')).toBe(1);
    expect(h.app.persistence.ledger.seatsTaken('NV701-20261216', 'economy')).toBe(1);
    const retry = await h.call(`/v1/orders/${booking.order.id}/servicing/${pending.operation.id}/payment-attempts`, {
      method: 'POST',
      token: booking.guest,
      body: { idempotencyKey: crypto.randomUUID(), method: 'DEMO_CARD' },
    });
    const { order } = resultOf(retry);
    expect(order.journeys[0]!.itinerary.segments.map((segment) => segment.id)).toEqual(['NV101-20261216', 'NV701-20261216']);
    expect(order.hold.flightIds).toEqual(['NV101-20261216', 'NV701-20261216']);
    expect(h.app.persistence.ledger.seatsTaken('NV501-20261215', 'economy')).toBe(0);
  });
});

describe('change flight: retries and conflicts', { timeout: 60_000 }, () => {
  it('the same request twice applies once and charges once', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('CLASSIC'));
    const quote = await changeQuote(h, booking, 'outbound', '2026-12-15', 'NV503-20261215');
    const key = crypto.randomUUID();
    const [first, second] = await Promise.all([
      confirmChange(h, booking, 'outbound', 'NV503-20261215', quote, { key }),
      confirmChange(h, booking, 'outbound', 'NV503-20261215', quote, { key }),
    ]);
    // One request did the work (201); the other answered as a replay — 200, or 202 while the
    // first one's payment was still with the provider.
    const [done, replay] = resultOf(first).replayed ? [second, first] : [first, second];
    expect(done.statusCode).toBe(201);
    expect([200, 202]).toContain(replay.statusCode);
    expect([first, second].map((r) => resultOf(r).replayed).sort()).toEqual([false, true]);
    const order = await getOrder(h, booking.order.id, { token: booking.guest });
    expect(order.servicing).toHaveLength(1);
    expect(order.financial.paidMinor).toBe(booking.order.totalMinor + 1360 * PESO);
    expect((await h.app.persistence.provider.all()).length).toBe(2); // checkout + one change
    // The same key for something else is a conflict, not a second change.
    const reused = await confirmChange(h, booking, 'outbound', 'NV503-20261215', quote, { key, accepted: 1 });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('two different changes from the same revision: exactly one wins, the other is a conflict', async () => {
    const booking = await confirmedBooking(h, ONE_WAY('FLEX'));
    const a = await changeQuote(h, booking, 'outbound', '2026-12-16', 'NV503-20261216');
    const b = await changeQuote(h, booking, 'outbound', '2026-12-16', 'NV501-20261216');
    const [ra, rb] = await Promise.all([
      confirmChange(h, booking, 'outbound', 'NV503-20261216', a),
      confirmChange(h, booking, 'outbound', 'NV501-20261216', b),
    ]);
    const codes = [ra, rb].map((r) => (r.statusCode === 201 ? 'ok' : r.json().error.code)).sort();
    expect(codes).toEqual(['SERVICING_CONFLICT', 'ok']);
    const order = await getOrder(h, booking.order.id, { token: booking.guest });
    expect(order.servicing.filter((op) => op.status === 'COMPLETED')).toHaveLength(1);
    expect(order.currentVersion).toBe(2);
  });
});
