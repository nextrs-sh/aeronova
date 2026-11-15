import { describe, expect, it } from 'vitest';
import {
  offerIdSchema,
  offerSearchQuerySchema,
  offerSearchQueryToParams,
  requiredDirections,
  sameSearch,
  selectOfferRequestSchema,
  shoppingSearchSchema,
  type FlightSearch,
} from '../src';

const SEARCH: FlightSearch = {
  tripType: 'round-trip',
  origin: 'MNL',
  destination: 'SIN',
  departDate: '2026-12-15',
  returnDate: '2026-12-20',
  passengers: { adults: 2, children: 1, infants: 0 },
  cabin: 'economy',
};

describe('offer search query', () => {
  it('parses, defaults, and round-trips through URL parameters', () => {
    const query = offerSearchQuerySchema.parse({
      itineraryId: 'NV501-20261215',
      adults: '2',
      children: '1',
    });
    expect(query).toEqual({
      itineraryId: 'NV501-20261215',
      passengers: { adults: 2, children: 1, infants: 0 },
      cabin: 'economy',
    });
    const again = offerSearchQuerySchema.parse(Object.fromEntries(offerSearchQueryToParams(query)));
    expect(again).toEqual(query);
  });

  it('reports every problem at once', () => {
    const result = offerSearchQuerySchema.safeParse({
      itineraryId: 'x',
      adults: 'two',
      infants: '3',
      cabin: 'first',
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path[0]).sort()).toEqual([
      'adults',
      'cabin',
      'itineraryId',
      'passengers',
    ]);
  });
});

describe('ids and requests', () => {
  it('accepts only opaque offer ids', () => {
    expect(offerIdSchema.safeParse('off_AbCdEfGhIjKlMnOpQrStUv').success).toBe(true);
    for (const forged of ['NV501-20261215', 'off_short', 'off_AbCdEfGhIjKlMnOpQrStU!', '']) {
      expect(offerIdSchema.safeParse(forged).success, forged).toBe(false);
    }
  });

  it('has nowhere to put a price when selecting an offer', () => {
    const offerId = 'off_AbCdEfGhIjKlMnOpQrStUv';
    expect(selectOfferRequestSchema.safeParse({ direction: 'outbound', offerId }).success).toBe(
      true,
    );
    expect(
      selectOfferRequestSchema.safeParse({ direction: 'outbound', offerId, totalMinor: 1 }).success,
    ).toBe(false);
  });
});

describe('shopping search', () => {
  it('matches a validated flight search shape', () => {
    expect(shoppingSearchSchema.parse(SEARCH)).toEqual(SEARCH);
    expect(shoppingSearchSchema.safeParse({ ...SEARCH, origin: 'mnl' }).success).toBe(false);
  });

  it('knows which directions a trip needs', () => {
    expect(requiredDirections(SEARCH)).toEqual(['outbound', 'inbound']);
    expect(requiredDirections({ tripType: 'one-way' })).toEqual(['outbound']);
  });

  it('compares searches field by field', () => {
    expect(sameSearch(SEARCH, { ...SEARCH, passengers: { ...SEARCH.passengers } })).toBe(true);
    expect(sameSearch(SEARCH, { ...SEARCH, returnDate: '2026-12-21' })).toBe(false);
    expect(
      sameSearch(SEARCH, { ...SEARCH, passengers: { ...SEARCH.passengers, infants: 1 } }),
    ).toBe(false);
    expect(sameSearch(SEARCH, { ...SEARCH, cabin: 'business' })).toBe(false);
  });
});
