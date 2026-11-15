import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESULTS_STATE,
  buildResultsHref,
  createFareCalendarQuerySchema,
  createFlightSearchQuerySchema,
  departureWindowFor,
  flightSearchQueryToParams,
  formatFlightNumber,
  hasActiveFilters,
  itineraryIdSchema,
  itineraryQuerySchema,
  parseResultsParams,
  serializeResultsState,
  toFlightFilters,
  type FlightSearch,
} from '../src';

const today = '2026-12-01';
const schema = createFlightSearchQuerySchema({
  today,
  knownAirportCodes: new Set(['MNL', 'SIN', 'CEB']),
  knownAircraftCodes: new Set(['A21N', 'A339']),
});
const base = { from: 'MNL', to: 'SIN', departureDate: '2026-12-15' };

describe('flight search query', () => {
  it('applies defaults', () => {
    expect(schema.parse(base)).toEqual({
      origin: 'MNL',
      destination: 'SIN',
      departureDate: '2026-12-15',
      passengers: { adults: 1, children: 0, infants: 0 },
      cabin: 'economy',
      filters: { departureWindows: [], aircraft: [] },
      sort: 'departure_asc',
      page: 1,
      pageSize: 10,
    });
  });

  it('parses filters, paging, and round-trip options', () => {
    const query = schema.parse({
      ...base,
      from: 'mnl',
      returnDate: '2026-12-20',
      adults: '2',
      infants: '1',
      cabin: 'business',
      maxStops: '0',
      departureTimes: 'morning,evening,morning',
      minPrice: '100000',
      maxPrice: '900000',
      aircraft: 'a21n',
      sort: 'price_asc',
      page: '2',
      pageSize: '5',
      leg: 'inbound',
      outboundId: 'NV501-20261215',
    });
    expect(query).toMatchObject({
      origin: 'MNL',
      returnDate: '2026-12-20',
      passengers: { adults: 2, children: 0, infants: 1 },
      filters: {
        maxStops: 0,
        departureWindows: ['morning', 'evening'],
        minPriceMinor: 100000,
        maxPriceMinor: 900000,
        aircraft: ['A21N'],
      },
      sort: 'price_asc',
      page: 2,
      pageSize: 5,
      leg: 'inbound',
      outboundId: 'NV501-20261215',
    });
  });

  it('reuses the storefront search rules with API field names', () => {
    const result = schema.safeParse({
      from: 'MNL',
      to: 'MNL',
      departureDate: '2026-11-30',
      adults: '0',
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['to', 'departureDate', 'passengers']));
    expect(schema.safeParse({ ...base, to: 'NRT' }).error!.issues[0]!.message).toMatch(
      /doesn't serve NRT/,
    );
  });

  it('serialises back to the same query', () => {
    const query = schema.parse({
      ...base,
      returnDate: '2026-12-20',
      children: '1',
      maxStops: '0',
      sort: 'duration_asc',
    });
    expect(schema.parse(Object.fromEntries(flightSearchQueryToParams(query)))).toEqual(query);
    expect(flightSearchQueryToParams(schema.parse(base)).toString()).toBe(
      'from=MNL&to=SIN&departureDate=2026-12-15&adults=1&cabin=economy',
    );
  });
});

describe('itinerary and calendar queries', () => {
  it('validates itinerary ids', () => {
    expect(itineraryIdSchema.safeParse('NV501-20261215').success).toBe(true);
    expect(itineraryIdSchema.safeParse('NV132-20261215_NV503-20261215').success).toBe(true);
    expect(itineraryIdSchema.safeParse('NV1-2026121_').success).toBe(false);
    expect(itineraryIdSchema.safeParse('NV1-20261215_NV2-20261215_NV3-20261215').success).toBe(
      false,
    );
  });

  it('validates passengers and cabin for detail lookups', () => {
    expect(itineraryQuerySchema.parse({})).toEqual({
      passengers: { adults: 1, children: 0, infants: 0 },
      cabin: 'economy',
    });
    expect(itineraryQuerySchema.safeParse({ adults: '0' }).success).toBe(false);
    expect(itineraryQuerySchema.safeParse({ cabin: 'first' }).success).toBe(false);
  });

  it('validates fare calendar ranges', () => {
    const calendar = createFareCalendarQuerySchema({ today });
    expect(calendar.parse({ from: 'MNL', to: 'SIN', startDate: '2026-12-12' })).toMatchObject({
      days: 7,
    });
    expect(
      calendar.safeParse({ from: 'MNL', to: 'SIN', startDate: '2026-12-12', days: '15' }).success,
    ).toBe(false);
    expect(calendar.safeParse({ from: 'MNL', to: 'MNL', startDate: '2026-12-12' }).success).toBe(
      false,
    );
  });
});

describe('display helpers', () => {
  it('formats flight numbers and departure windows', () => {
    expect(formatFlightNumber('NV501')).toBe('VEL 501');
    expect(formatFlightNumber('NV9')).toBe('VEL 9');
    expect(departureWindowFor('05:59')).toBe('early-morning');
    expect(departureWindowFor('06:00')).toBe('morning');
    expect(departureWindowFor('12:00')).toBe('afternoon');
    expect(departureWindowFor('23:55')).toBe('evening');
  });
});

describe('results URL state', () => {
  const search: FlightSearch = {
    tripType: 'round-trip',
    origin: 'MNL',
    destination: 'SIN',
    departDate: '2026-12-15',
    returnDate: '2026-12-20',
    passengers: { adults: 1, children: 0, infants: 0 },
    cabin: 'economy',
  };

  it('round-trips selections, filters, sort, and page', () => {
    const state = {
      outboundId: 'NV501-20261215',
      inboundId: 'NV502-20261220',
      filters: {
        maxStops: 0,
        departureWindows: ['morning' as const],
        maxPrice: 8000,
        aircraft: ['A21N'],
      },
      sort: 'price_asc' as const,
      page: 2,
    };
    const params = serializeResultsState(state);
    expect(params.toString()).toBe(
      'out=NV501-20261215&ret=NV502-20261220&stops=0&times=morning&maxPrice=8000&aircraft=A21N&sort=price_asc&page=2',
    );
    expect(parseResultsParams(params)).toEqual({ state, ignored: [] });
  });

  it('drops values it does not understand and reports them', () => {
    const { state, ignored } = parseResultsParams({
      out: 'garbage',
      ret: 'NV502-20261220',
      stops: '7',
      times: 'morning,brunch',
      maxPrice: '-5',
      sort: 'random',
      page: 'two',
    });
    expect(state).toEqual({
      filters: { departureWindows: ['morning'], aircraft: [] },
      sort: 'departure_asc',
      page: 1,
    });
    expect(ignored.sort()).toEqual(
      ['maxPrice', 'out', 'page', 'ret', 'sort', 'stops', 'times'].sort(),
    );
  });

  it('builds /flights links with search and results state', () => {
    expect(buildResultsHref(search, { outboundId: 'NV501-20261215' })).toBe(
      '/flights?trip=round-trip&from=MNL&to=SIN&depart=2026-12-15&return=2026-12-20&adults=1&cabin=economy&out=NV501-20261215',
    );
    expect(buildResultsHref(search)).not.toContain('sort=');
  });

  it('converts URL filters into API filters in minor units', () => {
    expect(hasActiveFilters(DEFAULT_RESULTS_STATE.filters)).toBe(false);
    expect(toFlightFilters({ maxPrice: 8000, departureWindows: [], aircraft: [] }, 'PHP')).toEqual({
      maxPriceMinor: 800000,
      departureWindows: [],
      aircraft: [],
    });
  });
});
