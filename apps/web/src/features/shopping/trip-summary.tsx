import {
  CABIN_LABELS,
  SERVICE_ROWS,
  formatPassengerSummary,
  formatTravelDate,
  requiredDirections,
  sameSearch,
  serializeFlightSearch,
  serializeResultsState,
  serviceFor,
  type FlightSearch,
  type JourneyDirection,
  type ResultsState,
  type Selection,
  type SelectionStatus,
  type ServiceCode,
  type ShoppingSession,
} from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import { AlertTriangle, ArrowRight, History, Info, RefreshCw, TicketX } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  AirlineMark,
  FlightTimes,
  cityOf,
  type AirportNames,
} from '@/features/flights/itinerary-parts';
import { afterSelectionHref, changeFareHref, changeHref } from '@/features/flights/journey';
import { ResultsError } from '@/features/flights/results-states';
import { getFareFamilies, loadSection } from '@/lib/content';
import { formatAirlineTime, formatMinor, formatMinorDifference } from '@/lib/format';
import { loadShoppingSession } from './data';
import { familyNamer } from './family-names';
import { OfferPriceBreakdown } from './offer-price-breakdown';
import { OfferValidity } from './offer-validity';
import { SelectFareForm } from './select-fare-form';
import { ServiceValue } from './service-value';
import { TripActions } from './trip-actions';

interface TripSummaryProps {
  search: FlightSearch;
  state: ResultsState;
  airports: AirportNames;
}

const STATUS: Record<SelectionStatus, { label: string; tone: 'navy' | 'gold' | 'neutral' }> = {
  SELECTED: { label: 'Selected', tone: 'neutral' },
  VALIDATED: { label: 'Price confirmed', tone: 'navy' },
  EXPIRED: { label: 'Price hold ended', tone: 'gold' },
  PRICE_CHANGED: { label: 'Price changed', tone: 'gold' },
  UNAVAILABLE: { label: 'No longer available', tone: 'gold' },
};

const INCLUDED_HIGHLIGHTS: readonly ServiceCode[] = [
  'CABIN_BAGGAGE',
  'CHECKED_BAGGAGE',
  'STANDARD_SEAT',
  'FLIGHT_CHANGE',
  'REFUND',
];
const LABEL = new Map(SERVICE_ROWS.map((row) => [row.code, row.label]));

/**
 * The trip summary: the offers the traveller selected, as held by their shopping session.
 * Everything shown — prices, totals, statuses — comes from the retailing API; this is a
 * provisional selection, not an order.
 */
export async function TripSummary({ search, state, airports }: TripSummaryProps) {
  const [sessionState, catalogue] = await Promise.all([
    loadShoppingSession(),
    loadSection(getFareFamilies),
  ]);
  if (sessionState.status === 'error') return <ResultsError kind={sessionState.error} />;
  const names = familyNamer(catalogue);
  const session =
    sessionState.status === 'active' && sameSearch(sessionState.session.search, search)
      ? sessionState.session
      : null;
  const required = requiredDirections(search);

  if (!session || required.some((direction) => !session.selections[direction])) {
    return (
      <Recovery
        search={search}
        state={state}
        session={session}
        expired={sessionState.status === 'expired'}
      />
    );
  }

  const selections = required.map((direction) => session.selections[direction]!);
  const urlIds = { outbound: state.outboundId, inbound: state.inboundId };
  const moved = selections.some((s) => s.offer.itineraryId !== urlIds[s.direction]);
  const query = serializeResultsState(state, serializeFlightSearch(search)).toString();
  const links = {
    sort: state.sort,
    outboundId: session.selections.outbound!.offer.itineraryId,
  };
  const { summary } = session;
  const blocked = selections.some((s) => s.status === 'PRICE_CHANGED')
    ? 'Accept the new price, or choose another fare, to continue.'
    : selections.some((s) => s.status === 'UNAVAILABLE')
      ? 'Choose another flight to continue.'
      : null;

  return (
    <section
      aria-labelledby="trip-heading"
      data-testid="trip-summary"
      className="grid gap-8 pb-24 lg:grid-cols-[minmax(0,1fr)_24rem] lg:pb-0"
    >
      <div className="min-w-0 space-y-4">
        <h2 id="trip-heading" className="font-display text-2xl font-bold text-ink sm:text-3xl">
          Your selected offers
        </h2>
        {moved ? (
          <Note icon={Info}>
            Your selection changed in another step, so this shows the flights you chose most
            recently.
          </Note>
        ) : null}
        {selections.map((selection) => (
          <SelectionCard
            key={selection.direction}
            selection={selection}
            search={search}
            links={links}
            airports={airports}
            names={names}
            query={query}
          />
        ))}
      </div>

      <aside
        id="trip-summary-panel"
        aria-labelledby="summary-heading"
        className="h-fit space-y-5 rounded-[1.5rem] border border-line bg-white p-5 shadow-card lg:sticky lg:top-24"
      >
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-gold-800 uppercase">
            Trip summary
          </p>
          <h2 id="summary-heading" className="mt-1 font-display text-xl font-bold text-ink">
            {cityOf(airports, search.origin)} to {cityOf(airports, search.destination)}
          </h2>
          <p className="text-sm text-ink-muted">
            {formatTravelDate(search.departDate)}
            {search.returnDate ? ` – ${formatTravelDate(search.returnDate)}` : ' · One-way'} ·{' '}
            {formatPassengerSummary(search.passengers)}
          </p>
        </div>
        <ul className="space-y-2 text-sm">
          {selections.map((selection) => (
            <li key={selection.direction} className="flex justify-between gap-4">
              <span>
                <span className="font-semibold text-ink">
                  {selection.direction === 'outbound' ? 'Departing' : 'Return'}
                </span>{' '}
                <span className="text-ink-muted">· {names(selection.offer.family).name}</span>
              </span>
              <span className="tabular-nums" data-testid={`leg-total-${selection.direction}`}>
                {formatMinor(selection.offer.price.totalMinor, selection.offer.price.currency)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-line pt-4 text-sm text-ink-muted">
          <Line label="Base fares">
            {formatMinor(summary.totals.baseFareMinor, summary.currency)}
          </Line>
          <Line label="Fare benefits">
            {formatMinor(summary.totals.fareFamilyMinor, summary.currency)}
          </Line>
          <Line label="Taxes and fees">
            {formatMinor(summary.totals.taxesMinor, summary.currency)}
          </Line>
          {summary.totals.extrasMinor > 0 ? (
            <Line label="Seats and extras">
              {formatMinor(summary.totals.extrasMinor, summary.currency)}
            </Line>
          ) : null}
          <Line label="Included services">No extra charge</Line>
        </dl>
        <div className="border-t border-line pt-4">
          <p className="text-sm font-semibold text-ink-muted">
            Total for {formatPassengerSummary(search.passengers).toLowerCase()}
          </p>
          <p
            className="font-display text-3xl font-extrabold text-ink tabular-nums"
            data-testid="trip-total"
          >
            {formatMinor(summary.totalMinor, summary.currency)}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {selections.length === 2 ? 'Departing plus return offers. ' : ''}Includes simulated
            taxes and fees; there are no booking fees.
          </p>
        </div>
        {summary.offersExpireAt ? (
          <OfferValidity
            key={summary.offersExpireAt}
            expiresAt={summary.offersExpireAt}
            serverTime={session.serverTime}
            heldUntil={formatAirlineTime(summary.offersExpireAt)}
          />
        ) : null}
        <TripActions query={query} blocked={blocked} />
        <p className="text-center text-xs text-ink-muted">
          This is a summary of selected offers, not a booking. No seats are reserved and nothing is
          charged.
        </p>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 shadow-float backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-4">
          <div>
            <p className="text-xs text-ink-muted">Total, all travellers</p>
            <p className="font-display text-xl font-extrabold text-ink tabular-nums">
              {formatMinor(summary.totalMinor, summary.currency)}
            </p>
          </div>
          <Button asChild size="md">
            <a href="#trip-summary-panel">
              Review and continue
              <ArrowRight aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

function SelectionCard({
  selection,
  search,
  links,
  airports,
  names,
  query,
}: {
  selection: Selection;
  search: FlightSearch;
  links: Pick<ResultsState, 'sort' | 'outboundId'>;
  airports: AirportNames;
  names: ReturnType<typeof familyNamer>;
  query: string;
}) {
  const { direction, offer, status } = selection;
  const family = names(offer.family);
  const { itinerary, price } = offer;
  const label = direction === 'outbound' ? 'Departing' : 'Return';
  const resultsState: ResultsState = {
    filters: { departureWindows: [], aircraft: [] },
    page: 1,
    ...links,
  };
  const pending = selection.pendingOffer;
  const previous = selection.previous;
  return (
    <article
      aria-labelledby={`selection-${direction}`}
      data-testid={`selection-${direction}`}
      data-status={status}
      className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id={`selection-${direction}`} className="text-sm font-bold text-ink">
          {label} · {formatTravelDate(itinerary.departure.date)} ·{' '}
          {cityOf(airports, itinerary.origin)} to {cityOf(airports, itinerary.destination)}
        </h3>
        <Badge tone={STATUS[status].tone} data-testid={`status-${direction}`}>
          {STATUS[status].label}
        </Badge>
      </div>
      <AirlineMark
        flightNumbers={itinerary.segments.map((s) => s.flightNumber)}
        className="mt-4 mb-3"
      />
      <FlightTimes itinerary={itinerary} airports={airports} size="md" />

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        <div>
          <p
            className="font-display text-lg font-bold text-ink"
            data-testid={`family-${direction}`}
          >
            {family.name}
          </p>
          <p className="text-xs text-ink-muted">{CABIN_LABELS[offer.cabin]}</p>
        </div>
        <p className="text-right">
          <span className="block font-display text-xl font-extrabold text-ink tabular-nums">
            {formatMinor(price.totalMinor, price.currency)}
          </span>
          <span className="text-xs text-ink-muted">all travellers</span>
        </p>
      </div>
      <ul
        className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2"
        aria-label={`${family.shortName} includes`}
      >
        {INCLUDED_HIGHLIGHTS.map((code) => (
          <li key={code}>
            <span className="block text-xs text-ink-muted">{LABEL.get(code)}</span>
            <ServiceValue service={serviceFor(offer.services, code)} />
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-3">
        {previous &&
        previous.itineraryId === offer.itineraryId &&
        previous.family !== offer.family ? (
          <Note icon={History} testId={`changed-${direction}`}>
            Changed from {names(previous.family).name} (
            {formatMinor(previous.totalMinor, price.currency)}):{' '}
            <strong className="font-semibold">
              {formatMinorDifference(price.totalMinor - previous.totalMinor, price.currency)}
            </strong>
          </Note>
        ) : null}
        {previous &&
        previous.family === offer.family &&
        previous.itineraryId === offer.itineraryId ? (
          <Note icon={History} testId={`changed-${direction}`}>
            You accepted a new price: {formatMinor(previous.totalMinor, price.currency)} →{' '}
            {formatMinor(price.totalMinor, price.currency)}.
          </Note>
        ) : null}
        {selection.lastCheck?.outcome === 'REFRESHED' && status === 'VALIDATED' ? (
          <Note icon={RefreshCw} testId={`refreshed-${direction}`}>
            Your previous offer had expired, so we requested a new one. The price is unchanged.
          </Note>
        ) : null}
        {status === 'EXPIRED' ? (
          <Note icon={Info} tone="gold" testId={`expired-${direction}`}>
            The price hold for this offer has ended. We’ll check the latest price when you continue,
            or you can check it now.
          </Note>
        ) : null}
        {status === 'PRICE_CHANGED' && pending ? (
          <div
            role="alert"
            className="rounded-2xl border border-gold-200 bg-gold-50 p-4"
            data-testid={`price-changed-${direction}`}
          >
            <p className="flex gap-2 font-semibold text-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold-800" aria-hidden="true" />
              The price for this {direction === 'outbound' ? 'departing' : 'return'} flight has
              changed
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-ink-muted">Previous</dt>
                <dd className="font-semibold tabular-nums line-through decoration-ink-subtle">
                  {formatMinor(price.totalMinor, price.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">New price</dt>
                <dd
                  className="font-semibold text-ink tabular-nums"
                  data-testid={`new-price-${direction}`}
                >
                  {formatMinor(pending.price.totalMinor, price.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Difference</dt>
                <dd className="font-semibold tabular-nums">
                  {formatMinorDifference(
                    pending.price.totalMinor - price.totalMinor,
                    price.currency,
                  )}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-ink-muted">
              Your earlier offer expired and demand on this flight has changed. Nothing changes
              unless you accept.
            </p>
            <div className="mt-3 flex flex-wrap items-start gap-3">
              <SelectFareForm
                query={query}
                direction={direction}
                offerId={pending.id}
                label={`Accept ${formatMinor(pending.price.totalMinor, price.currency)}`}
                description={`for the ${family.name} ${direction === 'outbound' ? 'departing' : 'return'} flight`}
                variant="secondary"
              />
              <Button asChild variant="outline">
                <Link href={changeFareHref(search, links, direction, offer.itineraryId)}>
                  Choose another fare
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
        {status === 'UNAVAILABLE' ? (
          <div
            role="alert"
            className="rounded-2xl border border-danger/25 bg-danger-surface p-4"
            data-testid={`unavailable-${direction}`}
          >
            <p className="flex gap-2 font-semibold text-ink">
              <TicketX className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
              This flight can no longer be sold for your party
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Your other choices are kept. Choose another{' '}
              {direction === 'outbound' ? 'departing' : 'return'} flight to continue.
            </p>
            <Button asChild variant="outline" className="mt-3">
              <Link href={changeHref(search, resultsState, direction)}>Choose another flight</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <details className="mt-4 rounded-xl border border-line">
        <summary className="cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold text-navy-700 hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus">
          Price breakdown<span className="sr-only"> for the {label.toLowerCase()} flight</span>
        </summary>
        <div className="border-t border-line p-3">
          <OfferPriceBreakdown price={price} familyName={family.shortName} />
        </div>
      </details>

      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link
          href={changeFareHref(search, links, direction, offer.itineraryId)}
          className="font-semibold text-navy-700 underline-offset-4 hover:underline"
        >
          Change fare<span className="sr-only"> for the {label.toLowerCase()} flight</span>
        </Link>
        <Link
          href={changeHref(search, resultsState, direction)}
          className="font-semibold text-navy-700 underline-offset-4 hover:underline"
        >
          Change flight<span className="sr-only"> ({label.toLowerCase()})</span>
        </Link>
      </p>
    </article>
  );
}

/** No usable selection for this summary: explain and offer the shortest way back. */
function Recovery({
  search,
  state,
  session,
  expired,
}: {
  search: FlightSearch;
  state: ResultsState;
  session: ShoppingSession | null;
  expired: boolean;
}) {
  const steps: { direction: JourneyDirection; href: Route; label: string }[] = [];
  const chosen = (direction: JourneyDirection) => session?.selections[direction]?.offer.itineraryId;
  if (!chosen('outbound') && state.outboundId) {
    steps.push({
      direction: 'outbound',
      href: changeFareHref(search, state, 'outbound', state.outboundId),
      label: 'Choose a fare for your departing flight',
    });
  } else if (chosen('outbound') && search.tripType === 'round-trip' && !chosen('inbound')) {
    steps.push({
      direction: 'inbound',
      href: afterSelectionHref(search, state.sort, { outbound: chosen('outbound') }),
      label: 'Choose your return flight',
    });
  }
  return (
    <section
      role="status"
      data-testid="trip-recovery"
      className="rounded-[1.75rem] border border-line bg-surface p-6 text-center sm:p-10"
    >
      <h2 className="font-display text-2xl font-bold text-ink">
        {expired ? 'Your trip selection has expired' : 'Choose your fares to see your trip'}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-ink-muted">
        {expired
          ? 'Selections are kept for a limited time and prices are never held indefinitely. Your search is still here — choose your fares again to get current prices.'
          : 'We don’t have fare choices for these flights yet — for example, if this link came from another device or your selection was cleared.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {steps.map((step) => (
          <Button asChild key={step.direction} variant="secondary">
            <Link href={step.href}>{step.label}</Link>
          </Button>
        ))}
        <Button asChild variant="outline">
          <Link href={changeHref(search, state, 'outbound')}>Back to flights</Link>
        </Button>
      </div>
    </section>
  );
}

function Note({
  icon: Icon,
  children,
  tone = 'neutral',
  testId,
}: {
  icon: typeof Info;
  children: React.ReactNode;
  tone?: 'neutral' | 'gold';
  testId?: string;
}) {
  return (
    <p
      className={cn(
        'flex gap-2 rounded-xl px-3 py-2 text-sm',
        tone === 'gold' ? 'bg-gold-50 text-gold-900' : 'bg-surface text-ink',
      )}
      data-testid={testId}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
