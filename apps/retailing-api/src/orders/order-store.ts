import type { OrderRepository } from '../db/repositories/order-repository';
import type { StoredOrder } from '../db/schema';
import type { AllocationLedger } from '../inventory/ledger';
import { assertOrderInvariants, expireOrder, holdExpiredAt } from './lifecycle';
import type { SerialQueue } from './serial-queue';
import { claimExpiredAt, endOperation } from './servicing-lifecycle';

const CLAIM_ENDED = 'The seats held for this change were released because it wasn’t paid in time.';

/** Something about this order has ended by `now` and must be written: a hold or a change's claim. */
function dueAt(order: StoredOrder, now: number): boolean {
  return holdExpiredAt(order, now) || order.servicing.some((op) => claimExpiredAt(op, now));
}

/**
 * The only way orders are written. Each write checks the order's invariants, stores it with a
 * compare-and-set, and only then updates the in-memory inventory ledger. Callers run writes
 * inside the serial queue.
 */
export class OrderStore {
  constructor(
    readonly repository: OrderRepository,
    readonly ledger: AllocationLedger,
    readonly queue: SerialQueue,
    private readonly maxAttempts: number,
  ) {}

  async insert(order: StoredOrder): Promise<StoredOrder> {
    assertOrderInvariants(order, this.maxAttempts);
    const stored = await this.repository.insert(order);
    this.ledger.apply(stored);
    return stored;
  }

  async write(previous: StoredOrder, next: StoredOrder): Promise<StoredOrder> {
    if (next === previous) return previous;
    assertOrderInvariants(next, this.maxAttempts);
    const stored = await this.repository.replace(previous, next);
    this.ledger.apply(stored);
    return stored;
  }

  /**
   * Expire the order if its hold has ended and no payment is undecided, and end any servicing
   * claim that ended the same way (Milestone 6). Idempotent; one write at most.
   */
  async expireIfDue(order: StoredOrder, now: number): Promise<StoredOrder> {
    if (!dueAt(order, now)) return order;
    let next = holdExpiredAt(order, now) ? expireOrder(order, now) : order;
    for (const op of next.servicing) {
      if (claimExpiredAt(op, now))
        next = endOperation(next, op.operationId, 'EXPIRED', CLAIM_ENDED, now);
    }
    return this.write(order, next);
  }

  /**
   * Read an order and expire it first if it is due. Most reads need no write, so the queue is
   * used only when one is.
   */
  async readCurrent(orderId: string, now: number): Promise<StoredOrder | null> {
    const order = await this.repository.byId(orderId);
    if (!order || !dueAt(order, now)) return order;
    return this.queue.run(async () => {
      const latest = await this.repository.byId(orderId);
      return latest ? this.expireIfDue(latest, now) : null;
    });
  }
}
