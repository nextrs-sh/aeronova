import { describe, expect, it } from 'vitest';
import {
  BOOKING_WINDOW_DAYS,
  DEFAULT_SEARCH_DRAFT,
  addDays,
  buildFlightsHref,
  createFlightSearchSchema,
  hasFlightSearchParams,
  parseFlightSearchParams,
  passengerStepLimits,
  searchParamsToDraft,
  serializeFlightSearch,
  validatePassengers,
  type FlightSearchDraft,
} from '../src';

const today = '2026-11-15';
const known = new Set(['MNL', 'CEB', 'NRT', 'SIN']);
const schema = createFlightSearchSchema({ today, knownAirportCodes: known });

const validDraft: FlightSearchDraft = {
  ...DEFAULT_SEARCH_DRAFT,
  origin: 'MNL',
  destination: 'NRT',
  departDate: '2026-12-01',
  returnDate: '2026-12-08',
};

function messagesFor(draft: FlightSearchDraft, path: string): string[] {
  const result = schema.safeParse(draft);
  if (result.success) return [];
  return result.error.issues.filter((i) => i.path.join('.') === path).map((i) => i.message);
}

describe('flight search schema', () => {
  it('accepts a valid round trip', () => {
    expect(schema.parse(validDraft)).toEqual({
      tripType: 'round-trip',
      origin: 'MNL',
      destination: 'NRT',
      departDate: '2026-12-01',
      returnDate: '2026-12-08',
      passengers: { adults: 1, children: 0, infants: 0 },
      cabin: 'economy',
    });
  });

  it('drops the return date from one-way searches', () => {
    const result = schema.parse({ ...validDraft, tripType: 'one-way', returnDate: '2026-11-01' });
    expect(result.returnDate).toBeUndefined();
  });

  it('reports every problem at once', () => {
    const result = schema.safeParse({ ...DEFAULT_SEARCH_DRAFT });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(['origin', 'destination', 'departDate', 'returnDate']);
  });

  describe('origin and destination', () => {
    it('requires both airports', () => {
      expect(messagesFor({ ...validDraft, origin: '' }, 'origin')).toEqual([
        'Choose where you are flying from.',
      ]);
      expect(messagesFor({ ...validDraft, destination: '' }, 'destination')).toEqual([
        'Choose where you are flying to.',
      ]);
    });

    it('rejects identical airports', () => {
      expect(messagesFor({ ...validDraft, destination: 'MNL' }, 'destination')).toEqual([
        'Departure and arrival airports must be different.',
      ]);
    });

    it('rejects malformed and unknown codes', () => {
      expect(messagesFor({ ...validDraft, origin: 'Manila' }, 'origin')).toEqual([
        'Choose an airport from the list.',
      ]);
      expect(messagesFor({ ...validDraft, origin: 'LAX' }, 'origin')[0]).toMatch(
        /doesn't serve LAX/,
      );
    });

    it('skips the network check when no airport list is supplied', () => {
      const lenient = createFlightSearchSchema({ today });
      expect(lenient.safeParse({ ...validDraft, origin: 'LAX' }).success).toBe(true);
    });
  });

  describe('dates', () => {
    it('allows departing today and rejects the past', () => {
      expect(messagesFor({ ...validDraft, departDate: today }, 'departDate')).toEqual([]);
      expect(messagesFor({ ...validDraft, departDate: '2026-11-14' }, 'departDate')).toEqual([
        'Choose a date from today onwards.',
      ]);
    });

    it(`enforces the ${BOOKING_WINDOW_DAYS}-day booking window`, () => {
      const last = addDays(today, BOOKING_WINDOW_DAYS);
      expect(
        messagesFor({ ...validDraft, departDate: last, returnDate: last }, 'departDate'),
      ).toEqual([]);
      expect(
        messagesFor({ ...validDraft, departDate: addDays(last, 1), returnDate: '' }, 'departDate'),
      ).toEqual([`Flights can be searched up to ${BOOKING_WINDOW_DAYS} days ahead.`]);
    });

    it('rejects impossible calendar dates', () => {
      expect(messagesFor({ ...validDraft, departDate: '2027-02-30' }, 'departDate')).toEqual([
        'Enter a valid date.',
      ]);
    });

    it('requires a return date on round trips only', () => {
      expect(messagesFor({ ...validDraft, returnDate: '' }, 'returnDate')).toEqual([
        'Choose a return date.',
      ]);
      expect(schema.safeParse({ ...validDraft, tripType: 'one-way', returnDate: '' }).success).toBe(
        true,
      );
    });

    it('rejects returning before departing but allows same-day returns', () => {
      expect(messagesFor({ ...validDraft, returnDate: '2026-11-30' }, 'returnDate')).toEqual([
        'Return date must be on or after the departure date.',
      ]);
      expect(messagesFor({ ...validDraft, returnDate: '2026-12-01' }, 'returnDate')).toEqual([]);
    });
  });

  it('rejects invalid passenger mixes', () => {
    expect(
      messagesFor(
        { ...validDraft, passengers: { adults: 1, children: 0, infants: 2 } },
        'passengers',
      ),
    ).toEqual(['Each infant must travel on the lap of their own adult.']);
  });
});

describe('passenger rules', () => {
  it('requires at least one adult', () => {
    expect(validatePassengers({ adults: 0, children: 2, infants: 0 })).toEqual([
      { message: 'At least one adult must travel on every booking.' },
    ]);
  });

  it('caps seated passengers at nine but excludes lap infants', () => {
    expect(validatePassengers({ adults: 5, children: 4, infants: 0 })).toEqual([]);
    expect(validatePassengers({ adults: 5, children: 4, infants: 5 })).toEqual([]);
    expect(validatePassengers({ adults: 5, children: 5, infants: 0 })).toHaveLength(1);
  });

  it('rejects fractional or negative counts', () => {
    expect(validatePassengers({ adults: 1.5, children: 0, infants: 0 })).toEqual([
      { message: 'Passenger counts must be whole numbers.' },
    ]);
    expect(validatePassengers({ adults: 1, children: -1, infants: 0 })).toHaveLength(1);
  });

  it('derives stepper limits that keep the mix valid', () => {
    const atStart = passengerStepLimits({ adults: 1, children: 0, infants: 0 });
    expect(atStart.adults).toEqual({ canIncrement: true, canDecrement: false });
    expect(atStart.infants).toEqual({ canIncrement: true, canDecrement: false });

    const infantPerAdult = passengerStepLimits({ adults: 2, children: 0, infants: 2 });
    expect(infantPerAdult.infants.canIncrement).toBe(false);
    expect(infantPerAdult.adults.canDecrement).toBe(false);

    const full = passengerStepLimits({ adults: 6, children: 3, infants: 0 });
    expect(full.adults.canIncrement).toBe(false);
    expect(full.children.canIncrement).toBe(false);
    expect(full.infants.canIncrement).toBe(true);
  });
});

describe('URL serialization', () => {
  const search = schema.parse({
    ...validDraft,
    passengers: { adults: 2, children: 1, infants: 1 },
    cabin: 'business',
  });

  it('serializes to short, stable keys', () => {
    expect(serializeFlightSearch(search).toString()).toBe(
      'trip=round-trip&from=MNL&to=NRT&depart=2026-12-01&return=2026-12-08&adults=2&children=1&infants=1&cabin=business',
    );
  });

  it('omits zero counts and one-way return dates', () => {
    const oneWay = schema.parse({ ...validDraft, tripType: 'one-way' });
    expect(buildFlightsHref(oneWay)).toBe(
      '/flights?trip=one-way&from=MNL&to=NRT&depart=2026-12-01&adults=1&cabin=economy',
    );
  });

  it('round-trips through parse', () => {
    const parsed = parseFlightSearchParams(serializeFlightSearch(search), {
      today,
      knownAirportCodes: known,
    });
    expect(parsed).toMatchObject({ success: true, search });
  });

  it('accepts Next.js searchParams records, including repeated keys', () => {
    const parsed = parseFlightSearchParams(
      { trip: 'one-way', from: ['mnl', 'CEB'], to: 'nrt', depart: '2026-12-01' },
      { today },
    );
    expect(parsed.success && parsed.search.origin).toBe('MNL');
  });

  it('infers trip type when missing and defaults passengers and cabin', () => {
    expect(searchParamsToDraft({ from: 'MNL', to: 'NRT', depart: '2026-12-01' })).toMatchObject({
      tripType: 'one-way',
      passengers: { adults: 1, children: 0, infants: 0 },
      cabin: 'economy',
    });
    expect(searchParamsToDraft({ return: '2026-12-09' }).tripType).toBe('round-trip');
    expect(searchParamsToDraft({ cabin: 'first' }).cabin).toBe('economy');
  });

  it('reports tampered parameters with field paths and keeps a draft for editing', () => {
    const parsed = parseFlightSearchParams(
      { trip: 'round-trip', from: 'MNL', to: 'MNL', depart: '2020-01-01', adults: 'lots' },
      { today, knownAirportCodes: known },
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.issues.map((i) => i.path)).toEqual([
      'destination',
      'departDate',
      'returnDate',
      'passengers',
    ]);
    expect(parsed.draft.origin).toBe('MNL');
  });

  it('detects whether any search parameters are present', () => {
    expect(hasFlightSearchParams({})).toBe(false);
    expect(hasFlightSearchParams({ utm_source: 'x' })).toBe(false);
    expect(hasFlightSearchParams(new URLSearchParams('from=MNL'))).toBe(true);
  });
});
