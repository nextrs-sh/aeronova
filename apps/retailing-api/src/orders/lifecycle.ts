import {
  UNRESOLVED_PAYMENT_STATUSES,
  UNRESOLVED_REFUND_STATUSES,
  type HoldStatus,
  type OrderStatus,
  type PaymentStatus,
} from '@velasia/contracts';
import {
  MAX_ORDER_EVENTS,
  MAX_SERVICING_OPERATIONS,
  type OrderEventType,
  type StoredAttempt,
  type StoredOrder,
} from '../db/schema';

/*
 * The order lifecycle: every state change an order can make, as pure functions from one stored
 * order to the next. Nothing here reads a clock or touches storage; the services persist the
 * result in one compare-and-set write, and `assertOrderInvariants` runs before every write.
 *
 *   PENDING_PAYMENT ──payment succeeded──▶ CONFIRMED        (hold HELD → COMMITTED)
 *          │
 *          ├──hold ended, no undecided payment──▶ EXPIRED   (hold HELD → EXPIRED)
 *          ├──last allowed attempt failed──────▶ PAYMENT_FAILED (hold HELD → RELEASED)
 *          └──replaced by a newer checkout─────▶ CANCELLED  (hold HELD → RELEASED)
 *
 *   CONFIRMED ──cancelled by the traveller (M6)──▶ BOOKING_CANCELLED (hold COMMITTED → RELEASED)
 *
 * A confirmed order stays CONFIRMED through flight, seat, and service changes (Milestone 6,
 * `servicing-lifecycle.ts`): those change what the booking is now (`current`) and its committed
 * allocations, never its status or the original purchase.
 *
 * Every other change is refused with an `InvalidTransitionError`. Confirming an order that is
 * already confirmed by the same payment is a no-op, so repeated confirmations are harmless.
 */

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['CONFIRMED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['BOOKING_CANCELLED'],
  PAYMENT_FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
  BOOKING_CANCELLED: [],
};

export const HOLD_TRANSITIONS: Readonly<Record<HoldStatus, readonly HoldStatus[]>> = {
  HELD: ['COMMITTED', 'RELEASED', 'EXPIRED'],
  /** A cancelled booking gives its seats back (Milestone 6). */
  COMMITTED: ['RELEASED'],
  RELEASED: [],
  EXPIRED: [],
};

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PROCESSING: ['PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED'],
  PENDING: ['SUCCEEDED', 'FAILED'],
  UNKNOWN: ['PENDING', 'SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
};

export class InvalidTransitionError extends Error {
  override readonly name = 'InvalidTransitionError';
}

/** A stored order breaks a rule that must always hold. Never written. */
export class OrderInvariantError extends Error {
  override readonly name = 'OrderInvariantError';
}

export function assertTransition<S extends string>(
  table: Readonly<Record<S, readonly S[]>>,
  what: string,
  from: S,
  to: S,
): void {
  if (!table[from].includes(to)) {
    throw new InvalidTransitionError(`${what} can't change from ${from} to ${to}.`);
  }
}

export const isUnresolved = (attempt: StoredAttempt) =>
  UNRESOLVED_PAYMENT_STATUSES.includes(attempt.status);

export function unresolvedAttempt(order: StoredOrder): StoredAttempt | undefined {
  return order.attempts.find(isUnresolved);
}

export function failedAttempts(order: StoredOrder): number {
  return order.attempts.filter((attempt) => attempt.status === 'FAILED').length;
}

/** The hold has ended and nothing may still be paying for it. */
export function holdExpiredAt(order: StoredOrder, now: number): boolean {
  return (
    order.status === 'PENDING_PAYMENT' &&
    order.hold.status === 'HELD' &&
    now >= order.hold.expiresAt &&
    !unresolvedAttempt(order)
  );
}

export function withEvent(
  order: StoredOrder,
  type: OrderEventType,
  at: number,
  detail: string | null = null,
): StoredOrder {
  const seq = (order.events.at(-1)?.seq ?? 0) + 1;
  return { ...order, events: [...order.events, { seq, type, at, detail }], updatedAt: at };
}

export function setStatus(order: StoredOrder, to: OrderStatus): StoredOrder {
  if (order.status === to) return order;
  assertTransition(ORDER_TRANSITIONS, 'An order', order.status, to);
  return { ...order, status: to };
}

export function setHold(
  order: StoredOrder,
  to: HoldStatus,
  at: number,
  reason: string | null = null,
): StoredOrder {
  assertTransition(HOLD_TRANSITIONS, 'A seat hold', order.hold.status, to);
  return {
    ...order,
    hold: {
      ...order.hold,
      status: to,
      committedAt: to === 'COMMITTED' ? at : order.hold.committedAt,
      releasedAt: to === 'RELEASED' || to === 'EXPIRED' ? at : order.hold.releasedAt,
      releaseReason: reason ?? order.hold.releaseReason,
    },
  };
}

function setAttempt(
  order: StoredOrder,
  attemptId: string,
  change: Partial<Pick<StoredAttempt, 'failureReason' | 'providerReference' | 'completedAt'>> & {
    status: PaymentStatus;
  },
): StoredOrder {
  const attempt = order.attempts.find((candidate) => candidate.attemptId === attemptId);
  if (!attempt) throw new InvalidTransitionError(`No payment attempt ${attemptId} on this order.`);
  if (attempt.status !== change.status) {
    assertTransition(PAYMENT_TRANSITIONS, 'A payment', attempt.status, change.status);
  }
  return {
    ...order,
    attempts: order.attempts.map((candidate) =>
      candidate.attemptId === attemptId ? { ...candidate, ...change } : candidate,
    ),
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Record a new payment attempt, sent to the provider next. */
export function startAttempt(order: StoredOrder, attempt: StoredAttempt, maxAttempts: number) {
  if (order.status !== 'PENDING_PAYMENT' || order.hold.status !== 'HELD') {
    throw new InvalidTransitionError('Only a pending order with held seats can take a payment.');
  }
  if (unresolvedAttempt(order)) {
    throw new InvalidTransitionError('A payment attempt is still undecided.');
  }
  if (order.attempts.length >= maxAttempts) {
    throw new InvalidTransitionError('No payment attempts are left for this order.');
  }
  if (attempt.status !== 'PROCESSING' || attempt.amountMinor !== order.totalMinor) {
    throw new InvalidTransitionError(
      'A new attempt must be processing and charge the order total.',
    );
  }
  return withEvent(
    { ...order, attempts: [...order.attempts, attempt] },
    'PAYMENT_INITIATED',
    attempt.createdAt,
    attempt.method,
  );
}

/**
 * Payment succeeded: commit the held seats and confirm the order, in one change. Repeating it
 * for the same attempt changes nothing.
 */
export function confirmPayment(
  order: StoredOrder,
  attemptId: string,
  providerReference: string,
  now: number,
): StoredOrder {
  const attempt = order.attempts.find((candidate) => candidate.attemptId === attemptId);
  if (order.status === 'CONFIRMED' && attempt?.status === 'SUCCEEDED') return order;
  if (order.status !== 'PENDING_PAYMENT' || order.hold.status !== 'HELD') {
    throw new InvalidTransitionError(
      `An order that is ${order.status} with a ${order.hold.status} hold can't be confirmed.`,
    );
  }
  let next = setAttempt(order, attemptId, {
    status: 'SUCCEEDED',
    providerReference,
    completedAt: now,
    failureReason: null,
  });
  next = withEvent(next, 'PAYMENT_SUCCEEDED', now, providerReference);
  next = withEvent(setHold(next, 'COMMITTED', now), 'INVENTORY_COMMITTED', now);
  next = withEvent(setStatus(next, 'CONFIRMED'), 'ORDER_CONFIRMED', now);
  return { ...next, confirmedAt: now };
}

/** The attempt failed. After the last allowed attempt the order fails and its seats go back. */
export function failPayment(
  order: StoredOrder,
  attemptId: string,
  reason: string,
  now: number,
  maxAttempts: number,
  providerReference: string | null = null,
): StoredOrder {
  const attempt = order.attempts.find((candidate) => candidate.attemptId === attemptId);
  if (attempt?.status === 'FAILED') return order;
  let next = setAttempt(order, attemptId, {
    status: 'FAILED',
    failureReason: reason,
    completedAt: now,
    providerReference,
  });
  next = withEvent(next, 'PAYMENT_FAILED', now);
  if (next.status === 'PENDING_PAYMENT' && failedAttempts(next) >= maxAttempts) {
    next = withEvent(
      setHold(next, 'RELEASED', now, 'payment-failed'),
      'HOLD_RELEASED',
      now,
      'payment-failed',
    );
    next = withEvent(setStatus(next, 'PAYMENT_FAILED'), 'ORDER_PAYMENT_FAILED', now);
  }
  return next;
}

/** The provider hasn't decided yet (`PENDING`) or didn't answer in time (`UNKNOWN`). */
export function markPaymentUndecided(
  order: StoredOrder,
  attemptId: string,
  status: 'PENDING' | 'UNKNOWN',
  now: number,
  providerReference: string | null = null,
): StoredOrder {
  const attempt = order.attempts.find((candidate) => candidate.attemptId === attemptId);
  if (attempt?.status === status) return order;
  const next = setAttempt(order, attemptId, {
    status,
    providerReference: providerReference ?? attempt?.providerReference ?? null,
  });
  return withEvent(next, status === 'PENDING' ? 'PAYMENT_PENDING' : 'PAYMENT_UNKNOWN', now);
}

/** The hold ended with no payment in flight: release the seats and expire the order. */
export function expireOrder(order: StoredOrder, now: number): StoredOrder {
  if (!holdExpiredAt(order, now)) {
    throw new InvalidTransitionError('This order’s hold has not ended, or a payment is undecided.');
  }
  let next = withEvent(setHold(order, 'EXPIRED', now, 'expired'), 'HOLD_EXPIRED', now);
  next = withEvent(setStatus(next, 'EXPIRED'), 'ORDER_EXPIRED', now);
  return next;
}

/** A newer checkout of the same trip replaces this one. */
export function cancelOrder(order: StoredOrder, reason: string, now: number): StoredOrder {
  if (order.status !== 'PENDING_PAYMENT' || unresolvedAttempt(order)) {
    throw new InvalidTransitionError(
      'Only a pending order with no undecided payment can be cancelled.',
    );
  }
  let next = withEvent(setHold(order, 'RELEASED', now, reason), 'HOLD_RELEASED', now, reason);
  next = withEvent(setStatus(next, 'CANCELLED'), 'ORDER_CANCELLED', now, reason);
  return next;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/** Rules every stored order obeys. Checked before every write; a violation is never stored. */
export function assertOrderInvariants(order: StoredOrder, maxAttempts: number): void {
  const fail = (message: string) => {
    throw new OrderInvariantError(`Order ${order.orderId}: ${message}`);
  };
  const succeeded = order.attempts.filter((attempt) => attempt.status === 'SUCCEEDED');
  const unresolved = order.attempts.filter(isUnresolved);
  const expectedHold: Record<OrderStatus, HoldStatus[]> = {
    PENDING_PAYMENT: ['HELD'],
    CONFIRMED: ['COMMITTED'],
    PAYMENT_FAILED: ['RELEASED'],
    EXPIRED: ['EXPIRED'],
    CANCELLED: ['RELEASED'],
    BOOKING_CANCELLED: ['RELEASED'],
  };
  if (!expectedHold[order.status].includes(order.hold.status)) {
    fail(`status ${order.status} with a ${order.hold.status} hold.`);
  }
  const booked = order.status === 'CONFIRMED' || order.status === 'BOOKING_CANCELLED';
  if (booked) {
    if (succeeded.length !== 1) fail('a booking needs exactly one successful checkout payment.');
    if (order.confirmedAt === null) fail('a booking needs its confirmation time.');
  } else if (succeeded.length > 0) {
    fail(`a successful payment on an order that is ${order.status}.`);
  }
  if (unresolved.length > 1) fail('more than one undecided payment.');
  if (unresolved.length > 0 && order.status !== 'PENDING_PAYMENT') {
    fail('an undecided payment on an order that is no longer pending.');
  }
  if (order.attempts.length > maxAttempts) fail('too many payment attempts.');
  if (order.attempts.some((attempt) => attempt.amountMinor !== order.totalMinor)) {
    fail('a payment attempt for a different amount than the order total.');
  }
  const amounts = [order.totalMinor, ...order.items.map((item) => item.amountMinor)];
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) {
    fail('a negative or non-integer amount.');
  }
  if (order.items.reduce((sum, item) => sum + item.amountMinor, 0) !== order.totalMinor) {
    fail('items don’t add up to the total.');
  }
  if (order.items.some((item) => item.included && item.amountMinor !== 0)) {
    fail('an included item with a charge.');
  }
  if (order.events.length > MAX_ORDER_EVENTS) fail('too many events.');
  if (order.events.some((event, index) => event.seq !== index + 1)) {
    fail('events are not an unbroken sequence.');
  }
  assertServicingInvariants(order, fail);
}

const UNRESOLVED_REFUNDS: readonly string[] = UNRESOLVED_REFUND_STATUSES;

/** Milestone 6: the booking as it is now, its servicing operations, and their money. */
function assertServicingInvariants(order: StoredOrder, fail: (message: string) => never): void {
  const { current, servicing } = order;
  const booked = order.status === 'CONFIRMED' || order.status === 'BOOKING_CANCELLED';
  if (!booked && (servicing.length > 0 || current.version !== 1)) {
    fail('only a booking can be serviced.');
  }
  const currentTotal = current.items.reduce((sum, item) => sum + item.amountMinor, 0);
  if (current.items.some((item) => !Number.isSafeInteger(item.amountMinor) || item.amountMinor < 0)) {
    fail('a current item with a negative or non-integer amount.');
  }
  if (current.items.some((item) => item.included && item.amountMinor !== 0)) {
    fail('a current item that is included but charged.');
  }
  const ids = new Set(current.items.map((item) => item.id));
  if (ids.size !== current.items.length) fail('two current items share an id.');
  const seatKeys = new Set(current.seats.map((seat) => `${seat.flightId}|${seat.seatId}`));
  if (seatKeys.size !== current.seats.length) fail('two travellers in one seat.');
  const travellerFlight = new Set(current.seats.map((seat) => `${seat.flightId}|${seat.travellerId}`));
  if (travellerFlight.size !== current.seats.length) fail('a traveller with two seats on a flight.');

  let completedDelta = 0;
  let completedChanges = 0;
  let awaiting = 0;
  for (const op of servicing) {
    const where = `operation ${op.operationId}`;
    const succeededAttempts = op.attempts.filter((attempt) => attempt.status === 'SUCCEEDED');
    const undecided = op.attempts.filter(isUnresolved);
    if (undecided.length > 1) fail(`${where}: more than one undecided payment.`);
    if (undecided.length > 0 && op.status !== 'AWAITING_PAYMENT') {
      fail(`${where}: an undecided payment on an operation that is ${op.status}.`);
    }
    if (op.attempts.some((attempt) => attempt.amountMinor !== op.adjustment.amountMinor)) {
      fail(`${where}: a payment for another amount than the operation's charge.`);
    }
    if (op.attempts.length > 0 && op.adjustment.kind !== 'CHARGE') {
      fail(`${where}: a payment on an operation that charges nothing.`);
    }
    if (op.status === 'AWAITING_PAYMENT') {
      awaiting += 1;
      if (order.status !== 'CONFIRMED') fail(`${where}: awaiting payment on a ${order.status} order.`);
      if (op.adjustment.kind !== 'CHARGE') fail(`${where}: awaiting payment with nothing to pay.`);
      if (!op.plan || op.plan.baseVersion !== current.version) fail(`${where}: no plan for the current booking.`);
      if (op.claim && op.claim.status !== 'HELD') fail(`${where}: awaiting payment without its claim.`);
      if (succeededAttempts.length > 0) fail(`${where}: paid but not applied.`);
    } else {
      if (op.plan) fail(`${where}: a plan left on a finished operation.`);
      if (op.claim?.status === 'HELD') fail(`${where}: a claim left held on a finished operation.`);
    }
    if (op.status === 'COMPLETED') {
      if (op.newRevision === null || op.completedAt === null) fail(`${where}: completed without its revision.`);
      const paid = op.adjustment.kind === 'CHARGE' ? 1 : 0;
      if (succeededAttempts.length !== paid) fail(`${where}: completed without exactly its payment.`);
      if (op.operation !== 'CANCEL_ORDER') {
        completedChanges += 1;
        completedDelta += op.valueDeltaMinor;
        const { kind, amountMinor } = op.adjustment;
        const money = kind === 'CHARGE' ? amountMinor : kind === 'NONE' ? 0 : -amountMinor;
        if (money !== op.valueDeltaMinor) fail(`${where}: its money doesn't match what changed.`);
      }
    } else if (succeededAttempts.length > 0) {
      fail(`${where}: a successful payment on an operation that is ${op.status}.`);
    }
    if (op.refunds.length > 0) {
      if (op.adjustment.kind !== 'REFUND' || op.status !== 'COMPLETED') {
        fail(`${where}: a refund for an operation that owes none.`);
      }
      if (op.refunds.filter((refund) => UNRESOLVED_REFUNDS.includes(refund.status)).length > 1) {
        fail(`${where}: more than one refund in progress.`);
      }
      if (op.refunds.some((refund) => refund.amountMinor !== op.adjustment.amountMinor)) {
        fail(`${where}: a refund for another amount than owed.`);
      }
      if (op.refunds.filter((refund) => refund.status === 'SUCCEEDED').length > 1) {
        fail(`${where}: refunded twice.`);
      }
    }
  }
  if (awaiting > 1) fail('more than one change waiting for payment.');
  if (currentTotal !== order.totalMinor + completedDelta) {
    fail('the current items don’t add up to the purchase plus its completed changes.');
  }
  if (current.version !== 1 + completedChanges) fail('the booking version doesn’t match its changes.');
  const cancellations = servicing.filter(
    (op) => op.operation === 'CANCEL_ORDER' && op.status === 'COMPLETED',
  );
  if ((order.status === 'BOOKING_CANCELLED') !== (cancellations.length === 1)) {
    fail('a cancelled booking needs exactly one completed cancellation.');
  }
  if ((order.status === 'BOOKING_CANCELLED') !== (order.cancelledAt !== null)) {
    fail('the cancellation time doesn’t match the status.');
  }
  if (servicing.length > MAX_SERVICING_OPERATIONS) fail('too many servicing operations.');
}
