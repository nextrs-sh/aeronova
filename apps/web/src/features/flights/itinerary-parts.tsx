/*
 * Presentational pieces shared by result cards (server), the details panel
 * (client), and the trip review (server). No hooks and no browser APIs, so
 * they render identically on both sides of the boundary.
 *
 * Times come from the API as local airport times (`HH:MM` + `YYYY-MM-DD`);
 * they are printed as-is and never reinterpreted in the viewer's time zone.
 */
import {
  airline,
  CABIN_LABELS,
  daysBetween,
  type FlightEndpoint,
  formatFlightNumber,
  formatPassengerSummary,
  formatTravelDate,
  formatUtcOffsetLabel,
  type IndicativePrice,
  type Itinerary,
  type PassengerCounts,
} from '@velasia/contracts';
import { cn } from '@velasia/ui/cn';
import { Clock3, Plane } from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import { formatDuration, formatDurationLong, formatMinor, formatShortDate } from '@/lib/format';

/** Airport names for display, keyed by code. Plain data so it can cross to the client. */
export type AirportNames = Record<string, { city: string; name: string }>;

/** An itinerary with or without its indicative price (offers carry their own price). */
type ItineraryShape = Omit<Itinerary, 'price'>;

export function cityOf(airports: AirportNames, code: string): string {
  return airports[code]?.city ?? code;
}

export function AirlineMark({
  flightNumbers,
  className,
}: {
  flightNumbers: string[];
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm', className)}>
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-navy-950">
        <LogoMark tone="inverse" className="h-3.5" />
      </span>
      <span className="font-semibold text-ink">{airline.shortName}</span>
      {/* ink-muted, not ink-subtle: this also sits on tinted (navy-50) panels. */}
      <span className="text-ink-muted">{flightNumbers.map(formatFlightNumber).join(' · ')}</span>
    </span>
  );
}

/** `+1` when the arrival is on a later local date than the departure. */
export function DayOffset({ from, to }: { from: FlightEndpoint; to: FlightEndpoint }) {
  const days = daysBetween(from.date, to.date);
  if (days === 0) return null;
  return (
    <sup className="ml-0.5 text-xs font-bold text-gold-800">
      <span aria-hidden="true">{days > 0 ? `+${days}` : days}</span>
      <span className="sr-only">, arrives {formatTravelDate(to.date)}</span>
    </sup>
  );
}

export function stopsLabel(itinerary: Pick<Itinerary, 'stops' | 'connections'>): string {
  if (itinerary.stops === 0) return 'Direct';
  return `1 stop · ${itinerary.connections.map((c) => c.airport).join(', ')}`;
}

/** The schedule line: departure, duration and stops, arrival. */
export function FlightTimes({
  itinerary,
  airports,
  size = 'lg',
}: {
  itinerary: ItineraryShape;
  airports: AirportNames;
  size?: 'lg' | 'md';
}) {
  const { departure, arrival } = itinerary;
  const time = size === 'lg' ? 'text-2xl sm:text-[1.75rem]' : 'text-xl';
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-5">
      <div>
        <p className={cn('font-display leading-none font-bold text-ink tabular-nums', time)}>
          {departure.time}
        </p>
        <p className="mt-1.5 text-sm font-semibold text-ink-muted">
          {departure.airport}
          <span className="sr-only">, {cityOf(airports, departure.airport)}</span>
        </p>
      </div>
      <div className="flex min-w-0 flex-col items-center text-center">
        <p className="text-xs font-medium text-ink-muted">
          <span aria-hidden="true">{formatDuration(itinerary.durationMinutes)}</span>
          <span className="sr-only">
            Total journey {formatDurationLong(itinerary.durationMinutes)}
          </span>
        </p>
        <div className="relative my-1.5 flex w-full items-center" aria-hidden="true">
          <span className="size-1.5 rounded-full bg-navy-300" />
          <span className="h-px flex-1 bg-line-strong" />
          {itinerary.connections.map((connection) => (
            <span
              key={connection.airport}
              className="size-2 rounded-full border-2 border-gold-600 bg-white"
            />
          ))}
          {itinerary.stops > 0 ? <span className="h-px flex-1 bg-line-strong" /> : null}
          <Plane className="size-3.5 text-navy-400" />
        </div>
        <p
          className={cn(
            'truncate text-xs font-semibold',
            itinerary.stops === 0 ? 'text-success' : 'text-gold-800',
          )}
        >
          {stopsLabel(itinerary)}
        </p>
      </div>
      <div className="text-right">
        <p className={cn('font-display leading-none font-bold text-ink tabular-nums', time)}>
          {arrival.time}
          <DayOffset from={departure} to={arrival} />
        </p>
        <p className="mt-1.5 text-sm font-semibold text-ink-muted">
          {arrival.airport}
          <span className="sr-only">, {cityOf(airports, arrival.airport)}</span>
        </p>
      </div>
    </div>
  );
}

/** "From ₱7,540 per adult", plus the party total when it differs. */
export function PriceBlock({
  price,
  passengers,
  align = 'end',
}: {
  price: IndicativePrice;
  passengers: PassengerCounts;
  align?: 'start' | 'end';
}) {
  const onlyOneAdult = price.perAdultMinor === price.totalMinor;
  return (
    <div className={cn('flex flex-col', align === 'end' ? 'items-end text-right' : 'items-start')}>
      <p className="text-xs font-medium text-ink-muted">From</p>
      <p className="font-display text-2xl leading-tight font-extrabold text-ink tabular-nums">
        {formatMinor(price.perAdultMinor, price.currency)}
      </p>
      <p className="text-xs text-ink-muted">per adult · indicative</p>
      {onlyOneAdult ? null : (
        <p className="mt-1 text-xs font-semibold text-ink">
          {formatMinor(price.totalMinor, price.currency)}{' '}
          <span className="font-normal text-ink-muted">
            total for {formatPassengerSummary(passengers).toLowerCase()}
          </span>
        </p>
      )}
    </div>
  );
}

function Endpoint({ endpoint, airports }: { endpoint: FlightEndpoint; airports: AirportNames }) {
  const airport = airports[endpoint.airport];
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-lg font-bold text-ink tabular-nums">
          {endpoint.time}
        </span>
        <span className="text-sm font-medium text-ink-muted">
          {formatShortDate(endpoint.date)} · {formatUtcOffsetLabel(endpoint.utcOffset)}
        </span>
      </p>
      <p className="font-semibold text-ink">
        {airport?.city ?? endpoint.airport} ({endpoint.airport})
      </p>
      {airport ? <p className="text-sm break-words text-ink-muted">{airport.name}</p> : null}
    </div>
  );
}

/** Segment-by-segment itinerary with connection times, in local airport time. */
export function ItineraryTimeline({
  itinerary,
  airports,
}: {
  itinerary: ItineraryShape;
  airports: AirportNames;
}) {
  return (
    <ol className="space-y-0">
      {itinerary.segments.map((segment, index) => {
        const connection = itinerary.connections[index];
        return (
          <li key={segment.id}>
            <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
              <div className="flex flex-col items-center pt-2" aria-hidden="true">
                <span className="size-2.5 rounded-full border-2 border-navy-600 bg-white" />
                <span className="my-1 w-px flex-1 bg-navy-200" />
                <span className="size-2.5 rounded-full bg-navy-600" />
              </div>
              <div className="space-y-3">
                <Endpoint endpoint={segment.departure} airports={airports} />
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-surface px-3 py-2 text-sm text-ink-muted">
                  <AirlineMark flightNumbers={[segment.flightNumber]} />
                  <span aria-hidden="true">·</span>
                  <span>{segment.aircraft.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{CABIN_LABELS[segment.cabin]}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    <span aria-hidden="true">{formatDuration(segment.durationMinutes)}</span>
                    <span className="sr-only">
                      Flight time {formatDurationLong(segment.durationMinutes)}
                    </span>
                  </span>
                </p>
                <Endpoint endpoint={segment.arrival} airports={airports} />
              </div>
            </div>
            {connection ? (
              <p className="my-4 ml-8 flex items-center gap-2 rounded-xl border border-dashed border-gold-200 bg-gold-50 px-3 py-2 text-sm text-gold-900">
                <Clock3 className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">
                    {formatDuration(connection.durationMinutes)} connection
                  </strong>{' '}
                  in {cityOf(airports, connection.airport)} ({connection.airport})
                  {connection.overnight ? ' · overnight' : ''}
                </span>
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Per-passenger-type breakdown of an indicative price, including mandatory charges. */
export function PriceBreakdown({ price, title }: { price: IndicativePrice; title?: string }) {
  const nouns = {
    adult: ['Adult', 'Adults'],
    child: ['Child', 'Children'],
    infant: ['Infant', 'Infants'],
  };
  return (
    <div>
      {title ? <h3 className="font-semibold text-ink">{title}</h3> : null}
      <ul className="mt-2 space-y-3 text-sm">
        {price.breakdown.map((item) => (
          <li key={item.passengerType} className="rounded-xl bg-surface p-3">
            <p className="flex justify-between gap-4 font-semibold text-ink">
              <span>
                {item.count} {nouns[item.passengerType][item.count === 1 ? 0 : 1]}
              </span>
              <span className="tabular-nums">
                {formatMinor(item.subtotalMinor, price.currency)}
              </span>
            </p>
            <dl className="mt-1.5 space-y-1 text-ink-muted">
              <div className="flex justify-between gap-4">
                <dt>Fare{item.count > 1 ? ', each' : ''}</dt>
                <dd className="tabular-nums">{formatMinor(item.fareMinor, price.currency)}</dd>
              </div>
              {item.charges.map((charge) => (
                <div key={charge.label} className="flex justify-between gap-4">
                  <dt>{charge.label}</dt>
                  <dd className="tabular-nums">
                    {formatMinor(charge.amountMinor, price.currency)}
                  </dd>
                </div>
              ))}
              {item.charges.length === 0 ? (
                <div className="flex justify-between gap-4">
                  <dt>Taxes and charges</dt>
                  <dd>None (lap infant)</dd>
                </div>
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
