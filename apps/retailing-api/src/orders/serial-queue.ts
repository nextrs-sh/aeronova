/**
 * Runs tasks one at a time, in arrival order: the single writer for orders and inventory.
 *
 * TalaDB has no multi-document transaction, and its Node client performs writes on the libuv
 * thread pool, so two requests that each read availability and then write could interleave
 * between their `await`s. Every operation that reads inventory or an order and then writes runs
 * through this queue, so those read-then-write sequences never overlap. (TalaDB also refuses a
 * second process on the same file, so this one process is the only writer.)
 *
 * The queue is bounded: past `maxPending` waiting tasks, new work is refused rather than queued
 * without limit. A caller stops waiting after `taskTimeoutMs`, but the queue itself still waits
 * for that task to settle before starting the next one: giving up must never let two writers
 * overlap. Tasks only do bounded database work (the payment provider is called outside it).
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;

  constructor(
    private readonly options: { maxPending: number; taskTimeoutMs: number } = {
      maxPending: 500,
      taskTimeoutMs: 15_000,
    },
  ) {}

  get size(): number {
    return this.pending;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new QueueClosedError());
    if (this.pending >= this.options.maxPending) return Promise.reject(new QueueFullError());
    this.pending += 1;
    const work = this.tail.then(task);
    // The next task waits for this one to settle, whatever its outcome.
    this.tail = work
      .catch(() => undefined)
      .finally(() => {
        this.pending -= 1;
      });
    return this.withTimeout(work);
  }

  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new QueueTimeoutError()), this.options.taskTimeoutMs);
      timer.unref();
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  /** Refuse new work and wait for what is queued (graceful shutdown). */
  async drain(): Promise<void> {
    this.closed = true;
    await this.tail.catch(() => undefined);
  }
}

export class QueueFullError extends Error {
  override readonly name = 'QueueFullError';
  constructor() {
    super('Too many checkout operations are waiting. Please try again.');
  }
}

export class QueueTimeoutError extends Error {
  override readonly name = 'QueueTimeoutError';
  constructor() {
    super('A checkout operation took too long.');
  }
}

export class QueueClosedError extends Error {
  override readonly name = 'QueueClosedError';
  constructor() {
    super('The service is shutting down.');
  }
}
