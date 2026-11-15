import { randomUUID } from 'node:crypto';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ownerCredentials } from '@/features/account/session';
import { StepSkeleton } from '@/features/booking/recovery';
import { loadPaymentOptions } from '@/features/checkout/data';
import { ResultsError } from '@/features/flights/results-states';
import { CancelForm } from '@/features/manage/cancel-form';
import { loadManagedOrder } from '@/features/manage/data';
import {
  BookingUnavailable,
  ManageHeader,
  NotModifiable,
  QuoteLines,
  manageHref,
} from '@/features/manage/parts';
import { formatMinor } from '@/lib/format';
import { RetailingApiError } from '@/lib/retailing-api/client';
import { servicingApi } from '@/lib/retailing-api/servicing';
import { logUpstreamFailure } from '@/lib/observability';

export const metadata: Metadata = {
  title: 'Cancel booking',
  robots: { index: false, follow: false },
};

/**
 * Cancel a booking (Milestone 6): the actual outcome first — what was paid, what comes back,
 * what is kept and why — then an explicit confirmation. Fictional rules; simulated refund.
 */
export default function CancelPage({ params }: PageProps<'/manage-booking/[orderId]/cancel'>) {
  return (
    <Container className="py-8 sm:py-12">
      <Suspense fallback={<StepSkeleton />}>
        <Cancel params={params} />
      </Suspense>
    </Container>
  );
}

async function Cancel({ params }: { params: Promise<{ orderId: string }> }) {
  await connection();
  const { orderId } = await params;
  const state = await loadManagedOrder(orderId);
  if (state.status === 'error') return <ResultsError kind={state.error} />;
  if (state.status !== 'ready') return <BookingUnavailable />;
  const { order, servicing } = state;
  if (!servicing.cancel.allowed) {
    return (
      <div className="space-y-6">
        <ManageHeader order={order} title="Cancel booking" back={manageHref(order.id)} />
        <NotModifiable order={order} what="Cancelling" />
      </div>
    );
  }
  let quote;
  try {
    quote = await servicingApi.cancellationQuote(order.id, await ownerCredentials());
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    logUpstreamFailure('manage', 'cancellation quote', error);
    return (
      <ResultsError
        kind={error.kind}
        message={error.kind === 'rejected' ? error.message : undefined}
      />
    );
  }
  const options = await loadPaymentOptions();
  const flights = order.journeys
    .map(
      (journey) =>
        `${journey.itinerary.origin} → ${journey.itinerary.destination} on ${journey.itinerary.departure.date}`,
    )
    .join(' and ');
  return (
    <div className="space-y-6" data-testid="cancel-booking">
      <ManageHeader order={order} title="Cancel booking" back={manageHref(order.id)} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section
          aria-labelledby="cancel-outcome"
          className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6"
        >
          <h2 id="cancel-outcome" className="font-display text-xl font-bold text-ink">
            What happens if you cancel
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Booking {order.reference}: {flights}, for {order.passengers.length}{' '}
            {order.passengers.length === 1 ? 'traveller' : 'travellers'}.
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3" data-testid="cancel-summary">
            {[
              ['Paid (simulated)', quote.paidMinor],
              ['Refund (simulated)', quote.refundMinor],
              ['Not refunded', quote.nonRefundableMinor + quote.feeMinor],
            ].map(([label, amount]) => (
              <div key={label as string} className="rounded-2xl bg-surface p-4">
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className="mt-1 font-display text-xl font-bold text-ink tabular-nums">
                  {formatMinor(amount as number, order.currency)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-6">
            <QuoteLines quote={quote} title="Line by line" />
          </div>
        </section>
        <section
          aria-labelledby="cancel-confirm"
          className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6 lg:self-start"
        >
          <h2 id="cancel-confirm" className="font-display text-xl font-bold text-ink">
            Confirm cancellation
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Your seats are released straight away. The refund is processed separately and its status
            is shown on your booking.
          </p>
          <div className="mt-4">
            <CancelForm
              orderId={order.id}
              revision={order.revision}
              refundMinor={quote.refundMinor}
              currency={order.currency}
              options={options}
              idempotencyKey={randomUUID()}
            />
          </div>
          <Button asChild variant="ghost" className="mt-2 w-full">
            <Link href={manageHref(order.id)}>Keep my booking</Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
