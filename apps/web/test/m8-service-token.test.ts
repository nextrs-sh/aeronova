// @vitest-environment node
import { buildApp } from '@velasia/retailing-api/app';
import { airportListResponseSchema } from '@velasia/contracts';
import { NextRequest } from 'next/server';
import type * as NextServer from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAirports } from '@/app/api/airports/route';
import { GET as getReady } from '@/app/api/internal/health/ready/route';

/*
 * Milestone 8: the storefront sends RETAILING_API_SERVICE_TOKEN to a retailing API that
 * requires it (App Platform), server-side only.
 */

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof NextServer>()),
  connection: async () => {},
}));

const TOKEN = 'm8-web-service-token-0123456789abcdef';
let api: ReturnType<typeof buildApp>;
let apiUrl: string;

beforeAll(async () => {
  api = buildApp({ access: { serviceToken: TOKEN } });
  apiUrl = await api.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => api.close());
beforeEach(() => {
  vi.stubEnv('RETAILING_API_URL', apiUrl);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const request = (path: string) => new NextRequest(new URL(path, 'http://localhost:3000'));

describe('RETAILING_API_SERVICE_TOKEN', () => {
  it('is sent to the API, which then answers', async () => {
    vi.stubEnv('RETAILING_API_SERVICE_TOKEN', TOKEN);
    const response = await getAirports(request('/api/airports'));
    expect(response.status).toBe(200);
    expect(airportListResponseSchema.parse(await response.json()).data.length).toBeGreaterThan(0);
  });

  it('without it, an API that requires one refuses the storefront', async () => {
    vi.stubEnv('RETAILING_API_SERVICE_TOKEN', '');
    const response = await getAirports(request('/api/airports'));
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('readiness needs no token (the API keeps health probes open)', async () => {
    vi.stubEnv('RETAILING_API_SERVICE_TOKEN', '');
    const response = await getReady();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ retailingApi: 'ready' });
  });
});
