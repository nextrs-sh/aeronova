import type { Collection, Document } from 'taladb';
import { z } from 'zod';
import {
  storedListingSchema,
  storedOrderSchema,
  withIndexFields,
  type StoredOrder,
} from '../schema';

/** What trip lists read: a projection of the order, never the whole document. */
export const orderListingSchema = z.object({
  orderId: z.string(),
  reference: z.string(),
  status: z.string(),
  ownerTokenHash: z.string().nullable(),
  servicingState: z.enum(['NONE', 'AWAITING_PAYMENT', 'REFUND_PENDING']),
  flightIds: z.array(z.string()),
  listing: storedListingSchema,
});
export type OrderListing = z.infer<typeof orderListingSchema>;

const LISTING_PROJECTION = {
  orderId: 1,
  reference: 1,
  status: 1,
  ownerTokenHash: 1,
  servicingState: 1,
  flightIds: 1,
  listing: 1,
} as const;

export type TripListSection = 'upcoming' | 'past' | 'cancelled' | 'attention';

/** Booking statuses (confirmed at some point), as opposed to checkouts that never paid. */
const BOOKED = ['CONFIRMED', 'BOOKING_CANCELLED'];

function sectionFilter(section: TripListSection, now: number): Document {
  switch (section) {
    case 'upcoming':
      return { status: 'CONFIRMED', tripEndsAt: { $gte: now } };
    case 'past':
      return { status: 'CONFIRMED', tripEndsAt: { $lt: now } };
    case 'cancelled':
      return { status: 'BOOKING_CANCELLED' };
    case 'attention':
      return { status: { $in: BOOKED }, servicingState: { $ne: 'NONE' } };
  }
}

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

  async byServicingAttemptId(attemptId: string): Promise<StoredOrder | null> {
    return this.parse(await this.collection.findOne({ servicingAttemptIds: attemptId }));
  }

  /** Orders with a servicing payment or a refund still to finish (recovery). */
  async withPendingServicing(): Promise<StoredOrder[]> {
    return this.parseAll(
      await this.collection.find({ servicingState: { $in: ['AWAITING_PAYMENT', 'REFUND_PENDING'] } }),
    );
  }

  /**
   * One page of an account's bookings in a section, newest-relevant first, as projections.
   * Sorting, paging, and projection run inside TalaDB (`aggregate`), so a long history is never
   * loaded whole.
   */
  async listForAccount(
    accountId: string,
    section: TripListSection,
    now: number,
    page: number,
    pageSize: number,
  ): Promise<{ items: OrderListing[]; total: number }> {
    const match = { ownerAccountId: accountId, ...sectionFilter(section, now) };
    const sort: Record<string, 1 | -1> =
      section === 'upcoming' ? { tripStartsAt: 1 } : section === 'past' ? { tripEndsAt: -1 } : { updatedAt: -1 };
    const [docs, total] = await Promise.all([
      this.collection.aggregate([
        { $match: match },
        { $sort: sort },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
        { $project: LISTING_PROJECTION },
      ]),
      this.collection.count(match),
    ]);
    return { items: docs.map((doc) => orderListingSchema.parse(doc)), total };
  }

  async countForAccount(accountId: string, section: TripListSection, now: number) {
    return this.collection.count({ ownerAccountId: accountId, ...sectionFilter(section, now) });
  }

  /** Bookings of one guest not linked to any account yet (at most `limit`), as projections. */
  async linkableForGuest(guestId: string, limit: number): Promise<OrderListing[]> {
    const docs = await this.collection.aggregate([
      { $match: { guestId, ownerAccountId: null, status: { $in: BOOKED } } },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      { $project: LISTING_PROJECTION },
    ]);
    return docs.map((doc) => orderListingSchema.parse(doc));
  }

  async count(filter: Document = {}): Promise<number> {
    return this.collection.count(filter);
  }

  /** Every order, for invariant checks in tests and diagnostics. */
  async all(): Promise<StoredOrder[]> {
    return this.parseAll(await this.collection.find({}));
  }
}
