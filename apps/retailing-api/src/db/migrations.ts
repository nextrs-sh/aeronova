import type { Migration } from 'taladb';
import {
  ACCOUNTS_COLLECTION,
  ORDERS_COLLECTION,
  PROVIDER_COLLECTION,
  REFUND_PROVIDER_COLLECTION,
  SESSIONS_COLLECTION,
  SHOPPING_SESSIONS_COLLECTION,
  TRAVELLERS_COLLECTION,
} from './schema';

/*
 * Application schema migrations, run by `openDB({ migrations })` in ascending order. TalaDB
 * stores the applied version and advances it after each migration completes, so a migration
 * runs once per database file. A migration is not one atomic transaction (TalaDB has none), so
 * each must be safe to re-run from the start: `createIndex` on an existing index is a no-op.
 *
 * Never edit a released migration; add a new one.
 */

/** Indexes the order and provider queries rely on (Milestone 5). */
const M5_ORDER_INDEXES = [
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
/** Milestone 6: account ownership, servicing recovery, servicing payment lookups. */
const M6_ORDER_INDEXES = ['ownerAccountId', 'servicingState', 'servicingAttemptIds'] as const;

export const ORDER_INDEXES = [...M5_ORDER_INDEXES, ...M6_ORDER_INDEXES] as const;
export const PROVIDER_INDEXES = ['attemptId', 'orderId'] as const;
export const REFUND_PROVIDER_INDEXES = ['refundId', 'orderId'] as const;
export const ACCOUNT_INDEXES = ['accountId', 'email'] as const;
export const SESSION_INDEXES = ['tokenHash', 'accountId', 'expiresAt'] as const;
export const TRAVELLER_INDEXES = ['travellerId', 'accountId', 'createKey'] as const;
/** Milestone 7. */
export const SHOPPING_SESSION_INDEXES = ['sessionId', 'expiresAt'] as const;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Orders and simulated payment provider: indexes',
    async up(db) {
      const orders = db.collection(ORDERS_COLLECTION);
      for (const field of M5_ORDER_INDEXES) await orders.createIndex(field);
      const provider = db.collection(PROVIDER_COLLECTION);
      for (const field of PROVIDER_INDEXES) await provider.createIndex(field);
    },
  },
  {
    version: 2,
    description: 'Servicing, refunds, demo accounts, sessions, saved travellers: indexes',
    async up(db) {
      const orders = db.collection(ORDERS_COLLECTION);
      for (const field of M6_ORDER_INDEXES) await orders.createIndex(field);
      const collections: [string, readonly string[]][] = [
        [REFUND_PROVIDER_COLLECTION, REFUND_PROVIDER_INDEXES],
        [ACCOUNTS_COLLECTION, ACCOUNT_INDEXES],
        [SESSIONS_COLLECTION, SESSION_INDEXES],
        [TRAVELLERS_COLLECTION, TRAVELLER_INDEXES],
      ];
      for (const [name, fields] of collections) {
        const collection = db.collection(name);
        for (const field of fields) await collection.createIndex(field);
      }
    },
  },
  {
    version: 3,
    description: 'Durable shopping sessions: indexes',
    async up(db) {
      const sessions = db.collection(SHOPPING_SESSIONS_COLLECTION);
      for (const field of SHOPPING_SESSION_INDEXES) await sessions.createIndex(field);
    },
  },
];

export const LATEST_MIGRATION = MIGRATIONS.at(-1)!.version;

/**
 * The oldest application schema (migration version) that can still safely run against a
 * database this version has written. Recorded in `velasia_meta` so that a rolled-back build
 * refuses a database it no longer understands, instead of silently writing to it (TalaDB itself
 * ignores a stored version newer than the migrations it is given).
 *
 * Migration 3 only adds the `shopping_sessions` collection, which Milestone 6 (schema 2) never
 * reads, so a Milestone 6 build can still run on a Milestone 7 database. Raise this whenever a
 * migration changes a document shape older code reads or writes.
 */
export const MIN_COMPATIBLE_SCHEMA = 2;
