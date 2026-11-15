import {
  isoWeekday,
  type CabinClass,
  type Charge,
  type DistanceBand,
  type IndicativePrice,
  type PassengerCounts,
  type PriceBreakdownItem,
  type PricedPassengerType,
} from '@velasia/contracts';
import { cabinInventory, isPeakSeason, type FlightInstance } from '../inventory/inventory';

/*
 * Indicative pricing. Deterministic and explainable: every factor below is a
 * documented rule, and the same inventory always gives the same price. These
 * are not offers: offers (with fare families) are priced from the same rules in
 * `offer-pricing.ts`.
 *
 * All arithmetic is in whole pesos and converted to minor units at the end,
 * so no floating-point centavos ever appear.
 */

export const PRICING_CURRENCY = 'PHP';
export const MINOR_PER_PESO = 100;

/** Economy base fare: a fixed component plus a per-kilometre rate, by distance band. */
const BASE_FARE: Record<DistanceBand, { fixed: number; perKm: number }> = {
  short: { fixed: 1450, perKm: 1.6 },
  medium: { fixed: 2200, perKm: 1.5 },
  long: { fixed: 3000, perKm: 1.45 },
};

const CABIN_MULTIPLIER: Record<CabinClass, number> = {
  economy: 1,
  'premium-economy': 1.7,
  business: 3.2,
};

/** Fewer days before departure → higher fare. Ordered by `maxDays`. */
const ADVANCE_PURCHASE: readonly { maxDays: number; multiplier: number }[] = [
  { maxDays: 3, multiplier: 1.45 },
  { maxDays: 7, multiplier: 1.3 },
  { maxDays: 14, multiplier: 1.15 },
  { maxDays: 30, multiplier: 1 },
  { maxDays: 60, multiplier: 0.92 },
  { maxDays: Number.POSITIVE_INFINITY, multiplier: 0.85 },
];

/** Demand band, from the cabin's projected load factor at departure. */
const DEMAND_BANDS: readonly { maxLoad: number; band: DemandBand; multiplier: number }[] = [
  { maxLoad: 0.6, band: 'low', multiplier: 0.92 },
  { maxLoad: 0.8, band: 'standard', multiplier: 1 },
  { maxLoad: 0.92, band: 'high', multiplier: 1.12 },
  { maxLoad: Number.POSITIVE_INFINITY, band: 'peak', multiplier: 1.25 },
];
export type DemandBand = 'low' | 'standard' | 'high' | 'peak';

/** Friday and Sunday are busiest; Tuesday and Wednesday quietest. */
const WEEKDAY_MULTIPLIER: Record<number, number> = { 2: 0.95, 3: 0.95, 5: 1.08, 7: 1.08 };
const PEAK_SEASON_MULTIPLIER = 1.1;
/** Connecting itineraries are priced below the sum of their legs. */
const CONNECTION_DISCOUNT = 0.9;

const PASSENGER_FARE_SHARE: Record<PricedPassengerType, number> = {
  adult: 1,
  child: 0.75,
  // Lap infants pay a tenth of the adult fare and no seat-based charges.
  infant: 0.1,
};

/** Simulated mandatory charges, per seated passenger per flight, in pesos. */
const PASSENGER_SERVICE_CHARGE = { domestic: 250, international: 950 } as const;
const FUEL_SURCHARGE: Record<DistanceBand, number> = { short: 180, medium: 450, long: 750 };
/** Simulated value-added tax on domestic fares. */
const DOMESTIC_VAT_RATE = 0.12;

const roundTo10 = (pesos: number) => Math.round(pesos / 10) * 10;

function timeOfDayMultiplier(departureTime: string): number {
  const hour = Number(departureTime.slice(0, 2));
  if (hour < 6) return 0.9; // red-eye
  if ((hour >= 6 && hour < 9) || (hour >= 17 && hour < 20)) return 1.06;
  return 1;
}

export function demandBandFor(load: number) {
  return DEMAND_BANDS.find((entry) => load <= entry.maxLoad)!;
}

/**
 * Adult fare (pesos, before charges) for one flight in one cabin. `demandShift` moves the
 * flight up (or down) that many demand bands; it is 0 except in simulated test scenarios.
 */
export function segmentFare(instance: FlightInstance, cabin: CabinClass, demandShift = 0): number {
  const { schedule } = instance;
  const base = BASE_FARE[schedule.distanceBand];
  const advance = ADVANCE_PURCHASE.find((entry) => instance.daysToDeparture <= entry.maxDays)!;
  const load = cabinInventory(instance, cabin)?.projectedLoad ?? 0.7;
  const bandIndex = DEMAND_BANDS.indexOf(demandBandFor(load));
  const demand =
    DEMAND_BANDS[Math.min(DEMAND_BANDS.length - 1, Math.max(0, bandIndex + demandShift))]!;
  const fare =
    (base.fixed + schedule.distanceKm * base.perKm) *
    CABIN_MULTIPLIER[cabin] *
    advance.multiplier *
    demand.multiplier *
    (WEEKDAY_MULTIPLIER[isoWeekday(instance.date)] ?? 1) *
    (isPeakSeason(instance.date) ? PEAK_SEASON_MULTIPLIER : 1) *
    timeOfDayMultiplier(schedule.departureTime);
  return roundTo10(fare);
}

export function segmentCharges(instance: FlightInstance, fare: number, seated: boolean): Charge[] {
  if (!seated) return [];
  const { kind, distanceBand, origin } = instance.schedule;
  const charges: Charge[] = [
    {
      code: 'PASSENGER_SERVICE',
      label: `Passenger service charge (${origin})`,
      amountMinor: PASSENGER_SERVICE_CHARGE[kind] * MINOR_PER_PESO,
    },
    {
      code: 'FUEL_SURCHARGE',
      label: 'Fuel surcharge',
      amountMinor: FUEL_SURCHARGE[distanceBand] * MINOR_PER_PESO,
    },
  ];
  if (kind === 'domestic') {
    charges.push({
      code: 'VAT',
      label: 'VAT (12%)',
      amountMinor: Math.round(fare * DOMESTIC_VAT_RATE) * MINOR_PER_PESO,
    });
  }
  return charges;
}

/** Sum charges that share a code across flights (e.g. two fuel surcharges). */
export function mergeCharges(charges: Charge[]): Charge[] {
  const merged = new Map<string, Charge>();
  for (const charge of charges) {
    const key = `${charge.code}|${charge.label}`;
    const existing = merged.get(key);
    merged.set(
      key,
      existing ? { ...existing, amountMinor: existing.amountMinor + charge.amountMinor } : charge,
    );
  }
  return [...merged.values()];
}

/** A fare family's addition to the base fare, per adult per flight (see `fare-families.ts`). */
export interface FareComponent {
  /** Share of the base fare. */
  rate: number;
  /** Fixed amount by distance band, in pesos. */
  fixed: Record<DistanceBand, number>;
}

export const NO_FARE_COMPONENT: FareComponent = {
  rate: 0,
  fixed: { short: 0, medium: 0, long: 0 },
};

export interface PassengerTypePrice {
  /** Pesos, per passenger, summed over the flights. */
  baseFare: number;
  fareComponent: number;
  /** Per passenger, merged across flights (minor units). */
  charges: Charge[];
}

/**
 * The single per-passenger pricing rule shared by indicative prices and offers, so the two
 * can never drift: per flight, the base fare (with the connection discount) and the fare
 * family component are each scaled by the passenger type's share and rounded to ₱10; then the
 * mandatory charges are computed on their sum. Lap infants pay no seat-based charges.
 */
export function pricePassengerType(
  segments: readonly FlightInstance[],
  cabin: CabinClass,
  type: PricedPassengerType,
  component: FareComponent = NO_FARE_COMPONENT,
  demandShift = 0,
): PassengerTypePrice {
  const discount = segments.length > 1 ? CONNECTION_DISCOUNT : 1;
  const share = PASSENGER_FARE_SHARE[type];
  let baseFare = 0;
  let fareComponent = 0;
  const charges: Charge[] = [];
  for (const segment of segments) {
    const adultBase = segmentFare(segment, cabin, demandShift) * discount;
    const adultComponent = roundTo10(
      adultBase * component.rate + component.fixed[segment.schedule.distanceBand],
    );
    const base = roundTo10(adultBase * share);
    const extra = roundTo10(adultComponent * share);
    baseFare += base;
    fareComponent += extra;
    charges.push(...segmentCharges(segment, base + extra, type !== 'infant'));
  }
  return { baseFare, fareComponent, charges: mergeCharges(charges) };
}

export const PASSENGER_TYPES: readonly [PricedPassengerType, keyof PassengerCounts][] = [
  ['adult', 'adults'],
  ['child', 'children'],
  ['infant', 'infants'],
];

/**
 * Indicative price for an itinerary (one or two flights) in one cabin for a
 * party of passengers. Includes every simulated mandatory charge.
 */
export function priceItinerary(
  segments: readonly FlightInstance[],
  cabin: CabinClass,
  passengers: PassengerCounts,
): IndicativePrice {
  const priceFor = (type: PricedPassengerType, count: number): PriceBreakdownItem => {
    const { baseFare, charges } = pricePassengerType(segments, cabin, type);
    const fareMinor = baseFare * MINOR_PER_PESO;
    const chargesMinor = charges.reduce((sum, charge) => sum + charge.amountMinor, 0);
    return {
      passengerType: type,
      count,
      fareMinor,
      chargesMinor,
      charges,
      subtotalMinor: count * (fareMinor + chargesMinor),
    };
  };

  const adult = priceFor('adult', 1);
  const breakdown = PASSENGER_TYPES.filter(([, key]) => passengers[key] > 0).map(([type, key]) =>
    priceFor(type, passengers[key]),
  );

  return {
    kind: 'indicative',
    currency: PRICING_CURRENCY,
    perAdultMinor: adult.fareMinor + adult.chargesMinor,
    totalMinor: breakdown.reduce((sum, item) => sum + item.subtotalMinor, 0),
    breakdown,
  };
}
