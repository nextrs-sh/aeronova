import 'server-only';
import { z } from 'zod';

const serverEnvSchema = z.object({
  RETAILING_API_URL: z.url().default('http://127.0.0.1:4010'),
  SITE_URL: z.url().default('http://localhost:3000'),
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
  });
}
