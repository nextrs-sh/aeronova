import {
  airportListResponseSchema,
  apiErrorSchema,
  destinationListResponseSchema,
  destinationResponseSchema,
  healthResponseSchema,
} from '@aeronova/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { AIRPORTS } from '../src/fixtures/airports';
import { DESTINATIONS } from '../src/fixtures/destinations';

let app: FastifyInstance;
beforeAll(async () => {
  app = buildApp();
  await app.ready();
});
afterAll(() => app.close());

const get = (url: string) => app.inject({ method: 'GET', url });

describe('GET /health', () => {
  it('reports ok', async () => {
    const response = await get('/health');
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe('ok');
  });
});

describe('GET /v1/airports', () => {
  it('lists every airport, matching the shared contract', async () => {
    const response = await get('/v1/airports');
    expect(response.statusCode).toBe(200);
    const body = airportListResponseSchema.parse(response.json());
    expect(body.data).toHaveLength(AIRPORTS.length);
    expect(body.data.map((a) => a.code)).toContain('MNL');
  });

  it('filters by query, best match first', async () => {
    const body = airportListResponseSchema.parse((await get('/v1/airports?q=tokyo')).json());
    expect(body.data.map((a) => a.code).sort()).toEqual(['HND', 'NRT']);
    const byCode = airportListResponseSchema.parse((await get('/v1/airports?q=kix')).json());
    expect(byCode.data[0]?.code).toBe('KIX');
  });

  it('rejects malformed queries with the error envelope', async () => {
    const response = await get(`/v1/airports?q=${'x'.repeat(65)}`);
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('BAD_REQUEST');
  });
});

describe('GET /v1/destinations', () => {
  it('lists all destinations, matching the shared contract', async () => {
    const response = await get('/v1/destinations');
    expect(response.statusCode).toBe(200);
    const body = destinationListResponseSchema.parse(response.json());
    expect(body.data).toHaveLength(12);
  });

  it('filters featured destinations and regions', async () => {
    const featured = destinationListResponseSchema.parse(
      (await get('/v1/destinations?featured=true')).json(),
    );
    expect(featured.data.length).toBeGreaterThan(0);
    expect(featured.data.every((d) => d.featured)).toBe(true);

    const ph = destinationListResponseSchema.parse(
      (await get('/v1/destinations?region=philippines')).json(),
    );
    expect(ph.data.map((d) => d.slug).sort()).toEqual(['cebu', 'davao', 'manila']);
  });

  it('rejects unknown filters values', async () => {
    const response = await get('/v1/destinations?region=antarctica');
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('BAD_REQUEST');
  });
});

describe('GET /v1/destinations/:slug', () => {
  it('returns a destination', async () => {
    const response = await get('/v1/destinations/tokyo');
    expect(response.statusCode).toBe(200);
    expect(destinationResponseSchema.parse(response.json()).data.airportCodes).toEqual([
      'NRT',
      'HND',
    ]);
  });

  it('returns 404 for an unknown slug', async () => {
    const response = await get('/v1/destinations/atlantis');
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed slug', async () => {
    expect((await get('/v1/destinations/Not%20A%20Slug')).statusCode).toBe(400);
  });
});

describe('unknown routes', () => {
  it('use the error envelope', async () => {
    const response = await get('/v1/offers');
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });
});

describe('fixture integrity', () => {
  const airportCodes = new Set(AIRPORTS.map((a) => a.code));

  it('has unique slugs and airport codes', () => {
    expect(new Set(DESTINATIONS.map((d) => d.slug)).size).toBe(DESTINATIONS.length);
    expect(airportCodes.size).toBe(AIRPORTS.length);
  });

  it('only references airports that exist', () => {
    for (const destination of DESTINATIONS) {
      for (const code of destination.airportCodes) expect(airportCodes).toContain(code);
      for (const route of destination.routes) {
        expect(airportCodes).toContain(route.origin);
        expect(destination.airportCodes).toContain(route.destination);
        expect(route.origin).not.toBe(route.destination);
      }
      if (destination.illustrativeFare) {
        expect(destination.illustrativeFare.kind).toBe('illustrative');
        expect(destination.illustrativeFare.currency).toBe('PHP');
        expect(destination.routes.map((r) => r.origin)).toContain(
          destination.illustrativeFare.origin,
        );
      }
    }
  });

  it('links airports to destinations that exist', () => {
    const slugs = new Set(DESTINATIONS.map((d) => d.slug));
    for (const airport of AIRPORTS) {
      if (airport.destinationSlug) expect(slugs).toContain(airport.destinationSlug);
    }
  });
});
