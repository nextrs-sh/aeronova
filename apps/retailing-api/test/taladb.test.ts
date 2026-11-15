import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase, DatabaseOpenError } from '../src/db/client';
import { LATEST_MIGRATION, ORDER_INDEXES, PROVIDER_INDEXES } from '../src/db/migrations';
import {
  ConcurrentModificationError,
  OrderRepository,
} from '../src/db/repositories/order-repository';
import { PaymentProviderRepository } from '../src/db/repositories/payment-provider-repository';
import { newBookingReference } from '../src/orders/ids';
import { sampleOrder } from './order-fixtures';

/*
 * TalaDB as the retailing API uses it: file-backed, migrated and indexed at open, written with
 * compare-and-set, durable across processes, owned by one process at a time.
 */

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'velasia-taladb-test-'));
  dirs.push(dir);
  return join(dir, 'nested', 'velasia.db');
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * TalaDB 0.13 releases the file lock only once every collection handle is garbage-collected
 * (see docs/MILESTONE-5-REPORT.md), so an in-process reopen needs a GC first.
 */
setFlagsFromString('--expose_gc');
const gc = runInNewContext('gc') as () => void;
async function collect() {
  for (let i = 0; i < 6; i += 1) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Run a short script in a fresh Node process against a database file. */
function inChild(script: string) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), status: result.status };
}

describe('TalaDB database lifecycle', { timeout: 60_000 }, () => {
  it('creates the parent directory, the collections, and every index', async () => {
    const file = tempFile();
    const db = await openDatabase(file);
    expect(existsSync(file)).toBe(true);
    expect((await db.orders.listIndexes()).btree.sort()).toEqual([...ORDER_INDEXES].sort());
    expect((await db.provider.listIndexes()).btree.sort()).toEqual([...PROVIDER_INDEXES].sort());
    expect(await db.health()).toMatchObject({ ok: true });
    await db.close();
    expect(await db.health()).toMatchObject({ ok: false });
    await db.close(); // closing twice is harmless
  });

  it('runs migrations once and keeps data when reopened', async () => {
    const file = tempFile();
    let db: Awaited<ReturnType<typeof openDatabase>> | null = await openDatabase(file);
    const order = sampleOrder();
    await new OrderRepository(db.orders).insert(order);
    await db.close();
    db = null;
    await collect();

    const again = await openDatabase(file);
    const repo = new OrderRepository(again.orders);
    expect((await repo.byId(order.orderId))?.reference).toBe(order.reference);
    expect(await repo.count()).toBe(1);
    expect((await again.orders.listIndexes()).btree.sort()).toEqual([...ORDER_INDEXES].sort());
    await again.close();
    expect(LATEST_MIGRATION).toBe(2);
  });

  it('refuses a second owner of the same file, in this process or another', async () => {
    const file = tempFile();
    const db = await openDatabase(file);
    await expect(openDatabase(file)).rejects.toThrow(DatabaseOpenError);
    await expect(openDatabase(file)).rejects.toThrow(/in use by another process/);
    const child = inChild(`
      import { openDatabase } from './src/db/client.ts';
      try { await openDatabase(${JSON.stringify(file)}); console.log('OPENED'); }
      catch (error) { console.log('REFUSED', error.name); }
    `);
    expect(child.stdout).toBe('REFUSED DatabaseOpenError');
    await db.close();
  });

  it('keeps every committed write when the process is killed without closing', () => {
    const file = tempFile();
    const writer = inChild(`
      import { openDatabase } from './src/db/client.ts';
      import { OrderRepository } from './src/db/repositories/order-repository.ts';
      import { sampleOrder } from './test/order-fixtures.ts';
      const db = await openDatabase(${JSON.stringify(file)});
      const repo = new OrderRepository(db.orders);
      for (let i = 0; i < 3; i++) await repo.insert(sampleOrder());
      process.kill(process.pid, 'SIGKILL');
    `);
    expect(writer.status).toBeNull(); // killed by the signal
    const reader = inChild(`
      import { openDatabase } from './src/db/client.ts';
      const db = await openDatabase(${JSON.stringify(file)});
      console.log(await db.orders.count({}));
      await db.close();
    `);
    expect(reader.stdout).toBe('3');
  });
});

describe('order repository', () => {
  it('validates documents, strips storage fields, and reads them back by every index', async () => {
    const db = await openDatabase(tempFile());
    const repo = new OrderRepository(db.orders);
    const order = sampleOrder();
    await repo.insert(order);
    const read = await repo.byId(order.orderId);
    expect(read).toEqual(order);
    expect(read).not.toHaveProperty('_id');
    expect(await repo.byReference(order.reference)).toEqual(order);
    expect(await repo.byCheckoutKey(order.checkoutKey)).toEqual(order);
    expect(await repo.pendingForSession(order.sessionId)).toHaveLength(1);
    expect(await repo.withActiveHolds()).toHaveLength(1);
    expect(await repo.heldDueBy(order.hold.expiresAt)).toHaveLength(1);
    expect(await repo.heldDueBy(order.hold.expiresAt - 1)).toHaveLength(0);
    expect(await repo.referenceExists(order.reference)).toBe(true);
    await expect(repo.insert({ ...order, totalMinor: -1 })).rejects.toThrow();
    await db.close();
  });

  it('writes with compare-and-set: a stale revision is refused', async () => {
    const db = await openDatabase(tempFile());
    const repo = new OrderRepository(db.orders);
    const order = await repo.insert(sampleOrder());
    const next = await repo.replace(order, { ...order, updatedAt: order.updatedAt + 1 });
    expect(next.rev).toBe(2);
    await expect(repo.replace(order, { ...order, updatedAt: 9 })).rejects.toThrow(
      ConcurrentModificationError,
    );
    // Concurrent writers from the same revision: exactly one wins.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => repo.replace(next, { ...next, updatedAt: 100 + i })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await repo.byId(order.orderId))?.rev).toBe(3);
    await db.close();
  });

  it('records one provider charge per attempt and decides a pending one once', async () => {
    const db = await openDatabase(tempFile());
    const provider = new PaymentProviderRepository(db.provider);
    const charge = {
      schemaVersion: 1 as const,
      attemptId: 'pay_AAAAAAAAAAAAAAAAAAAAAA',
      orderId: 'ord_AAAAAAAAAAAAAAAAAAAAAA',
      reference: 'DEMO-ABCDEF1234',
      amountMinor: 100,
      currency: 'PHP',
      method: 'DEMO_CARD' as const,
      status: 'PENDING' as const,
      declineReason: null,
      createdAtWall: 1,
      resolveAtWall: 2,
    };
    await provider.insert(charge);
    expect(await provider.resolvePending(charge.attemptId, 'SUCCEEDED')).toBe(true);
    expect(await provider.resolvePending(charge.attemptId, 'DECLINED')).toBe(false);
    expect((await provider.byAttempt(charge.attemptId))?.status).toBe('SUCCEEDED');
    await db.close();
  });
});

describe('booking references', () => {
  it('are readable, never use look-alike characters, and rarely collide', () => {
    const references = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) {
      const reference = newBookingReference();
      expect(reference).toMatch(/^VEL-[A-HJKMNP-Z2-9]{6}$/);
      references.add(reference);
    }
    // 887 million possibilities: 20,000 draws collide with probability ~0.02%.
    expect(references.size).toBeGreaterThanOrEqual(19_998);
  });
});
