import type { ShoppingSessionRepository } from '../db/repositories/shopping-session-repository';
import type { StoreListener } from './bounded-store';
import type { StoredSession } from './retailing-service';

export class SessionPersistenceError extends Error {
  override readonly name = 'SessionPersistenceError';
}

/**
 * How shopping-session changes reach TalaDB (Milestone 7, `SHOPPING_SESSION_DURABILITY`):
 *
 * - `batched` (default): write-behind. Changed sessions are group-committed every `flushMs`
 *   (default 1 s) and at graceful shutdown. A SIGKILL or power loss can lose at most the last
 *   `flushMs` of shopping-session changes (never an order, payment, or refund: those are written
 *   synchronously, as before). Requests never wait for a session write.
 * - `sync`: every mutating request is answered only after a group commit that includes its
 *   change (a failure is answered 503). Strongest, but each mutating request pays a commit
 *   (on a 7200 rpm disk ≈ 60–170 ms).
 */
export type SessionDurability = 'batched' | 'sync';

/**
 * The store marks a session dirty when it changes; `flush()` writes every dirty session's
 * *current* state in one group commit. Flushes are chained, so awaiting `flush()` after a change
 * returns only once that change (or a newer one) is durable — including when another flush had
 * already picked it up. A failed batch keeps its sessions dirty for the next flush.
 */
export class SessionWriter implements StoreListener {
  private readonly dirty = new Map<string, 'set' | 'delete'>();
  private chain: Promise<void> = Promise.resolve();
  private running = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: ShoppingSessionRepository,
    private readonly read: (id: string) => StoredSession | undefined,
    private readonly options: {
      durability: SessionDurability;
      flushMs: number;
      observe?: (seconds: number, failed: boolean, error?: unknown) => void;
    },
  ) {
    if (options.durability === 'batched') {
      this.timer = setInterval(() => {
        if (this.dirty.size > 0) this.flush().catch(() => undefined);
      }, options.flushMs);
      this.timer.unref();
    }
  }

  get durability(): SessionDurability {
    return this.options.durability;
  }

  set(id: string): void {
    this.dirty.set(id, 'set');
  }

  deleted(id: string): void {
    this.dirty.set(id, 'delete');
  }

  /** Changes not yet written, plus flushes in progress. */
  get pending(): number {
    return this.dirty.size + this.running;
  }

  flush(): Promise<void> {
    const run = this.chain.then(() => this.writeBatch());
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Stop the background flush and write what is left (graceful shutdown). */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  private async writeBatch(): Promise<void> {
    if (this.dirty.size === 0) return;
    const batch = [...this.dirty];
    this.dirty.clear();
    const saved: StoredSession[] = [];
    const deleted: string[] = [];
    for (const [id, operation] of batch) {
      const session = operation === 'set' ? this.read(id) : undefined;
      if (session) saved.push(session);
      else deleted.push(id);
    }
    this.running += 1;
    const started = performance.now();
    try {
      await this.repository.writeBatch(saved, deleted);
      this.options.observe?.((performance.now() - started) / 1000, false);
    } catch (error) {
      // Retry next time, unless a newer change to the session is already queued.
      for (const [id, operation] of batch) if (!this.dirty.has(id)) this.dirty.set(id, operation);
      this.options.observe?.((performance.now() - started) / 1000, true, error);
      throw new SessionPersistenceError('Shopping sessions could not be saved.', { cause: error });
    } finally {
      this.running -= 1;
    }
  }
}
