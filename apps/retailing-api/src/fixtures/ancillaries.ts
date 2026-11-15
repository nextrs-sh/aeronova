import {
  ancillaryProductSchema,
  type AncillaryProduct,
  type AncillaryProductId,
  type DistanceBand,
  type SeatCategory,
  type TravellerType,
} from '@velasia/contracts';
import { z } from 'zod';
import { MINOR_PER_PESO, PRICING_CURRENCY } from '../pricing/pricing';

/*
 * Velasia's optional services. Every product, price, and rule here is fictional.
 *
 * Prices are whole pesos per traveller, by route length (the distance band of the flight, or
 * the longest flight of a direction), and include any applicable taxes: what a traveller sees
 * is what the quote adds. What a fare family includes is read from the fare family itself
 * (`fare-families.ts`) and is never sold again.
 */

/** Bumped whenever a product, price, or rule below changes. */
export const ANCILLARY_CATALOGUE_VERSION = '2026-11.m4';

type BandPrices = Record<DistanceBand, number>;

/** Advance seat selection, per traveller per flight, for categories a fare doesn't include. */
export const SEAT_PRICES: Record<Exclude<SeatCategory, 'BUSINESS'>, BandPrices> = {
  STANDARD: { short: 150, medium: 300, long: 450 },
  PREFERRED: { short: 350, medium: 600, long: 850 },
  EXTRA_LEGROOM: { short: 600, medium: 1000, long: 1400 },
};

/** Flights shorter than this have no meal pre-order (the fare's snack and drink only). */
export const MEAL_MIN_BLOCK_MINUTES = 90;
/** The premium meal is offered on flights at least this long. */
export const PREMIUM_MEAL_MIN_BLOCK_MINUTES = 180;

export interface AncillaryDefinition extends Omit<AncillaryProduct, 'prices' | 'currency'> {
  prices: BandPrices;
  /** Traveller types who can buy it. Lap infants share their adult's services. */
  travellers: readonly TravellerType[];
  /** Meals only: the shortest flight it is offered on. */
  minBlockMinutes?: number;
}

const SEATED: readonly TravellerType[] = ['adult', 'child'];

const definitions: AncillaryDefinition[] = [
  {
    id: 'BAG_10',
    category: 'BAGGAGE',
    name: 'Extra 10 kg',
    description: 'Adds 10 kg to the checked baggage allowance. With Light, it is one 10 kg bag.',
    scope: 'direction',
    extraWeightKg: 10,
    eligibility: 'Adults and children. Covers every flight in one direction, connections included.',
    prices: { short: 700, medium: 1100, long: 1500 },
    travellers: SEATED,
  },
  {
    id: 'BAG_15',
    category: 'BAGGAGE',
    name: 'Extra 15 kg',
    description: 'Adds 15 kg to the checked baggage allowance. With Light, it is one 15 kg bag.',
    scope: 'direction',
    extraWeightKg: 15,
    eligibility: 'Adults and children. Covers every flight in one direction, connections included.',
    prices: { short: 950, medium: 1450, long: 2000 },
    travellers: SEATED,
  },
  {
    id: 'BAG_20',
    category: 'BAGGAGE',
    name: 'Extra 20 kg',
    description: 'Adds 20 kg to the checked baggage allowance. With Light, it is one 20 kg bag.',
    scope: 'direction',
    extraWeightKg: 20,
    eligibility: 'Adults and children. Covers every flight in one direction, connections included.',
    prices: { short: 1200, medium: 1800, long: 2500 },
    travellers: SEATED,
  },
  {
    id: 'MEAL_HOT',
    category: 'MEAL',
    name: 'Hot meal',
    description: 'A hot main course with rice or noodles, a side, and a drink.',
    scope: 'flight',
    extraWeightKg: null,
    eligibility: 'Flights of 90 minutes or more.',
    prices: { short: 350, medium: 350, long: 350 },
    travellers: SEATED,
    minBlockMinutes: MEAL_MIN_BLOCK_MINUTES,
  },
  {
    id: 'MEAL_VEGETARIAN',
    category: 'MEAL',
    name: 'Vegetarian meal',
    description: 'A hot vegetarian main course (may contain eggs and dairy), a side, and a drink.',
    scope: 'flight',
    extraWeightKg: null,
    eligibility: 'Flights of 90 minutes or more.',
    prices: { short: 350, medium: 350, long: 350 },
    travellers: SEATED,
    minBlockMinutes: MEAL_MIN_BLOCK_MINUTES,
  },
  {
    id: 'MEAL_VEGAN',
    category: 'MEAL',
    name: 'Vegan meal',
    description: 'A hot plant-based main course, a side, and a drink.',
    scope: 'flight',
    extraWeightKg: null,
    eligibility: 'Flights of 90 minutes or more.',
    prices: { short: 350, medium: 350, long: 350 },
    travellers: SEATED,
    minBlockMinutes: MEAL_MIN_BLOCK_MINUTES,
  },
  {
    id: 'MEAL_CHILD',
    category: 'MEAL',
    name: 'Child meal',
    description: 'A smaller, mildly seasoned meal with fruit and a drink.',
    scope: 'flight',
    extraWeightKg: null,
    eligibility: 'Children, on flights of 90 minutes or more.',
    prices: { short: 280, medium: 280, long: 280 },
    travellers: ['child'],
    minBlockMinutes: MEAL_MIN_BLOCK_MINUTES,
  },
  {
    id: 'MEAL_PREMIUM',
    category: 'MEAL',
    name: 'Premium meal',
    description: 'A three-course chef’s selection with a dessert and a choice of drinks.',
    scope: 'flight',
    extraWeightKg: null,
    eligibility: 'Flights of 3 hours or more.',
    prices: { short: 750, medium: 750, long: 750 },
    travellers: SEATED,
    minBlockMinutes: PREMIUM_MEAL_MIN_BLOCK_MINUTES,
  },
  {
    id: 'PRIORITY_CHECK_IN',
    category: 'PRIORITY',
    name: 'Priority check-in',
    description: 'Use the priority check-in counters where available.',
    scope: 'direction',
    extraWeightKg: null,
    eligibility: 'Adults and children, with fares that don’t already include it.',
    prices: { short: 200, medium: 300, long: 400 },
    travellers: SEATED,
  },
  {
    id: 'PRIORITY_BOARDING',
    category: 'PRIORITY',
    name: 'Priority boarding',
    description: 'Board early and settle in before the main cabin.',
    scope: 'direction',
    extraWeightKg: null,
    eligibility: 'Adults and children, with fares that don’t already include it.',
    prices: { short: 250, medium: 350, long: 450 },
    travellers: SEATED,
  },
];

export const ANCILLARIES: readonly AncillaryDefinition[] = Object.freeze(definitions);
export const ANCILLARIES_BY_ID: ReadonlyMap<string, AncillaryDefinition> = new Map(
  ANCILLARIES.map((product) => [product.id, product]),
);

/** The public catalogue entry, with prices in minor units. */
export function toPublicProduct(product: AncillaryDefinition): AncillaryProduct {
  const { prices, travellers: _travellers, minBlockMinutes: _min, ...rest } = product;
  return {
    ...rest,
    prices: {
      short: prices.short * MINOR_PER_PESO,
      medium: prices.medium * MINOR_PER_PESO,
      long: prices.long * MINOR_PER_PESO,
    },
    currency: PRICING_CURRENCY,
  };
}

// Fixtures are validated like any other input.
z.array(ancillaryProductSchema).parse(ANCILLARIES.map(toPublicProduct));
for (const prices of [...Object.values(SEAT_PRICES), ...ANCILLARIES.map((p) => p.prices)]) {
  if (Object.values(prices).some((pesos) => !Number.isSafeInteger(pesos) || pesos <= 0)) {
    throw new Error('Ancillary prices must be positive whole pesos.');
  }
}

export function isProductId(value: string): value is AncillaryProductId {
  return ANCILLARIES_BY_ID.has(value);
}
