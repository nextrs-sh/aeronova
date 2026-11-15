import {
  airportListResponseSchema,
  apiErrorSchema,
  destinationListResponseSchema,
  destinationResponseSchema,
  flightSearchResponseSchema,
  healthResponseSchema,
} from '@velasia/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { AIRPORTS } from '../src/fixtures/airports';
import { DESTINATION_CONTENT } from '../src/fixtures/destinations';
import { TODAY } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = buildApp({ config: { today: TODAY } });
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
    expect(new Set(DESTINATION_CONTENT.map((d) => d.slug)).size).toBe(DESTINATION_CONTENT.length);
    expect(airportCodes.size).toBe(AIRPORTS.length);
  });

  it('derives destination routes and fares from the network', async () => {
    const { data } = destinationListResponseSchema.parse((await get('/v1/destinations')).json());
    for (const destination of data) {
      for (const code of destination.airportCodes) expect(airportCodes).toContain(code);
      expect(destination.routes.length, destination.slug).toBeGreaterThan(0);
      for (const route of destination.routes) {
        expect(airportCodes).toContain(route.origin);
        expect(destination.airportCodes).toContain(route.destination);
        expect(route.origin).not.toBe(route.destination);
      }
      const fare = destination.illustrativeFare!;
      expect(fare.kind).toBe('illustrative');
      expect(fare.currency).toBe('PHP');
      expect(destination.routes.map((r) => r.origin)).toContain(fare.origin);
    }
  });

  it('quotes "from" fares that search can actually find', async () => {
    const { data } = destinationResponseSchema.parse(
      (await get('/v1/destinations/singapore')).json(),
    );
    const fare = data.illustrativeFare!;
    let lowest = Number.POSITIVE_INFINITY;
    for (let day = 0; day < 120; day += 1) {
      const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) + day * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const body = flightSearchResponseSchema.parse(
        (
          await get(`/v1/flights?from=${fare.origin}&to=SIN&departureDate=${date}&maxStops=0`)
        ).json(),
      );
      const price = body.data.legs[0]!.summary.lowestPerAdultMinor;
      if (price !== null) lowest = Math.min(lowest, price);
    }
    expect(fare.amount).toBe(Math.floor(lowest / 100));
  });

  it('links airports to destinations that exist', () => {
    const slugs = new Set(DESTINATION_CONTENT.map((d) => d.slug));
    for (const airport of AIRPORTS) {
      if (airport.destinationSlug) expect(slugs).toContain(airport.destinationSlug);
    }
  });
});
