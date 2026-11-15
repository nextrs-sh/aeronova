import 'server-only';
import { isIsoDate } from '@velasia/contracts';
import { z } from 'zod';

const serverEnvSchema = z.object({
  RETAILING_API_URL: z.url().default('http://127.0.0.1:4010'),
  SITE_URL: z.url().default('http://localhost:3000'),
  /** Time budget for each retailing API request, in milliseconds. */
  RETAILING_API_TIMEOUT_MS: z.coerce.number().int().min(200).max(60_000).default(5_000),
  /** Pin "today" (airline time zone) for deterministic demos and tests. Test-only. */
  VELASIA_TODAY: z.string().refine(isIsoDate, 'Use YYYY-MM-DD.').optional(),
  /**
   * Test-only: forward the `velasia-fault` cookie to the retailing API as a
   * fault-injection header. The API must also have faults enabled.
   */
  RETAILING_API_FORWARD_FAULTS: z.enum(['enabled', 'disabled']).default('disabled'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * The only place `process.env` is read. Values are server-only: the browser
 * reaches data through `/api/*` Route Handlers, never the internal API URL.
 */
export function getServerEnv(): ServerEnv {
  return serverEnvSchema.parse({
    RETAILING_API_URL: process.env.RETAILING_API_URL || undefined,
    SITE_URL: process.env.SITE_URL || undefined,
    RETAILING_API_TIMEOUT_MS: process.env.RETAILING_API_TIMEOUT_MS || undefined,
    // `AERONOVA_TODAY` is the deprecated pre-rebrand name, still honoured for existing setups.
    VELASIA_TODAY: process.env.VELASIA_TODAY || process.env.AERONOVA_TODAY || undefined,
    RETAILING_API_FORWARD_FAULTS: process.env.RETAILING_API_FORWARD_FAULTS || undefined,
  });
}
