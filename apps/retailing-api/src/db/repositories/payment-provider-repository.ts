import type { Collection, Document } from 'taladb';
import { providerChargeSchema, type ProviderCharge } from '../schema';

/** The simulated payment provider's charge ledger: one record per payment attempt. */
export class PaymentProviderRepository {
  constructor(private readonly collection: Collection<Document>) {}

  async insert(charge: ProviderCharge): Promise<void> {
    await this.collection.insert(providerChargeSchema.parse(charge) as unknown as Document);
  }

  async byAttempt(attemptId: string): Promise<ProviderCharge | null> {
    const doc = await this.collection.findOne({ attemptId });
    return doc ? providerChargeSchema.parse(doc) : null;
  }

  /** Decide a pending charge, once: only a record still `PENDING` is changed. */
  async resolvePending(attemptId: string, status: 'SUCCEEDED' | 'DECLINED'): Promise<boolean> {
    return this.collection.updateOne(
      { attemptId, status: 'PENDING' },
      { $set: { status, resolveAtWall: null } },
    );
  }

  async countForOrder(orderId: string): Promise<number> {
    return this.collection.count({ orderId });
  }

  async all(): Promise<ProviderCharge[]> {
    return (await this.collection.find({})).map((doc) => providerChargeSchema.parse(doc));
  }
}
