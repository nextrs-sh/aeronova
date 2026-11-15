import type {
  CreatePaymentAttemptRequest,
  PaymentStatus,
  SimulatedOutcome,
} from '@velasia/contracts';
import { crashIf, type CrashPoint } from '../crash';
import type { StoredAttempt, StoredOrder } from '../db/schema';
import type { RetailingResult, RetailingService } from '../offers/retailing-service';
import type { Scenario } from '../offers/scenario';
import { canAccess, type Principal } from './access';
import { hashOf, newId } from './ids';
import {
  confirmPayment,
  failPayment,
  isUnresolved,
  markPaymentUndecided,
  startAttempt,
  unresolvedAttempt,
} from './lifecycle';
import type { OrderStore } from './order-store';
import type { ChargeAnswer, PaymentSimulator } from './payment-simulator';

/*
 * Orders after checkout: protected reads, simulated payments, and recovery.
 *
 * A payment runs in three steps, so the slow provider call never holds the serial queue:
 *
 *   A. (queue) check the order and record the attempt as PROCESSING — durable before anything is
 *      charged. The order's hold is now pinned: it can't expire under an undecided payment.
 *   B. (no queue) ask the simulated provider, which records its own charge durably first.
 *   C. (queue) apply the provider's answer: SUCCEEDED confirms the order and commits the hold in
 *      one write; DECLINED fails the attempt; PENDING or no answer leave it undecided.
 *
 * If the process stops between steps, the order shows an undecided attempt and the provider
 * knows the truth: `reconcile` asks the provider and finishes the job. It never invents a
 * success: an attempt the provider has no record of was never charged, and fails.
 */

export interface OrderServiceConfig {
  maxPaymentAttempts: number;
  /** Whether a request may choose the simulated outcome (test and demo environments). */
  outcomeControls: boolean;
}

type Failure = Extract<RetailingResult<never>, { ok: false }>;
const fail = (status: Failure['status'], code: Failure['code'], message: string): Failure => ({
  ok: false,
  status,
  code,
  message,
});

const NOT_FOUND = () => fail(404, 'ORDER_NOT_FOUND', 'We couldn’t find this booking.');
const NEVER_CHARGED =
  'The payment didn’t reach the provider, so nothing was charged. You can try again.';

export interface PaymentOutcome {
  order: StoredOrder;
  attempt: StoredAttempt | null;
  replayed: boolean;
}

export function createOrderService({
  store,
  provider,
  retailing,
  config,
  log,
}: {
  store: OrderStore;
  provider: PaymentSimulator;
  retailing: Pick<RetailingService, 'markOrdered' | 'now'>;
  config: OrderServiceConfig;
  log?: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void };
}) {
  const { repository, queue } = store;
  const max = config.maxPaymentAttempts;

  /** The order if this principal may open it; otherwise exactly like an unknown order. */
  async function owned(orderId: string, principal: Principal, now: number) {
    const order = await store.readCurrent(orderId, now);
    return order && canAccess(order, principal) ? order : null;
  }

  /** Apply what the provider said about an attempt. Idempotent; inside the queue. */
  async function applyCharge(
    order: StoredOrder,
    attemptId: string,
    answer: ChargeAnswer | { kind: 'missing' },
    now: number,
  ): Promise<StoredOrder> {
    const attempt = order.attempts.find((candidate) => candidate.attemptId === attemptId);
    if (!attempt || !isUnresolved(attempt)) return order;
    let next: StoredOrder;
    if (answer.kind === 'timeout') {
      next = markPaymentUndecided(order, attemptId, 'UNKNOWN', now);
    } else if (answer.kind === 'missing') {
      next = failPayment(order, attemptId, NEVER_CHARGED, now, max);
    } else {
      const { charge } = answer;
      if (charge.amountMinor !== order.totalMinor || charge.orderId !== order.orderId) {
        throw new Error(`Provider charge ${charge.reference} doesn’t match its order.`);
      }
      next =
        charge.status === 'SUCCEEDED'
          ? confirmPayment(order, attemptId, charge.reference, now)
          : charge.status === 'DECLINED'
            ? failPayment(
                order,
                attemptId,
                charge.declineReason ?? 'Declined.',
                now,
                max,
                charge.reference,
              )
            : markPaymentUndecided(order, attemptId, 'PENDING', now, charge.reference);
    }
    const stored = await store.write(order, next);
    if (stored.status === 'CONFIRMED' && order.status !== 'CONFIRMED') {
      retailing.markOrdered(stored.sessionId, stored.orderId);
      log?.info({ orderId: stored.orderId, reference: stored.reference }, 'order confirmed');
    }
    return stored;
  }

  /**
   * Ask the provider about the order's undecided attempt, if any. Inside the queue. The
   * provider's record is the truth; "no record" means "never charged" only once nothing in this
   * process can still be creating one.
   */
  async function resolveUndecided(order: StoredOrder, now: number): Promise<StoredOrder> {
    const attempt = unresolvedAttempt(order);
    if (!attempt) return order;
    const charge = await provider.lookup(attempt.attemptId);
    if (charge) return applyCharge(order, attempt.attemptId, { kind: 'answered', charge }, now);
    if (provider.isInFlight(attempt.attemptId)) return order; // its answer will arrive (step C)
    return applyCharge(order, attempt.attemptId, { kind: 'missing' }, now);
  }

  const latestAttempt = (order: StoredOrder) => order.attempts.at(-1) ?? null;

  return {
    config,

    async get(
      orderId: string,
      principal: Principal,
      scenario?: Scenario,
    ): Promise<RetailingResult<StoredOrder>> {
      const order = await owned(orderId, principal, retailing.now(scenario));
      return order ? { ok: true, value: order } : NOT_FOUND();
    },

    /** Look up by booking reference. The reference alone grants nothing: the caller must own it. */
    async getByReference(
      reference: string,
      principal: Principal,
      scenario?: Scenario,
    ): Promise<RetailingResult<StoredOrder>> {
      const found = await repository.byReference(reference);
      if (!found || !canAccess(found, principal)) return NOT_FOUND();
      return this.get(found.orderId, principal, scenario);
    },

    async pay(
      orderId: string,
      principal: Principal,
      request: CreatePaymentAttemptRequest,
      scenario?: Scenario,
      crashAt?: CrashPoint | null,
    ): Promise<RetailingResult<PaymentOutcome>> {
      if (request.simulatedOutcome && !config.outcomeControls) {
        return fail(400, 'BAD_REQUEST', 'Choosing a payment outcome isn’t available here.');
      }
      const outcome: SimulatedOutcome = request.simulatedOutcome ?? 'SUCCESS';
      const requestHash = hashOf({ method: request.method, outcome });

      // A. Record the attempt.
      const started = await queue.run(
        async (): Promise<RetailingResult<PaymentOutcome & { fresh: boolean }>> => {
          const now = retailing.now(scenario);
          const current = await repository.byId(orderId);
          if (!current || !canAccess(current, principal)) return NOT_FOUND();
          const replay = current.attempts.find(
            (attempt) => attempt.idempotencyKey === request.idempotencyKey,
          );
          if (replay) {
            if (replay.requestHash !== requestHash) {
              return fail(
                409,
                'IDEMPOTENCY_CONFLICT',
                'This payment request was already used with different details. Please reload.',
              );
            }
            return {
              ok: true,
              value: { order: current, attempt: replay, replayed: true, fresh: false },
            };
          }
          const order = await store.expireIfDue(current, now);
          if (order.status === 'CONFIRMED') {
            return fail(
              409,
              'ORDER_ALREADY_CONFIRMED',
              'This booking is already confirmed. Nothing was charged again.',
            );
          }
          if (order.status === 'EXPIRED') {
            return fail(
              410,
              'HOLD_EXPIRED',
              'Your seat hold has ended, so we released the seats. Nothing was charged.',
            );
          }
          if (order.status !== 'PENDING_PAYMENT') {
            return fail(409, 'ORDER_NOT_PAYABLE', 'This checkout can no longer be paid.');
          }
          if (unresolvedAttempt(order)) {
            return fail(
              409,
              'PAYMENT_IN_PROGRESS',
              'Your last payment is still being processed. Check its status before paying again.',
            );
          }
          if (order.attempts.length >= max) {
            return fail(
              409,
              'ORDER_NOT_PAYABLE',
              'No payment attempts are left for this checkout.',
            );
          }
          const attempt: StoredAttempt = {
            attemptId: newId('pay'),
            idempotencyKey: request.idempotencyKey,
            requestHash,
            method: request.method,
            simulatedOutcome: request.simulatedOutcome ?? null,
            amountMinor: order.totalMinor,
            currency: order.currency,
            status: 'PROCESSING',
            createdAt: now,
            startedAtWall: Date.now(),
            completedAt: null,
            failureReason: null,
            providerReference: null,
          };
          const stored = await store.write(order, startAttempt(order, attempt, max));
          crashIf(crashAt, 'payment:after-attempt');
          return { ok: true, value: { order: stored, attempt, replayed: false, fresh: true } };
        },
      );
      if (!started.ok) return started;
      if (!started.value.fresh) {
        const { order, attempt } = started.value;
        return {
          ok: true,
          value: {
            order,
            attempt: order.attempts.find((a) => a.attemptId === attempt!.attemptId) ?? null,
            replayed: true,
          },
        };
      }
      const attempt = started.value.attempt!;

      // B. Ask the provider (outside the queue).
      const answer = await provider.charge(
        {
          attemptId: attempt.attemptId,
          orderId,
          amountMinor: attempt.amountMinor,
          currency: attempt.currency,
          method: attempt.method,
          outcome,
        },
        crashAt,
      );

      // C. Apply the answer.
      const order = await queue.run(async () => {
        const latest = (await repository.byId(orderId))!;
        return applyCharge(latest, attempt.attemptId, answer, retailing.now(scenario));
      });
      crashIf(crashAt, 'payment:after-confirm');
      return {
        ok: true,
        value: {
          order,
          attempt: order.attempts.find((a) => a.attemptId === attempt.attemptId) ?? null,
          replayed: false,
        },
      };
    },

    /** Find out what happened to an undecided payment, and apply it. */
    async refreshStatus(
      orderId: string,
      principal: Principal,
      scenario?: Scenario,
    ): Promise<RetailingResult<PaymentOutcome>> {
      return queue.run(async () => {
        const now = retailing.now(scenario);
        const current = await repository.byId(orderId);
        if (!current || !canAccess(current, principal)) return NOT_FOUND();
        const resolved = await resolveUndecided(current, now);
        const order = await store.expireIfDue(resolved, now);
        return { ok: true, value: { order, attempt: latestAttempt(order), replayed: false } };
      });
    },

    /**
     * Startup recovery and periodic sweep: decide undecided payments with the provider, then
     * expire holds that have ended. Reads only durable state; safe to run any number of times.
     */
    async reconcile(
      now: number,
    ): Promise<{ resolved: number; expired: number; confirmed: number }> {
      const summary = { resolved: 0, expired: 0, confirmed: 0 };
      const candidates = new Map<string, StoredOrder>();
      for (const order of await repository.pendingPayment()) candidates.set(order.orderId, order);
      for (const order of await repository.heldDueBy(now)) candidates.set(order.orderId, order);
      for (const orderId of candidates.keys()) {
        await queue.run(async () => {
          const current = await repository.byId(orderId);
          if (!current) return;
          let order = current;
          if (unresolvedAttempt(order)) {
            order = await resolveUndecided(order, now);
            if (!unresolvedAttempt(order)) summary.resolved += 1;
            if (order.status === 'CONFIRMED') summary.confirmed += 1;
          }
          const expired = await store.expireIfDue(order, now);
          if (expired.status === 'EXPIRED' && order.status !== 'EXPIRED') summary.expired += 1;
        });
      }
      if (summary.resolved || summary.expired) log?.info(summary, 'orders reconciled');
      return summary;
    },
  };
}

export type OrderService = ReturnType<typeof createOrderService>;

/** HTTP status for a payment answer: 202 while the outcome is still undecided. */
export function paymentHttpStatus(status: PaymentStatus | undefined, replayed: boolean) {
  if (status === 'PROCESSING' || status === 'PENDING' || status === 'UNKNOWN') return 202;
  return replayed ? 200 : 201;
}
