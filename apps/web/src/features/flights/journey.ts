import {
  DEFAULT_RESULTS_STATE,
  buildResultsHref,
  serializeFlightSearch,
  serializeResultsState,
  type FlightSearch,
  type JourneyDirection,
  type ResultsState,
} from '@velasia/contracts';
import type { Route } from 'next';

/** Where the traveller is in choosing flights. */
export type JourneyStage = JourneyDirection | 'review';

export function journeyStage(search: FlightSearch, state: ResultsState): JourneyStage {
  if (!state.outboundId) return 'outbound';
  if (search.tripType === 'round-trip' && !state.inboundId) return 'inbound';
  return 'review';
}

/** The local date being browsed for a direction. */
export function legDate(search: FlightSearch, direction: JourneyDirection): string {
  return direction === 'inbound' ? search.returnDate! : search.departDate;
}

export function legRoute(search: FlightSearch, direction: JourneyDirection) {
  return direction === 'inbound'
    ? { origin: search.destination, destination: search.origin }
    : { origin: search.origin, destination: search.destination };
}

const href = (search: FlightSearch, state: Partial<ResultsState>) =>
  buildResultsHref(search, state) as Route;

/**
 * Selecting a flight moves to the next step. Filters belong to the leg they
 * were set on, so they reset; the sort order carries over.
 */
export function selectHref(
  search: FlightSearch,
  state: ResultsState,
  direction: JourneyDirection,
  itineraryId: string,
): Route {
  const next = { ...DEFAULT_RESULTS_STATE, sort: state.sort };
  return direction === 'outbound'
    ? href(search, { ...next, outboundId: itineraryId })
    : href(search, { ...next, outboundId: state.outboundId, inboundId: itineraryId });
}

/** Back to choosing a direction's flight, keeping earlier choices. */
export function changeHref(
  search: FlightSearch,
  state: ResultsState,
  direction: JourneyDirection,
): Route {
  return direction === 'outbound'
    ? href(search, { sort: state.sort })
    : href(search, { sort: state.sort, outboundId: state.outboundId });
}

/** The same step with a different date for one direction. Later selections are cleared. */
export function dateHref(
  search: FlightSearch,
  state: ResultsState,
  direction: JourneyDirection,
  date: string,
): Route {
  const moved: FlightSearch =
    direction === 'outbound' ? { ...search, departDate: date } : { ...search, returnDate: date };
  return direction === 'outbound'
    ? href(moved, { sort: state.sort, filters: state.filters })
    : href(moved, { sort: state.sort, filters: state.filters, outboundId: state.outboundId });
}

export function resultsHref(search: FlightSearch, state: ResultsState): Route {
  return href(search, state);
}

/** The fare-selection preview for the chosen flights. */
export function faresHref(search: FlightSearch, state: ResultsState): Route {
  const params = serializeResultsState(
    { ...DEFAULT_RESULTS_STATE, outboundId: state.outboundId, inboundId: state.inboundId },
    serializeFlightSearch(search),
  );
  return `/flights/fares?${params}` as Route;
}
