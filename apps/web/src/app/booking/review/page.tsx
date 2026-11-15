import {
  CABIN_LABELS,
  SEAT_CATEGORY_LABELS,
  SPECIAL_ASSISTANCE,
  countryName,
  formatFlightNumber,
  formatTravelDate,
  serviceFor,
  slotLabel,
  travellerName,
  travellerTypeLabel,
  type Quote,
  type QuoteLine,
  type ReviewIssue,
  type ReviewResponse,
  type ShoppingSession,
} from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Pencil,
  ShieldCheck,
} from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { BookingFrame } from '@/features/booking/booking-frame';
import { loadBookingStep, loadReview } from '@/features/booking/data';
import { BookingRecovery, StepSkeleton } from '@/features/booking/recovery';
import { AcceptPriceForm, ReviewCheckForm } from '@/features/booking/review-actions';
import { StepHeader } from '@/features/booking/step-header';
import {
  STEP_HREF,
  travellerDisplayName,
  tripSegments,
  tripSelections,
  tripSummaryHref,
} from '@/features/booking/trip';
import { FlightTimes, type AirportNames } from '@/features/flights/itinerary-parts';
import { ResultsError } from '@/features/flights/results-states';
import { familyNamer } from '@/features/shopping/family-names';
import { getAirports, getFareFamilies, loadSection } from '@/lib/content';
import { formatAirlineTime, formatDuration, formatMinor } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Review your booking',
  description: 'Check your Velasia Airways itinerary, travellers, seats, extras, and total.',
  robots: { index: false, follow: false },
};

/**
 * Step 4: the booking review. Everything shown comes from the session and the API's itemised
 * quote. "Continue to checkout" appears only after the API's final validation succeeded for the
 * session as it is now. This is a pre-checkout quote: nothing is booked or paid.
 */
export default function ReviewPage() {
  return (
    <>
      <StepHeader
        step={4}
        title="Review your booking"
        description="Check every detail. We confirm prices, seats, and extras again before checkout."
      />
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<StepSkeleton />}>
          <ReviewStep />
        </Suspense>
      </Container>
    </>
  );
}

async function ReviewStep() {
  await connection();
  const state = await loadBookingStep('review');
  if (state.status !== 'ready')
    return <BookingRecovery state={state} retryHref={STEP_HREF.review} />;
  const [review, airports, families] = await Promise.all([
    loadReview(),
    loadSection(getAirports),
    loadSection(getFareFamilies),
  ]);
  if (!review.ok) {
    return (
      <BookingFrame session={state.session} step="review">
        <ResultsError kind={review.error} message="We couldn’t load your booking review." />
      </BookingFrame>
    );
  }
  const { session } = review.data;
  const names: AirportNames = Object.fromEntries(
    (airports.ok ? airports.data : []).map((a) => [a.code, { city: a.city, name: a.name }]),
  );
  return (
    <BookingFrame session={session} step="review">
      <ReadinessPanel data={review.data} />
      <FlightsSection session={session} airports={names} names={familyNamer(families)} />
      <TravellersSection session={session} />
      <SeatsSection session={session} />
      <ExtrasSection session={session} quote={review.data.quote} />
      <PriceSection quote={review.data.quote} />
      <div className="flex flex-col-reverse gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="outline">
          <Link href={STEP_HREF.extras}>
            <ArrowLeft aria-hidden="true" />
            Extras
          </Link>
        </Button>
        <CheckoutCta ready={review.data.readiness.status === 'READY'} />
      </div>
    </BookingFrame>
  );
}

function CheckoutCta({ ready }: { ready: boolean }) {
  if (!ready) {
    return (
      <p className="text-sm text-ink-muted sm:text-right" data-testid="checkout-unavailable">
        Checkout opens once your booking has been checked and nothing needs attention.
      </p>
    );
  }
  return (
    <Button asChild size="lg">
      <Link href={STEP_HREF.checkout} data-testid="continue-checkout">
        Continue to checkout
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );
}

const ISSUE_LINK: Record<ReviewIssue['step'], string> = {
  flights: 'Go to your trip summary',
  travellers: 'Edit traveller details',
  seats: 'Choose seats',
  extras: 'Review extras',
};

function issueHref(issue: ReviewIssue, session: ShoppingSession): Route {
  if (issue.step === 'flights') return tripSummaryHref(session);
  if (issue.step === 'seats' && issue.flightId) {
    return `${STEP_HREF.seats}?flight=${issue.flightId}` as Route;
  }
  return STEP_HREF[issue.step];
}

function ReadinessPanel({ data }: { data: ReviewResponse['data'] }) {
  const { session, readiness, quote } = data;
  const review = session.booking.review;
  if (readiness.status === 'READY' && review) {
    return (
      <section
        aria-labelledby="readiness-heading"
        className="rounded-[1.5rem] border border-success/30 bg-white p-5 shadow-card"
        data-testid="review-ready"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" aria-hidden="true" />
            <div>
              <h2 id="readiness-heading" className="font-display text-xl font-bold text-ink">
                Ready for checkout
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                We checked your flights, prices, seats, and extras at{' '}
                {formatAirlineTime(review.checkedAt)}. Your pre-checkout total is{' '}
                <span className="font-semibold text-ink">
                  {formatMinor(quote.totals.totalMinor, quote.currency)}
                </span>
                . Seats aren’t held until checkout, so we’ll confirm them once more then.
              </p>
            </div>
          </div>
          <ReviewCheckForm version={session.version} label="Check again" variant="outline" />
        </div>
      </section>
    );
  }
  const issues = readiness.issues;
  return (
    <section
      aria-labelledby="readiness-heading"
      className="rounded-[1.5rem] border border-gold-200 bg-gold-50 p-5"
      data-testid="review-action-required"
      role={issues.length ? 'alert' : undefined}
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-6 shrink-0 text-gold-800" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="readiness-heading" className="font-display text-xl font-bold text-ink">
            {issues.length ? 'A few things need your attention' : 'Check your booking'}
          </h2>
          {issues.length === 0 ? (
            <p className="mt-1 text-sm text-ink">
              Your booking has changed since it was last checked. Check the latest prices and
              availability to continue.
            </p>
          ) : (
            <ul className="mt-3 space-y-3" data-testid="review-issues">
              {issues.map((issue) => {
                const selection = issue.direction ? session.selections[issue.direction] : null;
                const pending = issue.code === 'PRICE_CHANGED' ? selection?.pendingOffer : null;
                return (
                  <li
                    key={`${issue.code}-${issue.message}`}
                    className="rounded-xl bg-white p-3 text-sm text-ink"
                    data-code={issue.code}
                  >
                    <p>{issue.message}</p>
                    {pending && selection ? (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <p className="text-ink-muted">
                          {formatMinor(selection.offer.price.totalMinor, pending.price.currency)} →{' '}
                          <span className="font-semibold text-ink">
                            {formatMinor(pending.price.totalMinor, pending.price.currency)}
                          </span>
                        </p>
                        <AcceptPriceForm
                          direction={selection.direction}
                          label={`Accept ${formatMinor(pending.price.totalMinor, pending.price.currency)}`}
                        />
                        <Link
                          href={tripSummaryHref(session)}
                          className="font-semibold text-navy-700 underline-offset-4 hover:underline"
                        >
                          Choose another fare
                        </Link>
                      </div>
                    ) : (
                      <Link
                        href={issueHref(issue, session)}
                        className="mt-1 inline-block font-semibold text-navy-700 underline-offset-4 hover:underline"
                      >
                        {ISSUE_LINK[issue.step]}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4">
            <ReviewCheckForm version={session.version} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewSection({
  id,
  title,
  edit,
  children,
}: {
  id: string;
  title: string;
  edit?: { href: Route; label: string };
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6"
      data-testid={`review-${id}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="font-display text-xl font-bold text-ink">
          {title}
        </h2>
        {edit ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={edit.href}>
              <Pencil aria-hidden="true" />
              {edit.label}
            </Link>
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function FlightsSection({
  session,
  airports,
  names,
}: {
  session: ShoppingSession;
  airports: AirportNames;
  names: ReturnType<typeof familyNamer>;
}) {
  return (
    <ReviewSection
      id="flights"
      title="Flights"
      edit={{ href: tripSummaryHref(session), label: 'Change flights' }}
    >
      <div className="space-y-5">
        {tripSelections(session).map((selection) => {
          const { itinerary } = selection.offer;
          const checked = serviceFor(selection.offer.services, 'CHECKED_BAGGAGE');
          const cabinBags = serviceFor(selection.offer.services, 'CABIN_BAGGAGE');
          return (
            <article
              key={selection.direction}
              className="rounded-2xl bg-surface p-4"
              data-testid={`review-leg-${selection.direction}`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-ink">
                  {selection.direction === 'outbound' ? 'Departing' : 'Return'} ·{' '}
                  {formatTravelDate(itinerary.departure.date)}
                </h3>
                <Badge tone="navy">{names(selection.offer.family).name}</Badge>
              </div>
              <FlightTimes itinerary={itinerary} airports={airports} size="md" />
              <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                {itinerary.segments.map((segment) => (
                  <li key={segment.id}>
                    {formatFlightNumber(segment.flightNumber)} · {segment.departure.airport}{' '}
                    {segment.departure.time} → {segment.arrival.airport} {segment.arrival.time} ·{' '}
                    {formatDuration(segment.durationMinutes)} · {segment.aircraft.name} ·{' '}
                    {CABIN_LABELS[selection.offer.cabin]}
                  </li>
                ))}
                {itinerary.connections.map((connection) => (
                  <li key={connection.airport}>
                    Connection in {connection.airport}: {formatDuration(connection.durationMinutes)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-ink">
                <span className="font-semibold">Fare includes:</span> cabin bag {cabinBags?.summary}{' '}
                · checked bag {checked?.inclusion === 'included' ? checked.summary : 'not included'}{' '}
                · seat:{' '}
                {serviceFor(selection.offer.services, 'STANDARD_SEAT')?.summary.toLowerCase()} ·{' '}
                {serviceFor(selection.offer.services, 'MEAL')?.summary.toLowerCase()}
              </p>
            </article>
          );
        })}
      </div>
    </ReviewSection>
  );
}

function TravellersSection({ session }: { session: ShoppingSession }) {
  const { passengers, contact } = session.booking;
  return (
    <ReviewSection
      id="travellers"
      title="Travellers"
      edit={{ href: STEP_HREF.travellers, label: 'Edit' }}
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {(passengers ?? []).map((passenger) => (
          <li key={passenger.id} className="rounded-2xl bg-surface p-4 text-sm">
            <p className="font-semibold text-ink">{travellerName(passenger, { full: true })}</p>
            <p className="text-ink-muted">
              {slotLabel(passenger.id)} · {travellerTypeLabel(passenger.type)} · born{' '}
              {formatTravelDate(passenger.dateOfBirth)} · {countryName(passenger.nationality)}
            </p>
            {passenger.infantOf ? (
              <p className="text-ink-muted">
                On the lap of {travellerDisplayName(session, passenger.infantOf)}
              </p>
            ) : null}
            {passenger.specialAssistance ? (
              <p className="text-ink-muted">
                Assistance: {SPECIAL_ASSISTANCE[passenger.specialAssistance]}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {contact ? (
        <p className="mt-4 text-sm text-ink-muted">
          Contact: <span className="text-ink">{contact.email}</span> ·{' '}
          <span className="text-ink">{contact.phone}</span>
        </p>
      ) : null}
    </ReviewSection>
  );
}

function SeatsSection({ session }: { session: ShoppingSession }) {
  const seated = session.booking.slots.filter((slot) => slot.type !== 'infant');
  const currency = session.summary.currency;
  return (
    <ReviewSection id="seats" title="Seats" edit={{ href: STEP_HREF.seats, label: 'Change seats' }}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <caption className="sr-only">Seats by traveller and flight</caption>
          <thead className="text-xs text-ink-muted">
            <tr>
              <th scope="col" className="pb-2 font-semibold">
                Traveller
              </th>
              <th scope="col" className="pb-2 font-semibold">
                Flight
              </th>
              <th scope="col" className="pb-2 font-semibold">
                Seat
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                Price
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tripSegments(session).flatMap(({ segment }) =>
              seated.map((slot) => {
                const seat = session.booking.seats.find(
                  (s) => s.flightId === segment.id && s.travellerId === slot.id,
                );
                return (
                  <tr key={`${segment.id}-${slot.id}`}>
                    <td className="py-2 text-ink">{travellerDisplayName(session, slot.id)}</td>
                    <td className="py-2 text-ink-muted">
                      {formatFlightNumber(segment.flightNumber)} · {segment.departure.airport} →{' '}
                      {segment.arrival.airport}
                    </td>
                    <td className="py-2 text-ink">
                      {seat
                        ? `${seat.seatId} · ${SEAT_CATEGORY_LABELS[seat.category]}`
                        : 'Assigned at check-in'}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {seat
                        ? seat.included
                          ? 'Included'
                          : formatMinor(seat.priceMinor, currency)
                        : 'No charge'}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Seat choices are provisional: they aren’t reserved until checkout, where we confirm them
        again.
      </p>
    </ReviewSection>
  );
}

function ExtrasSection({ session, quote }: { session: ShoppingSession; quote: Quote }) {
  const extras = quote.lines.filter((line) => line.kind !== 'FLIGHTS' && line.kind !== 'SEAT');
  return (
    <ReviewSection
      id="extras"
      title="Baggage and extras"
      edit={{ href: STEP_HREF.extras, label: 'Change extras' }}
    >
      <ul className="space-y-2 text-sm">
        {tripSelections(session).map((selection) => {
          const checked = serviceFor(selection.offer.services, 'CHECKED_BAGGAGE');
          return (
            <li key={selection.direction} className="flex gap-2 text-ink">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              {selection.direction === 'outbound' ? 'Departing' : 'Return'}:{' '}
              {checked?.inclusion === 'included'
                ? `${checked.summary} checked baggage included per traveller`
                : 'no checked baggage included with this fare'}
              {serviceFor(selection.offer.services, 'PRIORITY_BOARDING')?.inclusion === 'included'
                ? '; priority check-in and boarding included'
                : ''}
              .
            </li>
          );
        })}
      </ul>
      {extras.length ? (
        <ul className="mt-4 divide-y divide-line text-sm" data-testid="review-extras-list">
          {extras.map((line) => (
            <li
              key={`${line.kind}-${line.detail}-${line.label}`}
              className="flex justify-between gap-4 py-2"
            >
              <span>
                <span className="font-semibold text-ink">{line.label}</span>
                <span className="block text-ink-muted">
                  {line.travellerId ? travellerDisplayName(session, line.travellerId) : ''} ·{' '}
                  {line.detail.split(' · ').slice(1).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {line.included ? 'Included' : formatMinor(line.amountMinor, quote.currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">No extras added.</p>
      )}
    </ReviewSection>
  );
}

function PriceSection({ quote }: { quote: Quote }) {
  const { totals, currency } = quote;
  const sum = (kind: QuoteLine['kind']) => quote.lines.filter((l) => l.kind === kind).length;
  const rows: { label: string; amount: number; count?: number; testId: string }[] = [
    { label: 'Base fares', amount: totals.baseFareMinor, testId: 'quote-base' },
    { label: 'Fare benefits', amount: totals.fareFamilyMinor, testId: 'quote-family' },
    { label: 'Taxes and mandatory fees', amount: totals.taxesMinor, testId: 'quote-taxes' },
    { label: 'Seats', amount: totals.seatsMinor, count: sum('SEAT'), testId: 'quote-seats' },
    {
      label: 'Extra baggage',
      amount: totals.baggageMinor,
      count: sum('BAGGAGE'),
      testId: 'quote-baggage',
    },
    { label: 'Meals', amount: totals.mealsMinor, count: sum('MEAL'), testId: 'quote-meals' },
    {
      label: 'Priority services',
      amount: totals.priorityMinor,
      count: sum('PRIORITY'),
      testId: 'quote-priority',
    },
  ];
  return (
    <ReviewSection id="price" title="Price summary">
      <dl className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-ink-muted">
              {row.label}
              {row.count ? ` (${row.count})` : ''}
            </dt>
            <dd className="text-ink tabular-nums" data-testid={row.testId}>
              {formatMinor(row.amount, currency)}
            </dd>
          </div>
        ))}
        <div className="flex items-end justify-between gap-4 border-t border-line pt-3">
          <dt className="font-semibold text-ink">
            Pre-checkout total
            <span className="block text-xs font-normal text-ink-muted">
              {currency}, all travellers. Not yet booked or paid.
            </span>
          </dt>
          <dd
            className="font-display text-2xl font-extrabold text-ink tabular-nums"
            data-testid="quote-total"
          >
            {formatMinor(totals.totalMinor, currency)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-muted">
        Included fare benefits are listed at no charge and never added to the total.
      </p>
    </ReviewSection>
  );
}
