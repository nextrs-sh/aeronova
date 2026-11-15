import {
  CABIN_LABELS,
  SEAT_CATEGORY_LABELS,
  SPECIAL_ASSISTANCE,
  countryName,
  formatFlightNumber,
  formatTravelDate,
  serviceFor,
  slotLabel,
  travellerName,
  travellerTypeLabel,
  type Order,
  type OrderItem,
} from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Luggage, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { FlightTimes, type AirportNames } from '@/features/flights/itinerary-parts';
import { formatDuration, formatMinor, pluralize } from '@/lib/format';

/*
 * The order as the API describes it: at checkout and confirmation, what is being (or was)
 * bought; in Manage Booking (Milestone 6), the booking as it is now. Nothing here reads live
 * inventory or prices.
 */

export function travellerLabel(order: Order, id: string): string {
  const traveller = order.passengers.find((passenger) => passenger.id === id);
  return traveller ? travellerName(traveller) : slotLabel(id);
}

export function OrderSection({
  id,
  title,
  children,
  aside,
}: {
  id: string;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6 print:break-inside-avoid print:rounded-none print:border-0 print:p-0 print:shadow-none"
      data-testid={`order-${id}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="font-display text-xl font-bold text-ink">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function OrderFlights({ order, airports }: { order: Order; airports: AirportNames }) {
  return (
    <OrderSection id="flights" title="Flights">
      <div className="space-y-5">
        {order.journeys.map((journey) => {
          const { itinerary } = journey;
          const checked = serviceFor(journey.services, 'CHECKED_BAGGAGE');
          const cabinBags = serviceFor(journey.services, 'CABIN_BAGGAGE');
          return (
            <article
              key={journey.direction}
              className="rounded-2xl bg-surface p-4"
              data-testid={`order-leg-${journey.direction}`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-ink">
                  {journey.direction === 'outbound' ? 'Departing' : 'Return'} ·{' '}
                  {formatTravelDate(itinerary.departure.date)}
                </h3>
                <Badge tone="navy">{journey.familyName}</Badge>
              </div>
              <FlightTimes itinerary={itinerary} airports={airports} size="md" />
              <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                {itinerary.segments.map((segment) => (
                  <li key={segment.id}>
                    {formatFlightNumber(segment.flightNumber)} · {segment.departure.airport}{' '}
                    {segment.departure.time} → {segment.arrival.airport} {segment.arrival.time} ·{' '}
                    {formatDuration(segment.durationMinutes)} · {segment.aircraft.name} ·{' '}
                    {CABIN_LABELS[journey.cabin]}
                  </li>
                ))}
                {itinerary.connections.map((connection) => (
                  <li key={connection.airport}>
                    Connection in {connection.airport}: {formatDuration(connection.durationMinutes)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-ink">
                <span className="font-semibold">Fare includes:</span> cabin bag {cabinBags?.summary}{' '}
                · checked bag {checked?.inclusion === 'included' ? checked.summary : 'not included'}
              </p>
            </article>
          );
        })}
      </div>
    </OrderSection>
  );
}

export function OrderTravellers({ order }: { order: Order }) {
  return (
    <OrderSection id="travellers" title="Travellers and contact">
      <ul className="grid gap-3 sm:grid-cols-2">
        {order.passengers.map((passenger) => (
          <li key={passenger.id} className="rounded-2xl bg-surface p-4 text-sm">
            <p className="font-semibold text-ink">{travellerName(passenger, { full: true })}</p>
            <p className="text-ink-muted">
              {slotLabel(passenger.id)} · {travellerTypeLabel(passenger.type)} · born{' '}
              {formatTravelDate(passenger.dateOfBirth)} · {countryName(passenger.nationality)}
            </p>
            {passenger.infantOf ? (
              <p className="text-ink-muted">
                On the lap of {travellerLabel(order, passenger.infantOf)}
              </p>
            ) : null}
            {passenger.specialAssistance ? (
              <p className="text-ink-muted">
                Assistance: {SPECIAL_ASSISTANCE[passenger.specialAssistance]}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm break-words text-ink-muted">
        Contact: <span className="text-ink">{order.contact.email}</span> ·{' '}
        <span className="text-ink">{order.contact.phone}</span>
      </p>
    </OrderSection>
  );
}

export function OrderSeatsAndExtras({ order }: { order: Order }) {
  const segments = order.journeys.flatMap((journey) => journey.itinerary.segments);
  const seated = order.passengers.filter((passenger) => passenger.type !== 'infant');
  const extras = order.items.filter(
    (item) => item.kind === 'BAGGAGE' || item.kind === 'MEAL' || item.kind === 'PRIORITY',
  );
  return (
    <OrderSection id="extras" title="Seats, baggage and extras">
      <ul className="space-y-2 text-sm" data-testid="order-seats">
        {segments.map((segment) => (
          <li key={segment.id} className="rounded-2xl bg-surface p-3">
            <p className="font-semibold text-ink">
              {formatFlightNumber(segment.flightNumber)} · {segment.departure.airport} →{' '}
              {segment.arrival.airport}
            </p>
            <ul className="mt-1 text-ink-muted">
              {seated.map((traveller) => {
                const seat = order.seats.find(
                  (s) => s.flightId === segment.id && s.travellerId === traveller.id,
                );
                return (
                  <li key={traveller.id} className="flex flex-wrap justify-between gap-x-4">
                    <span>{travellerName(traveller)}</span>
                    <span className="text-ink">
                      {seat
                        ? `Seat ${seat.seatId} · ${SEAT_CATEGORY_LABELS[seat.category]}`
                        : 'Seat assigned at check-in'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <h3 className="mt-5 mb-2 flex items-center gap-2 text-sm font-bold text-ink">
        <Luggage className="size-4 text-navy-600" aria-hidden="true" />
        Checked baggage allowance
      </h3>
      <ul className="space-y-1 text-sm text-ink-muted" data-testid="order-baggage">
        {order.baggage.map((bag) => (
          <li key={`${bag.travellerId}-${bag.direction}`}>
            {travellerLabel(order, bag.travellerId)} ·{' '}
            {bag.direction === 'outbound' ? 'departing' : 'return'}:{' '}
            <span className="text-ink">{bag.totalKg > 0 ? `${bag.totalKg} kg` : 'none'}</span>
            {bag.extraKg > 0 ? ` (${bag.includedKg} kg included + ${bag.extraKg} kg added)` : ''}
          </li>
        ))}
      </ul>
      {extras.length ? (
        <ul className="mt-4 divide-y divide-line text-sm" data-testid="order-extras-list">
          {extras.map((item) => (
            <li key={item.id} className="flex justify-between gap-4 py-2">
              <span>
                <span className="font-semibold text-ink">{item.label}</span>
                <span className="block text-ink-muted">
                  {item.travellerId ? travellerLabel(order, item.travellerId) : ''} ·{' '}
                  {item.detail.split(' · ').slice(1).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {item.included ? 'Included' : formatMinor(item.amountMinor, order.currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">No paid extras.</p>
      )}
    </OrderSection>
  );
}

const GROUPS: { kinds: OrderItem['kind'][]; label: string; testId: string }[] = [
  { kinds: ['FLIGHT'], label: 'Flights', testId: 'order-price-flights' },
  { kinds: ['SEAT'], label: 'Seats', testId: 'order-price-seats' },
  { kinds: ['BAGGAGE'], label: 'Extra baggage', testId: 'order-price-baggage' },
  { kinds: ['MEAL'], label: 'Meals', testId: 'order-price-meals' },
  { kinds: ['PRIORITY'], label: 'Priority services', testId: 'order-price-priority' },
  { kinds: ['CHANGE_FEE'], label: 'Change fees', testId: 'order-price-change-fees' },
];

/** The itemised price, from the order's own items. */
export function OrderPriceSummary({
  order,
  totalLabel,
  totalNote,
}: {
  order: Order;
  totalLabel: string;
  totalNote: string;
}) {
  const { totals, currency } = order;
  return (
    <div data-testid="order-price">
      <ul className="space-y-3 text-sm">
        {GROUPS.map((group) => {
          const items = order.items.filter((item) => group.kinds.includes(item.kind));
          if (items.length === 0) return null;
          return (
            <li key={group.label}>
              <p className="flex justify-between gap-4 font-semibold text-ink">
                <span>{group.label}</span>
                <span className="tabular-nums" data-testid={group.testId}>
                  {formatMinor(
                    items.reduce((sum, item) => sum + item.amountMinor, 0),
                    currency,
                  )}
                </span>
              </p>
              <ul className="mt-1 space-y-0.5 text-ink-muted">
                {items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-4">
                    <span className="min-w-0">
                      {item.label}
                      {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                      {item.travellerId ? ` · ${travellerLabel(order, item.travellerId)}` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {item.included ? 'Included' : formatMinor(item.amountMinor, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
        {/* The fare/tax split is the checkout quote's; after a change only the items are current. */}
        {order.currentVersion === 1 ? (
          <>
            <div className="flex justify-between gap-4 text-ink-muted">
              <dt>Fares and fare benefits</dt>
              <dd className="tabular-nums">
                {formatMinor(totals.baseFareMinor + totals.fareFamilyMinor, currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 text-ink-muted">
              <dt>Taxes and mandatory fees</dt>
              <dd className="tabular-nums" data-testid="order-price-taxes">
                {formatMinor(totals.taxesMinor, currency)}
              </dd>
            </div>
          </>
        ) : null}
        <div className="flex items-end justify-between gap-4 border-t border-line pt-3">
          <dt className="font-semibold text-ink">
            {totalLabel}
            <span className="block text-xs font-normal text-ink-muted">{totalNote}</span>
          </dt>
          <dd
            className="font-display text-2xl font-extrabold text-ink tabular-nums"
            data-testid="order-total"
          >
            {formatMinor(order.currentTotalMinor, currency)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 flex gap-2 text-xs text-ink-muted">
        <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        {pluralize(order.passengers.length, 'traveller')}. Prices are fixed for this order and
        include all taxes and fees. Nothing is added later.
      </p>
    </div>
  );
}
