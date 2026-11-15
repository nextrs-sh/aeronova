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
  /** Milestone 7: optional bearer token for `/api/internal/metrics`. */
  METRICS_TOKEN: z.string().min(16).max(256).optional(),
  /** Milestone 7: production guard for test-only controls (see the retailing API). */
  VELASIA_ALLOW_TEST_CONTROLS: z.enum(['enabled', 'disabled']).default('disabled'),
  NODE_ENV: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const read = (name: keyof z.input<typeof serverEnvSchema>) => process.env[name] || undefined;

/**
 * The only place `process.env` is read. Values are server-only: the browser
 * reaches data through `/api/*` Route Handlers, never the internal API URL.
 */
export function getServerEnv(): ServerEnv {
  return serverEnvSchema.parse({
    RETAILING_API_URL: read('RETAILING_API_URL'),
    SITE_URL: read('SITE_URL'),
    RETAILING_API_TIMEOUT_MS: read('RETAILING_API_TIMEOUT_MS'),
    VELASIA_TODAY: read('VELASIA_TODAY'),
    RETAILING_API_FORWARD_FAULTS: read('RETAILING_API_FORWARD_FAULTS'),
    METRICS_TOKEN: read('METRICS_TOKEN'),
    VELASIA_ALLOW_TEST_CONTROLS: read('VELASIA_ALLOW_TEST_CONTROLS'),
    NODE_ENV: read('NODE_ENV'),
  });
}

/**
 * Milestone 7: checked once when the server starts (`instrumentation.ts`), so a misconfigured
 * production container fails at boot rather than on the first request. Messages name variables,
 * never their values.
 */
export function validateServerEnvAtStartup(): ServerEnv {
  let env: ServerEnv;
  try {
    env = getServerEnv();
  } catch (error) {
    const issues =
      error instanceof z.ZodError
        ? error.issues.map((issue) => `${issue.path.join('.')} (${issue.message})`).join('; ')
        : 'unreadable';
    throw new Error(`Invalid storefront environment: ${issues}`);
  }
  if (env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const problems: string[] = [];
    if (!read('RETAILING_API_URL')) problems.push('RETAILING_API_URL must be set in production.');
    if (!read('SITE_URL')) problems.push('SITE_URL must be set in production.');
    if (
      env.RETAILING_API_FORWARD_FAULTS === 'enabled' &&
      env.VELASIA_ALLOW_TEST_CONTROLS !== 'enabled'
    ) {
      problems.push(
        'RETAILING_API_FORWARD_FAULTS is test-only; in production it also needs VELASIA_ALLOW_TEST_CONTROLS=enabled.',
      );
    }
    if (problems.length > 0)
      throw new Error(`Invalid storefront environment: ${problems.join(' ')}`);
  }
  return env;
}
