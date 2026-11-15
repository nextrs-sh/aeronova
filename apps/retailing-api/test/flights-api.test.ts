import {
  aircraftListResponseSchema,
  apiErrorSchema,
  availabilityResponseSchema,
  fareCalendarResponseSchema,
  flightSearchResponseSchema,
  itineraryResponseSchema,
  routeListResponseSchema,
} from '@velasia/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { TODAY } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = buildApp({ config: { today: TODAY } });
  await app.ready();
});
afterAll(() => app.close());

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers });
const SEARCH = '/v1/flights?from=MNL&to=SIN&departureDate=2026-12-15';

async function expectBadRequest(url: string, path: string) {
  const response = await get(url);
  expect(response.statusCode, url).toBe(400);
  const body = apiErrorSchema.parse(response.json());
  expect(body.error.code).toBe('BAD_REQUEST');
  expect(
    body.error.issues?.map((issue) => issue.path),
    url,
  ).toContain(path);
  return body;
}

describe('GET /v1/flights', () => {
  it('searches one-way flights, matching the shared contract', async () => {
    const response = await get(`${SEARCH}&adults=2&children=1&sort=price_asc`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    const body = flightSearchResponseSchema.parse(response.json());
    expect(body.meta).toEqual({
      currency: 'PHP',
      priceKind: 'indicative',
      referenceDate: TODAY,
      scheduleEndDate: '2027-03-30',
    });
    const [leg] = body.data.legs;
    expect(body.data.legs).toHaveLength(1);
    expect(leg!.itineraries.length).toBeGreaterThan(0);
    const prices = leg!.itineraries.map((it) => it.price.perAdultMinor);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(leg!.itineraries[0]!.price.breakdown.map((item) => item.passengerType)).toEqual([
      'adult',
      'child',
    ]);
  });

  it('searches round trips', async () => {
    const body = flightSearchResponseSchema.parse(
      (await get(`${SEARCH}&returnDate=2026-12-20`)).json(),
    );
    expect(body.data.legs.map((leg) => [leg.direction, leg.origin, leg.date])).toEqual([
      ['outbound', 'MNL', '2026-12-15'],
      ['inbound', 'SIN', '2026-12-20'],
    ]);
  });

  it('is deterministic across requests and app instances', async () => {
    const other = buildApp({ config: { today: TODAY } });
    const [a, b, c] = await Promise.all([
      get(`${SEARCH}&returnDate=2026-12-20`),
      get(`${SEARCH}&returnDate=2026-12-20`),
      other.inject({ method: 'GET', url: `${SEARCH}&returnDate=2026-12-20` }),
    ]);
    expect(a.body).toBe(b.body);
    expect(a.body).toBe(c.body);
    await other.close();
  });

  it('returns an explained empty result for an unserved route', async () => {
    const body = flightSearchResponseSchema.parse(
      (await get('/v1/flights?from=DPS&to=CGK&departureDate=2026-12-15')).json(),
    );
    expect(body.data.legs[0]!.itineraries).toEqual([]);
    expect(body.data.legs[0]!.summary.emptyReason).toBe('no-route');
  });

  it('explains unavailable inventory', async () => {
    const cabin = flightSearchResponseSchema.parse(
      (await get('/v1/flights?from=MNL&to=ILO&departureDate=2026-12-15&cabin=business')).json(),
    );
    expect(cabin.data.legs[0]!.summary.emptyReason).toBe('cabin-not-offered');
    const far = flightSearchResponseSchema.parse(
      (await get('/v1/flights?from=MNL&to=CEB&departureDate=2027-06-01')).json(),
    );
    expect(far.data.legs[0]!.summary.emptyReason).toBe('beyond-schedule');
  });

  it('applies filters and paging, and reports pagination metadata', async () => {
    const body = flightSearchResponseSchema.parse(
      (
        await get(
          '/v1/flights?from=MNL&to=HKG&departureDate=2026-12-15&maxStops=0&pageSize=2&page=1',
        )
      ).json(),
    );
    const [leg] = body.data.legs;
    expect(leg!.itineraries.every((it) => it.stops === 0)).toBe(true);
    expect(leg!.pagination).toMatchObject({ page: 1, pageSize: 2 });
    expect(leg!.pagination.totalPages).toBe(Math.ceil(leg!.pagination.totalItems / 2));
  });

  describe('rejects invalid queries with field-level issues', () => {
    it.each([
      ['missing airports', '/v1/flights?departureDate=2026-12-15', 'from'],
      ['unknown airport', '/v1/flights?from=MNL&to=XYZ&departureDate=2026-12-15', 'to'],
      ['same airports', '/v1/flights?from=MNL&to=MNL&departureDate=2026-12-15', 'to'],
      ['malformed date', '/v1/flights?from=MNL&to=SIN&departureDate=2026-02-30', 'departureDate'],
      ['past date', '/v1/flights?from=MNL&to=SIN&departureDate=2026-11-30', 'departureDate'],
      ['return before departure', `${SEARCH}&returnDate=2026-12-14`, 'returnDate'],
      ['unsupported cabin', `${SEARCH}&cabin=first`, 'cabin'],
      ['too many passengers', `${SEARCH}&adults=8&children=2`, 'passengers'],
      ['no adult', `${SEARCH}&adults=0&children=1`, 'passengers'],
      ['infant without lap', `${SEARCH}&adults=1&infants=2`, 'passengers'],
      ['non-numeric count', `${SEARCH}&adults=two`, 'adults'],
      ['bad sort', `${SEARCH}&sort=cheapest`, 'sort'],
      ['zero page', `${SEARCH}&page=0`, 'page'],
      ['huge page size', `${SEARCH}&pageSize=500`, 'pageSize'],
      ['bad stops', `${SEARCH}&maxStops=3`, 'maxStops'],
      ['unknown time window', `${SEARCH}&departureTimes=brunch`, 'departureTimes'],
      ['inverted price range', `${SEARCH}&minPrice=900000&maxPrice=100`, 'maxPrice'],
      ['unknown aircraft', `${SEARCH}&aircraft=B744`, 'aircraft'],
      ['inbound leg without return', `${SEARCH}&leg=inbound`, 'leg'],
      ['malformed outbound id', `${SEARCH}&returnDate=2026-12-20&outboundId=abc`, 'outboundId'],
    ])('%s', async (_name, url, path) => {
      await expectBadRequest(url, path);
    });

    it('reports every problem at once', async () => {
      const body = await expectBadRequest(
        '/v1/flights?from=MNL&to=MNL&departureDate=2001-01-01&cabin=first&sort=x',
        'to',
      );
      expect(body.error.issues!.map((issue) => issue.path).sort()).toEqual(
        ['cabin', 'departureDate', 'sort', 'to'].sort(),
      );
    });
  });
});

describe('GET /v1/flights/:id', () => {
  it('returns an itinerary with its price for the party and cabin', async () => {
    const response = await get('/v1/flights/NV501-20261215?adults=2&cabin=premium-economy');
    expect(response.statusCode).toBe(200);
    const body = itineraryResponseSchema.parse(response.json());
    expect(body.data).toMatchObject({
      id: 'NV501-20261215',
      cabin: 'premium-economy',
      availability: 'available',
    });
    expect(body.data.price.breakdown[0]).toMatchObject({ passengerType: 'adult', count: 2 });
  });

  it('matches the itinerary returned by search', async () => {
    const search = flightSearchResponseSchema.parse((await get(SEARCH)).json());
    const found = search.data.legs[0]!.itineraries[0]!;
    const detail = itineraryResponseSchema.parse((await get(`/v1/flights/${found.id}`)).json());
    const { availability, ...itinerary } = detail.data;
    expect(availability).toBe('available');
    expect(itinerary).toEqual(found);
  });

  it('resolves connecting itineraries', async () => {
    const body = itineraryResponseSchema.parse(
      (await get('/v1/flights/NV132-20261215_NV503-20261215')).json(),
    );
    expect(body.data.stops).toBe(1);
    expect(body.data.connections[0]!.airport).toBe('MNL');
  });

  it('404s unknown flights and invalid connections; 400s malformed ids and cabins', async () => {
    expect((await get('/v1/flights/NV9999-20261215')).statusCode).toBe(404);
    expect((await get('/v1/flights/NV122-20261215_NV202-20261215')).statusCode).toBe(404);
    expect((await get('/v1/flights/not-a-flight')).statusCode).toBe(400);
    const cabin = await get('/v1/flights/NV131-20261215?cabin=business');
    expect(cabin.statusCode).toBe(400);
    expect(apiErrorSchema.parse(cabin.json()).error.code).toBe('BAD_REQUEST');
  });

  it('reports a flight that cannot seat the party', async () => {
    const body = itineraryResponseSchema.parse(
      (await get('/v1/flights/NV501-20261215?adults=9&cabin=business')).json(),
    );
    expect(['insufficient-seats', 'sold-out']).toContain(body.data.availability);
  });
});

describe('GET /v1/flights/:id/availability', () => {
  it('lists every cabin with capacity and seats left', async () => {
    const body = availabilityResponseSchema.parse(
      (await get('/v1/flights/NV503-20261215/availability')).json(),
    );
    const [segment] = body.data.segments;
    expect(segment!.aircraft.code).toBe('A339');
    expect(segment!.cabins.map((cabin) => cabin.cabin)).toEqual([
      'business',
      'premium-economy',
      'economy',
    ]);
    for (const cabin of segment!.cabins) {
      expect(cabin.available).toBeGreaterThanOrEqual(0);
      expect(cabin.available).toBeLessThanOrEqual(cabin.capacity);
    }
  });
});

describe('GET /v1/flights/calendar', () => {
  it('returns the lowest per-adult fare for each nearby day', async () => {
    const response = await get('/v1/flights/calendar?from=MNL&to=SIN&startDate=2026-11-28&days=7');
    expect(response.statusCode).toBe(200);
    const body = fareCalendarResponseSchema.parse(response.json());
    expect(body.data.map((day) => day.date)).toEqual([
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
    ]);
    expect(body.data.slice(0, 3).every((day) => day.status === 'past')).toBe(true);
    const available = body.data.filter((day) => day.status === 'available');
    expect(available.length).toBeGreaterThan(0);
    expect(available.every((day) => day.lowestPerAdultMinor !== null && day.itineraries > 0)).toBe(
      true,
    );
  });

  it('agrees with search on the lowest fare', async () => {
    const calendar = fareCalendarResponseSchema.parse(
      (await get('/v1/flights/calendar?from=MNL&to=SIN&startDate=2026-12-15&days=1')).json(),
    );
    const search = flightSearchResponseSchema.parse((await get(SEARCH)).json());
    expect(calendar.data[0]!.lowestPerAdultMinor).toBe(
      search.data.legs[0]!.summary.lowestPerAdultMinor,
    );
  });

  it('validates its query', async () => {
    await expectBadRequest(
      '/v1/flights/calendar?from=MNL&to=SIN&startDate=2026-12-15&days=40',
      'days',
    );
    await expectBadRequest('/v1/flights/calendar?from=MNL&to=SIN', 'startDate');
  });
});

describe('GET /v1/routes and /v1/aircraft', () => {
  it('lists the network, filterable by origin and destination', async () => {
    const all = routeListResponseSchema.parse((await get('/v1/routes')).json());
    expect(all.data.length).toBeGreaterThanOrEqual(40);
    const fromCebu = routeListResponseSchema.parse((await get('/v1/routes?from=CEB')).json());
    expect(fromCebu.data.every((route) => route.origin === 'CEB')).toBe(true);
    const one = routeListResponseSchema.parse((await get('/v1/routes?from=MNL&to=SIN')).json());
    expect(one.data).toEqual([expect.objectContaining({ id: 'MNL-SIN', kind: 'international' })]);
    expect((await get('/v1/routes?from=manila')).statusCode).toBe(400);
  });

  it('lists the fleet', async () => {
    const body = aircraftListResponseSchema.parse((await get('/v1/aircraft')).json());
    expect(body.data.map((aircraft) => aircraft.code).sort()).toEqual([
      'A20N',
      'A21N',
      'A339',
      'B38M',
    ]);
  });

  it('never exposes internal inventory fields', async () => {
    const raw = (await get(SEARCH)).body + (await get('/v1/routes')).body;
    for (const field of ['projectedLoad', 'sold', 'seed', 'daysToDeparture', 'demand']) {
      expect(raw).not.toContain(`"${field}"`);
    }
  });
});

describe('simulated network conditions', () => {
  let faulty: FastifyInstance;
  beforeAll(async () => {
    faulty = buildApp({ config: { today: TODAY, faults: { enabled: true, timeoutMs: 300 } } });
    await faulty.ready();
  });
  afterAll(() => faulty.close());
  const fault = (value: string) =>
    faulty.inject({ method: 'GET', url: SEARCH, headers: { 'x-aeronova-fault': value } });

  it('ignores fault headers unless explicitly enabled', async () => {
    const response = await get(SEARCH, { 'x-aeronova-fault': 'unavailable' });
    expect(response.statusCode).toBe(200);
  });

  it('answers 503 with the error envelope', async () => {
    const response = await fault('unavailable');
    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('delays and holds responses', async () => {
    const started = performance.now();
    expect((await fault('delay=150')).statusCode).toBe(200);
    expect(performance.now() - started).toBeGreaterThanOrEqual(140);
    const held = performance.now();
    await fault('timeout');
    expect(performance.now() - held).toBeGreaterThanOrEqual(280);
  });

  it('returns empty results', async () => {
    const body = flightSearchResponseSchema.parse((await fault('empty')).json());
    expect(body.data.legs[0]!.itineraries).toEqual([]);
    expect(body.data.legs[0]!.summary.emptyReason).toBe('no-flights-on-date');
  });

  it('returns bodies that break the contract', async () => {
    const response = await fault('malformed');
    expect(response.statusCode).toBe(200);
    expect(flightSearchResponseSchema.safeParse(response.json()).success).toBe(false);
  });

  it('leaves the health check alone', async () => {
    const response = await faulty.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-aeronova-fault': 'unavailable' },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('configuration', () => {
  it('defaults to safe, deterministic settings', () => {
    expect(loadConfig({})).toEqual({
      today: undefined,
      inventory: { seed: 'aeronova', horizonDays: 120 },
      faults: { enabled: false, latency: undefined, timeoutMs: 15_000 },
    });
  });

  it('parses overrides and rejects bad values', () => {
    const config = loadConfig({
      AERONOVA_TODAY: '2027-01-10',
      INVENTORY_HORIZON_DAYS: '90',
      RETAILING_API_FAULTS: 'enabled',
      RETAILING_API_LATENCY_MS: '900-200',
    });
    expect(config).toMatchObject({
      today: '2027-01-10',
      inventory: { horizonDays: 90 },
      faults: { enabled: true, latency: { minMs: 200, maxMs: 900 } },
    });
    expect(() => loadConfig({ AERONOVA_TODAY: '2027-13-01' })).toThrow();
    expect(() => loadConfig({ RETAILING_API_FAULTS: 'yes' })).toThrow();
  });
});
