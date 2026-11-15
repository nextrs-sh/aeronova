import { flightInstanceIdSchema, formatFlightNumber, formatTravelDate } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { continueFromSeatsAction } from '@/features/booking/actions';
import { BookingFrame } from '@/features/booking/booking-frame';
import { ContinueForm } from '@/features/booking/continue-form';
import { loadBookingStep, loadSeatMap } from '@/features/booking/data';
import { BookingRecovery, StepSkeleton } from '@/features/booking/recovery';
import { SeatSelector, type SeatSegment } from '@/features/booking/seat-selector';
import { StepHeader } from '@/features/booking/step-header';
import { STEP_HREF, tripSegments } from '@/features/booking/trip';
import { ResultsError } from '@/features/flights/results-states';

export const metadata: Metadata = {
  title: 'Choose seats',
  description: 'Choose seats for each traveller on each flight of your Velasia Airways trip.',
  robots: { index: false, follow: false },
};

/**
 * Step 2: seats. One seat map per flight, priced for the guest's fare. Choosing is optional:
 * anyone without a seat is assigned one free at check-in.
 */
export default function SeatsPage({ searchParams }: PageProps<'/booking/seats'>) {
  return (
    <>
      <StepHeader
        step={2}
        title="Choose your seats"
        description="Pick a seat for each traveller on each flight, or skip it and we’ll assign seats at check-in."
      />
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<StepSkeleton />}>
          <SeatsStep searchParams={searchParams} />
        </Suspense>
      </Container>
    </>
  );
}

async function SeatsStep({ searchParams }: Pick<PageProps<'/booking/seats'>, 'searchParams'>) {
  await connection();
  const state = await loadBookingStep('seats');
  if (state.status !== 'ready')
    return <BookingRecovery state={state} retryHref={STEP_HREF.seats} />;
  const { session } = state;
  const segments = tripSegments(session);
  const requested = flightInstanceIdSchema.safeParse((await searchParams).flight);
  const active =
    segments.find((s) => requested.success && s.segment.id === requested.data) ?? segments[0]!;
  const seatMap = await loadSeatMap(active.segment.id);
  const views: SeatSegment[] = segments.map(({ direction, segment }) => ({
    flightId: segment.id,
    directionLabel: direction === 'outbound' ? 'Departing' : 'Return',
    route: `${segment.departure.airport} → ${segment.arrival.airport}`,
    flightNumber: formatFlightNumber(segment.flightNumber),
    date: `${formatTravelDate(segment.departure.date)} · ${segment.departure.time}`,
    aircraft: segment.aircraft.name,
  }));
  return (
    <BookingFrame session={session} step="seats">
      {seatMap.ok ? (
        <SeatSelector
          // A different first flight (e.g. after a change) starts the selector afresh.
          key={segments.map((s) => s.segment.id).join()}
          segments={views}
          initialMap={seatMap.data}
          assignments={session.booking.seats}
        />
      ) : (
        <ResultsError kind={seatMap.error} message="We couldn’t load the seat map." />
      )}
      <div className="flex flex-col-reverse gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="outline">
          <Link href={STEP_HREF.travellers}>
            <ArrowLeft aria-hidden="true" />
            Traveller details
          </Link>
        </Button>
        <div className="sm:text-right">
          <p className="mb-2 text-sm text-ink-muted">
            Seats are provisional until checkout. Travellers without a seat get one at check-in at
            no charge.
          </p>
          <ContinueForm
            action={continueFromSeatsAction}
            label="Continue to extras"
            pendingLabel="Saving…"
            testId="continue-seats"
          />
        </div>
      </div>
    </BookingFrame>
  );
}
