import type { Order, PaymentAttempt, Refund, ServicingRecord } from '@velasia/contracts';
import {
  MAX_SERVICING_PAYMENT_ATTEMPTS,
  type StoredAttempt,
  type StoredOrder,
  type StoredRefund,
  type StoredServicing,
} from '../db/schema';
import { totalSeated } from '@velasia/contracts';
import { moneyOf } from '../servicing/money';
import { isUnresolved, unresolvedAttempt } from './lifecycle';

/*
 * Stored orders → public DTOs. Internal fields (owner hash, guest and account ids, idempotency
 * keys, request hashes, plans, simulated outcomes, the event log) never leave the API. The
 * revision does since Milestone 6: servicing requests send it back as `expectedRevision`.
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

export function toPublicRefund(operationId: string, refund: StoredRefund): Refund {
  return {
    id: refund.refundId,
    operationId,
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    status: refund.status,
    createdAt: iso(refund.createdAt),
    completedAt: refund.completedAt === null ? null : iso(refund.completedAt),
    providerReference: refund.providerReference,
    failureReason: refund.failureReason,
  };
}

export function toPublicServicing(op: StoredServicing, now: number): ServicingRecord {
  const undecided = op.attempts.some(isUnresolved);
  return {
    id: op.operationId,
    operation: op.operation,
    status: op.status,
    summary: op.summary,
    createdAt: iso(op.createdAt),
    completedAt: op.completedAt === null ? null : iso(op.completedAt),
    previousRevision: op.previousRevision,
    newRevision: op.newRevision,
    priceDifferenceMinor: op.priceDifferenceMinor,
    adjustment: op.adjustment,
    failureReason: op.failureReason,
    payment:
      op.adjustment.kind === 'CHARGE'
        ? {
            attempts: op.attempts.map(toPublicAttempt),
            canPay:
              op.status === 'AWAITING_PAYMENT' &&
              !undecided &&
              op.attempts.length < MAX_SERVICING_PAYMENT_ATTEMPTS &&
              (op.claim === null || now < op.claim.expiresAt),
            awaitingResult: undecided,
            attemptsRemaining: Math.max(0, MAX_SERVICING_PAYMENT_ATTEMPTS - op.attempts.length),
            claimExpiresAt:
              op.status === 'AWAITING_PAYMENT' && op.claim ? iso(op.claim.expiresAt) : null,
          }
        : null,
    refunds: op.refunds.map((refund) => toPublicRefund(op.operationId, refund)),
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
  const { snapshot, current } = order;
  const money = moneyOf(order);
  return {
    id: order.orderId,
    reference: order.reference,
    status: order.status,
    revision: order.rev,
    owner: order.ownerAccountId ? 'ACCOUNT' : 'GUEST',
    paymentStatus: order.attempts.at(-1)?.status ?? 'NOT_STARTED',
    currency: order.currency,
    totalMinor: order.totalMinor,
    totals: order.totals,
    items: current.items,
    search: snapshot.search,
    journeys: current.journeys,
    passengers: snapshot.passengers,
    contact: snapshot.contact,
    seats: current.seats,
    ancillaries: current.ancillaries,
    baggage: current.baggage,
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
    original: { journeys: snapshot.journeys, items: order.items, totalMinor: order.totalMinor },
    currentVersion: current.version,
    currentTotalMinor: current.items.reduce((sum, item) => sum + item.amountMinor, 0),
    financial: {
      paidMinor: money.paidMinor,
      refundedMinor: money.refundedMinor,
      refundPendingMinor: money.refundPendingMinor,
      refundFailedMinor: money.refundFailedMinor,
      creditMinor: money.creditMinor,
    },
    servicing: order.servicing.map((op) => toPublicServicing(op, now)),
    cancelledAt: order.cancelledAt === null ? null : iso(order.cancelledAt),
  };
}
