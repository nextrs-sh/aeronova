import type { PaymentMethod, SimulatedOutcome } from '@velasia/contracts';
import { crashIf, type CrashPoint } from '../crash';
import type { PaymentProviderRepository } from '../db/repositories/payment-provider-repository';
import { PROVIDER_SCHEMA_VERSION, type ProviderCharge } from '../db/schema';
import { newProviderReference } from './ids';

/*
 * A fictional payment provider. It moves no money and talks to nothing: it is a stand-in for an
 * external system, so the order service treats it like one. The provider keeps its own durable
 * record of every charge (`payment_provider`), and the order learns an outcome only from the
 * provider's answer or by looking the charge up later.
 *
 * - One charge per payment attempt: charging an attempt it already knows returns that charge.
 * - `SUCCESS` / `DECLINED`: decided at once.
 * - `PENDING`: accepted, then decided (approved) `pendingResolveMs` later on the provider's own
 *   wall clock, the next time anyone looks it up.
 * - `TIMEOUT`: the charge succeeds, but the answer never arrives in time — the dangerous case a
 *   blind retry would charge twice. The service must look it up instead.
 *
 * Without outcome controls every charge is approved.
 */

export const DECLINE_REASON = 'The demo payment was declined (simulated). Nothing was charged.';

export type ChargeAnswer =
  | { kind: 'answered'; charge: ProviderCharge }
  /** No answer within the time limit. The charge may or may not exist. */
  | { kind: 'timeout' };

export interface ChargeRequest {
  attemptId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  outcome: SimulatedOutcome;
}

export interface PaymentSimulatorOptions {
  /** Simulated network latency for an answer. */
  responseDelayMs: number;
  /** How long the order service waits for the provider. */
  timeoutMs: number;
  /** When a PENDING charge is decided. */
  pendingResolveMs: number;
  wallClock?: () => number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });

export class PaymentSimulator {
  private readonly inFlight = new Set<string>();
  private readonly wall: () => number;

  constructor(
    private readonly repository: PaymentProviderRepository,
    private readonly options: PaymentSimulatorOptions,
  ) {
    this.wall = options.wallClock ?? Date.now;
  }

  /**
   * Whether this process may still be talking to the provider about an attempt. Until that work
   * settles, "no record yet" must not be read as "never charged".
   */
  isInFlight(attemptId: string): boolean {
    return this.inFlight.has(attemptId);
  }

  /** Charge an attempt, waiting at most `timeoutMs` for the answer. */
  async charge(request: ChargeRequest, crashAt?: CrashPoint | null): Promise<ChargeAnswer> {
    this.inFlight.add(request.attemptId);
    const answer = this.process(request, crashAt).finally(() => {
      this.inFlight.delete(request.attemptId);
    });
    // A late answer is dropped; the charge it describes is already on record.
    answer.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ChargeAnswer>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), this.options.timeoutMs);
    });
    return Promise.race([answer, timeout]).finally(() => clearTimeout(timer));
  }

  private async process(
    request: ChargeRequest,
    crashAt?: CrashPoint | null,
  ): Promise<ChargeAnswer> {
    const existing = await this.repository.byAttempt(request.attemptId);
    if (existing) return { kind: 'answered', charge: existing };
    const now = this.wall();
    const charge: ProviderCharge = {
      schemaVersion: PROVIDER_SCHEMA_VERSION,
      attemptId: request.attemptId,
      orderId: request.orderId,
      reference: newProviderReference(),
      amountMinor: request.amountMinor,
      currency: request.currency,
      method: request.method,
      status:
        request.outcome === 'DECLINED'
          ? 'DECLINED'
          : request.outcome === 'PENDING'
            ? 'PENDING'
            : 'SUCCEEDED',
      declineReason: request.outcome === 'DECLINED' ? DECLINE_REASON : null,
      createdAtWall: now,
      resolveAtWall: request.outcome === 'PENDING' ? now + this.options.pendingResolveMs : null,
    };
    await this.repository.insert(charge);
    crashIf(crashAt, 'payment:after-provider');
    if (request.outcome === 'TIMEOUT') {
      // Processed, but the answer is lost: never arrives within the time limit.
      await sleep(this.options.timeoutMs * 2);
      return { kind: 'timeout' };
    }
    await sleep(this.options.responseDelayMs);
    return { kind: 'answered', charge };
  }

  /** The provider's record of an attempt, deciding a due PENDING charge first. */
  async lookup(attemptId: string): Promise<ProviderCharge | null> {
    const charge = await this.repository.byAttempt(attemptId);
    if (!charge) return null;
    if (charge.status === 'PENDING' && charge.resolveAtWall !== null) {
      if (this.wall() >= charge.resolveAtWall) {
        await this.repository.resolvePending(attemptId, 'SUCCEEDED');
        return { ...charge, status: 'SUCCEEDED', resolveAtWall: null };
      }
    }
    return charge;
  }
}
