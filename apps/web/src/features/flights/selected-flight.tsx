import { formatTravelDate, type FlightSearch, type JourneyDirection } from '@velasia/contracts';
import { Check } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { loadItinerary } from './data';
import { AirlineMark, FlightTimes, PriceBlock, cityOf, type AirportNames } from './itinerary-parts';
import { SectionNotice } from './results-states';

interface SelectedFlightProps {
  id: string;
  search: FlightSearch;
  direction: JourneyDirection;
  airports: AirportNames;
  changeHref: Route;
}

/** A flight the traveller has already chosen, with a way to change it. */
export async function SelectedFlight({
  id,
  search,
  direction,
  airports,
  changeHref,
}: SelectedFlightProps) {
  const result = await loadItinerary(id, search);
  const label = direction === 'outbound' ? 'Departing flight' : 'Return flight';
  if (!result.ok || !result.data) {
    return (
      <SectionNotice>
        {result.ok
          ? 'Your selected flight is no longer available.'
          : 'We couldn’t load your selected flight.'}{' '}
        <Link href={changeHref} className="font-semibold text-navy-700 underline">
          Choose again
        </Link>
      </SectionNotice>
    );
  }
  const itinerary = result.data.data;
  return (
    <section
      aria-label={`${label}: selected`}
      className="rounded-[1.5rem] border border-navy-100 bg-navy-50/60 p-4 sm:p-5"
      data-testid={`selected-${direction}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-bold text-navy-800">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-success text-white">
            <Check className="size-3.5" aria-hidden="true" />
          </span>
          {label} · {formatTravelDate(itinerary.departure.date)} ·{' '}
          {cityOf(airports, itinerary.origin)} to {cityOf(airports, itinerary.destination)}
        </p>
        <Link
          href={changeHref}
          className="text-sm font-semibold text-navy-700 underline-offset-4 hover:underline"
        >
          Change<span className="sr-only"> {label.toLowerCase()}</span>
        </Link>
      </div>
      <div className="mt-4 grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
        <div>
          <AirlineMark
            flightNumbers={itinerary.segments.map((s) => s.flightNumber)}
            className="mb-3"
          />
          <FlightTimes itinerary={itinerary} airports={airports} size="md" />
        </div>
        <PriceBlock price={itinerary.price} passengers={search.passengers} />
      </div>
    </section>
  );
}
