import type { PaymentStatus, RefundStatus } from '@velasia/contracts';
import {
  MAX_SERVICING_PAYMENT_ATTEMPTS,
  type OrderEventType,
  type StoredAttempt,
  type StoredOrder,
  type StoredPlan,
  type StoredRefund,
  type StoredServicing,
} from '../db/schema';
import {
  InvalidTransitionError,
  PAYMENT_TRANSITIONS,
  assertTransition,
  isUnresolved,
  setHold,
  setStatus,
  withEvent,
} from './lifecycle';

/*
 * Servicing state changes (Milestone 6), as pure functions from one stored order to the next.
 * The services persist each result in one compare-and-set write, after `assertOrderInvariants`.
 *
 *   (quote, never stored)
 *        │ confirm
 *        ├── nothing to pay ───────────────────────────────▶ COMPLETED   (applied in this write)
 *        ├── refund or credit due ─────────────────────────▶ COMPLETED   + refund PROCESSING
 *        └── payment due ──▶ AWAITING_PAYMENT (claim HELD, attempt PROCESSING)
 *                               ├── payment succeeded ─────▶ COMPLETED   (claim COMMITTED, applied)
 *                               ├── declined, attempts left ▶ AWAITING_PAYMENT (try again)
 *                               ├── last attempt declined / discarded ▶ FAILED (claim RELEASED)
 *                               └── claim ended, nothing undecided ──▶ EXPIRED (claim EXPIRED)
 *
 * "Applied" means: the booking as it is now (`current`) and the committed allocations become the
 * operation's plan, in the same write that marks it completed. Until then the original booking
 * and its seats are untouched, so a failed or abandoned change leaves nothing to undo.
 */

const opIndex = (order: StoredOrder, operationId: string) => {
  const index = order.servicing.findIndex((op) => op.operationId === operationId);
  if (index < 0) throw new InvalidTransitionError(`No servicing operation ${operationId}.`);
  return index;
};

export const findOperation = (order: StoredOrder, operationId: string) =>
  order.servicing.find((op) => op.operationId === operationId);

export const pendingOperation = (order: StoredOrder) =>
  order.servicing.find((op) => op.status === 'AWAITING_PAYMENT');

function setOp(
  order: StoredOrder,
  operationId: string,
  change: (op: StoredServicing) => StoredServicing,
): StoredOrder {
  const index = opIndex(order, operationId);
  const servicing = order.servicing.slice();
  servicing[index] = change(servicing[index]!);
  return { ...order, servicing };
}

function events(
  order: StoredOrder,
  at: number,
  list: (readonly [OrderEventType, string | null])[],
): StoredOrder {
  return list.reduce((next, [type, detail]) => withEvent(next, type, at, detail), order);
}

/** Apply a plan to the booking: what the traveller has now, and the seats it takes. */
function applyPlan(order: StoredOrder, plan: StoredPlan): StoredOrder {
  if (order.status !== 'CONFIRMED' || order.hold.status !== 'COMMITTED') {
    throw new InvalidTransitionError('Only a confirmed booking can be changed.');
  }
  if (plan.baseVersion !== order.current.version) {
    throw new InvalidTransitionError('The booking changed since this change was priced.');
  }
  return {
    ...order,
    current: plan.current,
    hold: { ...order.hold, allocations: plan.allocations },
  };
}

const APPLIED_EVENT: Record<StoredServicing['operation'], OrderEventType> = {
  CHANGE_FLIGHT: 'FLIGHT_CHANGED',
  CHANGE_SEAT: 'SEATS_CHANGED',
  ADD_ANCILLARY: 'SERVICES_ADDED',
  CANCEL_ORDER: 'BOOKING_CANCELLED',
};

function completeOp(order: StoredOrder, operationId: string, now: number): StoredOrder {
  const op = findOperation(order, operationId)!;
  let next = applyPlan(order, op.plan!);
  next = setOp(next, operationId, (current) => ({
    ...current,
    status: 'COMPLETED',
    plan: null,
    claim: current.claim ? { ...current.claim, status: 'COMMITTED', releasedAt: null } : null,
    completedAt: now,
    updatedAt: now,
    newRevision: order.rev + 1,
  }));
  const list: [OrderEventType, string | null][] = [
    [APPLIED_EVENT[op.operation], op.summary.slice(0, 200)],
    ['SERVICING_COMPLETED', op.operation],
  ];
  if (op.adjustment.kind === 'CREDIT')
    list.push(['CREDIT_ISSUED', String(op.adjustment.amountMinor)]);
  return events(next, now, list);
}

/**
 * Record a confirmed operation. With nothing to pay it is applied in the same write (and its
 * refund, if one is due, is recorded as PROCESSING before the provider is asked). With a charge
 * it waits for payment, its replacement inventory claimed and its first attempt recorded.
 */
export function openOperation(
  order: StoredOrder,
  op: StoredServicing,
  now: number,
  firstAttempt: StoredAttempt | null,
): StoredOrder {
  if (order.status !== 'CONFIRMED') {
    throw new InvalidTransitionError('Only a confirmed booking can be changed.');
  }
  if (order.servicing.some((existing) => existing.status === 'AWAITING_PAYMENT')) {
    throw new InvalidTransitionError('Another change is waiting for its payment.');
  }
  const charge = op.adjustment.kind === 'CHARGE';
  if (charge !== (firstAttempt !== null)) {
    throw new InvalidTransitionError('A charge needs a payment attempt, and only a charge.');
  }
  if (
    firstAttempt &&
    (firstAttempt.status !== 'PROCESSING' || firstAttempt.amountMinor !== op.adjustment.amountMinor)
  ) {
    throw new InvalidTransitionError('A new attempt must be processing and charge the change.');
  }
  const recorded: StoredServicing = {
    ...op,
    status: charge ? 'AWAITING_PAYMENT' : op.status,
    attempts: firstAttempt ? [firstAttempt] : [],
  };
  let next: StoredOrder = { ...order, servicing: [...order.servicing, recorded] };
  next = events(next, now, [['SERVICING_REQUESTED', op.operation]]);
  if (op.claim)
    next = events(next, now, [
      ['SERVICING_INVENTORY_CLAIMED', `${op.claim.allocations.length} flight(s)`],
    ]);
  if (firstAttempt) {
    return events(next, now, [['SERVICING_PAYMENT_INITIATED', firstAttempt.method]]);
  }
  if (op.operation === 'CANCEL_ORDER') return next;
  next = completeOp(next, op.operationId, now);
  return op.refunds.length
    ? events(next, now, [['REFUND_REQUESTED', String(op.adjustment.amountMinor)]])
    : next;
}

/** Cancel a confirmed booking: release its seats and record the cancellation, in one change. */
export function cancelBooking(order: StoredOrder, op: StoredServicing, now: number): StoredOrder {
  if (
    order.status !== 'CONFIRMED' ||
    order.servicing.some((o) => o.status === 'AWAITING_PAYMENT')
  ) {
    throw new InvalidTransitionError(
      'Only a confirmed booking with no change in progress can be cancelled.',
    );
  }
  let next = openOperation(order, { ...op, status: 'COMPLETED' }, now, null);
  next = setOp(next, op.operationId, (current) => ({
    ...current,
    status: 'COMPLETED',
    completedAt: now,
    newRevision: order.rev + 1,
  }));
  next = withEvent(setHold(next, 'RELEASED', now, 'cancelled'), 'HOLD_RELEASED', now, 'cancelled');
  next = withEvent(setStatus(next, 'BOOKING_CANCELLED'), 'BOOKING_CANCELLED', now);
  next = { ...next, cancelledAt: now };
  return op.refunds.length
    ? withEvent(next, 'REFUND_REQUESTED', now, String(op.adjustment.amountMinor))
    : next;
}

// ---------------------------------------------------------------------------
// Payments for a change
// ---------------------------------------------------------------------------

function setAttempt(
  op: StoredServicing,
  attemptId: string,
  change: Partial<Pick<StoredAttempt, 'failureReason' | 'providerReference' | 'completedAt'>> & {
    status: PaymentStatus;
  },
): StoredServicing {
  const attempt = op.attempts.find((candidate) => candidate.attemptId === attemptId);
  if (!attempt) throw new InvalidTransitionError(`No payment attempt ${attemptId} on this change.`);
  if (attempt.status !== change.status) {
    assertTransition(PAYMENT_TRANSITIONS, 'A payment', attempt.status, change.status);
  }
  return {
    ...op,
    attempts: op.attempts.map((candidate) =>
      candidate.attemptId === attemptId ? { ...candidate, ...change } : candidate,
    ),
  };
}

export function startServicingAttempt(
  order: StoredOrder,
  operationId: string,
  attempt: StoredAttempt,
  now: number,
): StoredOrder {
  const op = findOperation(order, operationId);
  if (op?.status !== 'AWAITING_PAYMENT' || op.claim?.status !== 'HELD') {
    throw new InvalidTransitionError('Only a change waiting for payment can take one.');
  }
  if (op.attempts.some(isUnresolved))
    throw new InvalidTransitionError('A payment is still undecided.');
  if (op.attempts.length >= MAX_SERVICING_PAYMENT_ATTEMPTS) {
    throw new InvalidTransitionError('No payment attempts are left for this change.');
  }
  if (attempt.status !== 'PROCESSING' || attempt.amountMinor !== op.adjustment.amountMinor) {
    throw new InvalidTransitionError('A new attempt must be processing and charge the change.');
  }
  const next = setOp(order, operationId, (current) => ({
    ...current,
    attempts: [...current.attempts, attempt],
    updatedAt: now,
  }));
  return withEvent(next, 'SERVICING_PAYMENT_INITIATED', now, attempt.method);
}

/** The change's payment succeeded: apply the change and commit its claim, in one change. */
export function confirmServicingPayment(
  order: StoredOrder,
  operationId: string,
  attemptId: string,
  providerReference: string,
  now: number,
): StoredOrder {
  const op = findOperation(order, operationId)!;
  const attempt = op.attempts.find((candidate) => candidate.attemptId === attemptId);
  if (op.status === 'COMPLETED' && attempt?.status === 'SUCCEEDED') return order;
  if (op.status !== 'AWAITING_PAYMENT') {
    throw new InvalidTransitionError(`A ${op.status} change can't take a successful payment.`);
  }
  let next = setOp(order, operationId, (current) =>
    setAttempt(current, attemptId, {
      status: 'SUCCEEDED',
      providerReference,
      completedAt: now,
      failureReason: null,
    }),
  );
  next = withEvent(next, 'SERVICING_PAYMENT_SUCCEEDED', now, providerReference);
  return completeOp(next, operationId, now);
}

/** The attempt failed. After the last allowed one, the change fails and its claim is released. */
export function failServicingPayment(
  order: StoredOrder,
  operationId: string,
  attemptId: string,
  reason: string,
  now: number,
  providerReference: string | null = null,
): StoredOrder {
  const op = findOperation(order, operationId)!;
  if (op.attempts.find((a) => a.attemptId === attemptId)?.status === 'FAILED') return order;
  let next = setOp(order, operationId, (current) => ({
    ...setAttempt(current, attemptId, {
      status: 'FAILED',
      failureReason: reason,
      completedAt: now,
      providerReference,
    }),
    updatedAt: now,
  }));
  next = withEvent(next, 'SERVICING_PAYMENT_FAILED', now);
  const failed = findOperation(next, operationId)!.attempts.filter((a) => a.status === 'FAILED');
  if (failed.length >= MAX_SERVICING_PAYMENT_ATTEMPTS) {
    next = endOperation(
      next,
      operationId,
      'FAILED',
      'No payment attempts are left for this change.',
      now,
    );
  }
  return next;
}

export function markServicingUndecided(
  order: StoredOrder,
  operationId: string,
  attemptId: string,
  status: 'PENDING' | 'UNKNOWN',
  now: number,
  providerReference: string | null = null,
): StoredOrder {
  const op = findOperation(order, operationId)!;
  const attempt = op.attempts.find((candidate) => candidate.attemptId === attemptId);
  if (attempt?.status === status) return order;
  const next = setOp(order, operationId, (current) => ({
    ...setAttempt(current, attemptId, {
      status,
      providerReference: providerReference ?? attempt?.providerReference ?? null,
    }),
    updatedAt: now,
  }));
  return withEvent(
    next,
    status === 'PENDING' ? 'SERVICING_PAYMENT_PENDING' : 'SERVICING_PAYMENT_UNKNOWN',
    now,
  );
}

/** End a change that wasn't applied: discarded, out of attempts, or its claim expired. */
export function endOperation(
  order: StoredOrder,
  operationId: string,
  status: 'FAILED' | 'EXPIRED',
  reason: string,
  now: number,
): StoredOrder {
  const op = findOperation(order, operationId)!;
  if (op.status !== 'AWAITING_PAYMENT') {
    throw new InvalidTransitionError(`A ${op.status} change can't end again.`);
  }
  if (op.attempts.some(isUnresolved)) {
    throw new InvalidTransitionError('A payment for this change is still undecided.');
  }
  const next = setOp(order, operationId, (current) => ({
    ...current,
    status,
    plan: null,
    claim: current.claim
      ? { ...current.claim, status: status === 'EXPIRED' ? 'EXPIRED' : 'RELEASED', releasedAt: now }
      : null,
    failureReason: reason,
    completedAt: now,
    updatedAt: now,
  }));
  return withEvent(
    next,
    status === 'EXPIRED' ? 'SERVICING_EXPIRED' : 'SERVICING_FAILED',
    now,
    op.operation,
  );
}

/** The change's claim ended with no payment undecided. */
export function claimExpiredAt(op: StoredServicing, now: number): boolean {
  return (
    op.status === 'AWAITING_PAYMENT' &&
    op.claim?.status === 'HELD' &&
    now >= op.claim.expiresAt &&
    !op.attempts.some(isUnresolved)
  );
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export const REFUND_TRANSITIONS: Readonly<Record<RefundStatus, readonly RefundStatus[]>> = {
  PROCESSING: ['PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED'],
  PENDING: ['SUCCEEDED', 'FAILED'],
  UNKNOWN: ['PENDING', 'SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
};

const REFUND_EVENT: Record<RefundStatus, OrderEventType | null> = {
  PROCESSING: null,
  PENDING: 'REFUND_PENDING',
  UNKNOWN: 'REFUND_UNKNOWN',
  SUCCEEDED: 'REFUND_SUCCEEDED',
  FAILED: 'REFUND_FAILED',
};

export function setRefund(
  order: StoredOrder,
  operationId: string,
  refundId: string,
  change: Partial<Pick<StoredRefund, 'failureReason' | 'providerReference' | 'completedAt'>> & {
    status: RefundStatus;
  },
  now: number,
): StoredOrder {
  const op = findOperation(order, operationId)!;
  const refund = op.refunds.find((candidate) => candidate.refundId === refundId);
  if (!refund) throw new InvalidTransitionError(`No refund ${refundId} on this booking.`);
  if (refund.status === change.status) return order;
  assertTransition(REFUND_TRANSITIONS, 'A refund', refund.status, change.status);
  const next = setOp(order, operationId, (current) => ({
    ...current,
    refunds: current.refunds.map((candidate) =>
      candidate.refundId === refundId ? { ...candidate, ...change } : candidate,
    ),
    updatedAt: now,
  }));
  const type = REFUND_EVENT[change.status];
  return type ? withEvent(next, type, now, change.providerReference ?? null) : next;
}

/** Try a failed refund again: a new refund record for the same amount (the old one stays). */
export function retryRefund(
  order: StoredOrder,
  operationId: string,
  refund: StoredRefund,
  now: number,
): StoredOrder {
  const op = findOperation(order, operationId)!;
  if (op.refunds.at(-1)?.status !== 'FAILED' || op.refunds.some((r) => r.status === 'SUCCEEDED')) {
    throw new InvalidTransitionError('Only a failed refund can be tried again.');
  }
  const next = setOp(order, operationId, (current) => ({
    ...current,
    refunds: [...current.refunds, refund],
    updatedAt: now,
  }));
  return withEvent(next, 'REFUND_REQUESTED', now, String(refund.amountMinor));
}
