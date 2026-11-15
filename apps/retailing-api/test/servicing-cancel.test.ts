import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './checkout-harness';
import {
  assertDurableConsistency,
  cancellationQuote,
  changeQuotes,
  confirmCancellation,
  confirmedBooking,
  getOrder,
  resultOf,
  seatQuote,
  type Booking,
} from './servicing-harness';

/*
 * Cancellation and simulated refunds (Milestone 6). MNL → SIN NV501 on 15 Dec, one adult.
 * Fictional rules: Flex and Business refund the fare; Classic refunds it less ₱3,000 per
 * traveller; Light refunds unused taxes only. Paid extras are refunded except with Light.
 */

const PESO = 100;
const FLIGHT = 'NV501-20261215';
const plan = (family: 'LIGHT' | 'CLASSIC' | 'FLEX', seat = '8C') => ({
  legs: [{ itineraryId: FLIGHT, family }],
  seats: { [FLIGHT]: { ADT1: seat } },
});

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await assertDurableConsistency(h);
  await h.close();
});

async function quote(booking: Booking) {
  const response = await cancellationQuote(h, booking);
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data;
}

describe('cancellation', { timeout: 60_000 }, () => {
  it('Classic: the fare less the ₱3,000 fee and the paid seat are refunded; the seat is released', async () => {
    const booking = await confirmedBooking(h, plan('CLASSIC'));
    const fare = booking.order.items
      .filter((item) => item.kind === 'FLIGHT')
      .reduce((s, i) => s + i.amountMinor, 0);
    const q = await quote(booking);
    expect(q.feeMinor).toBe(3000 * PESO);
    expect(q.refundMinor).toBe(fare - 3000 * PESO + 1000 * PESO);
    expect(q.paidMinor).toBe(booking.order.totalMinor);
    expect(q.netMinor).toBe(-q.refundMinor);
    expect(h.app.persistence.ledger.occupancy(FLIGHT).seatIds.has('8C')).toBe(true);

    const response = await confirmCancellation(h, booking, q.refundMinor);
    expect(response.statusCode, response.body).toBe(201);
    const { order, operation } = resultOf(response);
    expect(order.status).toBe('BOOKING_CANCELLED');
    expect(order.hold.status).toBe('RELEASED');
    expect(order.cancelledAt).not.toBeNull();
    expect(operation).toMatchObject({ operation: 'CANCEL_ORDER', status: 'COMPLETED' });
    expect(operation.refunds).toMatchObject([{ status: 'SUCCEEDED', amountMinor: q.refundMinor }]);
    expect(order.financial).toMatchObject({ refundedMinor: q.refundMinor, refundPendingMinor: 0 });
    expect(h.app.persistence.ledger.occupancy(FLIGHT).seatIds.has('8C')).toBe(false);
    // What was bought is still on record.
    expect(order.original.items).toEqual(booking.order.items);
    expect(order.journeys).toEqual(booking.order.journeys);
  });

  it('Light refunds unused taxes only, and its extras are non-refundable', async () => {
    const booking = await confirmedBooking(h, plan('LIGHT', '14B'));
    const q = await quote(booking);
    const taxes = booking.order.journeys[0]!.price.totals.taxesMinor;
    const seat = booking.order.items.find((item) => item.kind === 'SEAT')!.amountMinor;
    expect(seat).toBeGreaterThan(0);
    expect(q.refundMinor).toBe(taxes);
    expect(q.nonRefundableMinor).toBe(booking.order.totalMinor - taxes);
    expect(
      q.lines.some(
        (line: { kind: string; label: string }) =>
          line.kind === 'NON_REFUNDABLE' && line.label.startsWith('Seat'),
      ),
    ).toBe(true);
  });

  it('Flex refunds everything', async () => {
    const booking = await confirmedBooking(h, plan('FLEX', '14B'));
    const q = await quote(booking);
    expect(q.refundMinor).toBe(booking.order.totalMinor);
    expect(q.feeMinor).toBe(0);
  });

  it('is refused after the online cut-off and once cancelled; nothing else can change then', async () => {
    const booking = await confirmedBooking(h, plan('FLEX', '14B'));
    const q = await quote(booking);
    const { order } = resultOf(await confirmCancellation(h, booking, q.refundMinor));
    const next = { ...booking, order };
    expect((await cancellationQuote(h, next)).json().error.code).toBe('ORDER_NOT_MODIFIABLE');
    expect((await changeQuotes(h, next, 'outbound', '2026-12-16')).json().error.code).toBe(
      'ORDER_NOT_MODIFIABLE',
    );
    expect(
      (await seatQuote(h, next, [{ travellerId: 'ADT1', flightId: FLIGHT, seatId: '15C' }])).json()
        .error.code,
    ).toBe('ORDER_NOT_MODIFIABLE');
    const overview = (
      await h.call(`/v1/orders/${order.id}/servicing`, { token: booking.guest })
    ).json().data.servicing;
    expect([overview.cancel.allowed, overview.seats.allowed, overview.extras.allowed]).toEqual([
      false,
      false,
      false,
    ]);

    const late = await confirmedBooking(h, plan('CLASSIC', '15C'));
    h.time.advance(Date.parse('2026-12-14T23:30:00Z') - h.time.clock.now()); // 15 Dec 07:30, 45 min to go
    const closed = await cancellationQuote(h, late);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.code).toBe('CHANGE_NOT_ALLOWED');
  });

  it('a duplicate cancellation is answered from the record, never refunded twice', async () => {
    const booking = await confirmedBooking(h, plan('FLEX', '14B'));
    const q = await quote(booking);
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      confirmCancellation(h, booking, q.refundMinor, { key }),
      confirmCancellation(h, booking, q.refundMinor, { key }),
    ]);
    expect([a, b].map((r) => resultOf(r).replayed).sort()).toEqual([false, true]);
    const another = await confirmCancellation(h, booking, q.refundMinor);
    expect(another.statusCode).toBe(409);
    const refunds = (await h.app.persistence.refundProvider.all()).filter(
      (r) => r.orderId === booking.order.id,
    );
    expect(refunds).toHaveLength(1);
  });

  it('a pending refund: the booking is cancelled at once, the refund succeeds later', async () => {
    const booking = await confirmedBooking(h, plan('FLEX', '14B'));
    const q = await quote(booking);
    const response = await confirmCancellation(h, booking, q.refundMinor, {
      refundOutcome: 'PENDING',
    });
    expect(response.statusCode).toBe(202);
    const { order, operation } = resultOf(response);
    expect(order.status).toBe('BOOKING_CANCELLED');
    expect(operation.refunds[0]!.status).toBe('PENDING');
    expect(order.financial).toMatchObject({ refundPendingMinor: q.refundMinor, refundedMinor: 0 });
    const trips = await h.call(`/v1/orders/${order.id}/refunds`, { token: booking.guest });
    expect(trips.json().data[0].status).toBe('PENDING');
    await new Promise((resolve) => setTimeout(resolve, 250)); // the provider decides on its wall clock
    const status = await h.call(`/v1/orders/${order.id}/servicing-status`, {
      token: booking.guest,
    });
    expect(status.json().data.financial).toMatchObject({
      refundedMinor: q.refundMinor,
      refundPendingMinor: 0,
    });
  });

  it('a failed refund is shown as failed (never as paid) and can be tried again', async () => {
    const booking = await confirmedBooking(h, plan('FLEX', '14B'));
    const q = await quote(booking);
    const { order } = resultOf(
      await confirmCancellation(h, booking, q.refundMinor, { refundOutcome: 'DECLINED' }),
    );
    expect(order.status).toBe('BOOKING_CANCELLED');
    expect(order.financial).toMatchObject({ refundFailedMinor: q.refundMinor, refundedMinor: 0 });
    const retry = await h.call(`/v1/orders/${order.id}/refunds/retry`, {
      method: 'POST',
      token: booking.guest,
      body: {},
    });
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.json().data.financial).toMatchObject({
      refundedMinor: q.refundMinor,
      refundFailedMinor: 0,
    });
    const again = await h.call(`/v1/orders/${order.id}/refunds/retry`, {
      method: 'POST',
      token: booking.guest,
      body: {},
    });
    expect(again.statusCode).toBe(409);
    const ops = (await getOrder(h, order.id, { token: booking.guest })).servicing;
    expect(ops[0]!.refunds.map((refund) => refund.status)).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('a refund whose answer is lost is looked up, not sent again', async () => {
    const booking = await confirmedBooking(h, plan('FLEX', '14B'));
    const q = await quote(booking);
    const response = await confirmCancellation(h, booking, q.refundMinor, {
      refundOutcome: 'TIMEOUT',
    });
    expect(response.statusCode).toBe(202);
    expect(resultOf(response).operation.refunds[0]!.status).toBe('UNKNOWN');
    const status = await h.call(`/v1/orders/${booking.order.id}/servicing-status`, {
      token: booking.guest,
    });
    expect(status.json().data.financial.refundedMinor).toBe(q.refundMinor);
    expect(
      (await h.app.persistence.refundProvider.all()).filter((r) => r.orderId === booking.order.id),
    ).toHaveLength(1);
  });

  it('keeps the whole history, without personal data', async () => {
    const booking = await confirmedBooking(h, plan('CLASSIC'));
    const q = await quote(booking);
    await confirmCancellation(h, booking, q.refundMinor);
    const events = (
      await h.call(`/v1/orders/${booking.order.id}/events`, { token: booking.guest })
    ).json();
    const types = events.data.map((event: { type: string }) => event.type).reverse();
    expect(types.slice(0, 3)).toEqual(['ORDER_CREATED', 'INVENTORY_HELD', 'PAYMENT_INITIATED']);
    expect(types).toEqual(
      expect.arrayContaining([
        'SERVICING_REQUESTED',
        'HOLD_RELEASED',
        'BOOKING_CANCELLED',
        'REFUND_REQUESTED',
        'REFUND_SUCCEEDED',
      ]),
    );
    const text = JSON.stringify(events);
    for (const secret of [
      booking.order.contact.email,
      booking.order.passengers[0]!.familyName,
      booking.guest,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
