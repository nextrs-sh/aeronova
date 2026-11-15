import { randomUUID } from 'node:crypto';
import {
  formatFlightNumber,
  formatTravelDate,
  isIsoDate,
  journeyDirectionSchema,
  type ChangeAlternative,
  type ChangeSearchResult,
  type JourneyDirection,
  type OrderJourney,
} from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { cn } from '@velasia/ui/cn';
import { ArrowRight, CalendarSearch } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ownerCredentials } from '@/features/account/session';
import { StepSkeleton } from '@/features/booking/recovery';
import { loadPaymentOptions } from '@/features/checkout/data';
import { FlightTimes, type AirportNames } from '@/features/flights/itinerary-parts';
import { ResultsError } from '@/features/flights/results-states';
import { confirmFlightChangeAction } from '@/features/manage/actions';
import { loadManagedOrder } from '@/features/manage/data';
import {
  BookingUnavailable,
  ManageHeader,
  NotModifiable,
  QuoteLines,
  manageHref,
} from '@/features/manage/parts';
import { ServicingConfirm } from '@/features/manage/servicing-confirm';
import { getAirports, loadSection } from '@/lib/content';
import { formatMinor } from '@/lib/format';
import { RetailingApiError } from '@/lib/retailing-api/client';
import { servicingApi } from '@/lib/retailing-api/servicing';
import { logUpstreamFailure } from '@/lib/observability';

export const metadata: Metadata = {
  title: 'Change flight',
  robots: { index: false, follow: false },
};

/**
 * Change flight (Milestone 6): choose a date, compare replacement flights with their full
 * change price, review old and new together, and confirm. Searching is a GET (direction and date
 * in the URL, nothing personal); every price is the API's quote.
 */
export default function ChangeFlightPage({
  params,
  searchParams,
}: PageProps<'/manage-booking/[orderId]/change-flight'>) {
  return (
    <Container className="py-8 sm:py-12">
      <Suspense fallback={<StepSkeleton />}>
        <ChangeFlight params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

async function ChangeFlight({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const state = await loadManagedOrder(orderId);
  if (state.status === 'error') return <ResultsError kind={state.error} />;
  if (state.status !== 'ready') return <BookingUnavailable />;
  const { order, servicing } = state;
  const parsedDirection = journeyDirectionSchema.safeParse(one(query.direction));
  const direction: JourneyDirection = parsedDirection.success ? parsedDirection.data : 'outbound';
  const allowed = servicing.changeFlight.find((c) => c.direction === direction);
  const journey = order.journeys.find((j) => j.direction === direction);
  if (!allowed?.allowed || !journey) {
    return (
      <div className="space-y-6">
        <ManageHeader order={order} title="Change flight" back={manageHref(order.id)} />
        <NotModifiable order={order} what="Changing this flight" />
      </div>
    );
  }
  const date = isIsoDate(one(query.date) ?? '')
    ? one(query.date)!
    : journey.itinerary.departure.date;
  const [airports, options] = await Promise.all([loadSection(getAirports), loadPaymentOptions()]);
  const names: AirportNames = Object.fromEntries(
    (airports.ok ? airports.data : []).map((a) => [a.code, { city: a.city, name: a.name }]),
  );
  let result: ChangeSearchResult | null = null;
  let searchError: string | null = null;
  try {
    result = await servicingApi.changeSearch(order.id, await ownerCredentials(), direction, date);
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    logUpstreamFailure('manage', 'change search', error);
    searchError =
      error.kind === 'rejected'
        ? error.message
        : 'We couldn’t search flights right now. Please try again.';
  }
  const selected =
    result?.alternatives.find((alternative) => alternative.itineraryId === one(query.itinerary)) ??
    null;
  const base = `${manageHref(order.id, '/change-flight')}?direction=${direction}&date=${date}`;

  return (
    <div className="space-y-6" data-testid="change-flight">
      <ManageHeader
        order={order}
        title={direction === 'outbound' ? 'Change your flight' : 'Change your return flight'}
        back={manageHref(order.id)}
      />

      <section
        aria-labelledby="change-search-heading"
        className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6"
      >
        <h2 id="change-search-heading" className="font-display text-xl font-bold text-ink">
          1. Choose a new date
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          You keep your {journey.familyName} fare and route ({journey.itinerary.origin} →{' '}
          {journey.itinerary.destination}).{' '}
          {allowed.feePerTravellerMinor > 0
            ? `The change fee is ${formatMinor(allowed.feePerTravellerMinor, order.currency)} per traveller (lap infants exempt).`
            : 'There is no change fee with this fare.'}{' '}
          Changes close{' '}
          {allowed.closesAt
            ? `on ${formatTravelDate(allowed.closesAt.slice(0, 10))}`
            : 'before departure'}
          .
        </p>
        <form
          method="get"
          action={manageHref(order.id, '/change-flight')}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          {order.journeys.length > 1 ? (
            <label className="text-sm font-semibold text-ink">
              Flight
              <select
                name="direction"
                defaultValue={direction}
                className="mt-1 block h-11 rounded-xl border border-line-strong bg-white px-3"
              >
                <option value="outbound">Departing</option>
                <option value="inbound">Return</option>
              </select>
            </label>
          ) : (
            <input type="hidden" name="direction" value={direction} />
          )}
          <label className="text-sm font-semibold text-ink">
            New travel date
            <input
              type="date"
              name="date"
              defaultValue={date}
              required
              className="mt-1 block h-11 rounded-xl border border-line-strong bg-white px-3"
              data-testid="change-date"
            />
          </label>
          <Button type="submit" variant="secondary" data-testid="change-search">
            <CalendarSearch aria-hidden="true" />
            Find flights
          </Button>
        </form>
      </section>

      <section aria-labelledby="alternatives-heading" className="space-y-3">
        <h2 id="alternatives-heading" className="font-display text-xl font-bold text-ink">
          2. Compare flights on {formatTravelDate(date)}
        </h2>
        {searchError ? (
          <p
            role="alert"
            className="rounded-2xl bg-danger-surface p-4 text-sm text-danger"
            data-testid="change-search-error"
          >
            {searchError}
          </p>
        ) : result && result.alternatives.length === 0 ? (
          <p
            className="rounded-2xl border border-line bg-surface p-5 text-sm text-ink-muted"
            data-testid="change-empty"
          >
            {result.emptyReason ?? 'No other flight is available on this date.'} Try another date.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="change-alternatives">
            {result?.alternatives.map((alternative) => (
              <li key={alternative.itineraryId}>
                <AlternativeCard
                  alternative={alternative}
                  airports={names}
                  currency={order.currency}
                  href={`${base}&itinerary=${alternative.itineraryId}` as Route}
                  selected={alternative.itineraryId === selected?.itineraryId}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section
          aria-labelledby="review-heading"
          className="rounded-[1.5rem] border border-primary-border bg-white p-5 shadow-card sm:p-6"
          id="review"
          data-testid="change-review"
        >
          <h2 id="review-heading" className="font-display text-xl font-bold text-ink">
            3. Review and confirm
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <JourneyBox
              title="Your current flight"
              journey={journey}
              airports={names}
              tone="muted"
            />
            <JourneyBox
              title="Your new flight"
              journey={{ ...journey, itinerary: selected.itinerary }}
              airports={names}
              tone="new"
            />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <QuoteLines quote={selected.quote} />
            <ServicingConfirm
              action={confirmFlightChangeAction}
              quote={selected.quote}
              orderId={order.id}
              revision={order.revision}
              hidden={{ direction, itineraryId: selected.itineraryId }}
              options={options}
              idempotencyKey={randomUUID()}
              label="Confirm flight change"
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function net(alternative: ChangeAlternative, currency: string) {
  const { kind, amountMinor } = alternative.quote.adjustment;
  if (kind === 'CHARGE') return { text: `+${formatMinor(amountMinor, currency)}`, note: 'to pay' };
  if (kind === 'REFUND') return { text: formatMinor(amountMinor, currency), note: 'refunded' };
  if (kind === 'CREDIT') return { text: formatMinor(amountMinor, currency), note: 'travel credit' };
  return { text: 'No difference', note: 'nothing to pay' };
}

function AlternativeCard({
  alternative,
  airports,
  currency,
  href,
  selected,
}: {
  alternative: ChangeAlternative;
  airports: AirportNames;
  currency: string;
  href: Route;
  selected: boolean;
}) {
  const price = net(alternative, currency);
  return (
    <article
      className={cn(
        'grid gap-4 rounded-[1.25rem] border bg-white p-4 shadow-card sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center',
        selected ? 'border-primary ring-1 ring-primary' : 'border-line',
      )}
      data-testid="change-alternative"
      data-itinerary={alternative.itineraryId}
    >
      <div className="min-w-0">
        <FlightTimes itinerary={alternative.itinerary} airports={airports} size="md" />
        <p className="mt-2 text-xs text-ink-muted">
          {alternative.itinerary.segments
            .map((segment) => formatFlightNumber(segment.flightNumber))
            .join(' + ')}{' '}
          · {alternative.itinerary.segments.map((segment) => segment.aircraft.name).join(', ')}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
        <p className="text-right">
          <span className="block font-display text-xl font-bold text-ink tabular-nums">
            {price.text}
          </span>
          <span className="text-xs text-ink-muted">{price.note}</span>
        </p>
        <Button asChild variant={selected ? 'primary' : 'outline'} size="sm">
          <Link
            href={`${href}#review` as Route}
            scroll={false}
            aria-label={`Review the change to ${alternative.itinerary.segments.map((s) => formatFlightNumber(s.flightNumber)).join(' and ')} at ${alternative.itinerary.departure.time}`}
          >
            {selected ? 'Selected' : 'Review'}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

function JourneyBox({
  title,
  journey,
  airports,
  tone,
}: {
  title: string;
  journey: OrderJourney;
  airports: AirportNames;
  tone: 'muted' | 'new';
}) {
  return (
    <div
      className={cn('rounded-2xl p-4', tone === 'new' ? 'bg-primary-subtle' : 'bg-surface')}
      data-testid={tone === 'new' ? 'new-journey' : 'current-journey'}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <Badge tone={tone === 'new' ? 'primary' : 'neutral'}>
          {formatTravelDate(journey.itinerary.departure.date)}
        </Badge>
      </div>
      <FlightTimes itinerary={journey.itinerary} airports={airports} size="md" />
      <p className="mt-2 text-xs text-ink-muted">
        {journey.itinerary.segments
          .map((segment) => formatFlightNumber(segment.flightNumber))
          .join(' + ')}{' '}
        · {journey.familyName}
      </p>
    </div>
  );
}
