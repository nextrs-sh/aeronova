import { randomUUID } from 'node:crypto';
import { formatFlightNumber } from '@velasia/contracts';
import { Container } from '@velasia/ui/container';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ownerCredentials } from '@/features/account/session';
import { StepSkeleton } from '@/features/booking/recovery';
import { loadPaymentOptions } from '@/features/checkout/data';
import { ResultsError } from '@/features/flights/results-states';
import { loadManagedOrder, safely } from '@/features/manage/data';
import { ExtrasPicker } from '@/features/manage/extras-picker';
import {
  BookingUnavailable,
  ManageHeader,
  NotModifiable,
  manageHref,
} from '@/features/manage/parts';
import { retailingApi } from '@/lib/retailing-api/client';
import { servicingApi } from '@/lib/retailing-api/servicing';

export const metadata: Metadata = {
  title: 'Add services',
  robots: { index: false, follow: false },
};

/** Services after booking (Milestone 6): the M4 catalogue, priced for what the booking owns. */
export default function ManageExtrasPage({
  params,
}: PageProps<'/manage-booking/[orderId]/extras'>) {
  return (
    <Container className="py-8 sm:py-12">
      <Suspense fallback={<StepSkeleton />}>
        <Extras params={params} />
      </Suspense>
    </Container>
  );
}

async function Extras({ params }: { params: Promise<{ orderId: string }> }) {
  await connection();
  const { orderId } = await params;
  const state = await loadManagedOrder(orderId);
  if (state.status === 'error') return <ResultsError kind={state.error} />;
  if (state.status !== 'ready') return <BookingUnavailable />;
  const { order, servicing } = state;
  if (!servicing.extras.allowed) {
    return (
      <div className="space-y-6">
        <ManageHeader order={order} title="Add services" back={manageHref(order.id)} />
        <NotModifiable order={order} what="Adding services" />
      </div>
    );
  }
  const credentials = await ownerCredentials();
  const [ancillaries, catalogue, options] = await Promise.all([
    safely('ancillaries', () => servicingApi.ancillaries(order.id, credentials)),
    safely('catalogue', () => retailingApi.getAncillaryCatalogue()),
    loadPaymentOptions(),
  ]);
  if (!ancillaries) return <ResultsError kind="unavailable" />;
  const products = Object.fromEntries(
    (catalogue?.data ?? []).map((product) => [product.id, product.name]),
  );
  const flights = Object.fromEntries(
    order.journeys.flatMap((journey) =>
      journey.itinerary.segments.map((segment) => [
        segment.id,
        `${segment.departure.airport} → ${segment.arrival.airport} · ${formatFlightNumber(segment.flightNumber)}`,
      ]),
    ),
  );
  return (
    <div className="space-y-6" data-testid="manage-extras">
      <ManageHeader order={order} title="Add services" back={manageHref(order.id)} />
      <ExtrasPicker
        order={order}
        ancillaries={ancillaries}
        products={products}
        flights={flights}
        options={options}
        idempotencyKey={randomUUID()}
      />
    </div>
  );
}
