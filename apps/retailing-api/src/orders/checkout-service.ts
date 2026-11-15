import {
  formatFlightNumber,
  type CheckoutValidation,
  type PrepareCheckoutRequest,
  type ReviewIssue,
} from '@velasia/contracts';
import { crashIf, type CrashPoint } from '../crash';
import { ORDER_SCHEMA_VERSION, type StoredAllocation, type StoredOrder } from '../db/schema';
import { seatsAvailable } from '../inventory/inventory';
import type { RetailingResult, RetailingService } from '../offers/retailing-service';
import type { Scenario } from '../offers/scenario';
import type { FlightService } from '../services/flights';
import { formatPesos } from './format';
import { guestIdFor, hashOf, newBookingReference, newId } from './ids';
import { cancelOrder, unresolvedAttempt } from './lifecycle';
import type { OrderStore } from './order-store';
import { buildOrderContent } from './snapshot';

/*
 * Checkout: the last validation of a booking and the creation of its pending order.
 *
 * `prepare` runs entirely inside the serial queue, so no other checkout, payment, or expiry can
 * change inventory between its availability check and its write. The pending order and its seat
 * hold are one TalaDB document, written by one insert: either both exist or neither does.
 *
 * Retrying is safe:
 * - the same idempotency key with the same parameters returns the same order;
 * - the same key with different parameters is refused (`IDEMPOTENCY_CONFLICT`);
 * - the same request under a different key (another tab), or the same trip checked out again,
 *   returns the session's existing pending order instead of holding seats twice.
 */

export interface CheckoutConfig {
  holdMs: number;
  maxPaymentAttempts: number;
}

type Failure = Extract<RetailingResult<never>, { ok: false }>;
const fail = (status: Failure['status'], code: Failure['code'], message: string): Failure => ({
  ok: false,
  status,
  code,
  message,
});

const MAX_REFERENCE_TRIES = 8;

export interface PrepareResult {
  order: StoredOrder;
  replayed: boolean;
}

export function createCheckoutService({
  retailing,
  flights,
  store,
  config,
  referenceGenerator = newBookingReference,
}: {
  retailing: RetailingService;
  flights: FlightService;
  store: OrderStore;
  config: CheckoutConfig;
  referenceGenerator?: () => string;
}) {
  const { repository, ledger, queue } = store;

  /** Why these seats can't be held right now, or `null`. Checks every active hold. */
  function inventoryProblem(allocations: readonly StoredAllocation[]): string | null {
    const inventory = flights.current();
    for (const allocation of allocations) {
      const instance = inventory.getInstance(allocation.flightId);
      if (!instance) return 'A flight in your trip is no longer available.';
      const flight = formatFlightNumber(instance.schedule.flightNumber);
      if (seatsAvailable(instance, allocation.cabin) < allocation.seats) {
        return `There aren’t enough seats left on ${flight} for your party any more.`;
      }
      const taken = ledger.occupancy(allocation.flightId).seatIds;
      const clash = allocation.seatIds.find((seat) => taken.has(seat));
      if (clash) return `Seat ${clash} on ${flight} has just been booked by someone else.`;
    }
    return null;
  }

  async function uniqueReference(): Promise<string> {
    for (let attempt = 0; attempt < MAX_REFERENCE_TRIES; attempt += 1) {
      const reference = referenceGenerator();
      if (!(await repository.referenceExists(reference))) return reference;
    }
    throw new Error('Could not generate a unique booking reference.');
  }

  function notReady(issues: ReviewIssue[]): Failure {
    return {
      ...fail(
        409,
        'CHECKOUT_NOT_READY',
        issues[0]?.message ?? 'Your booking needs attention before checkout.',
      ),
      issues: issues.map((issue) => ({ path: issue.step, message: issue.message })),
    };
  }

  /** The session's pending order still holding seats, after expiring any that are due. */
  async function activePendingOrder(sessionId: string, now: number) {
    let active: StoredOrder | null = null;
    for (const order of await repository.pendingForSession(sessionId)) {
      const current = await store.expireIfDue(order, now);
      if (current.status === 'PENDING_PAYMENT') active = current;
    }
    return active;
  }

  return {
    /** Re-check a booking for checkout without creating anything. */
    validate(
      sessionId: string,
      token: string | undefined,
      acceptedTotalMinor: number | undefined,
      scenario?: Scenario,
    ): Promise<RetailingResult<CheckoutValidation>> {
      return queue.run(async () => {
        const now = retailing.now(scenario);
        const found = retailing.getSession(sessionId, token, scenario);
        if (!found.ok) return found;
        // The session's own pending hold doesn't count against it (see AllocationLedger).
        await activePendingOrder(sessionId, now);
        const checked = retailing.checkoutCheck(sessionId, token, scenario);
        if (!checked.ok) return checked;
        const { session, review, quote, baggage } = checked.value;
        const issues = [...review.issues];
        if (review.status === 'READY') {
          const problem = ledger.withExcludedSession(sessionId, () =>
            inventoryProblem(buildOrderContent({ session, quote, baggage }).allocations),
          );
          if (problem) {
            issues.push({
              code: 'SEAT_UNAVAILABLE',
              step: 'seats',
              message: problem,
              direction: null,
              travellerId: null,
              flightId: null,
            });
          }
        }
        const total = quote.totals.totalMinor;
        return {
          ok: true,
          value: {
            status: issues.length === 0 ? 'READY' : 'ACTION_REQUIRED',
            issues,
            priceChange:
              acceptedTotalMinor !== undefined && acceptedTotalMinor !== total
                ? { previousTotalMinor: acceptedTotalMinor, currentTotalMinor: total }
                : null,
            quote,
            session,
            holdMinutes: Math.round(config.holdMs / 60_000),
          },
        };
      });
    },

    /** Validate once more, then create the pending order and hold its seats (idempotent). */
    prepare(
      request: PrepareCheckoutRequest,
      sessionToken: string | undefined,
      guestToken: string,
      scenario?: Scenario,
      crashAt?: CrashPoint | null,
    ): Promise<RetailingResult<PrepareResult>> {
      return queue.run(async () => {
        const now = retailing.now(scenario);
        const { sessionId, idempotencyKey, expectedVersion, acceptedTotalMinor } = request;
        const found = retailing.getSession(sessionId, sessionToken, scenario);
        if (!found.ok) return found;
        const { guestId, tokenHash } = guestIdFor(guestToken);
        const checkoutKey = `${sessionId}:${idempotencyKey}`;
        const requestHash = hashOf({ sessionId, expectedVersion, acceptedTotalMinor });

        // 1. A retry of a request already handled: the same answer.
        const byKey = await repository.byCheckoutKey(checkoutKey);
        if (byKey) {
          if (byKey.checkoutRequestHash !== requestHash || byKey.ownerTokenHash !== tokenHash) {
            return fail(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This checkout request was already used for something else. Please reload and try again.',
            );
          }
          return {
            ok: true,
            value: { order: await store.expireIfDue(byKey, now), replayed: true },
          };
        }

        // 2. Already booked from this session.
        if (retailing.orderedOrderId(sessionId)) {
          return fail(409, 'SESSION_ORDERED', 'This trip has already been booked.');
        }

        // 3. The same request again under another key (another tab): the same pending order.
        const active = await activePendingOrder(sessionId, now);
        if (
          active &&
          active.checkoutRequestHash === requestHash &&
          active.ownerTokenHash === tokenHash
        ) {
          return { ok: true, value: { order: active, replayed: true } };
        }

        // 4. The traveller must have reviewed the session as it is now.
        if (found.value.version !== expectedVersion) {
          return fail(
            409,
            'SESSION_CONFLICT',
            'Your trip was changed in another window or tab. We’ve loaded the latest version.',
          );
        }

        // 5. The final validation: re-price, re-check seats and services. (This session's own
        //    pending hold never blocks it: see AllocationLedger.withExcludedSession.)
        const checked = retailing.checkoutCheck(sessionId, sessionToken, scenario);
        if (!checked.ok) return checked;
        const { session, review, quote, baggage } = checked.value;
        if (review.status !== 'READY') return notReady(review.issues);
        if (quote.totals.totalMinor !== acceptedTotalMinor) {
          return fail(
            409,
            'PRICE_CHANGED',
            `Your total changed from ${formatPesos(acceptedTotalMinor)} to ${formatPesos(quote.totals.totalMinor)}. Review the new total before you continue.`,
          );
        }
        const content = buildOrderContent({ session, quote, baggage });

        // 6. The same trip checked out again: keep the existing hold. A changed trip replaces it.
        if (active) {
          if (active.contentHash === content.contentHash && active.ownerTokenHash === tokenHash) {
            return { ok: true, value: { order: active, replayed: true } };
          }
          if (unresolvedAttempt(active)) {
            return fail(
              409,
              'PAYMENT_IN_PROGRESS',
              'A payment for your earlier checkout is still being processed. Check its status first.',
            );
          }
          await store.write(active, cancelOrder(active, 'superseded', now));
        }

        // 7. Seats, against every active hold — the check and the write below can't interleave
        //    with any other checkout, payment, or expiry.
        const problem = inventoryProblem(content.allocations);
        if (problem) return fail(409, 'INVENTORY_UNAVAILABLE', problem);

        const reference = await uniqueReference();
        const order: StoredOrder = {
          schemaVersion: ORDER_SCHEMA_VERSION,
          orderId: newId('ord'),
          reference,
          rev: 1,
          guestId,
          ownerTokenHash: tokenHash,
          sessionId,
          checkoutKey,
          checkoutRequestHash: requestHash,
          contentHash: content.contentHash,
          status: 'PENDING_PAYMENT',
          createdAt: now,
          updatedAt: now,
          confirmedAt: null,
          currency: content.currency,
          totalMinor: content.totalMinor,
          totals: content.totals,
          pricingVersion: content.pricingVersion,
          snapshot: content.snapshot,
          items: content.items,
          hold: {
            holdId: newId('hld'),
            status: 'HELD',
            createdAt: now,
            expiresAt: now + config.holdMs,
            committedAt: null,
            releasedAt: null,
            releaseReason: null,
            inventoryVersion: flights.current().referenceDate,
            allocations: content.allocations,
          },
          attempts: [],
          events: [
            { seq: 1, type: 'ORDER_CREATED', at: now, detail: reference },
            {
              seq: 2,
              type: 'INVENTORY_HELD',
              at: now,
              detail: `${content.allocations.length} flight(s)`,
            },
          ],
          paymentStatus: 'NOT_STARTED',
          holdState: 'HELD',
          holdExpiresAt: now + config.holdMs,
          flightIds: content.allocations.map((allocation) => allocation.flightId),
          attemptIds: [],
        };
        crashIf(crashAt, 'prepare:before-insert');
        const stored = await store.insert(order);
        crashIf(crashAt, 'prepare:after-insert');
        return { ok: true, value: { order: stored, replayed: false } };
      });
    },
  };
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;
