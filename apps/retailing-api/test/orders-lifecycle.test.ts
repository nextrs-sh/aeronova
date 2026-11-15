import { describe, expect, it } from 'vitest';
import type { StoredAttempt, StoredOrder } from '../src/db/schema';
import { AllocationLedger } from '../src/inventory/ledger';
import {
  HOLD_TRANSITIONS,
  InvalidTransitionError,
  ORDER_TRANSITIONS,
  OrderInvariantError,
  PAYMENT_TRANSITIONS,
  assertOrderInvariants,
  cancelOrder,
  confirmPayment,
  expireOrder,
  failPayment,
  holdExpiredAt,
  markPaymentUndecided,
  startAttempt,
} from '../src/orders/lifecycle';
import { canPay, toPublicOrder } from '../src/orders/public';
import { QueueFullError, SerialQueue } from '../src/orders/serial-queue';
import { hashOf, ownsOrder } from '../src/orders/ids';
import { FIXTURE_GUEST_TOKEN, sampleOrder } from './order-fixtures';

const MAX = 3;

function attempt(order: StoredOrder, n = 1, at = order.createdAt): StoredAttempt {
  return {
    attemptId: `pay_${String(n).padStart(22, 'A')}`,
    idempotencyKey: `key-${String(n).padStart(16, '0')}`,
    requestHash: hashOf({ n }),
    method: 'DEMO_CARD',
    simulatedOutcome: null,
    amountMinor: order.totalMinor,
    currency: 'PHP',
    status: 'PROCESSING',
    createdAt: at,
    startedAtWall: 0,
    completedAt: null,
    failureReason: null,
    providerReference: null,
  };
}

const started = (order = sampleOrder(), n = 1) => {
  const a = attempt(order, n);
  return { order: startAttempt(order, a, MAX), attemptId: a.attemptId };
};

describe('order lifecycle: transition tables', () => {
  it('only a pending order can change state; every other state is final', () => {
    expect(ORDER_TRANSITIONS.PENDING_PAYMENT).toEqual([
      'CONFIRMED',
      'PAYMENT_FAILED',
      'EXPIRED',
      'CANCELLED',
    ]);
    for (const state of ['CONFIRMED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(ORDER_TRANSITIONS[state]).toEqual([]);
    }
    expect(HOLD_TRANSITIONS.HELD).toEqual(['COMMITTED', 'RELEASED', 'EXPIRED']);
    expect(HOLD_TRANSITIONS.COMMITTED).toEqual([]);
    expect(PAYMENT_TRANSITIONS.SUCCEEDED).toEqual([]);
    expect(PAYMENT_TRANSITIONS.FAILED).toEqual([]);
    expect(PAYMENT_TRANSITIONS.PENDING).not.toContain('UNKNOWN');
  });
});

describe('order lifecycle: operations', () => {
  it('a successful payment commits the hold and confirms the order in one change', () => {
    const { order, attemptId } = started();
    const confirmed = confirmPayment(order, attemptId, 'DEMO-ABCDEF1234', order.createdAt + 5);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.hold.status).toBe('COMMITTED');
    expect(confirmed.attempts[0]).toMatchObject({
      status: 'SUCCEEDED',
      providerReference: 'DEMO-ABCDEF1234',
    });
    expect(confirmed.confirmedAt).toBe(order.createdAt + 5);
    expect(confirmed.events.map((event) => event.type)).toEqual([
      'ORDER_CREATED',
      'INVENTORY_HELD',
      'PAYMENT_INITIATED',
      'PAYMENT_SUCCEEDED',
      'INVENTORY_COMMITTED',
      'ORDER_CONFIRMED',
    ]);
    assertOrderInvariants(confirmed, MAX);
    // Confirmed → confirmed by the same payment: a no-op, not a second commit.
    expect(confirmPayment(confirmed, attemptId, 'DEMO-ABCDEF1234', 99)).toBe(confirmed);
  });

  it('refuses invalid transitions', () => {
    const { order, attemptId } = started();
    const confirmed = confirmPayment(order, attemptId, 'DEMO-ABCDEF1234', 1);
    // Confirmed → pending again, or a second payment.
    expect(() => startAttempt(confirmed, attempt(confirmed, 2), MAX)).toThrow(
      InvalidTransitionError,
    );
    expect(() => cancelOrder(confirmed, 'x', 2)).toThrow(InvalidTransitionError);
    expect(() => expireOrder(confirmed, Number.MAX_SAFE_INTEGER)).toThrow(InvalidTransitionError);
    // Expired → confirmed without a new allocation.
    const fresh = sampleOrder();
    const expired = expireOrder(fresh, fresh.hold.expiresAt);
    expect(() => confirmPayment(expired, 'pay_AAAAAAAAAAAAAAAAAAAAAA', 'DEMO-X', 1)).toThrow(
      InvalidTransitionError,
    );
    expect(() => startAttempt(expired, attempt(expired), MAX)).toThrow(InvalidTransitionError);
    // A second attempt while one is undecided.
    expect(() => startAttempt(order, attempt(order, 2), MAX)).toThrow(/still undecided/);
    // An attempt for a different amount.
    expect(() =>
      startAttempt(fresh, { ...attempt(fresh), amountMinor: fresh.totalMinor - 1 }, MAX),
    ).toThrow(InvalidTransitionError);
    // A decided payment can't change again.
    const failed = failPayment(order, attemptId, 'declined', 2, MAX);
    expect(() => confirmPayment(failed, attemptId, 'DEMO-X', 3)).toThrow(InvalidTransitionError);
  });

  it('a declined payment keeps the order pending until the last allowed attempt fails', () => {
    let order = sampleOrder();
    for (let n = 1; n <= MAX; n += 1) {
      const a = attempt(order, n);
      order = failPayment(
        startAttempt(order, a, MAX),
        a.attemptId,
        'declined',
        order.createdAt + n,
        MAX,
      );
      assertOrderInvariants(order, MAX);
      if (n < MAX) {
        expect(order.status).toBe('PENDING_PAYMENT');
        expect(order.hold.status).toBe('HELD');
      }
    }
    expect(order.status).toBe('PAYMENT_FAILED');
    expect(order.hold).toMatchObject({ status: 'RELEASED', releaseReason: 'payment-failed' });
    expect(() => startAttempt(order, attempt(order, 9), MAX)).toThrow(InvalidTransitionError);
  });

  it('an undecided payment pins the hold: it can’t expire until the payment is decided', () => {
    const { order, attemptId } = started();
    const late = order.hold.expiresAt + 60_000;
    const unknown = markPaymentUndecided(order, attemptId, 'UNKNOWN', late);
    expect(holdExpiredAt(unknown, late)).toBe(false);
    expect(() => expireOrder(unknown, late)).toThrow(InvalidTransitionError);
    expect(() => cancelOrder(unknown, 'superseded', late)).toThrow(InvalidTransitionError);
    // A success the provider recorded while the hold was valid still confirms the order.
    const confirmed = confirmPayment(unknown, attemptId, 'DEMO-ABCDEF1234', late + 1);
    expect(confirmed.status).toBe('CONFIRMED');
    // Once decided as failed, the ended hold expires.
    const failed = failPayment(unknown, attemptId, 'declined', late, MAX);
    expect(holdExpiredAt(failed, late)).toBe(true);
    expect(expireOrder(failed, late)).toMatchObject({
      status: 'EXPIRED',
      hold: { status: 'EXPIRED' },
    });
  });

  it('expiry and cancellation release the seats', () => {
    const order = sampleOrder();
    expect(holdExpiredAt(order, order.hold.expiresAt - 1)).toBe(false);
    expect(() => expireOrder(order, order.hold.expiresAt - 1)).toThrow(InvalidTransitionError);
    const expired = expireOrder(order, order.hold.expiresAt);
    expect(expired.events.at(-1)?.type).toBe('ORDER_EXPIRED');
    assertOrderInvariants(expired, MAX);
    const cancelled = cancelOrder(order, 'superseded', 5);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', hold: { status: 'RELEASED' } });
    assertOrderInvariants(cancelled, MAX);
  });
});

describe('order invariants', () => {
  it('reject states that must never be stored', () => {
    const order = sampleOrder();
    const bad = (patch: Partial<StoredOrder>) => () =>
      assertOrderInvariants({ ...order, ...patch }, MAX);
    expect(bad({ status: 'CONFIRMED' })).toThrow(OrderInvariantError); // no payment, HELD hold
    expect(bad({ hold: { ...order.hold, status: 'COMMITTED' } })).toThrow(OrderInvariantError);
    expect(bad({ totalMinor: order.totalMinor + 1 })).toThrow(/add up/);
    expect(bad({ items: [{ ...order.items[0]!, included: true }] })).toThrow(/included item/);
    const { order: paying, attemptId } = started(order);
    const confirmed = confirmPayment(paying, attemptId, 'DEMO-ABCDEF1234', 1);
    expect(() =>
      assertOrderInvariants(
        { ...confirmed, attempts: [...confirmed.attempts, confirmed.attempts[0]!] },
        MAX,
      ),
    ).toThrow(/exactly one successful payment/);
    expect(() => assertOrderInvariants({ ...paying, events: paying.events.slice(1) }, MAX)).toThrow(
      /unbroken sequence/,
    );
  });
});

describe('public order view', () => {
  it('exposes what the traveller needs and nothing internal', () => {
    const order = sampleOrder();
    const view = toPublicOrder(order, order.createdAt, MAX);
    expect(view).toMatchObject({
      id: order.orderId,
      reference: order.reference,
      status: 'PENDING_PAYMENT',
      paymentStatus: 'NOT_STARTED',
      payment: { canPay: true, awaitingResult: false, attemptsRemaining: MAX },
    });
    const json = JSON.stringify(view);
    for (const secret of [
      order.ownerTokenHash,
      order.checkoutKey,
      order.guestId,
      order.checkoutRequestHash,
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toContain('"rev"');
    expect(json).not.toContain('events');
    expect(canPay(order, order.hold.expiresAt, MAX)).toBe(false);
  });

  it('checks ownership in constant time against the stored hash only', () => {
    const order = sampleOrder();
    expect(ownsOrder(FIXTURE_GUEST_TOKEN, order.ownerTokenHash)).toBe(true);
    expect(ownsOrder('H'.repeat(43), order.ownerTokenHash)).toBe(false);
    expect(ownsOrder(undefined, order.ownerTokenHash)).toBe(false);
    expect(ownsOrder(order.ownerTokenHash, order.ownerTokenHash)).toBe(false);
  });
});

describe('allocation ledger', () => {
  const FLIGHT = 'NV501-20261215';
  function ledgerAt(time: { now: number }) {
    return new AllocationLedger(() => time.now);
  }
  const withSeats = (order: StoredOrder, seatIds: string[], seats = seatIds.length || 1) => ({
    ...order,
    hold: {
      ...order.hold,
      allocations: [{ flightId: FLIGHT, cabin: 'economy' as const, seats, seatIds }],
    },
  });

  it('counts held and committed seats, and stops counting a hold the moment it ends', () => {
    const order = withSeats(sampleOrder(), ['12A', '12B']);
    const time = { now: order.createdAt };
    const ledger = ledgerAt(time);
    ledger.apply(order);
    expect(ledger.seatsTaken(FLIGHT, 'economy')).toBe(2);
    expect([...ledger.occupancy(FLIGHT).seatIds]).toEqual(['12A', '12B']);
    time.now = order.hold.expiresAt;
    expect(ledger.seatsTaken(FLIGHT, 'economy')).toBe(0); // before any sweep
    // A pinned hold (undecided payment) keeps its seats past the expiry.
    const a = attempt(order);
    ledger.apply(startAttempt(order, a, MAX));
    expect(ledger.seatsTaken(FLIGHT, 'economy')).toBe(2);
    // Committed seats never expire; released ones are dropped.
    const committed = confirmPayment(
      startAttempt(order, a, MAX),
      a.attemptId,
      'DEMO-ABCDEF1234',
      1,
    );
    ledger.apply(committed);
    time.now = Number.MAX_SAFE_INTEGER;
    expect(ledger.seatsTaken(FLIGHT, 'economy')).toBe(2);
    ledger.apply(cancelOrder(order, 'x', 1));
    expect(ledger.seatsTaken(FLIGHT, 'economy')).toBe(0);
  });

  it('is rebuilt from durable orders and can ignore one session’s pending holds', () => {
    const a = withSeats(sampleOrder({ sessionId: `ses_${'A'.repeat(22)}` }), ['3C']);
    const b = withSeats(sampleOrder({ sessionId: `ses_${'B'.repeat(22)}` }), [], 2);
    const ledger = ledgerAt({ now: a.createdAt });
    ledger.rebuild([a, b]);
    expect(ledger.seatsTaken(FLIGHT, 'economy')).toBe(3);
    expect(
      ledger.withExcludedSession(a.sessionId, () => ledger.seatsTaken(FLIGHT, 'economy')),
    ).toBe(2);
    expect(ledger.seatsTaken(FLIGHT, 'economy')).toBe(3);
    expect(() => ledger.withExcludedSession(a.sessionId, () => Promise.resolve(1))).toThrow(
      /synchronous/,
    );
    // A confirmed order always counts, even for its own session.
    const at = attempt(a);
    ledger.apply(confirmPayment(startAttempt(a, at, MAX), at.attemptId, 'DEMO-ABCDEF1234', 1));
    expect(
      ledger.withExcludedSession(a.sessionId, () => ledger.seatsTaken(FLIGHT, 'economy')),
    ).toBe(3);
    ledger.rebuild([]);
    expect(ledger.activeOrderIds()).toEqual([]);
  });
});

describe('serial queue', () => {
  it('runs tasks one at a time, in order, even when they await', async () => {
    const queue = new SerialQueue();
    const log: string[] = [];
    const task = (name: string, ms: number) => () =>
      new Promise<string>((resolve) => {
        log.push(`start ${name}`);
        setTimeout(() => {
          log.push(`end ${name}`);
          resolve(name);
        }, ms);
      });
    const results = await Promise.all([
      queue.run(task('a', 20)),
      queue.run(task('b', 1)),
      queue.run(task('c', 5)),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('keeps going after a failure, refuses work beyond its bound, and never overlaps after a timeout', async () => {
    const queue = new SerialQueue({ maxPending: 2, taskTimeoutMs: 10 });
    await expect(queue.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    let running = 0;
    let overlapped = false;
    const slow = () =>
      new Promise<void>((resolve) => {
        running += 1;
        if (running > 1) overlapped = true;
        setTimeout(() => {
          running -= 1;
          resolve();
        }, 40);
      });
    const first = queue.run(slow);
    const second = queue.run(slow);
    await expect(queue.run(slow)).rejects.toThrow(QueueFullError);
    await expect(first).rejects.toThrow(/too long/); // the caller gives up…
    await second.catch(() => undefined);
    expect(overlapped).toBe(false); // …but the next task still waited
    await queue.drain();
    await expect(queue.run(slow)).rejects.toThrow(/shutting down/);
  });
});
