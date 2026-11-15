import {
  ORDER_STATUS_LABELS,
  SERVICING_OPERATION_LABELS,
  type Order,
  type OrderEvent,
  type ServicingQuote,
  type ServicingRecord,
} from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import { ArrowLeft, CircleSlash, type Clock, Lock } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatAirlineDateTime, formatMinor } from '@/lib/format';

/*
 * Manage Booking building blocks (Milestone 6). Server-rendered and free of client state: every
 * amount comes from the API's quote or order, formatted here and never computed.
 */

export const manageHref = (orderId: string, path = '') =>
  `/manage-booking/${orderId}${path}` as Route;

const ADJUSTMENT_LABEL = {
  CHARGE: 'To pay now',
  REFUND: 'Refunded to your payment',
  CREDIT: 'Kept as travel credit',
  NONE: 'No price difference',
} as const;

/** A quote, line by line, with what it means for the traveller's money. */
export function QuoteLines({
  quote,
  title = 'Price of this change',
}: {
  quote: ServicingQuote;
  title?: string;
}) {
  const cancellation = quote.operation === 'CANCEL_ORDER';
  return (
    <div
      data-testid="servicing-quote"
      data-net={quote.netMinor}
      data-adjustment={quote.adjustment.kind}
    >
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {quote.lines.map((line, index) => (
          <li
            key={`${line.kind}-${index}`}
            className="flex justify-between gap-4"
            data-testid={`quote-line-${line.kind}`}
          >
            <span className="min-w-0">
              <span className="font-medium text-ink">{line.label}</span>
              {line.detail ? (
                <span className="block text-xs text-ink-muted">{line.detail}</span>
              ) : null}
            </span>
            <span
              className={cn(
                'shrink-0 tabular-nums',
                cancellation
                  ? line.amountMinor < 0
                    ? 'font-semibold text-success'
                    : 'text-ink-muted'
                  : line.amountMinor < 0
                    ? 'text-success'
                    : 'text-ink',
              )}
            >
              {cancellation
                ? line.amountMinor < 0
                  ? `${formatMinor(-line.amountMinor, quote.currency)} back`
                  : `${formatMinor(line.amountMinor, quote.currency)} kept`
                : `${line.amountMinor < 0 ? '−' : ''}${formatMinor(Math.abs(line.amountMinor), quote.currency)}`}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-end justify-between gap-4 border-t border-line pt-3">
        <span className="font-semibold text-ink">{ADJUSTMENT_LABEL[quote.adjustment.kind]}</span>
        <span
          className="font-display text-2xl font-extrabold text-ink tabular-nums"
          data-testid="quote-amount"
        >
          {formatMinor(quote.adjustment.amountMinor, quote.currency)}
        </span>
      </div>
      {quote.notes.length ? (
        <ul className="mt-3 space-y-1 text-xs text-ink-muted">
          {quote.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function OrderStatusBadge({ order }: { order: Order }) {
  const tone =
    order.status === 'CONFIRMED'
      ? 'primary'
      : order.status === 'BOOKING_CANCELLED'
        ? 'neutral'
        : 'gold';
  return (
    <Badge tone={tone} data-testid="order-status">
      {ORDER_STATUS_LABELS[order.status]}
    </Badge>
  );
}

/** The navy booking header: reference, status, and dates. Compact on phones. */
export function ManageHeader({
  order,
  title,
  back,
  children,
}: {
  order: Order;
  title?: string;
  back?: Route;
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="manage-heading"
      className="overflow-hidden rounded-[1.75rem] bg-navy-950 text-white shadow-card print:bg-white print:text-ink print:shadow-none"
      data-testid="manage-header"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-8">
        <div className="min-w-0">
          {back ? (
            <Link
              href={back}
              className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-on-dark hover:underline print:hidden"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to your booking
            </Link>
          ) : null}
          <p className="text-xs font-bold tracking-[0.16em] text-primary-on-dark uppercase">
            Manage booking
          </p>
          <h1 id="manage-heading" className="mt-1 font-display text-2xl font-bold sm:text-4xl">
            {title ??
              `${order.journeys[0]!.itinerary.origin} → ${order.journeys[0]!.itinerary.destination}`}
          </h1>
          <p className="mt-2 text-sm text-navy-100 print:text-ink-muted">
            Booked {formatAirlineDateTime(order.confirmedAt ?? order.createdAt)} · Last changed{' '}
            {formatAirlineDateTime(order.updatedAt)} (Manila time)
          </p>
        </div>
        <div className="rounded-2xl bg-white/10 px-4 py-3 print:border print:border-line">
          <p className="text-xs font-semibold tracking-[0.14em] text-navy-100 uppercase print:text-ink-muted">
            Booking reference
          </p>
          <p
            className="font-display text-2xl font-extrabold tracking-wider tabular-nums sm:text-3xl"
            data-testid="booking-reference"
          >
            {order.reference}
          </p>
          <div className="mt-2">
            <OrderStatusBadge order={order} />
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

/** Paid, refunded, pending, credit: from durable records only. */
export function MoneySummary({ order }: { order: Order }) {
  const { financial, currency } = order;
  const rows: [string, number, string?][] = [
    ['Paid (simulated)', financial.paidMinor],
    ['Refunded (simulated)', financial.refundedMinor],
    ['Refund in progress', financial.refundPendingMinor, 'attention'],
    ['Refund not completed', financial.refundFailedMinor, 'danger'],
    ['Travel credit (fictional)', financial.creditMinor],
  ];
  return (
    <dl className="space-y-1 text-sm" data-testid="money-summary">
      {rows
        .filter(([, amount], index) => index === 0 || amount > 0)
        .map(([label, amount, tone]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt
              className={cn(
                'text-ink-muted',
                tone === 'danger' && 'text-danger',
                tone === 'attention' && 'text-gold-800',
              )}
            >
              {label}
            </dt>
            <dd className="font-semibold text-ink tabular-nums">{formatMinor(amount, currency)}</dd>
          </div>
        ))}
    </dl>
  );
}

/** In the history, a completed operation's money is in the past tense. */
const DONE_LABEL = { CHARGE: 'Paid', REFUND: 'Refund', CREDIT: 'Travel credit', NONE: '' } as const;

const STATUS_COPY: Record<ServicingRecord['status'], string> = {
  QUOTED: 'Quoted',
  AWAITING_PAYMENT: 'Waiting for payment',
  COMPLETED: 'Done',
  FAILED: 'Not applied',
  EXPIRED: 'Expired',
};

/** What happened to the booking after it was confirmed, newest first. */
export function ServicingHistory({ order, events }: { order: Order; events: OrderEvent[] | null }) {
  const records = [...order.servicing].reverse();
  return (
    <div data-testid="servicing-history">
      {records.length === 0 ? (
        <p className="text-sm text-ink-muted">No changes yet. Everything is as you booked it.</p>
      ) : (
        <ol className="space-y-3">
          {records.map((record) => (
            <li
              key={record.id}
              className="rounded-2xl border border-line p-4"
              data-testid="servicing-record"
              data-status={record.status}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink">
                  {SERVICING_OPERATION_LABELS[record.operation]}
                </p>
                <Badge
                  tone={
                    record.status === 'COMPLETED'
                      ? 'primary'
                      : record.status === 'AWAITING_PAYMENT'
                        ? 'gold'
                        : 'neutral'
                  }
                >
                  {STATUS_COPY[record.status]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{record.summary}</p>
              <p className="mt-1 text-xs text-ink-subtle">
                {formatAirlineDateTime(record.completedAt ?? record.createdAt)}
                {record.adjustment.kind !== 'NONE'
                  ? ` · ${(record.status === 'COMPLETED' ? DONE_LABEL : ADJUSTMENT_LABEL)[record.adjustment.kind]}: ${formatMinor(record.adjustment.amountMinor, order.currency)}`
                  : ''}
                {record.refunds.length
                  ? ` · Refund ${record.refunds.at(-1)!.status.toLowerCase()}`
                  : ''}
                {record.failureReason && record.status !== 'COMPLETED'
                  ? ` · ${record.failureReason}`
                  : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
      {events?.length ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Detailed booking log</summary>
          <ol className="mt-2 space-y-1 text-xs text-ink-muted">
            {events.map((event) => (
              <li key={event.seq} className="flex gap-3">
                <span className="w-36 shrink-0 tabular-nums">
                  {formatAirlineDateTime(event.at)}
                </span>
                <span>{event.type.replaceAll('_', ' ').toLowerCase()}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

/** One servicing action: a link when it can be used, an explanation when it can't. */
export function ActionCard({
  icon: Icon,
  title,
  description,
  href,
  reason,
  testId,
}: {
  icon: typeof Clock;
  title: string;
  description: string;
  href: Route | null;
  reason: string | null;
  testId: string;
}) {
  const body = (
    <>
      <Icon
        className={cn('size-6', href ? 'text-primary' : 'text-ink-subtle')}
        aria-hidden="true"
      />
      <span className="mt-3 block font-semibold text-ink">{title}</span>
      <span className="mt-1 block text-sm text-ink-muted">{href ? description : reason}</span>
    </>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-[1.25rem] border border-line bg-white p-4 shadow-card transition-colors hover:border-primary-border hover:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      data-testid={testId}
    >
      {body}
    </Link>
  ) : (
    <div
      className="rounded-[1.25rem] border border-dashed border-line bg-surface p-4"
      data-testid={testId}
      data-disabled="true"
    >
      {body}
    </div>
  );
}

export function BookingUnavailable() {
  return (
    <section
      role="status"
      className="rounded-[1.75rem] border border-line bg-surface p-8 text-center"
      data-testid="manage-unavailable"
    >
      <Lock className="mx-auto size-8 text-navy-600" aria-hidden="true" />
      <h1 className="mt-3 font-display text-2xl font-bold text-ink">
        We can’t open this booking here
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-ink-muted">
        A booking opens only in the browser that made it, or in the account it was added to. Sign
        in, or open it in that browser.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild variant="secondary">
          <Link href={'/account/sign-in?next=/account/trips' as Route}>Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/manage-booking">Manage booking</Link>
        </Button>
      </div>
    </section>
  );
}

export function NotModifiable({ order, what }: { order: Order; what: string }) {
  return (
    <section
      role="status"
      className="rounded-[1.5rem] border border-line bg-surface p-6"
      data-testid="not-modifiable"
    >
      <CircleSlash className="size-6 text-navy-600" aria-hidden="true" />
      <h2 className="mt-2 font-display text-xl font-bold text-ink">
        {what} isn’t available for this booking
      </h2>
      <p className="mt-1 text-ink-muted">
        {order.status === 'BOOKING_CANCELLED'
          ? 'This booking was cancelled, so it can no longer be changed.'
          : 'It may have closed for these flights, or another change is waiting for payment.'}
      </p>
      <Button asChild variant="outline" className="mt-4">
        <Link href={manageHref(order.id)}>Back to your booking</Link>
      </Button>
    </section>
  );
}
