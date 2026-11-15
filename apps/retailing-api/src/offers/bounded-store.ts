/**
 * A small in-memory map with a size cap and time-based cleanup, for offers and shopping
 * sessions. It is per process: M3 runs a single API instance, and durable or shared storage
 * is future work.
 *
 * - Entries are dropped `graceMs` after their own expiry (lazily, on writes).
 * - Above `maxEntries`, the least recently written entries are evicted first.
 */
export class BoundedStore<V> {
  private readonly entries = new Map<string, V>();
  private lastSweep = Number.NEGATIVE_INFINITY;

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
    if (
      now - this.lastSweep >= (this.options.sweepIntervalMs ?? 10_000) ||
      this.entries.size > this.options.maxEntries
    ) {
      this.sweep(now);
    }
    while (this.entries.size > this.options.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  /** Drop every entry whose expiry plus grace has passed. */
  sweep(now: number): void {
    this.lastSweep = now;
    for (const [id, value] of this.entries) {
      if (this.options.expiresAt(value) + this.options.graceMs <= now) this.entries.delete(id);
    }
  }
}
