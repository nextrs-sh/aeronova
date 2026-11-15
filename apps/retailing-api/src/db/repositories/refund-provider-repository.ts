import type { Collection, Document } from 'taladb';
import { providerRefundSchema, type ProviderRefund } from '../schema';

/** The simulated refund provider's ledger: one record per refund id. */
export class RefundProviderRepository {
  constructor(private readonly collection: Collection<Document>) {}

  async insert(refund: ProviderRefund): Promise<void> {
    await this.collection.insert(providerRefundSchema.parse(refund) as unknown as Document);
  }

  async byRefund(refundId: string): Promise<ProviderRefund | null> {
    const doc = await this.collection.findOne({ refundId });
    return doc ? providerRefundSchema.parse(doc) : null;
  }

  /** Decide a pending refund, once: only a record still `PENDING` is changed. */
  async resolvePending(refundId: string, status: 'SUCCEEDED' | 'FAILED'): Promise<boolean> {
    return this.collection.updateOne(
      { refundId, status: 'PENDING' },
      { $set: { status, resolveAtWall: null } },
    );
  }

  async all(): Promise<ProviderRefund[]> {
    return (await this.collection.find({})).map((doc) => providerRefundSchema.parse(doc));
  }
}
