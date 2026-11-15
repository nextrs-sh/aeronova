import {
  buildResultsHref,
  requiredDirections,
  slotLabel,
  travellerName,
  type BookingStep,
  type FlightSegment,
  type JourneyDirection,
  type Selection,
  type ShoppingSession,
  type TravellerRulesContext,
} from '@velasia/contracts';
import type { Route } from 'next';
import { summaryHref } from '@/features/flights/journey';

/*
 * Reading a shopping session for the booking steps. Pure functions over the API's session:
 * nothing here prices anything or decides eligibility.
 */

export const STEP_HREF: Record<BookingStep | 'checkout', Route> = {
  travellers: '/booking/travellers' as Route,
  seats: '/booking/seats' as Route,
  extras: '/booking/extras' as Route,
  review: '/booking/review' as Route,
  checkout: '/booking/checkout' as Route,
};

/** The selected offers the trip needs, in trip order (only those chosen). */
export function tripSelections(session: ShoppingSession): Selection[] {
  return requiredDirections(session.search).flatMap((direction) => {
    const selection = session.selections[direction];
    return selection ? [selection] : [];
  });
}

export interface TripSegment {
  direction: JourneyDirection;
  segment: FlightSegment;
}

export function tripSegments(session: ShoppingSession): TripSegment[] {
  return tripSelections(session).flatMap((selection) =>
    selection.offer.itinerary.segments.map((segment) => ({
      direction: selection.direction,
      segment,
    })),
  );
}

/** The dates the traveller rules use: first and last local departure dates. */
export function travellerRules(session: ShoppingSession): TravellerRulesContext {
  const selections = tripSelections(session);
  return {
    slots: session.booking.slots,
    firstTravelDate: selections[0]?.offer.itinerary.departure.date ?? session.search.departDate,
    lastTravelDate:
      selections.at(-1)?.offer.itinerary.segments.at(-1)?.departure.date ??
      session.search.returnDate ??
      session.search.departDate,
  };
}

/** `Amihan Dela Cruz`, or `Adult 1` before details are saved. */
export function travellerDisplayName(session: ShoppingSession, id: string): string {
  const traveller = session.booking.passengers?.find((passenger) => passenger.id === id);
  return traveller ? travellerName(traveller) : slotLabel(id);
}

/** Back to the M3 trip summary for this session's selection (or the results to start again). */
export function tripSummaryHref(session: ShoppingSession): Route {
  const outbound = session.selections.outbound;
  if (!outbound) return buildResultsHref(session.search, {}) as Route;
  return summaryHref(
    session.search,
    'departure_asc',
    outbound.offer.itineraryId,
    session.selections.inbound?.offer.itineraryId,
  );
}

/** Where to resume: the first booking step that isn't complete, or the trip summary. */
export function resumeTarget(session: ShoppingSession): { href: Route; label: string } {
  const { steps } = session.booking;
  if (steps.travellers === 'locked') {
    return { href: tripSummaryHref(session), label: 'Back to your trip summary' };
  }
  for (const step of ['travellers', 'seats', 'extras', 'review'] as const) {
    if (steps[step] === 'open') return { href: STEP_HREF[step], label: RESUME_LABEL[step] };
  }
  return { href: STEP_HREF.review, label: RESUME_LABEL.review };
}

const RESUME_LABEL: Record<BookingStep, string> = {
  travellers: 'Continue with traveller details',
  seats: 'Continue with seats',
  extras: 'Continue with extras',
  review: 'Go to your booking review',
};
