import { resolve } from 'node:path';
import { ACCOUNT_RULES, isIsoDate } from '@velasia/contracts';
import { z } from 'zod';
import { DEFAULT_RETAILING_CONFIG, type RetailingConfig } from './offers/retailing-service';

const latencySchema = z
  .string()
  .regex(/^\d{1,5}(-\d{1,5})?$/, 'Use milliseconds, e.g. 400 or 200-900.')
  .transform((value) => {
    const [min, max = min] = value.split('-').map(Number) as [number, number?];
    return { minMs: Math.min(min, max), maxMs: Math.max(min, max) };
  });

const envSchema = z.object({
  /** Pin "today" (airline time zone) for deterministic demos and tests. */
  VELASIA_TODAY: z.string().refine(isIsoDate, 'Use YYYY-MM-DD.').optional(),
  /**
   * Seed for simulated demand. The default intentionally keeps its pre-rebrand value: changing it
   * would reshuffle every deterministic seat count and price, which the rebrand must not do.
   */
  INVENTORY_SEED: z.string().min(1).max(64).default('aeronova'),
  INVENTORY_HORIZON_DAYS: z.coerce.number().int().min(14).max(355).default(120),
  /** Development/test only: honour `x-velasia-fault` request headers. */
  RETAILING_API_FAULTS: z.enum(['enabled', 'disabled']).default('disabled'),
  /** Artificial latency on `/v1/flights*`, e.g. `400` or `200-900` (ms). Off when unset. */
  RETAILING_API_LATENCY_MS: latencySchema.optional(),
  /** How long a simulated `timeout` fault holds the response. */
  RETAILING_API_FAULT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(15_000),
  /** How long an offer can be selected, in minutes. */
  OFFER_VALIDITY_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  /** TalaDB file owned by this API process. Relative paths resolve from the working directory. */
  TALADB_PATH: z.string().min(1).default('./data/velasia.db'),
  /** How long checkout holds seats while waiting for payment. */
  CHECKOUT_HOLD_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  CHECKOUT_MAX_PAYMENT_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  /** How often held orders are checked for expiry (expiry is also checked on every access). */
  ORDER_SWEEP_INTERVAL_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  /**
   * Let the tester choose the simulated payment outcome. Defaults to enabled except when
   * `NODE_ENV=production`; set `disabled` to approve every demo payment.
   */
  PAYMENT_OUTCOME_CONTROLS: z.enum(['enabled', 'disabled']).optional(),
  /** When the simulated provider decides a PENDING payment. */
  PAYMENT_PENDING_RESOLVE_MS: z.coerce.number().int().min(0).max(600_000).default(5_000),
  /** Simulated provider latency. */
  PAYMENT_PROVIDER_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(350),
  /** How long the API waits for the simulated provider before treating the result as unknown. */
  PAYMENT_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(20).max(30_000).default(2_500),
  /**
   * Milestone 6: demo account registration. Defaults to enabled except when
   * `NODE_ENV=production`, where demo sign-up stays closed unless explicitly enabled (there is no
   * email verification or recovery; see MILESTONE-6-REPORT.md).
   */
  ACCOUNT_REGISTRATION: z.enum(['enabled', 'disabled']).optional(),
  /** How long a change waiting for payment keeps its replacement flights or seats. */
  SERVICING_CLAIM_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  /** Test-only: honour `x-velasia-crash` (needs RETAILING_API_FAULTS=enabled too). */
  RETAILING_API_CRASH_TESTS: z.enum(['enabled', 'disabled']).default('disabled'),
  NODE_ENV: z.string().optional(),
});

export interface ApiConfig {
  today?: string;
  inventory: { seed: string; horizonDays: number };
  faults: {
    enabled: boolean;
    latency?: { minMs: number; maxMs: number };
    timeoutMs: number;
    /** Honour crash-point headers (also needs `enabled`). */
    crashTests?: boolean;
  };
  retailing: RetailingConfig;
  /** `path` unset: a temporary database, deleted on close (tests). */
  persistence: { path?: string };
  checkout: { holdMs: number; maxPaymentAttempts: number; sweepIntervalMs: number };
  payments: {
    outcomeControls: boolean;
    pendingResolveMs: number;
    responseDelayMs: number;
    timeoutMs: number;
  };
  /** Milestone 6. */
  servicing: { claimMs: number };
  accounts: { registration: boolean; sessionMs: number };
}

export const DEFAULT_SERVICING_CONFIG: ApiConfig['servicing'] = { claimMs: 10 * 60_000 };
export const DEFAULT_ACCOUNTS_CONFIG: ApiConfig['accounts'] = {
  registration: true,
  sessionMs: ACCOUNT_RULES.sessionDays * 24 * 60 * 60_000,
};

export const DEFAULT_CHECKOUT_CONFIG: ApiConfig['checkout'] = {
  holdMs: 10 * 60_000,
  maxPaymentAttempts: 5,
  sweepIntervalMs: 30_000,
};

export const DEFAULT_PAYMENTS_CONFIG: ApiConfig['payments'] = {
  outcomeControls: true,
  pendingResolveMs: 5_000,
  responseDelayMs: 350,
  timeoutMs: 2_500,
};

/** The only place the API reads `process.env`. Invalid values fail at startup. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = envSchema.parse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')),
  );
  return {
    today: parsed.VELASIA_TODAY,
    inventory: { seed: parsed.INVENTORY_SEED, horizonDays: parsed.INVENTORY_HORIZON_DAYS },
    faults: {
      enabled: parsed.RETAILING_API_FAULTS === 'enabled',
      latency: parsed.RETAILING_API_LATENCY_MS,
      timeoutMs: parsed.RETAILING_API_FAULT_TIMEOUT_MS,
      crashTests: parsed.RETAILING_API_CRASH_TESTS === 'enabled',
    },
    retailing: {
      ...DEFAULT_RETAILING_CONFIG,
      offerValidityMs: parsed.OFFER_VALIDITY_MINUTES * 60_000,
    },
    persistence: { path: resolve(parsed.TALADB_PATH) },
    checkout: {
      holdMs: parsed.CHECKOUT_HOLD_MINUTES * 60_000,
      maxPaymentAttempts: parsed.CHECKOUT_MAX_PAYMENT_ATTEMPTS,
      sweepIntervalMs: parsed.ORDER_SWEEP_INTERVAL_MS,
    },
    payments: {
      outcomeControls:
        (parsed.PAYMENT_OUTCOME_CONTROLS ??
          (parsed.NODE_ENV === 'production' ? 'disabled' : 'enabled')) === 'enabled',
      pendingResolveMs: parsed.PAYMENT_PENDING_RESOLVE_MS,
      responseDelayMs: parsed.PAYMENT_PROVIDER_DELAY_MS,
      timeoutMs: parsed.PAYMENT_PROVIDER_TIMEOUT_MS,
    },
    servicing: { claimMs: parsed.SERVICING_CLAIM_MINUTES * 60_000 },
    accounts: {
      ...DEFAULT_ACCOUNTS_CONFIG,
      registration:
        (parsed.ACCOUNT_REGISTRATION ??
          (parsed.NODE_ENV === 'production' ? 'disabled' : 'enabled')) === 'enabled',
    },
  };
}
