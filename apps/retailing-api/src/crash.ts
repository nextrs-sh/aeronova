/*
 * Test-only process termination at the checkout's critical boundaries, to prove recovery from
 * durable state. A request asks for a crash with the `x-velasia-crash` header; it is honoured
 * only when both `RETAILING_API_FAULTS=enabled` and `RETAILING_API_CRASH_TESTS=enabled`. The
 * process is then killed with SIGKILL at that point — no cleanup, no graceful close, exactly
 * like a power cut — and the test restarts it on the same TalaDB file.
 */

export const CRASH_HEADER = 'x-velasia-crash';

export const CRASH_POINTS = [
  /** Checkout validated; the order isn't written yet. */
  'prepare:before-insert',
  /** The pending order and its hold are written; the in-memory ledger and response aren't. */
  'prepare:after-insert',
  /** The payment attempt is written as PROCESSING; the provider hasn't been called. */
  'payment:after-attempt',
  /** The provider recorded the charge; the order doesn't know the result yet. */
  'payment:after-provider',
  /** The order is CONFIRMED and committed; the response hasn't been sent. */
  'payment:after-confirm',
  // Milestone 6: servicing.
  /** A change, seat, service, or cancellation quote is computed; nothing is written. */
  'servicing:after-quote',
  /**
   * The servicing operation is written: its intent, its claim on replacement inventory, and its
   * first payment attempt (PROCESSING) — one write. The provider hasn't been called.
   */
  'servicing:after-intent',
  /** The change is applied (COMPLETED) in the order; the response hasn't been sent. */
  'servicing:after-commit',
  /** The cancellation is written (seats released, refund PROCESSING); no refund sent yet. */
  'cancel:after-commit',
  /** The refund provider recorded the refund; the order doesn't know the result yet. */
  'refund:after-provider',
  /** The refund's answer is applied; the cancellation response hasn't been sent. */
  'cancel:before-response',
] as const;
export type CrashPoint = (typeof CRASH_POINTS)[number];

export function parseCrashPoint(header: string | string[] | undefined): CrashPoint | null {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  return CRASH_POINTS.find((point) => point === value) ?? null;
}

/** Kill the process here if this request asked for it. */
export function crashIf(requested: CrashPoint | null | undefined, point: CrashPoint): void {
  if (requested !== point) return;
  process.kill(process.pid, 'SIGKILL');
  // Don't let another line of JavaScript run while the signal is delivered.
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    /* spin */
  }
}
