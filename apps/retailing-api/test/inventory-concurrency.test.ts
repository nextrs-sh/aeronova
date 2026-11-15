import {
  apiErrorSchema,
  orderResponseSchema,
  prepareCheckoutResponseSchema,
  seatsOf,
  sessionSeatMapResponseSchema,
} from '@velasia/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AllocationLedger } from '../src/inventory/ledger';
import {
  LAST_BUSINESS_SEAT,
  OUTBOUND,
  newGuestToken,
  pay,
  paymentOf,
  prepare,
  prepared,
  readyCheckout,
  startHarness,
  type CallResult,
  type Harness,
  type ReadyCheckout,
} from './checkout-harness';

/*
 * Overselling. Every checkout runs through one serial writer, so concurrent requests can't both
 * see the last seat as free; the tests fire them truly concurrently and then check the durable
 * state, not just the HTTP answers.
 */

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const CONNECTING = 'NV506-20261203_NV541-20261203'; // SIN → MNL → TPE, shares the scarce segment
const SCARCE_FLIGHT = LAST_BUSINESS_SEAT.itineraryId;

const businessTrip = () =>
  readyCheckout(h, {
    legs: [{ itineraryId: SCARCE_FLIGHT, family: 'BUSINESS' }],
    search: LAST_BUSINESS_SEAT.search,
  });

async function availability(flightId: string, cabin: string) {
  const body = (await h.call(`/v1/flights/${flightId}/availability`)).json();
  return body.data.segments[0].cabins.find((c: { cabin: string }) => c.cabin === cabin)
    .available as number;
}

async function seatStatus(ready: ReadyCheckout, flightId: string, seatId: string) {
  const map = sessionSeatMapResponseSchema.parse(
    (
      await h.call(`/v1/shopping-sessions/${ready.id}/seatmaps/${flightId}`, { token: ready.token })
    ).json(),
  ).data;
  return seatsOf(map.seatMap).find((seat) => seat.id === seatId)?.status;
}

const codeOf = (response: CallResult) =>
  response.statusCode >= 400 ? apiErrorSchema.parse(response.json()).error.code : 'OK';

/** Orders currently holding or owning seats on a flight, from TalaDB. */
async function durableHolders(flightId: string) {
  const orders = await h.app.persistence.orders.withActiveHolds();
  return orders.filter(
    (order) =>
      order.flightIds.includes(flightId) &&
      (order.hold.status === 'COMMITTED' || order.hold.expiresAt > h.time.clock.now()),
  );
}

/** The live ledger must equal one rebuilt from the database, flight by flight. */
async function expectLedgerMatchesDatabase(flightIds: string[]) {
  const rebuilt = new AllocationLedger(() => h.time.clock.now());
  rebuilt.rebuild(await h.app.persistence.orders.withActiveHolds());
  for (const flightId of flightIds) {
    const live = h.app.persistence.ledger.occupancy(flightId);
    const fresh = rebuilt.occupancy(flightId);
    expect([...live.seatIds].sort()).toEqual([...fresh.seatIds].sort());
    expect(Object.fromEntries(live.seatsByCabin)).toEqual(Object.fromEntries(fresh.seatsByCabin));
  }
}

describe('the last seat', () => {
  it('goes to exactly one of many concurrent checkouts', async () => {
    expect(await availability(SCARCE_FLIGHT, 'business')).toBe(1);
    // Ten guests, each ready to buy the last Business seat (the same seat, chosen provisionally).
    const guests = await Promise.all(Array.from({ length: 10 }, () => businessTrip()));
    const seat = guests[0]!.session.booking.seats[0]!.seatId;
    for (const guest of guests) expect(guest.session.booking.seats[0]!.seatId).toBe(seat);

    const responses = await Promise.all(guests.map((guest) => prepare(h, guest, newGuestToken())));
    const codes = responses.map(codeOf);
    expect(codes.filter((code) => code === 'OK')).toHaveLength(1);
    // The others were told why, and nothing was held for them.
    for (const code of codes.filter((c) => c !== 'OK')) {
      expect(['CHECKOUT_NOT_READY', 'INVENTORY_UNAVAILABLE']).toContain(code);
    }
    expect(await durableHolders(SCARCE_FLIGHT)).toHaveLength(1);
    expect(await availability(SCARCE_FLIGHT, 'business')).toBe(0);
    await expectLedgerMatchesDatabase([SCARCE_FLIGHT]);

    // The winner pays; the seat stays taken for good.
    const winner = prepareCheckoutResponseSchema.parse(
      responses.find((r) => r.statusCode === 201)!.json(),
    ).data.order;
    const guestToken = (await h.app.persistence.orders.byId(winner.id))!;
    expect(guestToken.hold.allocations[0]!.seatIds).toEqual([seat]);
  });
});

describe('seat clashes and multi-flight trips', () => {
  it('two guests who chose the same seat: one holds it, the other is sent back to seats', async () => {
    const first = await readyCheckout(h);
    const seat = first.session.booking.seats[0]!.seatId;
    const second = await readyCheckout(h, { seats: { [OUTBOUND]: { ADT1: seat } } });
    expect(second.session.booking.seats[0]!.seatId).toBe(seat);

    const [a, b] = await Promise.all([
      prepare(h, first, newGuestToken()),
      prepare(h, second, newGuestToken()),
    ]);
    expect([codeOf(a), codeOf(b)].sort()).toEqual(['CHECKOUT_NOT_READY', 'OK']);
    const loser = a.statusCode === 201 ? second : first;
    const refused = apiErrorSchema.parse((a.statusCode === 201 ? b : a).json());
    expect(refused.error.issues?.[0]?.path).toBe('seats');
    expect(refused.error.message).toContain(seat);
    // The loser's provisional seat was released; the seat shows taken to them.
    const session = (
      await h.call(`/v1/shopping-sessions/${loser.id}`, { token: loser.token })
    ).json().data;
    expect(session.booking.seats).toEqual([]);
    expect(await seatStatus(loser, OUTBOUND, seat)).toBe('OCCUPIED');
    const holders = (await durableHolders(OUTBOUND)).filter((order) =>
      order.hold.allocations.some((allocation) => allocation.seatIds.includes(seat)),
    );
    expect(holders).toHaveLength(1);
    await expectLedgerMatchesDatabase([OUTBOUND]);
  });

  it('a connecting trip and a direct trip racing for a shared scarce flight: one wins, all-or-nothing', async () => {
    // Let the earlier winner's hold run out, so the last seat is free again.
    h.time.advance(10 * 60_000);
    expect(await availability(SCARCE_FLIGHT, 'business')).toBe(1);
    const connecting = await readyCheckout(h, {
      legs: [{ itineraryId: CONNECTING, family: 'BUSINESS' }],
      search: { ...LAST_BUSINESS_SEAT.search, origin: 'SIN' },
      seats: 'none',
    });
    const direct = await businessTrip();
    const firstLeg = CONNECTING.split('_')[0]!;
    const firstLegBefore = await availability(firstLeg, 'business');

    const [a, b] = await Promise.all([
      prepare(h, connecting, newGuestToken()),
      prepare(h, direct, newGuestToken()),
    ]);
    expect([codeOf(a), codeOf(b)].filter((code) => code === 'OK')).toHaveLength(1);
    expect(await durableHolders(SCARCE_FLIGHT)).toHaveLength(1);
    // The connecting trip took both flights or neither.
    const connectingWon = a.statusCode === 201;
    expect(await availability(firstLeg, 'business')).toBe(firstLegBefore - (connectingWon ? 1 : 0));
    if (connectingWon) {
      const order = prepareCheckoutResponseSchema.parse(a.json()).data.order;
      expect(order.hold.flightIds).toEqual(CONNECTING.split('_'));
    }
    await expectLedgerMatchesDatabase([SCARCE_FLIGHT, firstLeg]);
  });
});

describe('hold expiry and commitment', () => {
  it('an ended hold stops blocking the seat at once, and expires durably when next touched', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const order = await prepared(h, ready, guest);
    const seat = order.seats[0]!.seatId;
    const observer = await readyCheckout(h, { seats: 'none' });
    expect(await seatStatus(observer, OUTBOUND, seat)).toBe('OCCUPIED');
    const heldCount = await availability(OUTBOUND, 'economy');

    h.time.advance(10 * 60_000); // the hold's 10 minutes are up
    // Free again before any sweep or read has marked the order expired.
    expect((await h.app.persistence.orders.byId(order.id))!.status).toBe('PENDING_PAYMENT');
    expect(await seatStatus(observer, OUTBOUND, seat)).toBe('AVAILABLE');
    // (Earlier tests' holds on this flight ended too, so at least one more.)
    expect(await availability(OUTBOUND, 'economy')).toBeGreaterThanOrEqual(heldCount + 1);

    // Reading it records the expiry.
    const read = orderResponseSchema.parse(
      (await h.call(`/v1/orders/${order.id}`, { token: guest })).json(),
    ).data;
    expect(read).toMatchObject({
      status: 'EXPIRED',
      hold: { status: 'EXPIRED' },
      payment: { canPay: false },
    });
    const stored = (await h.app.persistence.orders.byId(order.id))!;
    expect(stored.events.slice(-2).map((e) => e.type)).toEqual(['HOLD_EXPIRED', 'ORDER_EXPIRED']);
    // Expiry is idempotent: a sweep finds nothing left to do.
    const revision = stored.rev;
    await h.app.persistence.orderService.reconcile(h.time.clock.now());
    await h.app.persistence.orderService.reconcile(h.time.clock.now());
    expect((await h.app.persistence.orders.byId(order.id))!.rev).toBe(revision);

    // And it can never be paid or confirmed now.
    const late = await pay(h, order.id, guest, { outcome: 'SUCCESS' });
    expect(late.statusCode).toBe(410);
    expect(apiErrorSchema.parse(late.json()).error.code).toBe('HOLD_EXPIRED');
    expect(await h.app.persistence.provider.countForOrder(order.id)).toBe(0);
  });

  it('the sweep expires holds nobody looks at', async () => {
    const ready = await readyCheckout(h);
    const order = await prepared(h, ready, newGuestToken());
    h.time.advance(10 * 60_000);
    const summary = await h.app.persistence.orderService.reconcile(h.time.clock.now());
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect((await h.app.persistence.orders.byId(order.id))!.status).toBe('EXPIRED');
  });

  it('a committed seat stays taken after the hold time, and is never committed twice', async () => {
    const ready = await readyCheckout(h);
    const guest = newGuestToken();
    const order = await prepared(h, ready, guest);
    const seat = order.seats[0]!.seatId;
    const paid = paymentOf(await pay(h, order.id, guest, { outcome: 'SUCCESS' }));
    expect(paid.order).toMatchObject({ status: 'CONFIRMED', hold: { status: 'COMMITTED' } });
    h.time.advance(60 * 60_000);
    const observer = await readyCheckout(h, { seats: 'none' });
    expect(await seatStatus(observer, OUTBOUND, seat)).toBe('OCCUPIED');
    const stored = (await h.app.persistence.orders.byId(order.id))!;
    expect(stored.events.filter((e) => e.type === 'INVENTORY_COMMITTED')).toHaveLength(1);
    await expectLedgerMatchesDatabase([OUTBOUND]);
  });
});
