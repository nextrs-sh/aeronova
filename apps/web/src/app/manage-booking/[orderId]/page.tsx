import { randomUUID } from 'node:crypto';
import { formatMinor } from '@/lib/format';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import {
  Armchair,
  CalendarSync,
  CheckCircle2,
  CircleX,
  Hourglass,
  Luggage,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { StepSkeleton } from '@/features/booking/recovery';
import { loadPaymentOptions } from '@/features/checkout/data';
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
import {
  abandonServicingAction,
  payServicingAction,
  refreshServicingAction,
  retryRefundAction,
} from '@/features/manage/actions';
import { loadManagedOrder, safely } from '@/features/manage/data';
import {
  ActionCard,
  BookingUnavailable,
  ManageHeader,
  MoneySummary,
  ServicingHistory,
  manageHref,
} from '@/features/manage/parts';
import { PayAgainForm, SmallActionForm } from '@/features/manage/servicing-confirm';
import { ownerCredentials } from '@/features/account/session';
import { getAirports, loadSection } from '@/lib/content';
import { servicingApi } from '@/lib/retailing-api/servicing';

export const metadata: Metadata = {
  title: 'Manage your booking',
  description: 'Your fictional Velasia Airways booking.',
  robots: { index: false, follow: false },
};

const UPDATED: Record<string, string> = {
  flight: 'Your flight was changed.',
  seats: 'Your seat was changed.',
  extras: 'Your services were added.',
  paid: 'Payment received: your change is done.',
  cancelled: 'Your booking was cancelled.',
  discarded: 'The change was discarded. Your booking is as it was.',
};
/** Outcomes that need the traveller's attention (shown in the attention colour). */
const NOTICES: Record<string, string> = {
  declined:
    'The demo payment was declined, so your booking hasn’t changed. Try again below, or discard the change.',
  pending:
    'Your payment is still being processed. Your booking changes only once it succeeds — don’t pay again.',
};

/**
 * Manage Booking (Milestone 6): the booking as it is now, what can be done with it, and its
 * history. Rendered per request for its owner only (guest or account cookie, checked by the
 * API); the order id in the URL grants nothing.
 */
export default function ManageOrderPage({
  params,
  searchParams,
}: PageProps<'/manage-booking/[orderId]'>) {
  return (
    <Container className="py-8 sm:py-12 print:py-0">
      <Suspense fallback={<StepSkeleton />}>
        <Overview params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Overview({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const state = await loadManagedOrder(orderId);
  if (state.status === 'error')
    return <ResultsError kind={state.error} message="We couldn’t load your booking." />;
  if (state.status !== 'ready') return <BookingUnavailable />;
  const { order, servicing } = state;
  const credentials = await ownerCredentials();
  const [airports, options, events] = await Promise.all([
    loadSection(getAirports),
    loadPaymentOptions(),
    safely('events', () => servicingApi.events(order.id, credentials)),
  ]);
  const names: AirportNames = Object.fromEntries(
    (airports.ok ? airports.data : []).map((a) => [a.code, { city: a.city, name: a.name }]),
  );
  const pending = order.servicing.find((record) => record.status === 'AWAITING_PAYMENT');
  const refundOpen = order.financial.refundPendingMinor > 0;
  const refundFailed = order.financial.refundFailedMinor > 0;
  const updated = typeof query.updated === 'string' ? UPDATED[query.updated] : undefined;
  const notice = typeof query.updated === 'string' ? NOTICES[query.updated] : undefined;
  const byDirection = (direction: 'outbound' | 'inbound') =>
    servicing.changeFlight.find((c) => c.direction === direction);

  return (
    <div
      className="space-y-6"
      data-testid="manage-booking"
      data-order-status={order.status}
      data-revision={order.revision}
    >
      <ManageHeader order={order} />

      {updated ? (
        <p
          role="status"
          className="flex gap-2 rounded-2xl bg-primary-subtle p-4 text-sm font-semibold text-ink"
          data-testid="manage-updated"
        >
          <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
          {updated}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="rounded-2xl bg-gold-50 p-4 text-sm font-semibold text-gold-900"
          data-testid="manage-notice"
        >
          {notice}
        </p>
      ) : null}

      {pending ? (
        <section
          className="rounded-[1.5rem] border border-gold-300 bg-gold-50 p-5 sm:p-6"
          data-testid="pending-change"
          aria-labelledby="pending-heading"
        >
          <h2
            id="pending-heading"
            className="flex items-center gap-2 font-display text-xl font-bold text-ink"
          >
            <Hourglass className="size-5 text-gold-800" aria-hidden="true" />A change is waiting for
            payment
          </h2>
          <p className="mt-1 text-sm text-ink">{pending.summary}</p>
          <p className="mt-1 text-sm text-ink-muted">
            Your booking is unchanged until this is paid.{' '}
            {formatMinor(pending.adjustment.amountMinor, order.currency)} to pay.
            {pending.payment?.attempts.at(-1)?.failureReason
              ? ` Last attempt: ${pending.payment.attempts.at(-1)!.failureReason}`
              : ''}
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            {pending.payment?.canPay && options ? (
              <PayAgainForm
                action={payServicingAction}
                orderId={order.id}
                operationId={pending.id}
                amountMinor={pending.adjustment.amountMinor}
                currency={order.currency}
                options={options}
                idempotencyKey={randomUUID()}
              />
            ) : (
              <p className="text-sm text-ink">
                We’re waiting for the payment result. Don’t pay again — check the status.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {pending.payment?.awaitingResult ? (
                <SmallActionForm
                  action={refreshServicingAction}
                  fields={{ orderId: order.id }}
                  label="Check payment status"
                  testId="check-servicing-status"
                  variant="secondary"
                />
              ) : (
                <SmallActionForm
                  action={abandonServicingAction}
                  fields={{ orderId: order.id, operationId: pending.id }}
                  label="Discard this change"
                  testId="discard-change"
                />
              )}
            </div>
          </div>
        </section>
      ) : null}

      {refundOpen || refundFailed ? (
        <section
          className="flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] border border-line bg-white p-5 shadow-card"
          data-testid="refund-status"
          data-state={refundFailed ? 'failed' : 'pending'}
        >
          <div>
            <h2 className="font-display text-lg font-bold text-ink">
              {refundFailed
                ? 'Your simulated refund didn’t go through'
                : 'Your simulated refund is being processed'}
            </h2>
            <p className="text-sm text-ink-muted">
              {formatMinor(
                refundFailed
                  ? order.financial.refundFailedMinor
                  : order.financial.refundPendingMinor,
                order.currency,
              )}{' '}
              {refundFailed
                ? 'hasn’t been returned yet. You can try again.'
                : 'will be returned to your original payment method.'}
            </p>
          </div>
          {refundFailed ? (
            <SmallActionForm
              action={retryRefundAction}
              fields={{ orderId: order.id }}
              label="Try the refund again"
              testId="retry-refund"
              variant="secondary"
            />
          ) : (
            <SmallActionForm
              action={refreshServicingAction}
              fields={{ orderId: order.id }}
              label="Check refund status"
              testId="check-refund-status"
              variant="secondary"
            />
          )}
        </section>
      ) : null}

      <section aria-labelledby="actions-heading" className="print:hidden">
        <h2 id="actions-heading" className="sr-only">
          What you can do
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(['outbound', 'inbound'] as const).map((direction) => {
            const change = byDirection(direction);
            if (!change) return null;
            return (
              <li key={direction}>
                <ActionCard
                  icon={CalendarSync}
                  title={
                    direction === 'outbound'
                      ? order.journeys.length > 1
                        ? 'Change departing flight'
                        : 'Change flight'
                      : 'Change return flight'
                  }
                  description={
                    change.feePerTravellerMinor > 0
                      ? `Change fee ${formatMinor(change.feePerTravellerMinor, order.currency)} per traveller, plus any fare difference.`
                      : 'No change fee. Any fare difference applies.'
                  }
                  href={
                    change.allowed
                      ? (`${manageHref(order.id, '/change-flight')}?direction=${direction}` as never)
                      : null
                  }
                  reason={change.reason}
                  testId={`action-change-${direction}`}
                />
              </li>
            );
          })}
          <li>
            <ActionCard
              icon={Armchair}
              title="Manage seats"
              description="Choose or change seats on any flight."
              href={servicing.seats.allowed ? manageHref(order.id, '/seats') : null}
              reason={servicing.seats.reason}
              testId="action-seats"
            />
          </li>
          <li>
            <ActionCard
              icon={Luggage}
              title="Add services"
              description="Extra baggage, meals, and priority services."
              href={servicing.extras.allowed ? manageHref(order.id, '/extras') : null}
              reason={servicing.extras.reason}
              testId="action-extras"
            />
          </li>
          <li>
            <ActionCard
              icon={CircleX}
              title="Cancel booking"
              description="See what would be refunded before you decide."
              href={servicing.cancel.allowed ? manageHref(order.id, '/cancel') : null}
              reason={servicing.cancel.reason}
              testId="action-cancel"
            />
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          <PrintButton />
          {order.owner === 'GUEST' ? (
            <Button asChild variant="ghost">
              <Link href="/account/trips">
                <UserRound aria-hidden="true" />
                Add to My Trips
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <OrderFlights order={order} airports={names} />
          <OrderTravellers order={order} />
          <OrderSeatsAndExtras order={order} />
          <OrderSection id="history" title="Booking history">
            <ServicingHistory order={order} events={events?.data ?? null} />
          </OrderSection>
        </div>
        <div className="space-y-4">
          <OrderSection id="price" title="Price">
            <OrderPriceSummary
              order={order}
              totalLabel="Booking value now"
              totalNote={`${order.currency}, all travellers. Simulated payments.`}
            />
          </OrderSection>
          <OrderSection id="payments" title="Payments and refunds">
            <MoneySummary order={order} />
            <p className="mt-3 text-xs text-ink-muted">
              Velasia Airways is fictional. Payments and refunds are simulated; no money moves and
              no ticket exists.
            </p>
          </OrderSection>
        </div>
      </div>
    </div>
  );
}
