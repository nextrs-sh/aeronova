import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, type Order } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { ArrowRight, CheckCircle2, CircleSlash, Hourglass, Home, Lock } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Logo } from '@/components/brand/logo';
import { StepSkeleton } from '@/features/booking/recovery';
import { STEP_HREF } from '@/features/booking/trip';
import { loadOwnedOrder } from '@/features/checkout/data';
import {
  OrderFlights,
  OrderPriceSummary,
  OrderSeatsAndExtras,
  OrderSection,
  OrderTravellers,
} from '@/features/checkout/order-sections';
import { PrintButton } from '@/features/checkout/print-button';
import type { AirportNames } from '@/features/flights/itinerary-parts';
import { ResultsError } from '@/features/flights/results-states';
import { getAirports, loadSection } from '@/lib/content';
import { formatAirlineDateTime, formatMinor } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Your booking',
  description: 'Your fictional Velasia Airways booking.',
  robots: { index: false, follow: false },
};

/**
 * The booking confirmation, read from the durable order every time: it survives a refresh, a
 * new tab, and a restart of the retailing API. Only the browser that made the booking (its guest
 * cookie) can open it; the order id in the URL grants nothing on its own.
 */
export default function ConfirmationPage({ params }: PageProps<'/booking/confirmation/[orderId]'>) {
  return (
    <Container className="py-8 sm:py-12 print:py-0">
      <Suspense fallback={<StepSkeleton />}>
        <Confirmation params={params} />
      </Suspense>
    </Container>
  );
}

async function Confirmation({ params }: { params: Promise<{ orderId: string }> }) {
  await connection();
  const { orderId } = await params;
  const state = await loadOwnedOrder(orderId);
  if (state.status === 'error') {
    return <ResultsError kind={state.error} message="We couldn’t load your booking." />;
  }
  if (state.status !== 'ready') return <NotAvailable />;
  const { order } = state;
  if (order.status !== 'CONFIRMED') return <NotConfirmed order={order} />;
  const airports = await loadSection(getAirports);
  const names: AirportNames = Object.fromEntries(
    (airports.ok ? airports.data : []).map((a) => [a.code, { city: a.city, name: a.name }]),
  );
  return <Confirmed order={order} airports={names} />;
}

function Confirmed({ order, airports }: { order: Order; airports: AirportNames }) {
  const payment = order.payment.attempts.find((attempt) => attempt.status === 'SUCCEEDED')!;
  return (
    <div className="space-y-6" data-testid="confirmation" data-order-status={order.status}>
      <section
        aria-labelledby="confirmation-heading"
        className="overflow-hidden rounded-[1.75rem] bg-navy-950 text-white shadow-card print:bg-white print:text-ink print:shadow-none"
      >
        <div className="flex flex-wrap items-start justify-between gap-6 p-6 sm:p-8">
          <div className="min-w-0">
            <Logo tone="inverse" className="h-8 print:hidden" />
            <Logo className="hidden h-8 print:block" />
            <p className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary-on-dark print:text-ink">
              <CheckCircle2 className="size-5" aria-hidden="true" />
              Paid · simulated payment
            </p>
            <h1 id="confirmation-heading" className="mt-2 text-3xl font-bold sm:text-4xl">
              Booking confirmed
            </h1>
            <p className="mt-2 max-w-xl text-navy-100 print:text-ink-muted">
              Your fictional Velasia Airways booking has been confirmed in this demo. No real ticket
              was issued and no money moved.
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 p-5 text-left print:border print:border-line print:bg-white">
            <p className="text-xs font-semibold tracking-[0.14em] text-primary-on-dark uppercase print:text-ink-muted">
              Booking reference
            </p>
            <p
              className="mt-1 font-display text-3xl font-extrabold tracking-wider tabular-nums sm:text-4xl"
              data-testid="booking-reference"
            >
              {order.reference}
            </p>
            <p className="mt-2 text-xs text-navy-100 print:text-ink-muted">
              Booked {formatAirlineDateTime(order.confirmedAt ?? order.createdAt)} (Manila time)
            </p>
          </div>
        </div>
        <dl className="grid gap-px bg-white/10 sm:grid-cols-3 print:bg-line">
          {[
            ['Total paid (simulated)', formatMinor(order.totalMinor, order.currency)],
            [
              'Payment',
              `${PAYMENT_METHOD_LABELS[payment.method].name} · ${payment.providerReference}`,
            ],
            ['Travellers', String(order.passengers.length)],
          ].map(([label, value]) => (
            <div key={label} className="bg-navy-900 px-6 py-4 print:bg-white">
              <dt className="text-xs text-navy-200 print:text-ink-muted">{label}</dt>
              <dd
                className="mt-0.5 font-semibold break-words"
                data-testid={`confirmation-${label!.split(' ')[0]!.toLowerCase()}`}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap gap-3 print:hidden">
        <PrintButton />
        <Button asChild variant="outline">
          <a href="#booking-details">
            View booking details
            <ArrowRight aria-hidden="true" />
          </a>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">
            <Home aria-hidden="true" />
            Back to homepage
          </Link>
        </Button>
      </div>

      <div
        id="booking-details"
        className="grid scroll-mt-24 gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]"
      >
        <div className="min-w-0 space-y-6">
          <OrderFlights order={order} airports={airports} />
          <OrderTravellers order={order} />
          <OrderSeatsAndExtras order={order} />
        </div>
        <div className="space-y-4">
          <OrderSection id="price" title="Price">
            <OrderPriceSummary
              order={order}
              totalLabel="Total paid"
              totalNote={`${order.currency}, all travellers. Simulated payment.`}
            />
          </OrderSection>
          <p className="flex gap-2 rounded-[1.5rem] bg-surface p-5 text-xs text-ink-muted">
            <Lock className="size-4 shrink-0 text-navy-600" aria-hidden="true" />
            Only this browser can open this booking. Keep your reference for your records; it isn’t
            a password and can’t be used to open the booking elsewhere.
          </p>
        </div>
      </div>
    </div>
  );
}

function NotConfirmed({ order }: { order: Order }) {
  const pending = order.status === 'PENDING_PAYMENT';
  const Icon = pending ? Hourglass : CircleSlash;
  return (
    <section
      role="status"
      className="rounded-[1.75rem] border border-line bg-surface p-8 text-center"
      data-testid="confirmation-not-confirmed"
      data-order-status={order.status}
    >
      <Icon className="mx-auto size-8 text-navy-600" aria-hidden="true" />
      <h1 className="mt-3 font-display text-2xl font-bold text-ink">
        {ORDER_STATUS_LABELS[order.status]}
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-ink-muted">
        {pending
          ? 'This booking isn’t confirmed yet: its payment hasn’t succeeded. Finish it at checkout.'
          : 'This checkout ended without a successful payment, so nothing was booked and nothing was charged.'}
      </p>
      <Button asChild variant="secondary" className="mt-6">
        <Link href={pending ? STEP_HREF.checkout : ('/flights' as Route)}>
          {pending ? 'Return to checkout' : 'Search flights'}
        </Link>
      </Button>
    </section>
  );
}

function NotAvailable() {
  return (
    <section
      role="status"
      className="rounded-[1.75rem] border border-line bg-surface p-8 text-center"
      data-testid="confirmation-unavailable"
    >
      <Lock className="mx-auto size-8 text-navy-600" aria-hidden="true" />
      <h1 className="mt-3 font-display text-2xl font-bold text-ink">
        We can’t show this booking here
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-ink-muted">
        A booking can only be opened in the browser that made it. If that was you, open this link in
        the same browser.
      </p>
      <Button asChild variant="secondary" className="mt-6">
        <Link href="/">Back to homepage</Link>
      </Button>
    </section>
  );
}
