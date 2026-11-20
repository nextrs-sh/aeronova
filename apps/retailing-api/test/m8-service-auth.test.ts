import { SERVICE_TOKEN_HEADER, apiErrorSchema } from '@velasia/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadRuntimeConfig } from '../src/config';
import { TODAY } from './helpers';

/*
 * Milestone 8: with RETAILING_API_SERVICE_TOKEN set (an API reachable outside a private
 * network, e.g. DigitalOcean App Platform), only callers holding the token get answers; health
 * probes stay open. Without it, nothing changes (every other test runs that way).
 */

const TOKEN = 'm8-test-service-token-0123456789abcdef';

let app: FastifyInstance;
beforeAll(async () => {
  app = buildApp({ config: { today: TODAY }, access: { serviceToken: TOKEN } });
  await app.ready();
});
afterAll(() => app.close());

const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url, headers: token ? { [SERVICE_TOKEN_HEADER]: token } : {} });

describe('service token', () => {
  it('answers callers that present the token', async () => {
    const response = await get('/v1/airports', TOKEN);
    expect(response.statusCode).toBe(200);
  });

  it.each([
    ['no token', undefined],
    ['a wrong token', 'm8-wrong-service-token-0123456789abcdef'],
    ['a prefix of the token', TOKEN.slice(0, 20)],
  ])('refuses %s with 401 UNAUTHENTICATED, before any route runs', async (_label, token) => {
    for (const url of ['/v1/airports', '/v1/orders/reference/VEL-ABCDEF', '/metrics', '/nope']) {
      const response = await get(url, token);
      expect(response.statusCode, url).toBe(401);
      expect(response.headers['cache-control'], url).toBe('no-store');
      expect(apiErrorSchema.parse(response.json()).error.code, url).toBe('UNAUTHENTICATED');
    }
    const write = await app.inject({
      method: 'POST',
      url: '/v1/shopping-sessions',
      payload: {},
      headers: token ? { [SERVICE_TOKEN_HEADER]: token } : {},
    });
    expect(write.statusCode).toBe(401);
  });

  it('keeps health probes open (platform checks carry no credentials)', async () => {
    for (const url of ['/health', '/health/live', '/health/ready', '/health/ready?probe=1']) {
      expect((await get(url)).statusCode, url).toBe(200);
    }
  });

  it('is read from RETAILING_API_SERVICE_TOKEN and must be at least 32 characters', () => {
    expect(loadRuntimeConfig({ RETAILING_API_SERVICE_TOKEN: TOKEN }).serviceToken).toBe(TOKEN);
    expect(loadRuntimeConfig({}).serviceToken).toBeUndefined();
    expect(() => loadRuntimeConfig({ RETAILING_API_SERVICE_TOKEN: 'too-short' })).toThrow(
      /RETAILING_API_SERVICE_TOKEN/,
    );
  });
});
