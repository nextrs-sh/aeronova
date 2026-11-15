import { randomUUID } from 'node:crypto';
import type { Order, PaymentOptions } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import {
  ArrowLeft,
  ChevronDown,
  CircleSlash,
  Clock,
  Hourglass,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { StepSkeleton } from '@/features/booking/recovery';
import { STEP_HREF } from '@/features/booking/trip';
import { CheckoutStartForm, CheckoutRecheckForm } from '@/features/checkout/checkout-start-form';
import { loadCheckoutOrder, loadPaymentOptions } from '@/features/checkout/data';
import { HoldTimer } from '@/features/checkout/hold-timer';
import {
  OrderFlights,
  OrderPriceSummary,
  OrderSeatsAndExtras,
  OrderSection,
  OrderTravellers,
} from '@/features/checkout/order-sections';
import { PaymentForm, PaymentStatusCheck } from '@/features/checkout/payment-form';
import type { AirportNames } from '@/features/flights/itinerary-parts';
import { ResultsError } from '@/features/flights/results-states';
import { loadShoppingSession } from '@/features/shopping/data';
import { getAirports, loadSection } from '@/lib/content';
import { formatAirlineTime, formatMinor } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Confirm your Velasia Airways trip with a simulated payment.',
  robots: { index: false, follow: false },
};

/**
 * Step 5: checkout. Everything shown comes from the pending order the API created when checkout
 * began — a durable snapshot, not the live shopping session — so a refresh, or a restart of the
 * retailing API, shows exactly the same trip and total. Payment is simulated.
 */
export default function CheckoutPage() {
  return (
    <>
      <div className="bg-navy-950 text-white print:hidden">
        <Container className="py-8 sm:py-10">
          <p className="text-xs font-bold tracking-[0.16em] text-primary-on-dark uppercase">
            Book your trip · Checkout
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Checkout</h1>
          <p className="mt-2 max-w-2xl text-base text-navy-100 sm:text-lg">
            Check your trip, choose a demo payment method, and confirm. No real money moves.
          </p>
        </Container>
      </div>
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<StepSkeleton />}>
          <Checkout />
        </Suspense>
      </Container>
    </>
  );
}

async function Checkout() {
  await connection();
  const state = await loadCheckoutOrder();
  if (state.status === 'error') {
    return <ResultsError kind={state.error} message="We couldn’t load your checkout." />;
  }
  if (state.status !== 'ready') return <NoCheckout />;
  const { order } = state;
  if (order.status === 'CONFIRMED') redirect(`/booking/confirmation/${order.id}` as Route);
  if (order.status !== 'PENDING_PAYMENT') return <CheckoutClosed order={order} />;
  const [options, airports] = await Promise.all([loadPaymentOptions(), loadSection(getAirports)]);
  const names: AirportNames = Object.fromEntries(
    (airports.ok ? airports.data : []).map((a) => [a.code, { city: a.city, name: a.name }]),
  );
  return <CheckoutView order={order} options={options} airports={names} />;
}

// ---------------------------------------------------------------------------
// The pending order
// ---------------------------------------------------------------------------

function CheckoutView({
  order,
  options,
  airports,
}: {
  order: Order;
  options: PaymentOptions | null;
  airports: AirportNames;
}) {
  const remainingMs = Date.parse(order.hold.expiresAt) - Date.parse(order.serverTime);
  const total = formatMinor(order.totalMinor, order.currency);
  const summary = (
    <OrderPriceSummary
      order={order}
      totalLabel="Total to pay"
      totalNote={`${order.currency}, all travellers, taxes included. Simulated payment.`}
    />
  );
  return (
    <div className="space-y-6" data-testid="checkout" data-order-status={order.status}>
      {/* Phones: the trip and price summary folds away above the form. */}
      <details
        className="group rounded-[1.5rem] border border-line bg-white shadow-card lg:hidden"
        data-testid="checkout-summary-mobile"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-xs font-semibold text-ink-muted">Total to pay</span>
            <span className="font-display text-xl font-extrabold text-ink tabular-nums">
              {total}
            </span>
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold text-primary">
            Trip summary
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </span>
        </summary>
        <div className="border-t border-line p-4">{summary}</div>
      </details>
      <a
        href="#payment"
        className="-mt-3 block text-right text-sm font-semibold text-primary underline-offset-4 hover:text-primary-hover hover:underline lg:hidden"
        data-testid="go-to-payment"
      >
        Go to payment ↓
      </a>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <HoldTimer remainingMs={remainingMs} until={formatAirlineTime(order.hold.expiresAt)} />
          <OrderTravellers order={order} />
          <OrderFlights order={order} airports={airports} />
          <OrderSeatsAndExtras order={order} />
          <PaymentSection order={order} options={options} />
          <Button asChild variant="ghost">
            <Link href={STEP_HREF.review}>
              <ArrowLeft aria-hidden="true" />
              Back to your booking review
            </Link>
          </Button>
        </div>
        <aside className="hidden lg:block" aria-label="Price summary">
          <div className="sticky top-24 space-y-4">
            <section className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card">
              <h2 className="mb-4 font-display text-xl font-bold text-ink">Your trip</h2>
              {summary}
            </section>
            <Conditions order={order} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Conditions({ order }: { order: Order }) {
  return (
    <ul
      className="space-y-2 rounded-[1.5rem] bg-surface p-5 text-xs text-ink-muted"
      aria-label="Important conditions"
    >
      <li className="flex gap-2">
        <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        This is a fictional demo. No ticket is issued, no seat is really reserved, and no money
        moves.
      </li>
      <li className="flex gap-2">
        <Clock className="size-4 shrink-0 text-navy-600" aria-hidden="true" />
        Seats are held until {formatAirlineTime(order.hold.expiresAt)} (Manila time). Pay before
        then to confirm.
      </li>
      <li className="flex gap-2">
        <ShieldCheck className="size-4 shrink-0 text-navy-600" aria-hidden="true" />
        The total is fixed for this checkout and includes every tax and fee.
      </li>
    </ul>
  );
}

function PaymentSection({ order, options }: { order: Order; options: PaymentOptions | null }) {
  const last = order.payment.attempts.at(-1);
  let body: ReactNode;
  if (order.payment.awaitingResult) {
    body = (
      <div className="space-y-4" data-testid="payment-awaiting">
        <p className="flex gap-3 rounded-2xl bg-navy-50 p-4 text-sm text-ink">
          <Hourglass className="mt-0.5 size-5 shrink-0 text-navy-600" aria-hidden="true" />
          <span>
            <span className="block font-semibold">
              {last?.status === 'PENDING' ? 'Payment pending' : 'Confirming your payment'}
            </span>
            Your booking isn’t confirmed yet. We’re waiting for the demo payment provider — check
            the status to find out. Don’t pay again: nothing will be charged twice.
          </span>
        </p>
        <PaymentStatusCheck orderId={order.id} autoFocus />
      </div>
    );
  } else if (!order.payment.canPay) {
    body = (
      <p className="text-sm text-ink-muted" data-testid="payment-closed">
        This checkout can’t take a payment any more. Refresh the page to see its latest state.
      </p>
    );
  } else if (!options) {
    body = <ResultsError kind="unavailable" message="Demo payment methods couldn’t be loaded." />;
  } else {
    body = (
      <>
        {last?.status === 'FAILED' ? (
          <p
            className="mb-4 rounded-2xl bg-danger-surface p-3 text-sm text-danger"
            data-testid="payment-last-failed"
          >
            <span className="font-semibold">Payment unsuccessful.</span> {last.failureReason} You
            can try again while your seats are held.
          </p>
        ) : null}
        <PaymentForm
          orderId={order.id}
          totalMinor={order.totalMinor}
          currency={order.currency}
          options={options}
          retry={last?.status === 'FAILED'}
          idempotencyKey={randomUUID()}
        />
      </>
    );
  }
  return (
    <div id="payment" className="scroll-mt-24">
      <OrderSection id="payment" title="Demo payment">
        {body}
      </OrderSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No checkout, or a checkout that has ended
// ---------------------------------------------------------------------------

function Panel({
  icon: Icon,
  title,
  children,
  reason,
}: {
  icon: typeof Search;
  title: string;
  children: ReactNode;
  reason: string;
}) {
  return (
    <section
      role="status"
      className="rounded-[1.75rem] border border-line bg-surface p-8 text-center"
      data-testid="checkout-recovery"
      data-reason={reason}
    >
      <Icon className="mx-auto size-8 text-navy-600" aria-hidden="true" />
      <h2 className="mt-3 font-display text-2xl font-bold text-ink">{title}</h2>
      <div className="mx-auto mt-2 flex max-w-xl flex-col items-center gap-4 text-ink-muted">
        {children}
      </div>
    </section>
  );
}

/** How to start (again) from the shopping session, if there still is one. */
async function StartAgain({ label }: { label: string }) {
  const state = await loadShoppingSession();
  if (state.status !== 'active') {
    return (
      <Button asChild variant="secondary">
        <Link href={'/flights' as Route}>
          <Search aria-hidden="true" />
          Start a new search
        </Link>
      </Button>
    );
  }
  const { session } = state;
  const review = session.booking.review;
  if (review?.current && review.status === 'READY') {
    return (
      <CheckoutStartForm
        version={session.version}
        totalMinor={review.totalMinor}
        idempotencyKey={randomUUID()}
        label={label}
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <CheckoutRecheckForm />
      <Link
        href={STEP_HREF.review}
        className="text-sm font-semibold text-primary underline-offset-4 hover:text-primary-hover hover:underline"
      >
        Go to your booking review
      </Link>
    </div>
  );
}

function NoCheckout() {
  return (
    <Panel icon={Search} title="There’s no checkout in progress" reason="none">
      <p>Review your booking first: checkout starts from there.</p>
      <StartAgain label="Continue to checkout" />
    </Panel>
  );
}

function CheckoutClosed({ order }: { order: Order }) {
  const content = {
    EXPIRED: {
      icon: Clock,
      title: 'Your seat hold has ended',
      body: 'We released the seats because the payment wasn’t completed in time. Nothing was charged. Your trip is still saved: check availability to hold the seats again.',
    },
    PAYMENT_FAILED: {
      icon: CircleSlash,
      title: 'Payment unsuccessful',
      body: 'Every demo payment attempt for this checkout was declined, so we released the seats. Nothing was charged.',
    },
    CANCELLED: {
      icon: CircleSlash,
      title: 'This checkout was replaced',
      body: 'You started a newer checkout for this trip, so this one was closed and its seats released.',
    },
  }[order.status as 'EXPIRED' | 'PAYMENT_FAILED' | 'CANCELLED'];
  return (
    <Panel icon={content.icon} title={content.title} reason={order.status.toLowerCase()}>
      <p>{content.body}</p>
      <StartAgain label="Check availability and hold again" />
    </Panel>
  );
}
