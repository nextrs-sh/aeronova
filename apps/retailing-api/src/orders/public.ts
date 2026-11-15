import type { Order, PaymentAttempt } from '@velasia/contracts';
import type { StoredAttempt, StoredOrder } from '../db/schema';
import { totalSeated } from '@velasia/contracts';
import { unresolvedAttempt } from './lifecycle';

/*
 * Stored orders → public DTOs. Internal fields (owner hash, idempotency keys, request hashes,
 * revision, event history, simulated outcome) never leave the API.
 */

const iso = (ms: number) => new Date(ms).toISOString();

export function toPublicAttempt(attempt: StoredAttempt): PaymentAttempt {
  return {
    id: attempt.attemptId,
    method: attempt.method,
    status: attempt.status,
    amountMinor: attempt.amountMinor,
    currency: attempt.currency,
    createdAt: iso(attempt.createdAt),
    completedAt: attempt.completedAt === null ? null : iso(attempt.completedAt),
    failureReason: attempt.failureReason,
    providerReference: attempt.providerReference,
  };
}

export function canPay(order: StoredOrder, now: number, maxAttempts: number): boolean {
  return (
    order.status === 'PENDING_PAYMENT' &&
    order.hold.status === 'HELD' &&
    now < order.hold.expiresAt &&
    !unresolvedAttempt(order) &&
    order.attempts.length < maxAttempts
  );
}

export function toPublicOrder(order: StoredOrder, now: number, maxAttempts: number): Order {
  const { snapshot } = order;
  return {
    id: order.orderId,
    reference: order.reference,
    status: order.status,
    paymentStatus: order.attempts.at(-1)?.status ?? 'NOT_STARTED',
    currency: order.currency,
    totalMinor: order.totalMinor,
    totals: order.totals,
    items: order.items,
    search: snapshot.search,
    journeys: snapshot.journeys,
    passengers: snapshot.passengers,
    contact: snapshot.contact,
    seats: snapshot.seats,
    ancillaries: snapshot.ancillaries,
    baggage: snapshot.baggage,
    hold: {
      status: order.hold.status,
      expiresAt: iso(order.hold.expiresAt),
      seatsPerFlight: totalSeated(snapshot.search.passengers),
      flightIds: order.hold.allocations.map((allocation) => allocation.flightId),
    },
    payment: {
      attempts: order.attempts.map(toPublicAttempt),
      canPay: canPay(order, now, maxAttempts),
      awaitingResult: unresolvedAttempt(order) !== undefined,
      attemptsRemaining: Math.max(0, maxAttempts - order.attempts.length),
    },
    pricingVersion: order.pricingVersion,
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
    confirmedAt: order.confirmedAt === null ? null : iso(order.confirmedAt),
    serverTime: iso(now),
  };
}
