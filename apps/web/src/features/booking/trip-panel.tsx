import {
  formatFlightNumber,
  formatPassengerSummary,
  formatTravelDate,
  type ShoppingSession,
} from '@velasia/contracts';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { familyNamer } from '@/features/shopping/family-names';
import { getFareFamilies, loadSection } from '@/lib/content';
import { formatMinor } from '@/lib/format';
import { tripSelections } from './trip';

/*
 * The persistent trip and price summary: a sticky side panel on desktop, a collapsible panel on
 * phones. Every amount is the API's (`session.summary`); nothing is added up here.
 */

async function PanelBody({ session }: { session: ShoppingSession }) {
  const names = familyNamer(await loadSection(getFareFamilies));
  const { summary } = session;
  const { extras } = summary;
  const lines: { label: string; amount: number; testId: string }[] = [
    { label: 'Seats', amount: extras.seatsMinor, testId: 'panel-seats' },
    { label: 'Extra baggage', amount: extras.baggageMinor, testId: 'panel-baggage' },
    { label: 'Meals', amount: extras.mealsMinor, testId: 'panel-meals' },
    { label: 'Priority services', amount: extras.priorityMinor, testId: 'panel-priority' },
  ];
  return (
    <div className="space-y-4">
      <ul className="space-y-3 text-sm">
        {tripSelections(session).map((selection) => {
          const { itinerary } = selection.offer;
          return (
            <li key={selection.direction} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-semibold text-ink">
                  {selection.direction === 'outbound' ? 'Departing' : 'Return'} · {itinerary.origin}{' '}
                  → {itinerary.destination}
                </span>
                <span className="block text-ink-muted">
                  {formatTravelDate(itinerary.departure.date)} · {itinerary.departure.time}
                </span>
                <span className="block text-ink-muted">
                  {itinerary.segments.map((s) => formatFlightNumber(s.flightNumber)).join(' + ')} ·{' '}
                  {names(selection.offer.family).name}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {formatMinor(selection.offer.price.totalMinor, selection.offer.price.currency)}
              </span>
            </li>
          );
        })}
      </ul>
      <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
        <Line label="Flights, taxes and fees" testId="panel-flights">
          {formatMinor(summary.flightsTotalMinor, summary.currency)}
        </Line>
        {lines.map((line) => (
          <Line key={line.label} label={line.label} testId={line.testId} muted={line.amount === 0}>
            {line.amount === 0 ? 'None added' : formatMinor(line.amount, summary.currency)}
          </Line>
        ))}
      </dl>
      <div className="border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-muted">
          Pre-checkout total, {formatPassengerSummary(session.search.passengers).toLowerCase()}
        </p>
        <p
          className="font-display text-3xl font-extrabold text-ink tabular-nums"
          data-testid="booking-total"
        >
          {formatMinor(summary.totalMinor, summary.currency)}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Includes simulated taxes and fees. Included fare benefits are never charged.
        </p>
      </div>
      <p className="flex gap-2 rounded-xl bg-surface p-3 text-xs text-ink-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        Not a booking: nothing is reserved or charged, and seat choices are provisional until
        checkout.
      </p>
    </div>
  );
}

function Line({
  label,
  children,
  muted = false,
  testId,
}: {
  label: string;
  children: ReactNode;
  muted?: boolean;
  testId: string;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={muted ? 'text-ink-subtle' : 'text-ink tabular-nums'} data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/** Sticky on desktop. */
export function TripPanel({ session }: { session: ShoppingSession }) {
  return (
    <aside
      aria-labelledby="trip-panel-heading"
      className="hidden h-fit rounded-[1.5rem] border border-line bg-white p-5 shadow-card lg:sticky lg:top-24 lg:block"
      data-testid="trip-panel"
    >
      <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">Your trip</p>
      <h2 id="trip-panel-heading" className="mt-1 mb-4 font-display text-xl font-bold text-ink">
        {session.search.origin} → {session.search.destination}
        {session.search.tripType === 'round-trip' ? ' and back' : ''}
      </h2>
      <PanelBody session={session} />
    </aside>
  );
}

/** Collapsible on phones and tablets, with the total always visible. */
export function TripPanelCompact({ session }: { session: ShoppingSession }) {
  return (
    <details
      className="group rounded-[1.25rem] border border-line bg-white shadow-card lg:hidden"
      data-testid="trip-panel-compact"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[1.25rem] p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-xs font-bold tracking-[0.14em] text-primary uppercase">
            Trip summary
          </span>
          <span className="block truncate text-sm font-semibold text-ink">
            {session.search.origin} → {session.search.destination} ·{' '}
            {formatPassengerSummary(session.search.passengers)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-display text-lg font-extrabold text-ink tabular-nums">
            {formatMinor(session.summary.totalMinor, session.summary.currency)}
          </span>
          <ChevronDown
            className="size-5 text-ink-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
          <span className="sr-only">Show trip details</span>
        </span>
      </summary>
      <div className="border-t border-line p-4">
        <PanelBody session={session} />
      </div>
    </details>
  );
}
