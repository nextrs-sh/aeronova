import { majorToMinor } from './common';
import {
  DEFAULT_FLIGHT_SORT,
  MAX_STOPS,
  departureWindowSchema,
  flightSortSchema,
  itineraryIdSchema,
  type DepartureWindow,
  type FlightFilters,
  type FlightSort,
} from './flights';
import { aircraftCodeSchema } from './network';
import { serializeFlightSearch, type FlightSearch, type SearchParamsInput } from './search';

/*
 * `/flights` results state in the URL: selections, filters, sort, and page.
 * The URL is the single source of truth, so results are shareable and the
 * browser's back and forward buttons move between steps.
 */

export const RESULTS_PARAM_KEYS = {
  outboundId: 'out',
  inboundId: 'ret',
  maxStops: 'stops',
  departureWindows: 'times',
  /** Whole currency units (pesos) per adult — friendlier in a URL than minor units. */
  maxPrice: 'maxPrice',
  aircraft: 'aircraft',
  sort: 'sort',
  page: 'page',
} as const;

export interface ResultsFilters {
  maxStops?: number;
  departureWindows: DepartureWindow[];
  /** Whole currency units per adult. */
  maxPrice?: number;
  aircraft: string[];
}

export interface ResultsState {
  outboundId?: string;
  inboundId?: string;
  filters: ResultsFilters;
  sort: FlightSort;
  page: number;
}

export const EMPTY_RESULTS_FILTERS: ResultsFilters = { departureWindows: [], aircraft: [] };

export const DEFAULT_RESULTS_STATE: ResultsState = {
  filters: EMPTY_RESULTS_FILTERS,
  sort: DEFAULT_FLIGHT_SORT,
  page: 1,
};

function read(params: SearchParamsInput, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export interface ParsedResultsState {
  state: ResultsState;
  /** URL keys whose values were not understood and were reset. */
  ignored: string[];
}

/** Parse results state leniently: unknown values are dropped and reported, never guessed. */
export function parseResultsParams(params: SearchParamsInput): ParsedResultsState {
  const K = RESULTS_PARAM_KEYS;
  const ignored = new Set<string>();
  const state: ResultsState = {
    filters: { departureWindows: [], aircraft: [] },
    sort: DEFAULT_FLIGHT_SORT,
    page: 1,
  };

  for (const key of ['outboundId', 'inboundId'] as const) {
    const value = read(params, K[key]);
    if (value === undefined || value === '') continue;
    if (itineraryIdSchema.safeParse(value).success) state[key] = value;
    else ignored.add(K[key]);
  }
  if (!state.outboundId && state.inboundId) {
    delete state.inboundId;
    ignored.add(K.inboundId);
  }

  const stops = read(params, K.maxStops);
  if (stops !== undefined && stops !== '') {
    if (/^\d$/.test(stops) && Number(stops) <= MAX_STOPS) state.filters.maxStops = Number(stops);
    else ignored.add(K.maxStops);
  }

  const times = read(params, K.departureWindows);
  if (times) {
    for (const item of new Set(times.split(','))) {
      const parsed = departureWindowSchema.safeParse(item);
      if (parsed.success) state.filters.departureWindows.push(parsed.data);
      else ignored.add(K.departureWindows);
    }
  }

  const maxPrice = read(params, K.maxPrice);
  if (maxPrice !== undefined && maxPrice !== '') {
    if (/^\d{1,7}$/.test(maxPrice) && Number(maxPrice) > 0)
      state.filters.maxPrice = Number(maxPrice);
    else ignored.add(K.maxPrice);
  }

  const aircraft = read(params, K.aircraft);
  if (aircraft) {
    for (const item of new Set(aircraft.toUpperCase().split(','))) {
      if (aircraftCodeSchema.safeParse(item).success) state.filters.aircraft.push(item);
      else ignored.add(K.aircraft);
    }
  }

  const sort = read(params, K.sort);
  if (sort !== undefined && sort !== '') {
    const parsed = flightSortSchema.safeParse(sort);
    if (parsed.success) state.sort = parsed.data;
    else ignored.add(K.sort);
  }

  const page = read(params, K.page);
  if (page !== undefined && page !== '') {
    if (/^\d{1,3}$/.test(page) && Number(page) >= 1) state.page = Number(page);
    else ignored.add(K.page);
  }

  return { state, ignored: [...ignored] };
}

/** Results state as URL parameters; defaults are omitted to keep links short. */
export function serializeResultsState(state: ResultsState, into = new URLSearchParams()) {
  const K = RESULTS_PARAM_KEYS;
  if (state.outboundId) into.set(K.outboundId, state.outboundId);
  if (state.outboundId && state.inboundId) into.set(K.inboundId, state.inboundId);
  const { filters } = state;
  if (filters.maxStops !== undefined) into.set(K.maxStops, String(filters.maxStops));
  if (filters.departureWindows.length > 0) {
    into.set(K.departureWindows, filters.departureWindows.join(','));
  }
  if (filters.maxPrice !== undefined) into.set(K.maxPrice, String(filters.maxPrice));
  if (filters.aircraft.length > 0) into.set(K.aircraft, filters.aircraft.join(','));
  if (state.sort !== DEFAULT_FLIGHT_SORT) into.set(K.sort, state.sort);
  if (state.page > 1) into.set(K.page, String(state.page));
  return into;
}

/** `/flights?…` for a search plus results state. */
export function buildResultsHref(search: FlightSearch, state: Partial<ResultsState> = {}): string {
  const params = serializeResultsState(
    { ...DEFAULT_RESULTS_STATE, ...state },
    serializeFlightSearch(search),
  );
  return `/flights?${params.toString()}`;
}

export function hasActiveFilters(filters: ResultsFilters): boolean {
  return (
    filters.maxStops !== undefined ||
    filters.departureWindows.length > 0 ||
    filters.maxPrice !== undefined ||
    filters.aircraft.length > 0
  );
}

/** Convert URL filters into the API's filter shape (prices in minor units). */
export function toFlightFilters(filters: ResultsFilters, currency: string): FlightFilters {
  return {
    departureWindows: filters.departureWindows,
    aircraft: filters.aircraft,
    ...(filters.maxStops !== undefined ? { maxStops: filters.maxStops } : {}),
    ...(filters.maxPrice !== undefined
      ? { maxPriceMinor: majorToMinor(filters.maxPrice, currency) }
      : {}),
  };
}
