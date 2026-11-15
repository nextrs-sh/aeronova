import type { Airport, FlightSearch } from '@aeronova/contracts';
import { Badge } from '@aeronova/ui/badge';
import { Button } from '@aeronova/ui/button';
import { CalendarClock, Layers3, PlaneTakeoff, Sparkles } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

interface ResultsPreviewProps {
  search: FlightSearch;
  destination?: Airport;
}

const UPCOMING = [
  {
    icon: PlaneTakeoff,
    title: 'Schedules',
    description: 'Departure times, flight durations, and connections.',
  },
  {
    icon: Layers3,
    title: 'Fare bundles',
    description: 'Lite, Classic, and Flex options side by side.',
  },
  {
    icon: CalendarClock,
    title: 'Flexible dates',
    description: 'Compare nearby days to find the best value.',
  },
];

/**
 * Honest placeholder for flight results: the search is validated, but there
 * is no inventory yet, so nothing is shown that could be mistaken for an offer.
 */
export function ResultsPreview({ search, destination }: ResultsPreviewProps) {
  return (
    <section
      aria-labelledby="results-heading"
      className="rounded-[1.75rem] border border-line bg-white p-6 shadow-card sm:p-10"
      data-testid="results-preview"
    >
      <Badge tone="ember">
        <Sparkles aria-hidden="true" />
        Coming soon
      </Badge>
      <h2 id="results-heading" className="mt-4 text-2xl font-bold text-ink sm:text-3xl">
        Live flight results are on their way
      </h2>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-muted">
        Your search for {search.origin} to {search.destination} is valid. Flight schedules and fares
        arrive in the next release of AeroNova — for now, no flights can be booked and no prices are
        shown here.
      </p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-3">
        {UPCOMING.map(({ icon: Icon, title, description }) => (
          <li key={title} className="rounded-2xl bg-surface p-5">
            <Icon className="size-6 text-navy-600" aria-hidden="true" />
            <h3 className="mt-3 font-bold text-ink">{title}</h3>
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
          </li>
        ))}
      </ul>
      {destination?.destinationSlug ? (
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="secondary">
            <Link href={`/destinations/${destination.destinationSlug}` as Route}>
              Explore {destination.city} while you wait
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
