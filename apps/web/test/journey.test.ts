import { parseResultsParams, type FlightSearch, type ResultsState } from '@aeronova/contracts';
import { describe, expect, it } from 'vitest';
import {
  changeHref,
  dateHref,
  faresHref,
  journeyStage,
  selectHref,
} from '@/features/flights/journey';

const search: FlightSearch = {
  tripType: 'round-trip',
  origin: 'MNL',
  destination: 'SIN',
  departDate: '2026-12-15',
  returnDate: '2026-12-20',
  passengers: { adults: 2, children: 0, infants: 0 },
  cabin: 'economy',
};
const filtered: ResultsState = {
  filters: { maxStops: 0, departureWindows: ['morning'], aircraft: [] },
  sort: 'price_asc',
  page: 2,
};
const params = (href: string) => new URL(href, 'http://x').searchParams;

describe('journey steps', () => {
  it('derives the step from the URL', () => {
    expect(journeyStage(search, filtered)).toBe('outbound');
    expect(journeyStage(search, { ...filtered, outboundId: 'NV501-20261215' })).toBe('inbound');
    expect(journeyStage(search, { ...filtered, outboundId: 'a', inboundId: 'b' })).toBe('review');
    expect(
      journeyStage(
        { ...search, tripType: 'one-way', returnDate: undefined },
        { ...filtered, outboundId: 'a' },
      ),
    ).toBe('review');
  });

  it('selecting a departure resets filters and paging but keeps the sort', () => {
    const next = parseResultsParams(
      params(selectHref(search, filtered, 'outbound', 'NV501-20261215')),
    ).state;
    expect(next).toEqual({
      outboundId: 'NV501-20261215',
      filters: { departureWindows: [], aircraft: [] },
      sort: 'price_asc',
      page: 1,
    });
  });

  it('selecting a return keeps the departure', () => {
    const state = { ...filtered, outboundId: 'NV501-20261215' };
    const next = parseResultsParams(
      params(selectHref(search, state, 'inbound', 'NV502-20261220')),
    ).state;
    expect(next).toMatchObject({ outboundId: 'NV501-20261215', inboundId: 'NV502-20261220' });
  });

  it('changing the departure date clears the departure choice; changing the return keeps it', () => {
    const state = { ...filtered, outboundId: 'NV501-20261215' };
    const out = params(dateHref(search, state, 'outbound', '2026-12-16'));
    expect(out.get('depart')).toBe('2026-12-16');
    expect(out.has('out')).toBe(false);
    expect(out.get('times')).toBe('morning');
    const back = params(dateHref(search, state, 'inbound', '2026-12-21'));
    expect(back.get('return')).toBe('2026-12-21');
    expect(back.get('out')).toBe('NV501-20261215');
  });

  it('builds change and fare-preview links', () => {
    const state = { ...filtered, outboundId: 'NV501-20261215', inboundId: 'NV502-20261220' };
    expect(params(changeHref(search, state, 'outbound')).has('out')).toBe(false);
    expect(params(changeHref(search, state, 'inbound')).get('out')).toBe('NV501-20261215');
    const fares = faresHref(search, state);
    expect(fares).toMatch(/^\/flights\/fares\?/);
    expect(params(fares).get('ret')).toBe('NV502-20261220');
    expect(params(fares).has('stops')).toBe(false);
  });
});
