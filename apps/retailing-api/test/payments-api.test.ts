import { apiErrorSchema, orderResponseSchema } from '@velasia/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredOrder } from '../src/db/schema';
import {
  newGuestToken,
  newKey,
  pay,
  paymentOf,
  paymentStatus,
  prepared,
  readyCheckout,
  startHarness,
  type CallResult,
  type Harness,
} from './checkout-harness';

/*
 * The simulated payment engine. The backend decides every outcome: the request can only pick a
 * simulated scenario (where allowed), never a status or an amount. After every test, the
 * durable state is checked against the provider's own ledger.
 */

let h: Harness;
let wall = 1_000_000;
beforeAll(async () => {
  h = await startHarness({ testHooks: { wallClock: () => wall } });
});
afterAll(async () => {
  await expectNoFalseConfirmations();
  await h.close();
});

async function newOrder() {
  const ready = await readyCheckout(h);
  const guest = newGuestToken();
  const order = await prepared(h, ready, guest);
  return { order, guest };
}

const stored = async (orderId: string) => (await h.app.persistence.orders.byId(orderId))!;
const charges = (orderId: string) => h.app.persistence.provider.countForOrder(orderId);
const codeOf = (response: CallResult) => apiErrorSchema.parse(response.json()).error.code;

/**
 * Across every order in the database: a confirmed order has exactly one successful attempt, its
 * hold is committed, and the provider recorded that charge as succeeded for the order total.
 * Nothing else is confirmed, and no order was charged successfully twice.
 */
async function expectNoFalseConfirmations() {
  const orders: StoredOrder[] = await h.app.persistence.orders.all();
  const ledger = await h.app.persistence.provider.all();
  for (const order of orders) {
    const successes = ledger.filter((c) => c.orderId === order.orderId && c.status === 'SUCCEEDED');
    if (order.status === 'CONFIRMED') {
      const attempt = order.attempts.find((a) => a.status === 'SUCCEEDED')!;
      expect(order.hold.status).toBe('COMMITTED');
      expect(successes.map((c) => c.attemptId)).toEqual([attempt.attemptId]);
      expect(successes[0]!.amountMinor).toBe(order.totalMinor);
    } else {
      expect(order.attempts.some((a) => a.status === 'SUCCEEDED')).toBe(false);
      // A success the order doesn't know about yet may only exist while it is still undecided.
      if (successes.length)
        expect(
          order.attempts.some((a) => ['PROCESSING', 'UNKNOWN', 'PENDING'].includes(a.status)),
        ).toBe(true);
    }
  }
}

describe('outcomes', () => {
  it('success confirms the order and commits the seats', async () => {
    const { order, guest } = await newOrder();
    const response = await pay(h, order.id, guest, { outcome: 'SUCCESS', method: 'DEMO_WALLET' });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const result = paymentOf(response);
    expect(result.attempt).toMatchObject({
      status: 'SUCCEEDED',
      method: 'DEMO_WALLET',
      amountMinor: order.totalMinor,
    });
    expect(result.attempt!.providerReference).toMatch(/^DEMO-/);
    expect(result.order).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'SUCCEEDED',
      hold: { status: 'COMMITTED' },
    });
    expect(result.order.confirmedAt).not.toBeNull();
    expect(await charges(order.id)).toBe(1);
    expect((await stored(order.id)).events.map((e) => e.type)).toEqual([
      'ORDER_CREATED',
      'INVENTORY_HELD',
      'PAYMENT_INITIATED',
      'PAYMENT_SUCCEEDED',
      'INVENTORY_COMMITTED',
      'ORDER_CONFIRMED',
    ]);
  });

  it('a decline keeps the order pending and payable; a retry with a new key can succeed', async () => {
    const { order, guest } = await newOrder();
    const declined = paymentOf(await pay(h, order.id, guest, { outcome: 'DECLINED' }));
    expect(declined.attempt).toMatchObject({ status: 'FAILED' });
    expect(declined.attempt!.failureReason).toMatch(/declined/i);
    expect(declined.order).toMatchObject({
      status: 'PENDING_PAYMENT',
      hold: { status: 'HELD' },
      payment: { canPay: true, attemptsRemaining: 4 },
    });
    const retried = paymentOf(await pay(h, order.id, guest, { outcome: 'SUCCESS' }));
    expect(retried.order.status).toBe('CONFIRMED');
    expect(retried.order.payment.attempts.map((a) => a.status)).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('pending: not confirmed early; the status check confirms it once the provider decides', async () => {
    const { order, guest } = await newOrder();
    const response = await pay(h, order.id, guest, { outcome: 'PENDING' });
    expect(response.statusCode).toBe(202);
    expect(paymentOf(response).order).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      payment: { canPay: false, awaitingResult: true },
    });
    // Not decided yet.
    const early = await paymentStatus(h, order.id, guest);
    expect(early.statusCode).toBe(202);
    expect(paymentOf(early).order.status).toBe('PENDING_PAYMENT');
    // A second payment can't start while this one is undecided.
    expect(codeOf(await pay(h, order.id, guest, { outcome: 'SUCCESS' }))).toBe(
      'PAYMENT_IN_PROGRESS',
    );
    wall += 1_000; // the provider's own clock passes its decision time
    const decided = await paymentStatus(h, order.id, guest);
    expect(decided.statusCode).toBe(200);
    expect(paymentOf(decided).order).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'SUCCEEDED',
    });
    expect(await charges(order.id)).toBe(1);
  });

  it('timeout: the result is unknown, a blind retry is refused, the status check recovers it', async () => {
    const { order, guest } = await newOrder();
    const key = newKey();
    const response = await pay(h, order.id, guest, { outcome: 'TIMEOUT', key });
    expect(response.statusCode).toBe(202);
    expect(paymentOf(response).attempt?.status).toBe('UNKNOWN');
    expect(paymentOf(response).order.status).toBe('PENDING_PAYMENT');
    // Retrying the same attempt replays it — no second charge.
    const replay = await pay(h, order.id, guest, { outcome: 'TIMEOUT', key });
    expect(replay.statusCode).toBe(202);
    expect(paymentOf(replay)).toMatchObject({ replayed: true, attempt: { status: 'UNKNOWN' } });
    // A new attempt is refused until the outcome is known.
    const blind = await pay(h, order.id, guest, { outcome: 'SUCCESS' });
    expect(blind.statusCode).toBe(409);
    expect(codeOf(blind)).toBe('PAYMENT_IN_PROGRESS');
    expect(await charges(order.id)).toBe(1);
    // The provider did take the payment: the lookup confirms the order.
    const recovered = paymentOf(await paymentStatus(h, order.id, guest));
    expect(recovered.order.status).toBe('CONFIRMED');
    expect(recovered.attempt?.status).toBe('SUCCEEDED');
    expect(await charges(order.id)).toBe(1);
  });

  it('an answer lost after the commit: the order is already confirmed when the client asks', async () => {
    const { order, guest } = await newOrder();
    let answered = false;
    const slow = pay(h, order.id, guest, { outcome: 'SUCCESS', fault: 'slow-commit' }).then((r) => {
      answered = true;
      return r;
    });
    // While the answer is still held back, the order is already confirmed.
    let status = '';
    while (!answered && status !== 'CONFIRMED') {
      // Yield to timers: TalaDB's findOne is synchronous, so inject alone never leaves the
      // microtask queue and the held-back answer could never complete.
      await new Promise((resolve) => setTimeout(resolve, 10));
      status = orderResponseSchema.parse(
        (await h.call(`/v1/orders/${order.id}`, { token: guest })).json(),
      ).data.status;
    }
    expect(status).toBe('CONFIRMED');
    expect(answered).toBe(false);
    expect((await slow).statusCode).toBe(201);
  });
});

describe('retries and duplicates', () => {
  it('concurrent duplicates of one attempt charge once', async () => {
    const { order, guest } = await newOrder();
    const key = newKey();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => pay(h, order.id, guest, { outcome: 'SUCCESS', key })),
    );
    expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
    for (const response of responses) {
      expect([200, 201, 202]).toContain(response.statusCode);
    }
    const final = await stored(order.id);
    expect(final.attempts).toHaveLength(1);
    expect(final.status).toBe('CONFIRMED');
    expect(await charges(order.id)).toBe(1);
  });

  it('a reused key with different details is refused', async () => {
    const { order, guest } = await newOrder();
    const key = newKey();
    await pay(h, order.id, guest, { outcome: 'DECLINED', key });
    const conflict = await pay(h, order.id, guest, { outcome: 'SUCCESS', key });
    expect(conflict.statusCode).toBe(409);
    expect(codeOf(conflict)).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('paying a confirmed order again charges nothing', async () => {
    const { order, guest } = await newOrder();
    await pay(h, order.id, guest, { outcome: 'SUCCESS' });
    const again = await pay(h, order.id, guest, { outcome: 'SUCCESS' });
    expect(again.statusCode).toBe(409);
    expect(codeOf(again)).toBe('ORDER_ALREADY_CONFIRMED');
    expect(await charges(order.id)).toBe(1);
    expect((await stored(order.id)).attempts).toHaveLength(1);
  });

  it('after the last allowed decline, the order fails and the seats go back', async () => {
    const { order, guest } = await newOrder();
    let last;
    for (let i = 0; i < 5; i += 1)
      last = paymentOf(await pay(h, order.id, guest, { outcome: 'DECLINED' }));
    expect(last!.order).toMatchObject({
      status: 'PAYMENT_FAILED',
      hold: { status: 'RELEASED' },
      payment: { canPay: false, attemptsRemaining: 0 },
    });
    expect(h.app.persistence.ledger.activeOrderIds()).not.toContain(order.id);
    const more = await pay(h, order.id, guest, { outcome: 'SUCCESS' });
    expect(more.statusCode).toBe(409);
    expect(codeOf(more)).toBe('ORDER_NOT_PAYABLE');
    expect(await charges(order.id)).toBe(5);
  });
});

describe('what the client can’t do', () => {
  it('send an amount, a status, or unknown fields', async () => {
    const { order, guest } = await newOrder();
    for (const extra of [
      { amountMinor: 1 },
      { status: 'SUCCEEDED' },
      { cardNumber: '4111111111111111' },
    ]) {
      const response = await pay(h, order.id, guest, { outcome: 'SUCCESS', extra });
      expect(response.statusCode).toBe(400);
      expect(codeOf(response)).toBe('BAD_REQUEST');
    }
    expect((await stored(order.id)).attempts).toHaveLength(0);
    const invalid = await h.call(`/v1/orders/${order.id}/payment-attempts`, {
      method: 'POST',
      token: guest,
      body: { idempotencyKey: newKey(), method: 'REAL_CARD' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('pay after the hold ended: refused, nothing charged, seats released', async () => {
    const { order, guest } = await newOrder();
    const response = await pay(h, order.id, guest, {
      outcome: 'SUCCESS',
      scenario: 'hold-expired',
    });
    expect(response.statusCode).toBe(410);
    expect(codeOf(response)).toBe('HOLD_EXPIRED');
    expect(await charges(order.id)).toBe(0);
    expect((await stored(order.id)).status).toBe('EXPIRED');
  });
});

describe('without outcome controls', () => {
  it('every demo payment is approved, and choosing an outcome is refused', async () => {
    const locked = await startHarness({
      config: {
        payments: {
          outcomeControls: false,
          pendingResolveMs: 0,
          responseDelayMs: 0,
          timeoutMs: 1_500,
        },
      },
    });
    try {
      const ready = await readyCheckout(locked);
      const guest = newGuestToken();
      const order = await prepared(locked, ready, guest);
      const refused = await pay(locked, order.id, guest, { outcome: 'SUCCESS' });
      expect(refused.statusCode).toBe(400);
      expect(refused.body).toMatch(/isn’t available/);
      const approved = paymentOf(await pay(locked, order.id, guest));
      expect(approved.order.status).toBe('CONFIRMED');
      const options = (await locked.call('/v1/payments/options')).json().data;
      expect(options).toMatchObject({ outcomeControls: false, outcomes: [] });
    } finally {
      await locked.close();
    }
  });
});
