import 'server-only';
import {
  DEFAULT_PAGE_SIZE,
  addDays,
  toFlightFilters,
  type FareCalendarResponse,
  type FlightSearch,
  type FlightSearchQuery,
  type FlightSearchResponse,
  type ItineraryResponse,
  type JourneyDirection,
  type ResultsState,
} from '@velasia/contracts';
import { cache } from 'react';
import {
  RetailingApiError,
  retailingApi,
  type RetailingApiErrorKind,
} from '@/lib/retailing-api/client';
import { logUpstreamFailure } from '@/lib/observability';

export const PRICE_CURRENCY = 'PHP';

export type Loaded<T> =
  { ok: true; data: T } | { ok: false; error: RetailingApiErrorKind; message?: string };

/** Turn retailing API failures into values, so a section can render its own error state. */
async function load<T>(label: string, run: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    logUpstreamFailure('flights', label, error);
    return {
      ok: false,
      error: error.kind,
      ...(error.kind === 'rejected' ? { message: error.message } : {}),
    };
  }
}

/** The API query for one direction of the traveller's search. */
export function legQuery(
  search: FlightSearch,
  state: ResultsState,
  direction: JourneyDirection,
): FlightSearchQuery {
  const roundTrip = search.tripType === 'round-trip' && search.returnDate;
  return {
    origin: search.origin,
    destination: search.destination,
    departureDate: search.departDate,
    ...(roundTrip ? { returnDate: search.returnDate, leg: direction } : {}),
    ...(roundTrip && direction === 'inbound' && state.outboundId
      ? { outboundId: state.outboundId }
      : {}),
    passengers: search.passengers,
    cabin: search.cabin,
    filters: toFlightFilters(state.filters, PRICE_CURRENCY),
    sort: state.sort,
    page: state.page,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

export function searchLeg(
  search: FlightSearch,
  state: ResultsState,
  direction: JourneyDirection,
): Promise<Loaded<FlightSearchResponse>> {
  return load(`search ${direction}`, () =>
    retailingApi.searchFlights(legQuery(search, state, direction)),
  );
}

/** Deduplicated per request: the selected flight may be shown in more than one section. */
export const loadItinerary = cache(
  (id: string, search: FlightSearch): Promise<Loaded<ItineraryResponse | null>> =>
    load(`itinerary ${id}`, () =>
      retailingApi.getItinerary(id, { passengers: search.passengers, cabin: search.cabin }),
    ),
);

/** Lowest fares for the days around `date` (three either side). */
export function loadNearbyDates(
  search: FlightSearch,
  direction: JourneyDirection,
  date: string,
): Promise<Loaded<FareCalendarResponse>> {
  const outbound = direction === 'outbound';
  return load(`calendar ${direction}`, () =>
    retailingApi.getFareCalendar({
      origin: outbound ? search.origin : search.destination,
      destination: outbound ? search.destination : search.origin,
      startDate: addDays(date, -3),
      days: 7,
      passengers: search.passengers,
      cabin: search.cabin,
    }),
  );
}
