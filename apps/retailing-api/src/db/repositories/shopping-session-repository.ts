import type { Collection, Document, Filter } from 'taladb';
import { z } from 'zod';
import type { StoredSession } from '../../offers/retailing-service';

/*
 * Milestone 7: shopping sessions in TalaDB.
 *
 * The in-memory store in the retailing service stays the working copy: every session method is
 * synchronous, so a read-check-write can't interleave with another request. Each change is
 * written through to this collection before the request that made it is answered (see
 * `offers/session-persistence.ts`), and the store is reloaded from here at startup. TalaDB is
 * therefore what survives a restart, and memory is a cache of it — not a second source of truth.
 *
 * One document per session. The session itself is stored as a JSON string: it is only ever
 * read back whole, by this process, and it holds nested offers and traveller details that no
 * query needs to see. Only `sessionId` and `expiresAt` are indexed.
 *
 * Privacy: traveller names and contact details entered during booking live in `data` until the
 * session ends. Sessions are deleted after expiry plus a grace period, and when the memory cap
 * evicts them, so the collection stays bounded (see `maxSessions`).
 */

export const SHOPPING_SESSION_SCHEMA_VERSION = 1;

const storedDocumentSchema = z.object({
  schemaVersion: z.literal(SHOPPING_SESSION_SCHEMA_VERSION),
  sessionId: z.string().regex(/^ses_[A-Za-z0-9_-]{22}$/),
  /** Write sequence: the newest document for a session wins (see `writeBatch`). */
  seq: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  data: z.string().min(2),
});

/** What the JSON payload must at least contain to be restored. */
const payloadSchema = z
  .object({
    id: z.string(),
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    search: z.object({}).passthrough(),
    selections: z.object({ outbound: z.unknown(), inbound: z.unknown() }),
    booking: z.object({}).passthrough(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    expiresAt: z.number().int(),
    version: z.number().int().nonnegative(),
    orderedOrderId: z.string().nullable(),
  })
  .passthrough();

export function serializeSession(session: StoredSession, seq: number): Document {
  return {
    schemaVersion: SHOPPING_SESSION_SCHEMA_VERSION,
    sessionId: session.id,
    seq,
    version: session.version,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    data: JSON.stringify({ ...session, tokenHash: session.tokenHash.toString('hex') }),
  };
}

export function deserializeSession(doc: Document): StoredSession {
  const stored = storedDocumentSchema.parse(doc);
  const payload = payloadSchema.parse(JSON.parse(stored.data));
  if (payload.id !== stored.sessionId) throw new Error('Session document id mismatch.');
  return {
    ...(payload as unknown as StoredSession),
    tokenHash: Buffer.from(payload.tokenHash, 'hex'),
  };
}

/**
 * Writes are group commits: a batch of changed sessions is one `insertMany` (one TalaDB commit,
 * one fsync, whatever its size) followed by one `deleteMany` of the versions it replaces and of
 * removed sessions. If the process dies between the two, a session briefly has two documents;
 * the reader keeps the one with the highest `seq`. Measured on a 7200 rpm disk, a commit costs
 * 60–90 ms whether it holds 1 or 50 sessions (docs/MILESTONE-7-REPORT.md), so per-session
 * commits would not keep up with concurrent shoppers.
 */
export class ShoppingSessionRepository {
  private seq = 0;

  constructor(private readonly collection: Collection<Document>) {}

  /** Write the current state of `sessions` and remove `deleted`, in at most two commits. */
  async writeBatch(sessions: readonly StoredSession[], deleted: readonly string[]): Promise<void> {
    const seq = ++this.seq;
    if (sessions.length > 0) {
      await this.collection.insertMany(sessions.map((session) => serializeSession(session, seq)));
    }
    const replaced = sessions.map((session) => session.id);
    const filters: Filter<Document>[] = [];
    if (replaced.length > 0) filters.push({ sessionId: { $in: replaced }, seq: { $lt: seq } });
    if (deleted.length > 0) filters.push({ sessionId: { $in: [...deleted] } });
    if (filters.length === 1) await this.collection.deleteMany(filters[0]!);
    else if (filters.length > 1)
      await this.collection.deleteMany({ $or: filters } as Filter<Document>);
  }

  /**
   * Sessions still worth restoring (not past expiry plus grace), newest document per session.
   * Unreadable and superseded documents are removed so they don't accumulate.
   */
  async loadRestorable(cutoff: number): Promise<{ sessions: StoredSession[]; unreadable: number }> {
    const docs = await this.collection.find({ expiresAt: { $gt: cutoff } });
    const newest = new Map<string, { seq: number; session: StoredSession }>();
    const stale: Filter<Document>[] = [];
    let unreadable = 0;
    for (const doc of docs) {
      const id = (doc as { sessionId?: unknown }).sessionId;
      const seq = Number((doc as { seq?: unknown }).seq ?? 0);
      this.seq = Math.max(this.seq, Number.isFinite(seq) ? seq : 0);
      let session: StoredSession;
      try {
        session = deserializeSession(doc);
      } catch {
        unreadable += 1;
        if (typeof id === 'string') stale.push({ sessionId: id, seq });
        continue;
      }
      const current = newest.get(session.id);
      if (!current || seq > current.seq) {
        if (current) stale.push({ sessionId: session.id, seq: current.seq });
        newest.set(session.id, { seq, session });
      } else {
        stale.push({ sessionId: session.id, seq });
      }
    }
    if (stale.length > 0) await this.collection.deleteMany({ $or: stale } as Filter<Document>);
    return { sessions: [...newest.values()].map((entry) => entry.session), unreadable };
  }

  /** Remove sessions whose expiry plus grace ended before `cutoff`. */
  async purgeEnded(cutoff: number): Promise<number> {
    return this.collection.deleteMany({ expiresAt: { $lte: cutoff } });
  }

  async count(): Promise<number> {
    return this.collection.count({});
  }
}
