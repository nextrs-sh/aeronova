import { isAbsolute, resolve } from 'node:path';
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
  // Milestone 7: runtime and operations.
  RETAILING_API_HOST: z.string().min(1).default('127.0.0.1'),
  RETAILING_API_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Optional bearer token for `GET /metrics` (the API is internal-only either way). */
  METRICS_TOKEN: z.string().min(16).max(256).optional(),
  /**
   * Milestone 8: shared secret every caller must send in `x-velasia-service-token` (health
   * probes excepted). Set it whenever the API is reachable from outside a private network.
   */
  RETAILING_API_SERVICE_TOKEN: z.string().min(32).max(256).optional(),
  /** Bound on a graceful shutdown; past it the process exits (TalaDB stays consistent). */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
  /** Requests slower than this are logged at `warn`. */
  SLOW_REQUEST_MS: z.coerce.number().int().min(10).max(120_000).default(1_000),
  /**
   * Production guard: fault injection and crash tests are refused under `NODE_ENV=production`
   * unless this is also set, for a deliberately controlled demonstration environment.
   */
  VELASIA_ALLOW_TEST_CONTROLS: z.enum(['enabled', 'disabled']).default('disabled'),
  /** Shopping sessions in TalaDB: `batched` write-behind (default) or `sync` (see M7 report). */
  SHOPPING_SESSION_DURABILITY: z.enum(['batched', 'sync']).default('batched'),
  /** `batched`: how often changed sessions are group-committed (the most a crash can lose). */
  SHOPPING_SESSION_FLUSH_MS: z.coerce.number().int().min(50).max(10_000).default(1_000),
});

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Settings that are safe in development but must be explicit in production. Throws a
 * `ConfigError` naming the variables (never their values).
 */
function checkProduction(parsed: z.output<typeof envSchema>, env: NodeJS.ProcessEnv): void {
  if (parsed.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (!env.TALADB_PATH) {
    problems.push('TALADB_PATH must be set explicitly in production (an absolute path).');
  } else if (!isAbsolute(env.TALADB_PATH)) {
    problems.push('TALADB_PATH must be an absolute path in production.');
  }
  const testControls =
    parsed.RETAILING_API_FAULTS === 'enabled' || parsed.RETAILING_API_CRASH_TESTS === 'enabled';
  if (testControls && parsed.VELASIA_ALLOW_TEST_CONTROLS !== 'enabled') {
    problems.push(
      'RETAILING_API_FAULTS / RETAILING_API_CRASH_TESTS are test-only. In production they also need VELASIA_ALLOW_TEST_CONTROLS=enabled (controlled demonstrations only).',
    );
  }
  if (problems.length > 0) throw new ConfigError(problems.join(' '));
}

/** Process-level settings for `server.ts` (not needed by `buildApp`). */
export interface RuntimeConfig {
  host: string;
  port: number;
  logLevel: z.output<typeof envSchema>['LOG_LEVEL'];
  metricsToken?: string;
  /** Milestone 8: required from callers when set (see `service-auth.ts`). */
  serviceToken?: string;
  shutdownTimeoutMs: number;
  slowRequestMs: number;
  production: boolean;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = envSchema.parse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')),
  );
  return {
    host: parsed.RETAILING_API_HOST,
    port: parsed.RETAILING_API_PORT ?? parsed.PORT ?? 4010,
    logLevel: parsed.LOG_LEVEL,
    metricsToken: parsed.METRICS_TOKEN,
    serviceToken: parsed.RETAILING_API_SERVICE_TOKEN,
    shutdownTimeoutMs: parsed.SHUTDOWN_TIMEOUT_MS,
    slowRequestMs: parsed.SLOW_REQUEST_MS,
    production: parsed.NODE_ENV === 'production',
  };
}

/** Variable names (never values) behind a configuration failure, for the startup log. */
export function describeConfigError(error: unknown): string {
  if (error instanceof ConfigError) return error.message;
  if (error instanceof z.ZodError) {
    return `Invalid environment: ${error.issues
      .map((issue) => `${issue.path.join('.')} (${issue.message})`)
      .join('; ')}`;
  }
  return 'Invalid configuration.';
}

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
  /** Milestone 7: how shopping sessions reach TalaDB. */
  sessions: { durability: 'batched' | 'sync'; flushMs: number };
}

export const DEFAULT_SESSIONS_CONFIG: ApiConfig['sessions'] = {
  durability: 'batched',
  flushMs: 1_000,
};

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
  checkProduction(parsed, env);
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
    sessions: {
      durability: parsed.SHOPPING_SESSION_DURABILITY,
      flushMs: parsed.SHOPPING_SESSION_FLUSH_MS,
    },
    accounts: {
      ...DEFAULT_ACCOUNTS_CONFIG,
      registration:
        (parsed.ACCOUNT_REGISTRATION ??
          (parsed.NODE_ENV === 'production' ? 'disabled' : 'enabled')) === 'enabled',
    },
  };
}
