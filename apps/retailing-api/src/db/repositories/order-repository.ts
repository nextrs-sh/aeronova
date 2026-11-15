import type { Collection, Document } from 'taladb';
import { storedOrderSchema, withIndexFields, type StoredOrder } from '../schema';

/**
 * A write lost a compare-and-set race: the order changed since it was read. Writes are
 * serialized (see `orders/serial-queue.ts`), so this means a bug, not normal contention.
 */
export class ConcurrentModificationError extends Error {
  override readonly name = 'ConcurrentModificationError';
}

/**
 * Orders in TalaDB. Every write is a whole-document compare-and-set: `updateOne` with the
 * revision that was read in its filter. TalaDB re-evaluates the filter inside its exclusive write
 * transaction, so a stale revision matches nothing and the write is refused.
 *
 * Documents are validated against the stored schema on the way in and on the way out.
 */
export class OrderRepository {
  constructor(private readonly collection: Collection<Document>) {}

  private parse(doc: Document | null): StoredOrder | null {
    // Parsing strips TalaDB's own `_id` and `_changed_at`.
    return doc ? storedOrderSchema.parse(doc) : null;
  }

  private parseAll(docs: Document[]): StoredOrder[] {
    return docs.map((doc) => storedOrderSchema.parse(doc));
  }

  async insert(order: StoredOrder): Promise<StoredOrder> {
    const doc = storedOrderSchema.parse(withIndexFields(order));
    await this.collection.insert(doc as unknown as Document);
    return doc;
  }

  /** Replace `previous` with `next` in one atomic write, if nobody changed it meanwhile. */
  async replace(previous: StoredOrder, next: StoredOrder): Promise<StoredOrder> {
    const doc = storedOrderSchema.parse(withIndexFields({ ...next, rev: previous.rev + 1 }));
    const written = await this.collection.updateOne(
      { orderId: previous.orderId, rev: previous.rev },
      { $set: doc as unknown as Document },
    );
    if (!written) {
      throw new ConcurrentModificationError(`Order ${previous.orderId} changed concurrently.`);
    }
    return doc;
  }

  async byId(orderId: string): Promise<StoredOrder | null> {
    return this.parse(await this.collection.findOne({ orderId }));
  }

  async byReference(reference: string): Promise<StoredOrder | null> {
    return this.parse(await this.collection.findOne({ reference }));
  }

  async referenceExists(reference: string): Promise<boolean> {
    return (await this.collection.count({ reference })) > 0;
  }

  async byCheckoutKey(checkoutKey: string): Promise<StoredOrder | null> {
    return this.parse(await this.collection.findOne({ checkoutKey }));
  }

  async byAttemptId(attemptId: string): Promise<StoredOrder | null> {
    return this.parse(await this.collection.findOne({ attemptIds: attemptId }));
  }

  /** The session's orders still waiting for payment (normally at most one). */
  async pendingForSession(sessionId: string): Promise<StoredOrder[]> {
    return this.parseAll(await this.collection.find({ sessionId, status: 'PENDING_PAYMENT' }));
  }

  /** Orders whose hold takes seats (or did, until its expiry is processed). */
  async withActiveHolds(): Promise<StoredOrder[]> {
    return this.parseAll(await this.collection.find({ holdState: { $in: ['HELD', 'COMMITTED'] } }));
  }

  async pendingPayment(): Promise<StoredOrder[]> {
    return this.parseAll(await this.collection.find({ status: 'PENDING_PAYMENT' }));
  }

  /** Held orders whose hold has ended by `now` (some may be pinned by an undecided payment). */
  async heldDueBy(now: number): Promise<StoredOrder[]> {
    return this.parseAll(
      await this.collection.find({ holdState: 'HELD', holdExpiresAt: { $lte: now } }),
    );
  }

  async count(filter: Document = {}): Promise<number> {
    return this.collection.count(filter);
  }

  /** Every order, for invariant checks in tests and diagnostics. */
  async all(): Promise<StoredOrder[]> {
    return this.parseAll(await this.collection.find({}));
  }
}
