import type { Document } from 'taladb';
import { AllocationLedger } from '../inventory/ledger';
import { assertOrderInvariants } from '../orders/lifecycle';
import type { Database } from './client';
import { deserializeSession } from './repositories/shopping-session-repository';
import {
  providerChargeSchema,
  providerRefundSchema,
  storedOrderSchema,
  type ProviderCharge,
  type ProviderRefund,
  type StoredOrder,
} from './schema';

/*
 * Milestone 7: a whole-database integrity check, for backup verification (`db-tool verify`),
 * after load and crash tests, and before a restored file is put into service. Read-only.
 *
 * It reports counts (never personal data) and lists every violation of:
 *
 * - every order document parses against the stored schema and obeys the order invariants
 *   (the same check made before every write);
 * - no seat is held by two orders on the same flight (ledger rebuilt from disk);
 * - no shopping session was booked twice (one confirmed order per session at most);
 * - every simulated provider charge and refund belongs to exactly one attempt/refund on its
 *   order (no lost or duplicated payment records), and no succeeded charge is recorded as
 *   failed on the order;
 * - shopping session documents parse.
 */

export interface IntegrityReport {
  ok: boolean;
  schemaVersion: number;
  counts: Record<string, number>;
  orders: {
    total: number;
    byStatus: Record<string, number>;
    pendingPayment: number;
    servicingAwaitingPayment: number;
    refundPending: number;
  };
  providers: { charges: Record<string, number>; refunds: Record<string, number> };
  activeHolds: number;
  heldSeats: number;
  violations: string[];
}

const UNDECIDED_ATTEMPT = new Set(['PROCESSING', 'PENDING', 'UNKNOWN']);

function tally(values: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export async function checkIntegrity(
  database: Database,
  options: { maxPaymentAttempts: number; now?: number } = { maxPaymentAttempts: 10 },
): Promise<IntegrityReport> {
  const violations: string[] = [];
  const parseAll = <T>(docs: Document[], parse: (doc: Document) => T, what: string): T[] =>
    docs.flatMap((doc, index) => {
      try {
        return [parse(doc)];
      } catch (error) {
        violations.push(
          `${what} #${index} does not parse: ${(error as Error).message.slice(0, 200)}`,
        );
        return [];
      }
    });

  const orders: StoredOrder[] = parseAll(
    await database.orders.find({}),
    (doc) => storedOrderSchema.parse(doc),
    'order',
  );
  const charges: ProviderCharge[] = parseAll(
    await database.provider.find({}),
    (doc) => providerChargeSchema.parse(doc),
    'provider charge',
  );
  const refunds: ProviderRefund[] = parseAll(
    await database.refundProvider.find({}),
    (doc) => providerRefundSchema.parse(doc),
    'provider refund',
  );
  const sessions = parseAll(
    await database.shoppingSessions.find({}),
    deserializeSession,
    'shopping session',
  );

  for (const order of orders) {
    try {
      assertOrderInvariants(order, Math.max(options.maxPaymentAttempts, order.attempts.length));
    } catch (error) {
      violations.push((error as Error).message);
    }
  }

  // No seat held twice: rebuild the ledger from the documents alone.
  const ledger = new AllocationLedger(() => options.now ?? Date.now());
  ledger.rebuild(orders);
  const holders = new Map<string, string>();
  let heldSeats = 0;
  for (const entry of ledger.snapshot()) {
    const [orderId, flightId, , count, seatIds] = entry.split('|');
    heldSeats += Number(count);
    for (const seat of seatIds ? seatIds.split(',') : []) {
      const key = `${flightId}|${seat}`;
      const holder = holders.get(key);
      if (holder && holder !== orderId) {
        violations.push(`Seat ${seat} on ${flightId} is held by ${holder} and ${orderId}.`);
      }
      holders.set(key, orderId!);
    }
  }

  // One confirmed (or later cancelled) booking per shopping session.
  const booked = tally(
    orders
      .filter((order) => order.status === 'CONFIRMED' || order.status === 'BOOKING_CANCELLED')
      .map((order) => order.sessionId),
  );
  for (const [sessionId, count] of Object.entries(booked)) {
    if (count > 1) violations.push(`Shopping session ${sessionId} has ${count} bookings.`);
  }

  // Provider records ↔ order records.
  const attempts = new Map<string, { orderId: string; status: string }>();
  const orderRefunds = new Map<string, { orderId: string; status: string }>();
  for (const order of orders) {
    const all = [...order.attempts, ...order.servicing.flatMap((op) => op.attempts)];
    for (const attempt of all) {
      if (attempts.has(attempt.attemptId)) {
        violations.push(`Payment attempt ${attempt.attemptId} is recorded twice.`);
      }
      attempts.set(attempt.attemptId, { orderId: order.orderId, status: attempt.status });
    }
    for (const refund of order.servicing.flatMap((op) => op.refunds)) {
      if (orderRefunds.has(refund.refundId)) {
        violations.push(`Refund ${refund.refundId} is recorded twice.`);
      }
      orderRefunds.set(refund.refundId, { orderId: order.orderId, status: refund.status });
    }
  }
  for (const charge of charges) {
    const attempt = attempts.get(charge.attemptId);
    if (!attempt || attempt.orderId !== charge.orderId) {
      violations.push(`Provider charge for ${charge.attemptId} has no matching order attempt.`);
    } else if (charge.status === 'SUCCEEDED' && attempt.status === 'FAILED') {
      violations.push(`Charge ${charge.attemptId} succeeded but its attempt is FAILED.`);
    } else if (charge.status === 'DECLINED' && attempt.status === 'SUCCEEDED') {
      violations.push(`Charge ${charge.attemptId} was declined but its attempt SUCCEEDED.`);
    }
  }
  for (const refund of refunds) {
    const recorded = orderRefunds.get(refund.refundId);
    if (!recorded || recorded.orderId !== refund.orderId) {
      violations.push(`Provider refund ${refund.refundId} has no matching order refund.`);
    } else if (refund.status === 'SUCCEEDED' && recorded.status === 'FAILED') {
      violations.push(`Refund ${refund.refundId} succeeded but is recorded as FAILED.`);
    }
  }

  const counts = {
    orders: orders.length,
    paymentProviderCharges: charges.length,
    refundProviderRefunds: refunds.length,
    accounts: await database.accounts.count({}),
    accountSessions: await database.sessions.count({}),
    savedTravellers: await database.travellers.count({}),
    shoppingSessions: sessions.length,
  };
  return {
    ok: violations.length === 0,
    schemaVersion: database.schema.schemaVersion,
    counts,
    orders: {
      total: orders.length,
      byStatus: tally(orders.map((order) => order.status)),
      pendingPayment: orders.filter((order) => order.status === 'PENDING_PAYMENT').length,
      servicingAwaitingPayment: orders.filter((order) =>
        order.servicing.some((op) => op.status === 'AWAITING_PAYMENT'),
      ).length,
      refundPending: orders.filter((order) =>
        order.servicing.some((op) => op.refunds.some((r) => UNDECIDED_ATTEMPT.has(r.status))),
      ).length,
    },
    providers: {
      charges: tally(charges.map((charge) => charge.status)),
      refunds: tally(refunds.map((refund) => refund.status)),
    },
    activeHolds: ledger.activeOrders,
    heldSeats,
    violations,
  };
}
