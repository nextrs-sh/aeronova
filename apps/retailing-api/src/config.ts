import { isIsoDate } from '@aeronova/contracts';
import { z } from 'zod';

const latencySchema = z
  .string()
  .regex(/^\d{1,5}(-\d{1,5})?$/, 'Use milliseconds, e.g. 400 or 200-900.')
  .transform((value) => {
    const [min, max = min] = value.split('-').map(Number) as [number, number?];
    return { minMs: Math.min(min, max), maxMs: Math.max(min, max) };
  });

const envSchema = z.object({
  /** Pin "today" (airline time zone) for deterministic demos and tests. */
  AERONOVA_TODAY: z.string().refine(isIsoDate, 'Use YYYY-MM-DD.').optional(),
  INVENTORY_SEED: z.string().min(1).max(64).default('aeronova'),
  INVENTORY_HORIZON_DAYS: z.coerce.number().int().min(14).max(355).default(120),
  /** Development/test only: honour `x-aeronova-fault` request headers. */
  RETAILING_API_FAULTS: z.enum(['enabled', 'disabled']).default('disabled'),
  /** Artificial latency on `/v1/flights*`, e.g. `400` or `200-900` (ms). Off when unset. */
  RETAILING_API_LATENCY_MS: latencySchema.optional(),
  /** How long a simulated `timeout` fault holds the response. */
  RETAILING_API_FAULT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(15_000),
});

export interface ApiConfig {
  today?: string;
  inventory: { seed: string; horizonDays: number };
  faults: {
    enabled: boolean;
    latency?: { minMs: number; maxMs: number };
    timeoutMs: number;
  };
}

/** The only place the API reads `process.env`. Invalid values fail at startup. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = envSchema.parse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')),
  );
  return {
    today: parsed.AERONOVA_TODAY,
    inventory: { seed: parsed.INVENTORY_SEED, horizonDays: parsed.INVENTORY_HORIZON_DAYS },
    faults: {
      enabled: parsed.RETAILING_API_FAULTS === 'enabled',
      latency: parsed.RETAILING_API_LATENCY_MS,
      timeoutMs: parsed.RETAILING_API_FAULT_TIMEOUT_MS,
    },
  };
}
