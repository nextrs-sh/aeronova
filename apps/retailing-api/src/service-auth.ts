import { createHash, timingSafeEqual } from 'node:crypto';
import { SERVICE_TOKEN_HEADER } from '@velasia/contracts';
import type { FastifyInstance } from 'fastify';

/*
 * Milestone 8: caller authentication for a retailing API that is reachable from outside a
 * private network.
 *
 * In Docker Compose the API sits on an internal network that only the storefront can reach. On
 * DigitalOcean App Platform the API is a separate app with a public HTTPS hostname (separate
 * apps share no private network), so with `RETAILING_API_SERVICE_TOKEN` set every request must
 * carry the same token in `x-velasia-service-token`. The storefront sends it server-side; the
 * browser never talks to this API and never sees the token. Health probes stay open (the
 * platform's checks carry no credentials) and reveal nothing beyond readiness.
 *
 * Without a token configured nothing changes: the internal-network deployment is unaffected.
 */
const OPEN_PATHS = new Set(['/health', '/health/live', '/health/ready']);

const digest = (value: string) => createHash('sha256').update(value).digest();

export function registerServiceAuth(app: FastifyInstance, token: string | undefined): void {
  if (!token) return;
  const expected = digest(token);
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?', 1)[0] ?? '';
    if (OPEN_PATHS.has(path)) return;
    const presented = request.headers[SERVICE_TOKEN_HEADER];
    // Hashing first gives equal-length buffers, so the comparison time never depends on input.
    if (typeof presented === 'string' && timingSafeEqual(digest(presented), expected)) return;
    reply.apiErrorCode = 'UNAUTHENTICATED';
    return reply
      .code(401)
      .header('cache-control', 'no-store')
      .send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'This API answers the Velasia storefront only.',
        },
      });
  });
}
