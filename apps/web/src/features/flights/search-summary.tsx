import {
  CABIN_LABELS,
  TRIP_TYPE_LABELS,
  formatPassengerSummary,
  formatTravelDate,
  type Airport,
  type FlightSearch,
} from '@velasia/contracts';
import { ArrowLeftRight, ArrowRight, Armchair, CalendarDays, Users } from 'lucide-react';
import type { ReactNode } from 'react';

interface SearchSummaryProps {
  search: FlightSearch;
  airportsByCode: Map<string, Airport>;
  /** Rendered beside the summary, e.g. the "Edit search" control. */
  action?: ReactNode;
}

function Place({
  code,
  airport,
  align,
}: {
  code: string;
  airport?: Airport;
  align: 'start' | 'end';
}) {
  return (
    <span className={align === 'end' ? 'min-w-0 text-right sm:text-left' : 'min-w-0'}>
      <span className="block font-display text-3xl leading-none font-extrabold sm:text-4xl">
        {code}
      </span>
      <span className="mt-1.5 block text-sm font-semibold text-white">{airport?.city ?? code}</span>
      {airport ? (
        <span className="block text-xs leading-snug break-words text-navy-200">{airport.name}</span>
      ) : null}
    </span>
  );
}

/** Read-only summary of a validated search, rendered on the server. */
export function SearchSummary({ search, airportsByCode, action }: SearchSummaryProps) {
  const origin = airportsByCode.get(search.origin);
  const destination = airportsByCode.get(search.destination);
  const roundTrip = search.tripType === 'round-trip';
  const RouteIcon = roundTrip ? ArrowLeftRight : ArrowRight;
  const dates = search.returnDate
    ? `${formatTravelDate(search.departDate)} – ${formatTravelDate(search.returnDate)}`
    : formatTravelDate(search.departDate);

  return (
    <section
      id="search-summary"
      aria-labelledby="summary-heading"
      className="scroll-mt-24"
      data-testid="search-summary"
    >
      <h2 id="summary-heading" className="sr-only">
        Your search
      </h2>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <p className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 sm:flex sm:w-auto sm:gap-6">
          <Place code={search.origin} airport={origin} align="start" />
          <RouteIcon
            className="mt-1.5 size-7 shrink-0 text-ember-300"
            aria-label={roundTrip ? 'round trip to' : 'to'}
          />
          <Place code={search.destination} airport={destination} align="end" />
        </p>
        {/* `contents`: the action's button and panel join this row's flex layout. */}
        {action ? <div className="contents">{action}</div> : null}
        <ul className="flex basis-full flex-wrap gap-2 text-sm" aria-label="Search details">
          <Chip icon={<RouteIcon />}>{TRIP_TYPE_LABELS[search.tripType]}</Chip>
          <Chip icon={<CalendarDays />}>{dates}</Chip>
          <Chip icon={<Users />}>{formatPassengerSummary(search.passengers)}</Chip>
          <Chip icon={<Armchair />}>{CABIN_LABELS[search.cabin]}</Chip>
        </ul>
      </div>
    </section>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 font-medium text-white ring-1 ring-white/15 [&_svg]:size-4 [&_svg]:text-navy-200">
      <span aria-hidden="true">{icon}</span>
      {children}
    </li>
  );
}
