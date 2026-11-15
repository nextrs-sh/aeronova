import {
  buildResultsHref,
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
 * Compare fares for one itinerary in the current step. The rest of the results state (filters,
 * sort, page) is kept, so "Back to flights" returns to the same list.
 */
export function faresHref(search: FlightSearch, state: ResultsState, itineraryId: string): Route {
  return href(search, { ...state, inboundId: undefined, faresId: itineraryId });
}

/** Leave the fare comparison, back to the results it was opened from. */
export function backToResultsHref(search: FlightSearch, state: ResultsState): Route {
  return href(search, { ...state, faresId: undefined });
}

/** Compare fares again for a flight already chosen, e.g. from the trip summary. */
export function changeFareHref(
  search: FlightSearch,
  state: Pick<ResultsState, 'sort' | 'outboundId'>,
  direction: JourneyDirection,
  itineraryId: string,
): Route {
  return direction === 'outbound'
    ? href(search, { sort: state.sort, faresId: itineraryId })
    : href(search, { sort: state.sort, outboundId: state.outboundId, faresId: itineraryId });
}

/** The trip summary for chosen flights. */
export function summaryHref(
  search: FlightSearch,
  sort: ResultsState['sort'],
  outboundId: string,
  inboundId?: string,
): Route {
  return href(search, {
    sort,
    outboundId,
    ...(search.tripType === 'round-trip' && inboundId ? { inboundId } : {}),
  });
}

/**
 * Where to go once a fare is chosen: the return flights next, unless a return that still fits
 * is already chosen — then (as for one-way trips and returns) the trip summary.
 */
export function afterSelectionHref(
  search: FlightSearch,
  sort: ResultsState['sort'],
  chosen: { outbound?: string; inbound?: string },
): Route {
  if (!chosen.outbound) return href(search, { sort });
  if (search.tripType === 'round-trip' && !chosen.inbound) {
    return href(search, { sort, outboundId: chosen.outbound });
  }
  return summaryHref(search, sort, chosen.outbound, chosen.inbound);
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
