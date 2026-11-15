import type { HealthResponse } from '@velasia/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { Lifecycle } from '../app';

/*
 * Health endpoints (Milestone 7):
 *
 * - `GET /health`: the original M1 probe (kept for compatibility): the process answers.
 * - `GET /health/live`: liveness. Depends on nothing but the event loop, so a slow or briefly
 *   unavailable dependency never makes an orchestrator restart a healthy process.
 * - `GET /health/ready`: readiness, registered with the persistence layer (see `app.ts`):
 *   TalaDB open and answering, migrations and indexes verified, ledger rebuilt, recovery done,
 *   sessions restored, and not shutting down.
 */
export const healthRoutes: FastifyPluginAsync<{ version: string; lifecycle: Lifecycle }> = async (
  app,
  options,
) => {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'velasia-retailing-api',
    version: options.version,
  }));

  app.get('/health/live', async (_request, reply) =>
    reply.header('cache-control', 'no-store').send({
      status: 'ok',
      service: 'velasia-retailing-api',
      version: options.version,
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );
};
