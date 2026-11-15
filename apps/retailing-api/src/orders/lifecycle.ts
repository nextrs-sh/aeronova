import {
  UNRESOLVED_PAYMENT_STATUSES,
  type HoldStatus,
  type OrderStatus,
  type PaymentStatus,
} from '@velasia/contracts';
import {
  MAX_ORDER_EVENTS,
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
 * Every other change is refused with an `InvalidTransitionError`. Confirming an order that is
 * already confirmed by the same payment is a no-op, so repeated confirmations are harmless.
 */

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['CONFIRMED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: [],
  PAYMENT_FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export const HOLD_TRANSITIONS: Readonly<Record<HoldStatus, readonly HoldStatus[]>> = {
  HELD: ['COMMITTED', 'RELEASED', 'EXPIRED'],
  COMMITTED: [],
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

function assertTransition<S extends string>(
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

function withEvent(
  order: StoredOrder,
  type: OrderEventType,
  at: number,
  detail: string | null = null,
): StoredOrder {
  const seq = (order.events.at(-1)?.seq ?? 0) + 1;
  return { ...order, events: [...order.events, { seq, type, at, detail }], updatedAt: at };
}

function setStatus(order: StoredOrder, to: OrderStatus): StoredOrder {
  if (order.status === to) return order;
  assertTransition(ORDER_TRANSITIONS, 'An order', order.status, to);
  return { ...order, status: to };
}

function setHold(
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
  };
  if (!expectedHold[order.status].includes(order.hold.status)) {
    fail(`status ${order.status} with a ${order.hold.status} hold.`);
  }
  if (order.status === 'CONFIRMED') {
    if (succeeded.length !== 1) fail('a confirmed order needs exactly one successful payment.');
    if (order.confirmedAt === null) fail('a confirmed order needs its confirmation time.');
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
}
