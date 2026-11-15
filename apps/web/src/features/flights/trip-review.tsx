import {
  formatPassengerSummary,
  formatTravelDate,
  type FlightSearch,
  type ItineraryDetail,
  type JourneyDirection,
  type ResultsState,
} from '@aeronova/contracts';
import { Badge } from '@aeronova/ui/badge';
import { Button } from '@aeronova/ui/button';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { formatMinor } from '@/lib/format';
import { loadItinerary } from './data';
import {
  AirlineMark,
  FlightTimes,
  PriceBreakdown,
  cityOf,
  type AirportNames,
} from './itinerary-parts';
import { changeHref, faresHref } from './journey';
import { ResultsError } from './results-states';

interface TripReviewProps {
  search: FlightSearch;
  state: ResultsState;
  airports: AirportNames;
}

/**
 * Review the chosen flights with a transparent indicative total: the sum of
 * each direction's price, as calculated by the retailing API.
 */
export async function TripReview({ search, state, airports }: TripReviewProps) {
  const ids: [JourneyDirection, string][] = [['outbound', state.outboundId!]];
  if (search.tripType === 'round-trip' && state.inboundId) ids.push(['inbound', state.inboundId]);
  // Both lookups run in parallel.
  const results = await Promise.all(ids.map(([, id]) => loadItinerary(id, search)));

  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) return <ResultsError kind={failed.error} message={failed.message} />;
  const legs = results.map((result, index) => ({
    direction: ids[index]![0],
    itinerary: result.ok ? result.data?.data : undefined,
  }));
  const missing = legs.find((leg) => !leg.itinerary);
  if (missing) {
    return (
      <ResultsError
        kind="not-found"
        message="One of your selected flights no longer exists. Please choose again."
      />
    );
  }
  const chosen = legs as { direction: JourneyDirection; itinerary: ItineraryDetail }[];
  const unavailable = chosen.find((leg) => leg.itinerary.availability !== 'available');
  const currency = chosen[0]!.itinerary.price.currency;
  const total = chosen.reduce((sum, leg) => sum + leg.itinerary.price.totalMinor, 0);

  return (
    <section
      aria-labelledby="review-heading"
      data-testid="trip-review"
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <div className="space-y-4">
        <h2 id="review-heading" className="font-display text-2xl font-bold text-ink">
          Review your flights
        </h2>
        {chosen.map(({ direction, itinerary }) => (
          <article
            key={direction}
            className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-bold text-ink">
                {direction === 'outbound' ? 'Departing' : 'Returning'} ·{' '}
                {formatTravelDate(itinerary.departure.date)} · {cityOf(airports, itinerary.origin)}{' '}
                to {cityOf(airports, itinerary.destination)}
              </p>
              <Link
                href={changeHref(search, state, direction)}
                className="text-sm font-semibold text-navy-700 underline-offset-4 hover:underline"
              >
                Change
                <span className="sr-only">
                  {' '}
                  {direction === 'outbound' ? 'departing' : 'return'} flight
                </span>
              </Link>
            </div>
            <AirlineMark
              flightNumbers={itinerary.segments.map((s) => s.flightNumber)}
              className="mt-4 mb-3"
            />
            <FlightTimes itinerary={itinerary} airports={airports} size="md" />
            <p className="mt-4 text-right text-sm text-ink-muted">
              {formatMinor(itinerary.price.totalMinor, currency)}{' '}
              <span className="text-ink-subtle">indicative, all passengers</span>
            </p>
          </article>
        ))}
      </div>

      <aside
        aria-labelledby="total-heading"
        className="h-fit rounded-[1.5rem] border border-line bg-white p-5 shadow-card lg:sticky lg:top-24"
      >
        <Badge tone="ember">Indicative price</Badge>
        <h2 id="total-heading" className="mt-3 text-sm font-semibold text-ink-muted">
          Total for {formatPassengerSummary(search.passengers).toLowerCase()}
        </h2>
        <p
          className="font-display text-3xl font-extrabold text-ink tabular-nums"
          data-testid="trip-total"
        >
          {formatMinor(total, currency)}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          {chosen.length === 2 ? 'Departing plus return flight. ' : ''}Includes all simulated
          mandatory taxes and charges. Not an offer; not guaranteed.
        </p>
        <div className="mt-5 space-y-5">
          {chosen.map(({ direction, itinerary }) => (
            <PriceBreakdown
              key={direction}
              price={itinerary.price}
              title={
                chosen.length === 2
                  ? direction === 'outbound'
                    ? 'Departing flight'
                    : 'Return flight'
                  : undefined
              }
            />
          ))}
        </div>
        {unavailable ? (
          <p
            role="alert"
            className="mt-5 flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            One of these flights can no longer be sold for your party. Please change it.
          </p>
        ) : (
          <Button asChild size="lg" className="mt-6 w-full">
            <Link href={faresHref(search, state)}>
              Continue to fare options
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        )}
        <p className="mt-3 text-center text-xs text-ink-muted">Nothing is reserved yet.</p>
      </aside>
    </section>
  );
}
