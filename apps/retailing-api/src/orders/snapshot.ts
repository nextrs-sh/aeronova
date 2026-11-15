import {
  SEAT_CATEGORY_LABELS,
  requiredDirections,
  totalSeated,
  type OrderItem,
  type Quote,
  type QuoteLine,
  type ShoppingSession,
  type TravellerBaggage,
} from '@velasia/contracts';
import type { OrderSnapshot, StoredAllocation } from '../db/schema';
import { ANCILLARIES_BY_ID } from '../fixtures/ancillaries';
import { FARE_FAMILIES_BY_CODE } from '../fixtures/fare-families';
import { hashOf } from './ids';

/*
 * What an order buys, captured once from a freshly validated session and its quote. The result
 * is immutable: a confirmed order is never re-priced or rebuilt from live inventory.
 */

export interface OrderContent {
  snapshot: OrderSnapshot;
  items: OrderItem[];
  allocations: StoredAllocation[];
  totals: Quote['totals'];
  totalMinor: number;
  currency: string;
  pricingVersion: string;
  /** Identifies what was bought, to recognise the same checkout made twice. */
  contentHash: string;
}

const PASSENGER_TYPE_LABELS = { adult: 'Adult', child: 'Child', infant: 'Infant' } as const;

export class SnapshotError extends Error {
  override readonly name = 'SnapshotError';
}

/** Find the quote line describing an item, for its human-readable detail. */
function detailFrom(lines: readonly QuoteLine[], match: (line: QuoteLine) => boolean): string {
  const line = lines.find(match);
  if (!line) throw new SnapshotError('The quote has no line for an item being bought.');
  return line.detail;
}

export function buildOrderContent({
  session,
  quote,
  baggage,
}: {
  session: ShoppingSession;
  quote: Quote;
  baggage: TravellerBaggage[];
}): OrderContent {
  const { booking, search } = session;
  if (!booking.passengers || !booking.contact) {
    throw new SnapshotError('Traveller details are missing.');
  }
  const selections = requiredDirections(search).map((direction) => {
    const selection = session.selections[direction];
    if (!selection) throw new SnapshotError(`No ${direction} flight is selected.`);
    return selection;
  });

  const journeys = selections.map((selection) => {
    const family = FARE_FAMILIES_BY_CODE.get(selection.offer.family);
    if (!family) throw new SnapshotError(`Unknown fare family ${selection.offer.family}.`);
    return {
      direction: selection.direction,
      offerId: selection.offer.id,
      family: selection.offer.family,
      familyName: family.name,
      cabin: selection.offer.cabin,
      itinerary: selection.offer.itinerary,
      services: selection.offer.services,
      price: selection.offer.price,
    };
  });

  const items: OrderItem[] = [];
  for (const journey of journeys) {
    const flightDetail = detailFrom(
      quote.lines,
      (line) => line.kind === 'FLIGHTS' && line.direction === journey.direction,
    );
    for (const line of journey.price.passengers) {
      items.push({
        id: `flight-${journey.direction}-${line.passengerType}`,
        kind: 'FLIGHT',
        label: `${journey.familyName} · ${PASSENGER_TYPE_LABELS[line.passengerType]}`,
        detail: flightDetail,
        direction: journey.direction,
        travellerId: null,
        flightId: null,
        productCode: journey.family,
        quantity: line.count,
        unitPriceMinor: line.unitTotalMinor,
        amountMinor: line.subtotalMinor,
        included: false,
      });
    }
  }
  for (const seat of booking.seats) {
    const label = `Seat ${seat.seatId} · ${SEAT_CATEGORY_LABELS[seat.category]}`;
    const journey = journeys.find((candidate) =>
      candidate.itinerary.segments.some((segment) => segment.id === seat.flightId),
    );
    if (!journey) throw new SnapshotError('A seat is on a flight outside the trip.');
    items.push({
      id: `seat-${seat.travellerId}-${seat.flightId}`,
      kind: 'SEAT',
      label,
      detail: detailFrom(
        quote.lines,
        (line) =>
          line.kind === 'SEAT' &&
          line.travellerId === seat.travellerId &&
          line.flightId === seat.flightId,
      ),
      direction: journey.direction,
      travellerId: seat.travellerId,
      flightId: seat.flightId,
      productCode: seat.category,
      quantity: 1,
      unitPriceMinor: seat.priceMinor,
      amountMinor: seat.priceMinor,
      included: seat.included,
    });
  }
  for (const selection of booking.ancillaries) {
    const product = ANCILLARIES_BY_ID.get(selection.productId);
    if (!product) throw new SnapshotError(`Unknown service ${selection.productId}.`);
    items.push({
      id: `${selection.id}-${selection.productId}`,
      kind: selection.category,
      label: product.name,
      detail: detailFrom(
        quote.lines,
        (line) =>
          line.kind === selection.category &&
          line.label === product.name &&
          line.travellerId === selection.travellerId &&
          line.direction === selection.direction &&
          line.flightId === selection.flightId,
      ),
      direction: selection.direction,
      travellerId: selection.travellerId,
      flightId: selection.flightId,
      productCode: selection.productId,
      quantity: selection.quantity,
      unitPriceMinor: selection.priceMinor,
      amountMinor: selection.priceMinor * selection.quantity,
      included: selection.included,
    });
  }

  const totalMinor = items.reduce((sum, item) => sum + item.amountMinor, 0);
  if (totalMinor !== quote.totals.totalMinor) {
    throw new SnapshotError('Order items don’t add up to the validated quote.');
  }

  const seatsPerFlight = totalSeated(search.passengers);
  const allocations: StoredAllocation[] = journeys.flatMap((journey) =>
    journey.itinerary.segments.map((segment) => ({
      flightId: segment.id,
      cabin: journey.cabin,
      seats: seatsPerFlight,
      seatIds: booking.seats
        .filter((seat) => seat.flightId === segment.id)
        .map((seat) => seat.seatId)
        .sort(),
    })),
  );

  const snapshot: OrderSnapshot = {
    search: {
      tripType: search.tripType,
      origin: search.origin,
      destination: search.destination,
      cabin: search.cabin,
      passengers: { ...search.passengers },
    },
    journeys,
    passengers: booking.passengers,
    contact: booking.contact,
    seats: booking.seats,
    ancillaries: booking.ancillaries,
    baggage,
  };

  const contentHash = hashOf({
    journeys: journeys.map((journey) => ({
      direction: journey.direction,
      itineraryId: journey.itinerary.id,
      family: journey.family,
      totalMinor: journey.price.totalMinor,
    })),
    passengers: booking.passengers,
    contact: booking.contact,
    seats: booking.seats.map(({ travellerId, flightId, seatId }) => ({
      travellerId,
      flightId,
      seatId,
    })),
    ancillaries: booking.ancillaries.map(({ productId, travellerId, direction, flightId }) => ({
      productId,
      travellerId,
      direction,
      flightId,
    })),
    totalMinor,
  });

  return {
    snapshot,
    items,
    allocations,
    totals: quote.totals,
    totalMinor,
    currency: quote.currency,
    pricingVersion: quote.priceVersion,
    contentHash,
  };
}
