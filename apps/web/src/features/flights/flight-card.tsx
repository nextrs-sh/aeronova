import { CABIN_LABELS, type Itinerary, type PassengerCounts } from '@aeronova/contracts';
import { Button } from '@aeronova/ui/button';
import { ArrowRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { FlightDetails } from './flight-details';
import { AirlineMark, FlightTimes, PriceBlock, cityOf, type AirportNames } from './itinerary-parts';

/** Seat counts are shown only when they help a decision. */
const LOW_SEATS = 9;

interface FlightCardProps {
  itinerary: Itinerary;
  passengers: PassengerCounts;
  airports: AirportNames;
  selectHref: Route;
  selectLabel: string;
}

/** One itinerary in the results: schedule first, then duration and stops, then price and action. */
export function FlightCard({
  itinerary,
  passengers,
  airports,
  selectHref,
  selectLabel,
}: FlightCardProps) {
  const headingId = `flight-${itinerary.id}`;
  const aircraft = [...new Set(itinerary.segments.map((segment) => segment.aircraft.name))];
  return (
    <article
      aria-labelledby={headingId}
      className="group rounded-[1.5rem] border border-line bg-white shadow-card transition-shadow focus-within:ring-2 focus-within:ring-navy-200"
      data-testid="flight-card"
    >
      <h3 id={headingId} className="sr-only">
        {cityOf(airports, itinerary.origin)} to {cityOf(airports, itinerary.destination)}, departs{' '}
        {itinerary.departure.time}, arrives {itinerary.arrival.time}
      </h3>
      <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_13rem] md:gap-0 md:p-0">
        <div className="min-w-0 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <AirlineMark
              flightNumbers={itinerary.segments.map((segment) => segment.flightNumber)}
            />
            <p className="text-xs text-ink-muted">{aircraft.join(' + ')}</p>
          </div>
          <div className="mt-4">
            <FlightTimes itinerary={itinerary} airports={airports} />
          </div>
          <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
            <span>{CABIN_LABELS[itinerary.cabin]}</span>
            {itinerary.seatsAvailable <= LOW_SEATS ? (
              <span className="font-semibold text-ember-700">
                {itinerary.seatsAvailable === 1
                  ? 'Last seat at this price'
                  : `${itinerary.seatsAvailable} seats left`}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-line pt-4 md:flex-col md:items-stretch md:justify-center md:border-t-0 md:border-l md:p-6">
          <PriceBlock price={itinerary.price} passengers={passengers} align="start" />
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
            <Button asChild size="md">
              <Link href={selectHref}>
                {selectLabel}
                <span className="sr-only">
                  {' '}
                  {cityOf(airports, itinerary.origin)} {itinerary.departure.time} flight
                </span>
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <FlightDetails
              itinerary={itinerary}
              passengers={passengers}
              airports={airports}
              selectHref={selectHref}
              selectLabel={selectLabel}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
