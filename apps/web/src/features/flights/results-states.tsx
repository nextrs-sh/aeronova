import {
  airline,
  CABIN_LABELS,
  type EmptyReason,
  type FlightSearch,
  formatTravelDate,
  type NetworkRoute,
  totalSeated,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import {
  Armchair,
  CalendarOff,
  CalendarSearch,
  CloudOff,
  FilterX,
  MapPinOff,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RetailingApiErrorKind } from '@/lib/retailing-api/client';
import { cityOf, type AirportNames } from './itinerary-parts';
import { RetryButton } from './retry-button';

function StatePanel({
  icon: Icon,
  title,
  children,
  actions,
  tone = 'neutral',
  role = 'status',
  testId,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  tone?: 'neutral' | 'danger';
  role?: 'status' | 'alert';
  testId: string;
}) {
  return (
    <section
      role={role}
      data-testid={testId}
      className={cn(
        'rounded-[1.75rem] border p-6 text-center sm:p-10',
        tone === 'danger' ? 'border-danger/25 bg-danger-surface' : 'border-line bg-surface',
      )}
    >
      <span
        className={cn(
          'mx-auto inline-flex size-12 items-center justify-center rounded-full',
          tone === 'danger' ? 'bg-white text-danger' : 'bg-white text-navy-600',
        )}
      >
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <h3 className="mt-4 font-display text-xl font-bold text-ink sm:text-2xl">{title}</h3>
      <div className="mx-auto mt-2 max-w-xl text-ink-muted">{children}</div>
      {actions ? <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </section>
  );
}

const editSearch = (
  <Button asChild variant="outline">
    <a href="#edit-search">Edit search</a>
  </Button>
);

interface EmptyResultsProps {
  reason: EmptyReason;
  search: FlightSearch;
  origin: string;
  destination: string;
  date: string;
  airports: AirportNames;
  scheduleEndDate: string;
  clearFiltersHref: Route;
  economyHref: Route;
  /** Destinations served directly from the origin, for the "no route" state. */
  alternatives: { route: NetworkRoute; href: Route }[];
}

/** An explained empty result with recovery actions. Never shows invented flights. */
export function EmptyResults(props: EmptyResultsProps) {
  const { reason, search, origin, destination, date, airports } = props;
  const from = cityOf(airports, origin);
  const to = cityOf(airports, destination);
  const testId = `empty-${reason}`;

  switch (reason) {
    case 'filtered-out':
      return (
        <StatePanel
          icon={FilterX}
          title="No flights match your filters"
          testId={testId}
          actions={
            <Button asChild variant="secondary">
              <Link href={props.clearFiltersHref} scroll={false}>
                Clear filters
              </Link>
            </Button>
          }
        >
          There are flights from {from} to {to} on this date — try widening the time window or
          price.
        </StatePanel>
      );
    case 'no-route':
      return (
        <StatePanel
          icon={MapPinOff}
          title={`${airline.shortName} doesn’t fly from ${from} to ${to}`}
          testId={testId}
          actions={editSearch}
        >
          <p>There’s no direct or one-stop connection on this route in our network.</p>
          {props.alternatives.length > 0 ? (
            <div className="mt-5">
              <p className="text-sm font-semibold text-ink">Fly from {from} to</p>
              <ul className="mt-3 flex flex-wrap justify-center gap-2">
                {props.alternatives.map(({ route, href }) => (
                  <li key={route.id}>
                    <Link
                      href={href}
                      className="inline-flex rounded-full border border-line-strong bg-white px-3.5 py-1.5 text-sm font-semibold text-ink hover:border-navy-300"
                    >
                      {cityOf(airports, route.destination)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </StatePanel>
      );
    case 'cabin-not-offered':
      return (
        <StatePanel
          icon={Armchair}
          title={`${CABIN_LABELS[search.cabin]} isn’t offered on this route`}
          testId={testId}
          actions={
            <>
              <Button asChild variant="secondary">
                <Link href={props.economyHref}>Show Economy flights</Link>
              </Button>
              {editSearch}
            </>
          }
        >
          Flights between {from} and {to} use aircraft without a {CABIN_LABELS[search.cabin]} cabin.
        </StatePanel>
      );
    case 'beyond-schedule':
      return (
        <StatePanel
          icon={CalendarOff}
          title="Schedules aren’t published for this date yet"
          testId={testId}
          actions={editSearch}
        >
          We publish flights up to {formatTravelDate(props.scheduleEndDate)}. Choose an earlier
          date, or check back as new schedules are released.
        </StatePanel>
      );
    case 'insufficient-seats':
      return (
        <StatePanel
          icon={Users}
          title={`Not enough seats for ${totalSeated(search.passengers)} travellers`}
          testId={testId}
          actions={editSearch}
        >
          Flights on {formatTravelDate(date)} are too full to seat your whole party in{' '}
          {CABIN_LABELS[search.cabin]}. Try a nearby date above, another cabin, or fewer passengers.
        </StatePanel>
      );
    case 'no-flights-on-date':
      return (
        <StatePanel
          icon={CalendarSearch}
          title={`No flights on ${formatTravelDate(date)}`}
          testId={testId}
          actions={editSearch}
        >
          {airline.shortName} doesn’t have a flight from {from} to {to} you can book that day.
          Nearby dates above may have availability.
        </StatePanel>
      );
  }
}

const ERROR_COPY: Record<RetailingApiErrorKind, { title: string; body: string }> = {
  unavailable: {
    title: 'We can’t load flights right now',
    body: 'Our flight search service isn’t responding. Your search is fine — please try again in a moment.',
  },
  timeout: {
    title: 'Flight search is taking too long',
    body: 'The search didn’t finish in time. Please try again.',
  },
  'bad-response': {
    title: 'Something went wrong loading flights',
    body: 'We received results we couldn’t read, so we haven’t shown any. Please try again.',
  },
  rejected: {
    title: 'We couldn’t run this search',
    body: 'Some details of this search weren’t accepted. Please change your search.',
  },
  'not-found': {
    title: 'That flight is no longer available',
    body: 'Please choose another flight.',
  },
};

/** The retailing API failed. Offer recovery; show no flights at all. */
export function ResultsError({ kind, message }: { kind: RetailingApiErrorKind; message?: string }) {
  const copy = ERROR_COPY[kind];
  return (
    <StatePanel
      icon={CloudOff}
      title={copy.title}
      tone="danger"
      role="alert"
      testId="results-error"
      actions={
        <>
          {kind === 'rejected' ? null : <RetryButton />}
          {editSearch}
        </>
      }
    >
      {message ?? copy.body}
    </StatePanel>
  );
}

/** Compact notice for a secondary section that failed, so the rest of the page still works. */
export function SectionNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-sm text-ink-muted"
    >
      <CloudOff className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      {children}
    </p>
  );
}
