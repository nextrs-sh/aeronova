/** Milestone 7: told about every write and removal, so shopping sessions can be made durable. */
export interface StoreListener {
  set(id: string): void;
  deleted(id: string): void;
}

/**
 * A small in-memory map with a size cap and time-based cleanup, for offers and shopping
 * sessions. It is per process (one API instance owns the TalaDB file). Since Milestone 7 the
 * session store has a listener that writes every change through to TalaDB; offers stay in
 * memory only.
 *
 * - Entries are dropped `graceMs` after their own expiry (lazily, on writes).
 * - Above `maxEntries`, the least recently written entries are evicted first.
 */
export class BoundedStore<V> {
  private readonly entries = new Map<string, V>();
  private lastSweep = Number.NEGATIVE_INFINITY;
  listener?: StoreListener;

  constructor(
    private readonly options: {
      maxEntries: number;
      /** Keep expired entries this long, so callers can tell "expired" from "unknown". */
      graceMs: number;
      expiresAt: (value: V) => number;
      /** Minimum time between full sweeps. */
      sweepIntervalMs?: number;
    },
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get(id: string): V | undefined {
    return this.entries.get(id);
  }

  /** Insert or replace; a replaced entry becomes the most recent. */
  set(id: string, value: V, now: number): void {
    this.entries.delete(id);
    this.entries.set(id, value);
    this.listener?.set(id);
    if (
      now - this.lastSweep >= (this.options.sweepIntervalMs ?? 10_000) ||
      this.entries.size > this.options.maxEntries
    ) {
      this.sweep(now);
    }
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.entries.delete(oldest);
      this.listener?.deleted(oldest);
    }
  }

  /** Put back an entry read from durable storage (no listener call: it is already stored). */
  restore(id: string, value: V): void {
    this.entries.set(id, value);
  }

  delete(id: string): boolean {
    const removed = this.entries.delete(id);
    if (removed) this.listener?.deleted(id);
    return removed;
  }

  /** Drop every entry whose expiry plus grace has passed. */
  sweep(now: number): void {
    this.lastSweep = now;
    for (const [id, value] of this.entries) {
      if (this.options.expiresAt(value) + this.options.graceMs <= now) {
        this.entries.delete(id);
        this.listener?.deleted(id);
      }
    }
  }
}
