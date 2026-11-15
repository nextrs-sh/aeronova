// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from '@aeronova/retailing-api/app';
import {
  aircraftListResponseSchema,
  apiErrorSchema,
  flightDetailResponseSchema,
  flightSearchResponseSchema,
  routeListResponseSchema,
} from '@aeronova/contracts';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAircraft } from '@/app/api/aircraft/route';
import { GET as getFlight } from '@/app/api/flights/[id]/route';
import { GET as searchFlights } from '@/app/api/flights/route';
import { GET as getRoutes } from '@/app/api/routes/route';
import { retailingApi } from '@/lib/retailing-api/client';

// `'use cache'` is a compiler directive; outside Next.js the cache APIs are no-ops.
vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {} }));

let faultCookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'aeronova-fault' && faultCookie ? { value: faultCookie } : undefined,
  }),
}));

const TODAY = '2026-12-01';
let api: ReturnType<typeof buildApp>;
let apiUrl: string;

beforeAll(async () => {
  api = buildApp({ config: { today: TODAY } });
  apiUrl = await api.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => api.close());
beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('RETAILING_API_URL', apiUrl);
  vi.stubEnv('AERONOVA_TODAY', TODAY);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const request = (path: string) => new NextRequest(new URL(path, 'http://localhost:3000'));
const detail = (id: string, query = '') =>
  getFlight(request(`/api/flights/${id}${query}`), { params: Promise.resolve({ id }) });
const SEARCH = '/api/flights?from=MNL&to=SIN&departureDate=2026-12-15';

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = apiErrorSchema.parse(await response.json());
  expect(body.error.code).toBe(code);
  expect(body.error.message).not.toMatch(/127\.0\.0\.1|localhost|ECONNREFUSED/);
  return body;
}

describe('GET /api/flights', () => {
  it('returns live results from the retailing API, never cached', async () => {
    const response = await searchFlights(request(`${SEARCH}&returnDate=2026-12-20&adults=2`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = flightSearchResponseSchema.parse(await response.json());
    expect(body.data.legs.map((leg) => leg.direction)).toEqual(['outbound', 'inbound']);
    expect(body.meta.referenceDate).toBe(TODAY);
  });

  it('matches the retailing API response exactly (no storefront pricing)', async () => {
    const direct = await (
      await fetch(`${apiUrl}/v1/flights?from=MNL&to=SIN&departureDate=2026-12-15`)
    ).json();
    const proxied = await (await searchFlights(request(SEARCH))).json();
    expect(proxied).toEqual(direct);
  });

  it('forwards only validated parameters, rebuilt from parsed values', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await searchFlights(request(`${SEARCH}&from=mnl&debug=1&sort=price_asc&page=1`));
    const upstream = new URL(String(spy.mock.calls.at(-1)![0]));
    expect(upstream.pathname).toBe('/v1/flights');
    expect(Object.fromEntries(upstream.searchParams)).toEqual({
      from: 'MNL',
      to: 'SIN',
      departureDate: '2026-12-15',
      adults: '1',
      cabin: 'economy',
      sort: 'price_asc',
    });
  });

  it('validates before calling upstream and reports every issue', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const body = await expectError(
      await searchFlights(
        request('/api/flights?from=MNL&to=MNL&departureDate=2001-01-01&cabin=first'),
      ),
      400,
      'BAD_REQUEST',
    );
    expect(body.error.issues?.map((issue) => issue.path).sort()).toEqual([
      'cabin',
      'departureDate',
      'to',
    ]);
    expect(spy.mock.calls.some(([url]) => String(url).includes('/v1/flights'))).toBe(false);
  });

  it('forwards the API’s own validation messages', async () => {
    // Aircraft codes are checked by the API, not the storefront.
    const body = await expectError(
      await searchFlights(request(`${SEARCH}&aircraft=B744`)),
      400,
      'BAD_REQUEST',
    );
    expect(body.error.issues?.[0]).toMatchObject({ path: 'aircraft' });
  });
});

describe('GET /api/flights/[id]', () => {
  it('combines the itinerary and per-cabin availability', async () => {
    const response = await detail('NV503-20261215', '?adults=2&cabin=business');
    expect(response.status).toBe(200);
    const body = flightDetailResponseSchema.parse(await response.json());
    expect(body.data.itinerary).toMatchObject({ id: 'NV503-20261215', cabin: 'business' });
    expect(body.data.segments[0]!.cabins).toHaveLength(3);
  });

  it('calls the two upstream endpoints in parallel', async () => {
    const started: number[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      started.push(performance.now());
      return realFetch(input, init);
    });
    await detail('NV501-20261215');
    expect(started).toHaveLength(2);
    expect(Math.abs(started[1]! - started[0]!)).toBeLessThan(15);
  });

  it('maps missing and malformed flights', async () => {
    await expectError(await detail('NV9999-20261215'), 404, 'NOT_FOUND');
    await expectError(await detail('not-a-flight'), 400, 'BAD_REQUEST');
    await expectError(await detail('NV501-20261215', '?adults=0'), 400, 'BAD_REQUEST');
  });
});

describe('GET /api/routes and /api/aircraft', () => {
  it('lists the network with filters and public caching', async () => {
    const response = await getRoutes(request('/api/routes?from=ceb'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('public');
    const body = routeListResponseSchema.parse(await response.json());
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((route) => route.origin === 'CEB')).toBe(true);
    await expectError(await getRoutes(request('/api/routes?from=cebu')), 400, 'BAD_REQUEST');
  });

  it('lists the fleet', async () => {
    const body = aircraftListResponseSchema.parse(await (await getAircraft()).json());
    expect(body.data.map((aircraft) => aircraft.code)).toContain('A339');
  });
});

describe('upstream failures', () => {
  it('maps an unreachable API to 503', async () => {
    vi.stubEnv('RETAILING_API_URL', 'http://127.0.0.1:9');
    await expectError(await searchFlights(request(SEARCH)), 503, 'UPSTREAM_UNAVAILABLE');
    await expectError(await detail('NV501-20261215'), 503, 'UPSTREAM_UNAVAILABLE');
  });

  it('maps a 503 from the API to 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } }, { status: 503 }),
    );
    await expectError(await searchFlights(request(SEARCH)), 503, 'UPSTREAM_UNAVAILABLE');
  });

  it('rejects responses that break the contract instead of passing them on', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: { legs: 'nope' } }));
    await expectError(await searchFlights(request(SEARCH)), 503, 'UPSTREAM_UNAVAILABLE');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 200 }));
    await expectError(await searchFlights(request(SEARCH)), 503, 'UPSTREAM_UNAVAILABLE');
  });

  describe('timeouts', () => {
    let hanging: Server;
    let hangingUrl: string;
    beforeAll(async () => {
      // Accepts connections and never answers.
      hanging = createServer(() => {});
      await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', resolve));
      hangingUrl = `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`;
    });
    afterAll(() => {
      hanging.closeAllConnections();
      hanging.close();
    });

    it('gives up after the configured budget and answers 504', async () => {
      vi.stubEnv('RETAILING_API_URL', hangingUrl);
      vi.stubEnv('RETAILING_API_TIMEOUT_MS', '300');
      const started = performance.now();
      await expectError(await searchFlights(request(SEARCH)), 504, 'UPSTREAM_TIMEOUT');
      expect(performance.now() - started).toBeLessThan(2_000);
      await expect(retailingApi.listAirports()).rejects.toMatchObject({ kind: 'timeout' });
    });
  });
});

describe('fault-injection forwarding (test-only)', () => {
  const forwarded = async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await searchFlights(request(SEARCH));
    return new Headers(spy.mock.calls.at(-1)![1]?.headers).get('x-aeronova-fault');
  };

  it('is off unless explicitly enabled', async () => {
    faultCookie = 'unavailable';
    expect(await forwarded()).toBeNull();
  });

  it('forwards only recognised fault values when enabled', async () => {
    vi.stubEnv('RETAILING_API_FORWARD_FAULTS', 'enabled');
    faultCookie = 'timeout';
    expect(await forwarded()).toBe('timeout');
    faultCookie = 'drop table';
    expect(await forwarded()).toBeNull();
    faultCookie = undefined;
  });
});
