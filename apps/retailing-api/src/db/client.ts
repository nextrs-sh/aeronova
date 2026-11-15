import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDB, type Collection, type Document, type TalaDB } from 'taladb';
import { MIGRATIONS, ORDER_INDEXES, PROVIDER_INDEXES } from './migrations';
import { ORDERS_COLLECTION, PROVIDER_COLLECTION } from './schema';

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
  /** A cheap indexed read that proves the database answers. */
  health(): Promise<{ ok: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

export class DatabaseOpenError extends Error {
  override readonly name = 'DatabaseOpenError';
}

async function verifyIndexes(collection: Collection<Document>, expected: readonly string[]) {
  const { btree } = await collection.listIndexes();
  const missing = expected.filter((field) => !btree.includes(field));
  if (missing.length > 0) {
    throw new DatabaseOpenError(`Migration check failed: missing indexes ${missing.join(', ')}.`);
  }
}

export async function openDatabase(path: string): Promise<Database> {
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  let db: TalaDB;
  try {
    // An inline config stops TalaDB looking for a taladb.config.* file in the working directory.
    db = await openDB(file, {
      config: {},
      durability: { flush_every_write: true },
      migrations: MIGRATIONS,
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
  const orders = db.collection(ORDERS_COLLECTION);
  const provider = db.collection(PROVIDER_COLLECTION);
  try {
    await verifyIndexes(orders, ORDER_INDEXES);
    await verifyIndexes(provider, PROVIDER_INDEXES);
  } catch (error) {
    await db.close();
    throw error;
  }

  let closed = false;
  return {
    path: file,
    orders,
    provider,
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
