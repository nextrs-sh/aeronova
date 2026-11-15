import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createSessionResponseSchema } from '@velasia/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { ApiConfig } from '../src/config';
import { DatabaseOpenError, openDatabase } from '../src/db/client';
import { LATEST_MIGRATION, MIGRATIONS } from '../src/db/migrations';
import { OrderRepository } from '../src/db/repositories/order-repository';
import {
  deserializeSession,
  serializeSession,
} from '../src/db/repositories/shopping-session-repository';
import { DEFAULT_RETAILING_CONFIG } from '../src/offers/retailing-service';
import { FAST_PAYMENTS, MNL_SIN, manualClock, type ManualClock } from './checkout-harness';
import { TODAY } from './helpers';
import { sampleOrder } from './order-fixtures';

/*
 * Milestone 7: schema compatibility between builds (rollback safety) and the lifecycle of
 * durable shopping sessions (expiry across restarts, retention, bounds, failed writes).
 */

setFlagsFromString('--expose_gc');
const gc = runInNewContext('gc') as () => void;
async function collect() {
  for (let i = 0; i < 6; i += 1) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'velasia-m7-schema-'));
  dirs.push(dir);
  return join(dir, 'velasia.db');
};

describe('schema compatibility (rollback safety)', { timeout: 60_000 }, () => {
  it('lets a Milestone 6 build (schema 2) run on a Milestone 7 database and leaves the record alone', async () => {
    const file = tempFile();
    let db: Awaited<ReturnType<typeof openDatabase>> | null = await openDatabase(file);
    expect(db.schema).toMatchObject({ schemaVersion: LATEST_MIGRATION, minCompatibleSchema: 2 });
    const order = sampleOrder();
    await new OrderRepository(db.orders).insert(order);
    await db.close();
    db = null;
    await collect();

    // What the M6 build does at open: migrations 1–2 only. TalaDB skips them (already applied).
    db = await openDatabase(file, {
      schema: { latest: 2, minCompatible: 2, migrations: MIGRATIONS.slice(0, 2) },
    });
    expect((await new OrderRepository(db.orders).byId(order.orderId))?.reference).toBe(
      order.reference,
    );
    expect(db.schema.schemaVersion).toBe(3);
    await db.close();
    db = null;
    await collect();

    // Rolling forward again works and keeps the data.
    db = await openDatabase(file);
    expect(await new OrderRepository(db.orders).count()).toBe(1);
    await db.close();
    db = null;
    await collect();
  });

  it('refuses a database written by a newer, incompatible build', async () => {
    const file = tempFile();
    const future = {
      latest: 4,
      minCompatible: 4,
      migrations: [...MIGRATIONS, { version: 4, description: 'future', up: async () => {} }],
    };
    let db: Awaited<ReturnType<typeof openDatabase>> | null = await openDatabase(file, {
      schema: future,
    });
    await db.close();
    db = null;
    await collect();
    await expect(openDatabase(file)).rejects.toThrow(DatabaseOpenError);
    await collect();
    await expect(openDatabase(file)).rejects.toThrow(/newer build \(schema 4, needs at least 4\)/);
    await collect();
  });

  it('accepts a newer build that declares this schema compatible', async () => {
    const file = tempFile();
    let db: Awaited<ReturnType<typeof openDatabase>> | null = await openDatabase(file, {
      schema: {
        latest: 4,
        minCompatible: 3,
        migrations: [...MIGRATIONS, { version: 4, description: 'future', up: async () => {} }],
      },
    });
    await db.close();
    db = null;
    await collect();
    db = await openDatabase(file);
    expect(db.schema).toMatchObject({ schemaVersion: 4, minCompatibleSchema: 3 });
    await db.close();
    db = null;
    await collect();
  });
});

async function appOn(
  file: string,
  time: ManualClock,
  retailing: Partial<ApiConfig['retailing']> = {},
  // Most tests check acknowledged-then-durable behaviour; the batched default is tested below.
  sessions: ApiConfig['sessions'] = { durability: 'sync', flushMs: 1_000 },
): Promise<FastifyInstance> {
  const app = buildApp({
    config: {
      today: TODAY,
      persistence: { path: file },
      payments: FAST_PAYMENTS,
      retailing: { ...DEFAULT_RETAILING_CONFIG, ...retailing },
      sessions,
    },
    testHooks: { clock: time.clock },
  });
  await app.ready();
  return app;
}

async function closeApp(app: FastifyInstance) {
  await app.close();
  await collect();
}

async function createSession(app: FastifyInstance) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/shopping-sessions',
    payload: { search: MNL_SIN },
  });
  expect(response.statusCode, response.body).toBe(201);
  return createSessionResponseSchema.parse(response.json()).data;
}

const getSession = (app: FastifyInstance, id: string, token: string) =>
  app.inject({ url: `/v1/shopping-sessions/${id}`, headers: { authorization: `Bearer ${token}` } });

describe('durable shopping sessions: lifecycle', { timeout: 60_000 }, () => {
  it('keep their expiry across restarts, then are purged after the grace period', async () => {
    const file = tempFile();
    const time = manualClock();
    /*
     * Each "process" runs in its own function and returns plain data only: TalaDB 0.13 releases
     * its file lock once the closed app is garbage-collected, and an inject() response kept in
     * this frame would keep the app reachable.
     */
    async function lifetime<T>(work: (app: FastifyInstance) => Promise<T>): Promise<T> {
      const app = await appOn(file, time);
      try {
        return await work(app);
      } finally {
        await app.close();
      }
    }
    async function run<T>(work: (app: FastifyInstance) => Promise<T>): Promise<T> {
      const result = await lifetime(work);
      await collect(); // now that no frame holds the app
      return result;
    }
    const { id, token } = await run(async (app) => {
      const { session, token } = await createSession(app);
      return { id: session.id, token };
    });

    // 31 minutes idle: the restored session answers "expired", not "unknown".
    time.advance(31 * 60_000);
    const expired = await run(async (app) => {
      const response = await getSession(app, id, token);
      return { status: response.statusCode, code: response.json().error?.code as string };
    });
    expect(expired).toEqual({ status: 410, code: 'SESSION_EXPIRED' });

    // Past expiry plus the 30-minute grace: gone from memory and from TalaDB.
    time.advance(31 * 60_000);
    const gone = await run(async (app) => ({
      status: (await getSession(app, id, token)).statusCode,
      stored: await app.persistence.shoppingSessions.count(),
    }));
    expect(gone).toEqual({ status: 404, stored: 0 });
  });

  it('stay bounded: sessions evicted from memory are deleted from TalaDB too', async () => {
    const file = tempFile();
    const time = manualClock();
    const app = await appOn(file, time, { maxSessions: 3 });
    const created = [];
    for (let i = 0; i < 5; i += 1) created.push(await createSession(app));
    expect(app.persistence.sessionWriter.pending).toBe(0);
    expect(await app.persistence.shoppingSessions.count()).toBe(3);
    // The newest three survive; the oldest two are unknown.
    expect((await getSession(app, created[0]!.session.id, created[0]!.token)).statusCode).toBe(404);
    expect((await getSession(app, created[4]!.session.id, created[4]!.token)).statusCode).toBe(200);
    await closeApp(app);
  });

  it('answer 503 when a change cannot be made durable, and retry it on the next write', async () => {
    const file = tempFile();
    const time = manualClock();
    const app = await appOn(file, time);
    const repository = app.persistence.shoppingSessions;
    const writeBatch = repository.writeBatch.bind(repository);
    repository.writeBatch = async () => {
      throw new Error('disk full (simulated)');
    };
    const failed = await app.inject({
      method: 'POST',
      url: '/v1/shopping-sessions',
      payload: { search: MNL_SIN },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe('SERVICE_UNAVAILABLE');
    // Never a token or session for a write that wasn't saved.
    expect(failed.body).not.toMatch(/ses_|token/);
    expect(app.persistence.sessionWriter.pending).toBe(1);

    repository.writeBatch = writeBatch;
    await createSession(app);
    expect(app.persistence.sessionWriter.pending).toBe(0);
    // Both are stored: the failed one was retried with the next flush.
    expect(await repository.count()).toBe(2);
    const metrics = (await app.inject({ url: '/metrics' })).body;
    expect(metrics).toMatch(/velasia_shopping_session_flush_failures_total 1/);
    await closeApp(app);
  });

  it('batched (default): requests never wait; changes are group-committed within the interval', async () => {
    const file = tempFile();
    const time = manualClock();
    const app = await appOn(file, time, {}, { durability: 'batched', flushMs: 100 });
    const repository = app.persistence.shoppingSessions;
    let commits = 0;
    const writeBatch = repository.writeBatch.bind(repository);
    repository.writeBatch = async (saved, deleted) => {
      commits += 1;
      return writeBatch(saved, deleted);
    };
    const created = await Promise.all(Array.from({ length: 20 }, () => createSession(app)));
    // Answered before anything was written…
    expect(app.persistence.sessionWriter.pending).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // …then all 20 landed in a handful of group commits, not 20.
    expect(app.persistence.sessionWriter.pending).toBe(0);
    expect(await repository.count()).toBe(20);
    expect(commits).toBeLessThanOrEqual(3);
    expect((await getSession(app, created[7]!.session.id, created[7]!.token)).statusCode).toBe(200);
    await closeApp(app);
  });

  it('keep only the newest document per session, even after a crash between insert and delete', async () => {
    const file = tempFile();
    const time = manualClock();
    const app = await appOn(file, time);
    const { session } = await createSession(app);
    const repository = app.persistence.shoppingSessions;
    const raw = app.persistence.database.shoppingSessions;
    // A newer version inserted, the older one not yet deleted: what a crash mid-batch leaves.
    const older = deserializeSession((await raw.findOne({ sessionId: session.id }))!);
    await raw.insert(serializeSession({ ...older, version: 99 }, 10_000));
    expect(await repository.count()).toBe(2);
    const restored = await repository.loadRestorable(0);
    expect(restored.sessions.map((stored) => stored.version)).toEqual([99]);
    expect(await repository.count()).toBe(1);
    await closeApp(app);
  });
});
