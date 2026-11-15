import {
  CABIN_LABELS,
  TRIP_TYPE_LABELS,
  formatPassengerSummary,
  formatTravelDate,
  type Airport,
  type FlightSearch,
} from '@aeronova/contracts';
import { ArrowRight, ArrowLeftRight, CalendarDays, Armchair, Users } from 'lucide-react';

interface SearchSummaryProps {
  search: FlightSearch;
  airportsByCode: Map<string, Airport>;
}

/** Read-only summary of a validated search, rendered on the server. */
export function SearchSummary({ search, airportsByCode }: SearchSummaryProps) {
  const origin = airportsByCode.get(search.origin);
  const destination = airportsByCode.get(search.destination);
  const RouteIcon = search.tripType === 'round-trip' ? ArrowLeftRight : ArrowRight;
  const dates = search.returnDate
    ? `${formatTravelDate(search.departDate)} – ${formatTravelDate(search.returnDate)}`
    : formatTravelDate(search.departDate);

  return (
    <section aria-labelledby="summary-heading" className="mt-8" data-testid="search-summary">
      <h2 id="summary-heading" className="sr-only">
        Your search
      </h2>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="flex items-center gap-4 font-display text-3xl font-extrabold sm:text-4xl">
          <span>
            {search.origin}
            <span className="block text-sm font-medium text-navy-200">{origin?.city}</span>
          </span>
          <RouteIcon
            className="size-7 text-ember-300"
            aria-label={search.tripType === 'round-trip' ? 'round trip to' : 'to'}
          />
          <span>
            {search.destination}
            <span className="block text-sm font-medium text-navy-200">{destination?.city}</span>
          </span>
        </p>
      </div>
      <ul className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="Search details">
        <Chip icon={<ArrowLeftRight />}>{TRIP_TYPE_LABELS[search.tripType]}</Chip>
        <Chip icon={<CalendarDays />}>{dates}</Chip>
        <Chip icon={<Users />}>{formatPassengerSummary(search.passengers)}</Chip>
        <Chip icon={<Armchair />}>{CABIN_LABELS[search.cabin]}</Chip>
      </ul>
    </section>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 font-medium text-white ring-1 ring-white/15 [&_svg]:size-4 [&_svg]:text-navy-200">
      <span aria-hidden="true">{icon}</span>
      {children}
    </li>
  );
}
