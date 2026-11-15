import {
  orderResponseSchema,
  servicingResultResponseSchema,
  type Order,
  type ServicingQuote,
  type SimulatedOutcome,
} from '@velasia/contracts';
import { expect } from 'vitest';
import type { Harness } from './checkout-harness';
import {
  newGuestToken,
  newKey,
  pay,
  paymentOf,
  prepared,
  readyCheckout,
  type CallOptions,
  type CallResult,
  type Caller,
  type TripPlan,
} from './checkout-harness';

/*
 * Milestone 6 helpers: confirmed bookings to service, and the servicing calls. Every traveller is
 * synthetic.
 */

export interface Booking {
  order: Order;
  guest: string;
}

/** Search → review → checkout → approved demo payment: a confirmed booking and its owner. */
export async function confirmedBooking(
  h: Caller,
  plan: TripPlan = {},
  guest = newGuestToken(),
  /** `null` sends no outcome (where outcome controls are off, every payment is approved). */
  outcome: SimulatedOutcome | null = 'SUCCESS',
): Promise<Booking> {
  const ready = await readyCheckout(h, plan);
  const pending = await prepared(h, ready, guest);
  const paid = await pay(h, pending.id, guest, outcome ? { outcome } : {});
  expect(paid.statusCode, paid.body).toBe(201);
  const { order } = paymentOf(paid);
  expect(order.status).toBe('CONFIRMED');
  return { order, guest };
}

export function call(h: Caller, path: string, options: CallOptions = {}): Promise<CallResult> {
  return h.call(path, options);
}

export async function getOrder(h: Caller, orderId: string, options: CallOptions): Promise<Order> {
  const response = await h.call(`/v1/orders/${orderId}`, options);
  expect(response.statusCode, response.body).toBe(200);
  return orderResponseSchema.parse(response.json()).data;
}

export const resultOf = (response: CallResult) =>
  servicingResultResponseSchema.parse(response.json()).data;

export function changeQuotes(
  h: Caller,
  booking: Booking,
  direction: 'outbound' | 'inbound',
  date: string,
  options: CallOptions = {},
) {
  return h.call(`/v1/orders/${booking.order.id}/change-quotes`, {
    method: 'POST',
    token: booking.guest,
    body: { direction, date },
    ...options,
  });
}

/** The quote for one replacement itinerary, from the change search. */
export async function changeQuote(
  h: Caller,
  booking: Booking,
  direction: 'outbound' | 'inbound',
  date: string,
  itineraryId: string,
): Promise<ServicingQuote> {
  const response = await changeQuotes(h, booking, direction, date);
  expect(response.statusCode, response.body).toBe(200);
  const alternative = response
    .json()
    .data.alternatives.find(
      (candidate: { itineraryId: string }) => candidate.itineraryId === itineraryId,
    );
  if (!alternative) throw new Error(`no alternative ${itineraryId}: ${response.body}`);
  return alternative.quote as ServicingQuote;
}

export interface ConfirmOptions {
  key?: string;
  revision?: number;
  accepted?: number;
  outcome?: SimulatedOutcome;
  refundOutcome?: SimulatedOutcome;
  method?: 'DEMO_CARD' | 'DEMO_WALLET' | 'DEMO_BANK_TRANSFER';
  noPayment?: boolean;
  extra?: object;
  options?: CallOptions;
}

function confirmBody(
  order: Order,
  quote: Pick<ServicingQuote, 'netMinor' | 'adjustment'>,
  o: ConfirmOptions,
) {
  const charge = quote.adjustment.kind === 'CHARGE';
  return {
    idempotencyKey: o.key ?? newKey(),
    expectedRevision: o.revision ?? order.revision,
    acceptedAmountMinor: o.accepted ?? quote.netMinor,
    ...(charge && !o.noPayment
      ? {
          payment: {
            method: o.method ?? 'DEMO_CARD',
            ...(o.outcome ? { simulatedOutcome: o.outcome } : {}),
          },
        }
      : {}),
    ...(o.refundOutcome ? { simulatedRefundOutcome: o.refundOutcome } : {}),
    ...o.extra,
  };
}

export function confirmChange(
  h: Caller,
  booking: Booking,
  direction: 'outbound' | 'inbound',
  itineraryId: string,
  quote: ServicingQuote,
  o: ConfirmOptions = {},
) {
  return h.call(`/v1/orders/${booking.order.id}/changes`, {
    method: 'POST',
    token: booking.guest,
    body: { ...confirmBody(booking.order, quote, o), direction, itineraryId },
    ...o.options,
  });
}

export async function seatQuote(
  h: Caller,
  booking: Booking,
  changes: object[],
  options: CallOptions = {},
) {
  const response = await h.call(`/v1/orders/${booking.order.id}/seat-quotes`, {
    method: 'POST',
    token: booking.guest,
    body: { changes },
    ...options,
  });
  return response;
}

export function confirmSeats(
  h: Caller,
  booking: Booking,
  changes: object[],
  quote: ServicingQuote,
  o: ConfirmOptions = {},
) {
  return h.call(`/v1/orders/${booking.order.id}/seat-changes`, {
    method: 'POST',
    token: booking.guest,
    body: { ...confirmBody(booking.order, quote, o), changes },
    ...o.options,
  });
}

export function ancillaryQuote(
  h: Caller,
  booking: Booking,
  changes: object[],
  options: CallOptions = {},
) {
  return h.call(`/v1/orders/${booking.order.id}/ancillary-quotes`, {
    method: 'POST',
    token: booking.guest,
    body: { changes },
    ...options,
  });
}

export function confirmAncillaries(
  h: Caller,
  booking: Booking,
  changes: object[],
  quote: ServicingQuote,
  o: ConfirmOptions = {},
) {
  return h.call(`/v1/orders/${booking.order.id}/ancillary-purchases`, {
    method: 'POST',
    token: booking.guest,
    body: { ...confirmBody(booking.order, quote, o), changes },
    ...o.options,
  });
}

export function cancellationQuote(h: Caller, booking: Booking, options: CallOptions = {}) {
  return h.call(`/v1/orders/${booking.order.id}/cancellation-quotes`, {
    method: 'POST',
    token: booking.guest,
    body: {},
    ...options,
  });
}

export function confirmCancellation(
  h: Caller,
  booking: Booking,
  refundMinor: number,
  o: {
    key?: string;
    revision?: number;
    refundOutcome?: SimulatedOutcome;
    options?: CallOptions;
  } = {},
) {
  return h.call(`/v1/orders/${booking.order.id}/cancellations`, {
    method: 'POST',
    token: booking.guest,
    body: {
      idempotencyKey: o.key ?? newKey(),
      expectedRevision: o.revision ?? booking.order.revision,
      acceptedRefundMinor: refundMinor,
      ...(o.refundOutcome ? { simulatedRefundOutcome: o.refundOutcome } : {}),
    },
    ...o.options,
  });
}

/** A fresh view of the booking after a change, for the next request's expected revision. */
export async function refreshed(h: Caller, booking: Booking): Promise<Booking> {
  return { ...booking, order: await getOrder(h, booking.order.id, { token: booking.guest }) };
}

/** Every stored order obeys the invariants, and the live ledger equals one rebuilt from disk. */
export async function assertDurableConsistency(h: Harness) {
  const { orders, ledger } = h.app.persistence;
  const all = await orders.all();
  const { AllocationLedger } = await import('../src/inventory/ledger');
  const { assertOrderInvariants } = await import('../src/orders/lifecycle');
  for (const order of all) assertOrderInvariants(order, 5);
  const rebuilt = new AllocationLedger(() => h.time.clock.now());
  rebuilt.rebuild(all);
  expect(ledger.snapshot()).toEqual(rebuilt.snapshot());
  // No seat is held twice on any flight.
  const seen = new Map<string, string>();
  for (const entry of rebuilt.snapshot()) {
    const [orderId, flightId, , , seats] = entry.split('|');
    for (const seat of seats ? seats.split(',') : []) {
      const key = `${flightId}|${seat}`;
      const holder = seen.get(key);
      expect(
        holder === undefined || holder === orderId,
        `seat ${key} held by ${holder} and ${orderId}`,
      ).toBe(true);
      seen.set(key, orderId!);
    }
  }
  return all;
}
