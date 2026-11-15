// @vitest-environment node
import { buildApp } from '@velasia/retailing-api/app';
import {
  airportListResponseSchema,
  apiErrorSchema,
  destinationListResponseSchema,
} from '@velasia/contracts';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAirports } from '@/app/api/airports/route';
import { GET as getDestinations } from '@/app/api/destinations/route';
import { retailingApi } from '@/lib/retailing-api/client';

let api: ReturnType<typeof buildApp>;
let apiUrl: string;

beforeAll(async () => {
  api = buildApp();
  apiUrl = await api.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => api.close());
beforeEach(() => {
  vi.stubEnv('RETAILING_API_URL', apiUrl);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const request = (path: string) => new NextRequest(new URL(path, 'http://localhost:3000'));

describe('GET /api/airports', () => {
  it('proxies the airport catalogue with public cache headers', async () => {
    const response = await getAirports(request('/api/airports'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('public');
    const body = airportListResponseSchema.parse(await response.json());
    expect(body.data.length).toBeGreaterThanOrEqual(12);
  });

  it('forwards a validated query, not the raw query string', async () => {
    const response = await getAirports(request('/api/airports?q=osaka&debug=1'));
    const body = airportListResponseSchema.parse(await response.json());
    expect(body.data.map((airport) => airport.code)).toEqual(['KIX']);
  });

  it('rejects oversized queries before calling upstream', async () => {
    const response = await getAirports(request(`/api/airports?q=${'a'.repeat(100)}`));
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('BAD_REQUEST');
  });
});

describe('GET /api/destinations', () => {
  it('lists destinations and supports filters', async () => {
    const all = destinationListResponseSchema.parse(
      await (await getDestinations(request('/api/destinations'))).json(),
    );
    expect(all.data).toHaveLength(12);

    const featured = destinationListResponseSchema.parse(
      await (
        await getDestinations(request('/api/destinations?featured=true&region=east-asia'))
      ).json(),
    );
    expect(featured.data.length).toBeGreaterThan(0);
    expect(featured.data.every((d) => d.featured && d.region === 'east-asia')).toBe(true);
  });

  it('rejects unknown filter values', async () => {
    const response = await getDestinations(request('/api/destinations?region=mars'));
    expect(response.status).toBe(400);
  });
});

describe('when the retailing API is unavailable', () => {
  beforeEach(() => {
    // Port 9 (discard) on loopback refuses connections immediately.
    vi.stubEnv('RETAILING_API_URL', 'http://127.0.0.1:9');
  });

  it('route handlers return 503 with no-store and a safe message', async () => {
    for (const handler of [
      () => getAirports(request('/api/airports')),
      () => getDestinations(request('/api/destinations')),
    ]) {
      const response = await handler();
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = apiErrorSchema.parse(await response.json());
      expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(body.error.message).not.toContain('127.0.0.1');
    }
  });

  it('the server client throws a typed error', async () => {
    await expect(retailingApi.listDestinations()).rejects.toMatchObject({
      name: 'RetailingApiError',
      kind: 'unavailable',
    });
  });
});

describe('retailing API client', () => {
  it('resolves null for missing or malformed destination slugs', async () => {
    expect(await retailingApi.getDestination('atlantis')).toBeNull();
    expect(await retailingApi.getDestination('Not A Slug')).toBeNull();
    expect((await retailingApi.getDestination('seoul'))?.name).toBe('Seoul');
  });

  it('rejects upstream bodies that break the contract', async () => {
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () =>
      Response.json({ data: [{ code: 'nope' }] }),
    );
    await expect(retailingApi.listAirports()).rejects.toMatchObject({ kind: 'bad-response' });
    globalThis.fetch = realFetch;
  });
});
