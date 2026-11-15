import { randomBytes } from 'node:crypto';
import type { SimulatedOutcome } from '@velasia/contracts';
import { crashIf, type CrashPoint } from '../crash';
import type { RefundProviderRepository } from '../db/repositories/refund-provider-repository';
import { PROVIDER_SCHEMA_VERSION, type ProviderRefund } from '../db/schema';

/*
 * A fictional refund provider (Milestone 6). Like the payment simulator, it moves no money and
 * stands in for an external system: it keeps its own durable record of every refund
 * (`refund_provider`), and an order learns a refund's outcome only from its answer or by looking
 * it up later.
 *
 * - One refund per refund id: sending an id it already knows returns that refund (idempotent).
 * - `SUCCESS`: refunded at once. `DECLINED`: the refund fails (shown as such, never hidden).
 * - `PENDING`: accepted, then refunded `pendingResolveMs` later on the provider's wall clock.
 * - `TIMEOUT`: the refund succeeds, but the answer never arrives in time. The order must look
 *   it up; sending it again would be safe (same id), but recovery looks first.
 *
 * Without outcome controls every refund succeeds.
 */

export const REFUND_FAILURE_REASON =
  'The simulated refund provider couldn’t process this refund. Nothing was returned yet.';

export type RefundAnswer = { kind: 'answered'; refund: ProviderRefund } | { kind: 'timeout' };

export interface RefundRequest {
  refundId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  outcome: SimulatedOutcome;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });

const newRefundReference = () =>
  `DEMO-R${randomBytes(8).toString('hex').slice(0, 9).toUpperCase()}`;

export class RefundSimulator {
  private readonly inFlight = new Set<string>();
  private readonly wall: () => number;

  constructor(
    private readonly repository: RefundProviderRepository,
    private readonly options: {
      responseDelayMs: number;
      timeoutMs: number;
      pendingResolveMs: number;
      wallClock?: () => number;
    },
  ) {
    this.wall = options.wallClock ?? Date.now;
  }

  isInFlight(refundId: string): boolean {
    return this.inFlight.has(refundId);
  }

  async refund(request: RefundRequest, crashAt?: CrashPoint | null): Promise<RefundAnswer> {
    this.inFlight.add(request.refundId);
    const answer = this.process(request, crashAt).finally(() => {
      this.inFlight.delete(request.refundId);
    });
    answer.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<RefundAnswer>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), this.options.timeoutMs);
    });
    return Promise.race([answer, timeout]).finally(() => clearTimeout(timer));
  }

  private async process(
    request: RefundRequest,
    crashAt?: CrashPoint | null,
  ): Promise<RefundAnswer> {
    const existing = await this.repository.byRefund(request.refundId);
    if (existing) return { kind: 'answered', refund: existing };
    const now = this.wall();
    const refund: ProviderRefund = {
      schemaVersion: PROVIDER_SCHEMA_VERSION,
      refundId: request.refundId,
      orderId: request.orderId,
      reference: newRefundReference(),
      amountMinor: request.amountMinor,
      currency: request.currency,
      status:
        request.outcome === 'DECLINED'
          ? 'FAILED'
          : request.outcome === 'PENDING'
            ? 'PENDING'
            : 'SUCCEEDED',
      failureReason: request.outcome === 'DECLINED' ? REFUND_FAILURE_REASON : null,
      createdAtWall: now,
      resolveAtWall: request.outcome === 'PENDING' ? now + this.options.pendingResolveMs : null,
    };
    await this.repository.insert(refund);
    crashIf(crashAt, 'refund:after-provider');
    if (request.outcome === 'TIMEOUT') {
      await sleep(this.options.timeoutMs * 2);
      return { kind: 'timeout' };
    }
    await sleep(this.options.responseDelayMs);
    return { kind: 'answered', refund };
  }

  /** The provider's record of a refund, deciding a due PENDING refund first. */
  async lookup(refundId: string): Promise<ProviderRefund | null> {
    const refund = await this.repository.byRefund(refundId);
    if (!refund) return null;
    if (refund.status === 'PENDING' && refund.resolveAtWall !== null) {
      if (this.wall() >= refund.resolveAtWall) {
        await this.repository.resolvePending(refundId, 'SUCCEEDED');
        return { ...refund, status: 'SUCCEEDED', resolveAtWall: null };
      }
    }
    return refund;
  }
}
