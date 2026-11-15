import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDB, type Collection, type Document, type TalaDB } from 'taladb';
import {
  ACCOUNT_INDEXES,
  LATEST_MIGRATION,
  MIGRATIONS,
  MIN_COMPATIBLE_SCHEMA,
  ORDER_INDEXES,
  PROVIDER_INDEXES,
  REFUND_PROVIDER_INDEXES,
  SESSION_INDEXES,
  SHOPPING_SESSION_INDEXES,
  TRAVELLER_INDEXES,
} from './migrations';
import {
  ACCOUNTS_COLLECTION,
  META_COLLECTION,
  ORDERS_COLLECTION,
  PROVIDER_COLLECTION,
  REFUND_PROVIDER_COLLECTION,
  SESSIONS_COLLECTION,
  SHOPPING_SESSIONS_COLLECTION,
  TRAVELLERS_COLLECTION,
} from './schema';

/*
 * The retailing API's TalaDB database: opened once at startup, closed at shutdown, and never
 * touched by the storefront. One file, owned by one API process — TalaDB locks the file, so a
 * second process (or a second open in this one) fails instead of writing alongside.
 */

export interface Database {
  /** Absolute path of the database file. Never sent to clients. */
  readonly path: string;
  readonly orders: Collection<Document>;
  readonly provider: Collection<Document>;
  readonly refundProvider: Collection<Document>;
  readonly accounts: Collection<Document>;
  readonly sessions: Collection<Document>;
  readonly travellers: Collection<Document>;
  /** Milestone 7. */
  readonly shoppingSessions: Collection<Document>;
  /** The schema this file was last opened with (see `MIN_COMPATIBLE_SCHEMA`). */
  readonly schema: SchemaRecord;
  /** A cheap indexed read that proves the database answers. */
  health(): Promise<{ ok: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

export class DatabaseOpenError extends Error {
  override readonly name = 'DatabaseOpenError';
}

/** What `velasia_meta` records about the application schema of a database file. */
export interface SchemaRecord {
  /** Highest migration version of the build that last opened the file. */
  schemaVersion: number;
  /** Oldest application schema that may still run against the file. */
  minCompatibleSchema: number;
  /** When the record was last written. */
  updatedAt: number;
}

export interface OpenDatabaseOptions {
  /** Wrap each collection (Milestone 7 metrics). */
  wrap?: (collection: Collection<Document>, name: string) => Collection<Document>;
  /** Overrides for tests: pretend to be an older or newer build. */
  schema?: { latest: number; minCompatible: number; migrations?: typeof MIGRATIONS };
}

/**
 * Refuse a file written by a newer, incompatible build; otherwise record this build's schema.
 * Returns the record now in force.
 */
async function checkSchema(
  meta: Collection<Document>,
  latest: number,
  minCompatible: number,
): Promise<SchemaRecord> {
  const existing = (await meta.findOne({ key: 'schema' })) as
    (Document & Partial<SchemaRecord>) | null;
  const stored = existing
    ? {
        schemaVersion: Number(existing.schemaVersion ?? 0),
        minCompatibleSchema: Number(existing.minCompatibleSchema ?? 0),
        updatedAt: Number(existing.updatedAt ?? 0),
      }
    : null;
  if (stored && stored.schemaVersion > latest) {
    if (stored.minCompatibleSchema > latest) {
      throw new DatabaseOpenError(
        `This database was written by a newer build (schema ${stored.schemaVersion}, needs at least ${stored.minCompatibleSchema}); this build knows schema ${latest}. Upgrade the build or restore a backup taken before the upgrade.`,
      );
    }
    // A compatible rollback: leave the newer record as it is.
    return stored;
  }
  const record: SchemaRecord = {
    schemaVersion: latest,
    minCompatibleSchema: minCompatible,
    updatedAt: Date.now(),
  };
  if (!stored || stored.schemaVersion !== latest || stored.minCompatibleSchema !== minCompatible) {
    const written = existing
      ? await meta.updateOne({ key: 'schema' }, { $set: { ...record } })
      : false;
    if (!written) await meta.insert({ key: 'schema', ...record });
  }
  return stored && stored.schemaVersion === latest && stored.minCompatibleSchema === minCompatible
    ? stored
    : record;
}

async function verifyIndexes(collection: Collection<Document>, expected: readonly string[]) {
  const { btree } = await collection.listIndexes();
  const missing = expected.filter((field) => !btree.includes(field));
  if (missing.length > 0) {
    throw new DatabaseOpenError(`Migration check failed: missing indexes ${missing.join(', ')}.`);
  }
}

export async function openDatabase(
  path: string,
  options: OpenDatabaseOptions = {},
): Promise<Database> {
  const latest = options.schema?.latest ?? LATEST_MIGRATION;
  const minCompatible = options.schema?.minCompatible ?? MIN_COMPATIBLE_SCHEMA;
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  let db: TalaDB;
  try {
    // An inline config stops TalaDB looking for a taladb.config.* file in the working directory.
    db = await openDB(file, {
      config: {},
      durability: { flush_every_write: true },
      migrations: options.schema?.migrations ?? MIGRATIONS,
    });
  } catch (cause) {
    const locked = /already open|acquire lock/i.test(String((cause as Error)?.message));
    throw new DatabaseOpenError(
      locked
        ? `The database at ${file} is in use by another process. Only one retailing API process may own it.`
        : `Could not open the database at ${file}.`,
      { cause },
    );
  }
  const wrap = options.wrap ?? ((collection: Collection<Document>) => collection);
  const open = (name: string) => wrap(db.collection(name), name);
  const orders = open(ORDERS_COLLECTION);
  const provider = open(PROVIDER_COLLECTION);
  const refundProvider = open(REFUND_PROVIDER_COLLECTION);
  const accounts = open(ACCOUNTS_COLLECTION);
  const sessions = open(SESSIONS_COLLECTION);
  const travellers = open(TRAVELLERS_COLLECTION);
  const shoppingSessions = open(SHOPPING_SESSIONS_COLLECTION);
  let schema: SchemaRecord;
  try {
    schema = await checkSchema(db.collection(META_COLLECTION), latest, minCompatible);
    await verifyIndexes(orders, ORDER_INDEXES);
    await verifyIndexes(provider, PROVIDER_INDEXES);
    await verifyIndexes(refundProvider, REFUND_PROVIDER_INDEXES);
    await verifyIndexes(accounts, ACCOUNT_INDEXES);
    await verifyIndexes(sessions, SESSION_INDEXES);
    await verifyIndexes(travellers, TRAVELLER_INDEXES);
    if (latest >= 3) await verifyIndexes(shoppingSessions, SHOPPING_SESSION_INDEXES);
  } catch (error) {
    await db.close();
    throw error;
  }

  let closed = false;
  return {
    path: file,
    orders,
    provider,
    refundProvider,
    accounts,
    sessions,
    travellers,
    shoppingSessions,
    schema,
    async health() {
      const started = performance.now();
      if (closed) return { ok: false, latencyMs: 0 };
      try {
        await orders.findOne({ orderId: '__health__' });
        return { ok: true, latencyMs: Math.round(performance.now() - started) };
      } catch {
        return { ok: false, latencyMs: Math.round(performance.now() - started) };
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await db.close();
    },
  };
}
