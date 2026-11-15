import type { Collection, Document } from 'taladb';
import {
  storedAccountSchema,
  storedSessionSchema,
  storedTravellerSchema,
  type StoredAccount,
  type StoredSession,
  type StoredTraveller,
} from '../schema';
import { ConcurrentModificationError } from './order-repository';

/*
 * Demo accounts, their sessions, and their saved travellers. Every write runs inside the serial
 * queue (see `accounts/account-service.ts`): TalaDB has no unique index, so "no two accounts
 * with one email" is enforced by checking and inserting without another writer in between.
 * Documents are validated on the way in and out, like orders.
 */

export class AccountRepository {
  constructor(private readonly collection: Collection<Document>) {}

  async insert(account: StoredAccount): Promise<void> {
    await this.collection.insert(storedAccountSchema.parse(account) as unknown as Document);
  }

  async byId(accountId: string): Promise<StoredAccount | null> {
    const doc = await this.collection.findOne({ accountId });
    return doc ? storedAccountSchema.parse(doc) : null;
  }

  async byEmail(email: string): Promise<StoredAccount | null> {
    const doc = await this.collection.findOne({ email });
    return doc ? storedAccountSchema.parse(doc) : null;
  }

  async replace(previous: StoredAccount, next: StoredAccount): Promise<StoredAccount> {
    const doc = storedAccountSchema.parse({ ...next, rev: previous.rev + 1 });
    const written = await this.collection.updateOne(
      { accountId: previous.accountId, rev: previous.rev },
      { $set: doc as unknown as Document },
    );
    if (!written) throw new ConcurrentModificationError('Account changed concurrently.');
    return doc;
  }

  async count(): Promise<number> {
    return this.collection.count({});
  }
}

export class SessionRepository {
  constructor(private readonly collection: Collection<Document>) {}

  async insert(session: StoredSession): Promise<void> {
    await this.collection.insert(storedSessionSchema.parse(session) as unknown as Document);
  }

  async byTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const doc = await this.collection.findOne({ tokenHash });
    return doc ? storedSessionSchema.parse(doc) : null;
  }

  async revoke(sessionId: string, at: number): Promise<boolean> {
    return this.collection.updateOne({ sessionId, revokedAt: null }, { $set: { revokedAt: at } });
  }

  /** Revoke every live session of an account (password change, "sign out everywhere"). */
  async revokeAll(accountId: string, at: number): Promise<number> {
    return this.collection.updateMany({ accountId, revokedAt: null }, { $set: { revokedAt: at } });
  }

  /** Delete sessions that ended before `before` (expired or revoked). */
  async purgeEnded(before: number): Promise<number> {
    const expired = await this.collection.deleteMany({ expiresAt: { $lt: before } });
    const revoked = await this.collection.deleteMany({ revokedAt: { $lt: before } });
    return expired + revoked;
  }

  async count(filter: Document = {}): Promise<number> {
    return this.collection.count(filter);
  }
}

export class TravellerRepository {
  constructor(private readonly collection: Collection<Document>) {}

  private parse(doc: Document | null) {
    return doc ? storedTravellerSchema.parse(doc) : null;
  }

  async insert(traveller: StoredTraveller): Promise<void> {
    await this.collection.insert(storedTravellerSchema.parse(traveller) as unknown as Document);
  }

  /** The traveller only if it belongs to this account. */
  async owned(accountId: string, travellerId: string): Promise<StoredTraveller | null> {
    return this.parse(await this.collection.findOne({ travellerId, accountId }));
  }

  async byCreateKey(createKey: string): Promise<StoredTraveller | null> {
    return this.parse(await this.collection.findOne({ createKey }));
  }

  async forAccount(accountId: string): Promise<StoredTraveller[]> {
    const docs = await this.collection.find({ accountId });
    return docs
      .map((doc) => storedTravellerSchema.parse(doc))
      .sort((a, b) => a.createdAt - b.createdAt || a.travellerId.localeCompare(b.travellerId));
  }

  async countForAccount(accountId: string): Promise<number> {
    return this.collection.count({ accountId });
  }

  async replace(previous: StoredTraveller, next: StoredTraveller): Promise<StoredTraveller> {
    const doc = storedTravellerSchema.parse({ ...next, rev: previous.rev + 1 });
    const written = await this.collection.updateOne(
      { travellerId: previous.travellerId, accountId: previous.accountId, rev: previous.rev },
      { $set: doc as unknown as Document },
    );
    if (!written) throw new ConcurrentModificationError('Traveller changed concurrently.');
    return doc;
  }

  async delete(accountId: string, travellerId: string): Promise<boolean> {
    return this.collection.deleteOne({ travellerId, accountId });
  }
}
