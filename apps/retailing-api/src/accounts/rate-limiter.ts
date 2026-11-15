/**
 * A fixed-window counter per key, in memory and bounded: past `maxKeys` the oldest windows are
 * dropped (a bounded map can't be used to exhaust memory). One process owns the database, so
 * one in-memory limiter sees every attempt; several instances would need a shared store (M7).
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Whether `key` has used up its attempts in the current window. Doesn't count. */
  blocked(key: string, now: number): boolean {
    const window = this.windows.get(key);
    return window !== undefined && now < window.resetAt && window.count >= this.limit;
  }

  /** Count one attempt for `key`. */
  hit(key: string, now: number): void {
    const window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      this.windows.delete(key);
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      while (this.windows.size > this.maxKeys) {
        this.windows.delete(this.windows.keys().next().value!);
      }
      return;
    }
    window.count += 1;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  get size(): number {
    return this.windows.size;
  }
}
