import { UNRESOLVED_REFUND_STATUSES } from '@velasia/contracts';
import type { StoredOrder } from '../db/schema';

/**
 * What a booking's money looks like, from its durable records only: successful simulated
 * charges, refunds by status, and travel credits. Never from the request.
 */
export function moneyOf(order: StoredOrder) {
  const succeeded = (attempts: StoredOrder['attempts']) =>
    attempts
      .filter((attempt) => attempt.status === 'SUCCEEDED')
      .reduce((sum, a) => sum + a.amountMinor, 0);
  let paid = succeeded(order.attempts);
  let refunded = 0;
  let refundPending = 0;
  let refundFailed = 0;
  let refundOwed = 0;
  let credit = 0;
  for (const op of order.servicing) {
    paid += succeeded(op.attempts);
    if (op.status !== 'COMPLETED') continue;
    if (op.adjustment.kind === 'CREDIT') credit += op.adjustment.amountMinor;
    if (op.adjustment.kind !== 'REFUND') continue;
    refundOwed += op.adjustment.amountMinor;
    const done = op.refunds.some((refund) => refund.status === 'SUCCEEDED');
    const last = op.refunds.at(-1);
    if (done) refunded += op.adjustment.amountMinor;
    else if (last && UNRESOLVED_REFUND_STATUSES.includes(last.status))
      refundPending += op.adjustment.amountMinor;
    else if (last?.status === 'FAILED') refundFailed += op.adjustment.amountMinor;
  }
  return {
    paidMinor: paid,
    refundedMinor: refunded,
    refundPendingMinor: refundPending,
    refundFailedMinor: refundFailed,
    creditMinor: credit,
    /** Paid and not committed to any refund yet: the most a new refund can return. */
    refundableCeilingMinor: paid - refundOwed,
  };
}
