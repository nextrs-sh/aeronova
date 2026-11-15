import { randomUUID } from 'node:crypto';
import { formatFlightNumber, formatTravelDate } from '@velasia/contracts';
import { Container } from '@velasia/ui/container';
import { cn } from '@velasia/ui/cn';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ownerCredentials } from '@/features/account/session';
import { StepSkeleton } from '@/features/booking/recovery';
import { loadPaymentOptions } from '@/features/checkout/data';
import { ResultsError } from '@/features/flights/results-states';
import { loadManagedOrder, safely } from '@/features/manage/data';
import {
  BookingUnavailable,
  ManageHeader,
  NotModifiable,
  manageHref,
} from '@/features/manage/parts';
import { SeatChangeFlow } from '@/features/manage/seat-change';
import { servicingApi } from '@/lib/retailing-api/servicing';

export const metadata: Metadata = {
  title: 'Manage seats',
  robots: { index: false, follow: false },
};

/** Seats after booking (Milestone 6): one flight at a time, the aircraft's own seat map. */
export default function ManageSeatsPage({
  params,
  searchParams,
}: PageProps<'/manage-booking/[orderId]/seats'>) {
  return (
    <Container className="py-8 sm:py-12">
      <Suspense fallback={<StepSkeleton />}>
        <Seats params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Seats({
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
  if (!servicing.seats.allowed) {
    return (
      <div className="space-y-6">
        <ManageHeader order={order} title="Manage seats" back={manageHref(order.id)} />
        <NotModifiable order={order} what="Changing seats" />
      </div>
    );
  }
  const segments = order.journeys.flatMap((journey) =>
    journey.itinerary.segments.map((segment) => ({
      flightId: segment.id,
      directionLabel: journey.direction === 'outbound' ? 'Departing' : 'Return',
      route: `${segment.departure.airport} → ${segment.arrival.airport}`,
      flightNumber: formatFlightNumber(segment.flightNumber),
      date: formatTravelDate(segment.departure.date),
      aircraft: segment.aircraft.name,
    })),
  );
  const flightId =
    segments.find((segment) => segment.flightId === query.flight)?.flightId ??
    segments[0]!.flightId;
  const credentials = await ownerCredentials();
  const [map, options] = await Promise.all([
    safely('seat map', () => servicingApi.seatMap(order.id, credentials, flightId)),
    loadPaymentOptions(),
  ]);
  const segment = segments.find((candidate) => candidate.flightId === flightId)!;

  return (
    <div className="space-y-6" data-testid="manage-seats">
      <ManageHeader order={order} title="Manage seats" back={manageHref(order.id)} />
      {segments.length > 1 ? (
        <nav aria-label="Flights" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {segments.map((candidate) => {
            const active = candidate.flightId === flightId;
            return (
              <Link
                key={candidate.flightId}
                href={`${manageHref(order.id, '/seats')}?flight=${candidate.flightId}` as Route}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-2xl border p-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  active
                    ? 'border-navy-900 bg-navy-950 text-white'
                    : 'border-line bg-white hover:bg-surface',
                )}
                data-testid={`manage-flight-tab-${candidate.flightId}`}
              >
                <span
                  className={cn(
                    'block text-xs font-semibold',
                    active ? 'text-primary-on-dark' : 'text-primary',
                  )}
                >
                  {candidate.directionLabel} · {candidate.flightNumber}
                </span>
                <span className="block font-semibold">{candidate.route}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
      {map ? (
        <SeatChangeFlow
          key={flightId}
          orderId={order.id}
          revision={order.revision}
          segment={segment}
          map={map}
          assignments={order.seats}
          options={options}
          idempotencyKey={randomUUID()}
        />
      ) : (
        <p role="alert" className="rounded-2xl bg-danger-surface p-4 text-sm text-danger">
          We couldn’t load this seat map. Please try again.
        </p>
      )}
    </div>
  );
}
