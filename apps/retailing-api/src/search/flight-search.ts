import {
  MAX_STOPS,
  departureWindowFor,
  totalSeated,
  type CabinClass,
  type EmptyReason,
  type FlightFilters,
  type FlightSort,
  type Itinerary,
  type JourneyDirection,
  type LegResult,
  type PassengerCounts,
  type SearchFacets,
} from '@aeronova/contracts';
import { AIRCRAFT_BY_CODE } from '../fixtures/aircraft';
import { cabinInventory, seatsAvailable, type Inventory } from '../inventory/inventory';
import { toItinerary } from '../serialization';
import { buildCandidates, isServed, type Candidate } from './itineraries';

/** Online sales close this long before departure. */
export const SALES_CUTOFF_MINUTES = 60;

export interface LegSearch {
  direction: JourneyDirection;
  origin: string;
  destination: string;
  date: string;
  passengers: PassengerCounts;
  cabin: CabinClass;
  filters: FlightFilters;
  sort: FlightSort;
  page: number;
  pageSize: number;
  /** Only itineraries departing at or after this instant (e.g. after the outbound lands). */
  notBeforeUtc?: number;
}

export interface SellableResult {
  itineraries: Itinerary[];
  emptyReason: Exclude<EmptyReason, 'filtered-out'> | null;
}

function isOpenForSale(candidate: Candidate, now: number, notBeforeUtc = 0): boolean {
  const first = candidate.segments[0]!;
  return (
    candidate.segments.every((segment) => segment.status === 'scheduled') &&
    first.departureUtc >= Math.max(now + SALES_CUTOFF_MINUTES * 60_000, notBeforeUtc)
  );
}

/**
 * Every itinerary that can be sold for this date, cabin, and party — before
 * the traveller's filters — plus the reason when there are none.
 */
export function findSellable(
  inventory: Inventory,
  now: number,
  search: Pick<
    LegSearch,
    'origin' | 'destination' | 'date' | 'passengers' | 'cabin' | 'notBeforeUtc'
  > & {
    maxStops?: number;
  },
): SellableResult {
  const { origin, destination, date, cabin, passengers } = search;
  const none = (emptyReason: SellableResult['emptyReason']): SellableResult => ({
    itineraries: [],
    emptyReason,
  });
  if (!isServed(inventory, origin, destination)) return none('no-route');
  if (!inventory.isWithinSchedule(date)) return none('beyond-schedule');

  const candidates = buildCandidates(
    inventory,
    origin,
    destination,
    date,
    search.maxStops ?? MAX_STOPS,
  );
  if (candidates.length === 0) return none('no-flights-on-date');

  const withCabin = candidates.filter((candidate) =>
    candidate.segments.every((segment) => cabinInventory(segment, cabin) !== undefined),
  );
  if (withCabin.length === 0) return none('cabin-not-offered');

  const open = withCabin.filter((candidate) => isOpenForSale(candidate, now, search.notBeforeUtc));
  if (open.length === 0) return none('no-flights-on-date');

  const seatsNeeded = totalSeated(passengers);
  const withSeats = open.filter((candidate) =>
    candidate.segments.every((segment) => seatsAvailable(segment, cabin) >= seatsNeeded),
  );
  if (withSeats.length === 0) return none('insufficient-seats');

  return {
    itineraries: withSeats.map((candidate) => toItinerary(candidate, cabin, passengers)),
    emptyReason: null,
  };
}

function matchesFilters(itinerary: Itinerary, filters: FlightFilters): boolean {
  if (filters.maxStops !== undefined && itinerary.stops > filters.maxStops) return false;
  if (
    filters.departureWindows.length > 0 &&
    !filters.departureWindows.includes(departureWindowFor(itinerary.departure.time))
  ) {
    return false;
  }
  const price = itinerary.price.perAdultMinor;
  if (filters.minPriceMinor !== undefined && price < filters.minPriceMinor) return false;
  if (filters.maxPriceMinor !== undefined && price > filters.maxPriceMinor) return false;
  if (
    filters.aircraft.length > 0 &&
    !itinerary.segments.every((segment) => filters.aircraft.includes(segment.aircraft.code))
  ) {
    return false;
  }
  return true;
}

const departs = (itinerary: Itinerary) => Date.parse(itinerary.departure.at);
const COMPARATORS: Record<FlightSort, (a: Itinerary, b: Itinerary) => number> = {
  departure_asc: (a, b) => departs(a) - departs(b) || a.durationMinutes - b.durationMinutes,
  departure_desc: (a, b) => departs(b) - departs(a) || a.durationMinutes - b.durationMinutes,
  price_asc: (a, b) => a.price.perAdultMinor - b.price.perAdultMinor || departs(a) - departs(b),
  duration_asc: (a, b) =>
    a.durationMinutes - b.durationMinutes || a.price.perAdultMinor - b.price.perAdultMinor,
};

export function sortItineraries(itineraries: Itinerary[], sort: FlightSort): Itinerary[] {
  // The id makes the order total, so equal itineraries never swap between requests.
  return [...itineraries].sort((a, b) => COMPARATORS[sort](a, b) || a.id.localeCompare(b.id));
}

function countBy<T>(items: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

export function buildFacets(itineraries: readonly Itinerary[]): SearchFacets {
  const prices = itineraries.map((itinerary) => itinerary.price.perAdultMinor);
  const aircraftCodes = itineraries.flatMap((itinerary) => [
    ...new Set(itinerary.segments.map((segment) => segment.aircraft.code)),
  ]);
  return {
    stops: [...countBy(itineraries.map((itinerary) => itinerary.stops))]
      .sort(([a], [b]) => a - b)
      .map(([stops, count]) => ({ stops, count })),
    departureWindows: [...countBy(itineraries.map((it) => departureWindowFor(it.departure.time)))]
      .map(([window, count]) => ({ window, count }))
      .sort((a, b) => a.window.localeCompare(b.window)),
    aircraft: [...countBy(aircraftCodes)]
      .map(([code, count]) => ({ code, name: AIRCRAFT_BY_CODE.get(code)!.name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    price:
      prices.length > 0 ? { minMinor: Math.min(...prices), maxMinor: Math.max(...prices) } : null,
  };
}

/** One direction of a search: sellable itineraries, filtered, sorted, and paginated. */
export function searchLeg(inventory: Inventory, now: number, leg: LegSearch): LegResult {
  const sellable = findSellable(inventory, now, leg);
  const matching = sortItineraries(
    sellable.itineraries.filter((itinerary) => matchesFilters(itinerary, leg.filters)),
    leg.sort,
  );
  const totalPages = Math.ceil(matching.length / leg.pageSize);
  const start = (leg.page - 1) * leg.pageSize;
  return {
    direction: leg.direction,
    origin: leg.origin,
    destination: leg.destination,
    date: leg.date,
    itineraries: matching.slice(start, start + leg.pageSize),
    pagination: {
      page: leg.page,
      pageSize: leg.pageSize,
      totalItems: matching.length,
      totalPages,
    },
    summary: {
      availableItineraries: sellable.itineraries.length,
      matchingItineraries: matching.length,
      lowestPerAdultMinor:
        matching.length > 0 ? Math.min(...matching.map((it) => it.price.perAdultMinor)) : null,
      emptyReason: sellable.emptyReason ?? (matching.length === 0 ? 'filtered-out' : null),
      facets: buildFacets(sellable.itineraries),
    },
  };
}
