import { parseResultsParams, type FlightSearch, type ResultsState } from '@velasia/contracts';
import { describe, expect, it } from 'vitest';
import {
  afterSelectionHref,
  backToResultsHref,
  changeFareHref,
  changeHref,
  dateHref,
  faresHref,
  journeyStage,
  summaryHref,
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

  it('opens the fare comparison over the current results, and returns to them', () => {
    const fares = faresHref(search, filtered, 'NV501-20261215');
    const state = parseResultsParams(params(fares)).state;
    expect(state).toEqual({ ...filtered, faresId: 'NV501-20261215' });
    expect(journeyStage(search, state)).toBe('outbound');
    expect(parseResultsParams(params(backToResultsHref(search, state))).state).toEqual(filtered);

    const inbound = { ...filtered, outboundId: 'NV501-20261215' };
    const returnFares = parseResultsParams(params(faresHref(search, inbound, 'NV502-20261220')));
    expect(returnFares.state).toMatchObject({
      outboundId: 'NV501-20261215',
      faresId: 'NV502-20261220',
    });
    expect(journeyStage(search, returnFares.state)).toBe('inbound');
  });

  it('after choosing a fare, goes to the return flights or the trip summary', () => {
    const next = (chosen: { outbound?: string; inbound?: string }, trip = search) =>
      parseResultsParams(params(afterSelectionHref(trip, 'price_asc', chosen))).state;
    expect(next({ outbound: 'NV501-20261215' })).toEqual({
      outboundId: 'NV501-20261215',
      filters: { departureWindows: [], aircraft: [] },
      sort: 'price_asc',
      page: 1,
    });
    expect(next({ outbound: 'NV501-20261215', inbound: 'NV502-20261220' })).toMatchObject({
      outboundId: 'NV501-20261215',
      inboundId: 'NV502-20261220',
    });
    const oneWay = { ...search, tripType: 'one-way' as const, returnDate: undefined };
    expect(journeyStage(oneWay, next({ outbound: 'NV501-20261215' }, oneWay))).toBe('review');
    expect(params(summaryHref(oneWay, 'departure_asc', 'a', 'b')).has('ret')).toBe(false);
  });

  it('changes a chosen fare without losing the other direction', () => {
    const state = { ...filtered, outboundId: 'NV501-20261215', inboundId: 'NV502-20261220' };
    const out = parseResultsParams(
      params(changeFareHref(search, state, 'outbound', 'NV501-20261215')),
    );
    expect(out.state).toMatchObject({ faresId: 'NV501-20261215' });
    expect(out.state.outboundId).toBeUndefined();
    const back = parseResultsParams(
      params(changeFareHref(search, state, 'inbound', 'NV502-20261220')),
    );
    expect(back.state).toMatchObject({ outboundId: 'NV501-20261215', faresId: 'NV502-20261220' });
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

  it('builds change links', () => {
    const state = { ...filtered, outboundId: 'NV501-20261215', inboundId: 'NV502-20261220' };
    expect(params(changeHref(search, state, 'outbound')).has('out')).toBe(false);
    expect(params(changeHref(search, state, 'inbound')).get('out')).toBe('NV501-20261215');
  });
});
