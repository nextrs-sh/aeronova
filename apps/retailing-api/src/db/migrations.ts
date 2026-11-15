import type { Migration } from 'taladb';
import { ORDERS_COLLECTION, PROVIDER_COLLECTION } from './schema';

/*
 * Application schema migrations, run by `openDB({ migrations })` in ascending order. TalaDB
 * stores the applied version and advances it after each migration completes, so a migration
 * runs once per database file. A migration is not one atomic transaction (TalaDB has none), so
 * each must be safe to re-run from the start: `createIndex` on an existing index is a no-op.
 *
 * Never edit a released migration; add a new one.
 */

/** Indexes the order and provider queries rely on. */
export const ORDER_INDEXES = [
  'orderId',
  'reference',
  'guestId',
  'sessionId',
  'checkoutKey',
  'status',
  'createdAt',
  'holdState',
  'holdExpiresAt',
  'flightIds',
  'attemptIds',
] as const;
export const PROVIDER_INDEXES = ['attemptId', 'orderId'] as const;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Orders and simulated payment provider: indexes',
    async up(db) {
      const orders = db.collection(ORDERS_COLLECTION);
      for (const field of ORDER_INDEXES) await orders.createIndex(field);
      const provider = db.collection(PROVIDER_COLLECTION);
      for (const field of PROVIDER_INDEXES) await provider.createIndex(field);
    },
  },
];

export const LATEST_MIGRATION = MIGRATIONS.at(-1)!.version;
