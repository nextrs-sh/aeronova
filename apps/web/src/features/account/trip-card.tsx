import { ORDER_STATUS_LABELS, type TripSummary } from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Button } from '@velasia/ui/button';
import { AlertTriangle, ArrowRight, Plane } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatAirlineDateTime, formatMinor } from '@/lib/format';

const FAMILY = { LIGHT: 'Light', CLASSIC: 'Classic', FLEX: 'Flex', BUSINESS: 'Business' } as const;

/** One booking in a list: a projection from the API, never the whole order. */
export function TripCard({ trip, action }: { trip: TripSummary; action?: ReactNode }) {
  return (
    <article
      className="flex h-full flex-col rounded-[1.25rem] border border-line bg-white p-5 shadow-card"
      data-testid="trip-card"
      data-order={trip.orderId}
      data-status={trip.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-xl font-bold text-ink">
            {trip.origin}
            <Plane className="size-4 text-primary" aria-hidden="true" />
            <span className="sr-only">to</span>
            {trip.destination}
          </p>
          <p className="text-sm text-ink-muted">
            {trip.tripType === 'round-trip' ? 'Return trip' : 'One way'} ·{' '}
            {formatAirlineDateTime(trip.departsAt)}
            {trip.returnsAt ? ` – ${formatAirlineDateTime(trip.returnsAt)}` : ''}
          </p>
        </div>
        <Badge tone={trip.status === 'CONFIRMED' ? 'primary' : 'neutral'}>
          {ORDER_STATUS_LABELS[trip.status]}
        </Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">Reference</dt>
          <dd className="font-semibold tracking-wider text-ink tabular-nums">{trip.reference}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Fare</dt>
          <dd className="font-semibold text-ink">
            {[...new Set(trip.families.map((family) => FAMILY[family]))].join(' / ')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Travellers</dt>
          <dd className="text-ink">
            {trip.leadTraveller}
            {trip.travellers > 1 ? ` + ${trip.travellers - 1}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Flights</dt>
          <dd className="text-ink">
            {trip.flightNumbers.map((n) => n.replace(/^NV/, 'VEL ')).join(', ')}
          </dd>
        </div>
      </dl>
      {trip.flightStatus === 'disrupted' || trip.attention ? (
        <p className="mt-3 flex gap-2 rounded-xl bg-gold-50 p-2.5 text-xs font-semibold text-gold-900">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {trip.attention ?? 'A flight in this trip was cancelled by the airline (simulated).'}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        <span className="text-sm text-ink-muted tabular-nums">
          {formatMinor(trip.currentTotalMinor, trip.currency)}
        </span>
        {action ?? (
          <Button asChild size="sm" variant="secondary">
            <Link
              href={`/manage-booking/${trip.orderId}` as Route}
              aria-label={`Manage booking ${trip.reference}`}
            >
              Manage booking
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
    </article>
  );
}
