import { travellerSlots, type OrderJourney } from '@velasia/contracts';
import { longestBand, type ServiceLeg, type ServiceTrip } from '../booking/booking';
import type { StoredOrder } from '../db/schema';
import { FARE_FAMILIES_BY_CODE } from '../fixtures/fare-families';
import type { FlightInstance, Inventory } from '../inventory/inventory';

/*
 * A confirmed booking as the M4 service rules see it: its legs (direction, fare family, dated
 * flights) and its traveller slots. Ancillary offers, meal service, seat prices, and baggage
 * allowances after booking are computed by the same functions as during the booking steps.
 */

export interface OrderLeg extends ServiceLeg {
  journey: OrderJourney;
  /** First departure of the direction (UTC ms). */
  departsAt: number;
  /** Every flight of the direction is still in the inventory (today or later). */
  live: boolean;
}

export interface OrderTrip extends ServiceTrip {
  legs: OrderLeg[];
}

export function orderTrip(order: StoredOrder, inventory: Inventory): OrderTrip {
  const legs = order.current.journeys.map((journey): OrderLeg => {
    const family = FARE_FAMILIES_BY_CODE.get(journey.family)!;
    const segments = journey.itinerary.segments
      .map((segment) => inventory.getInstance(segment.id))
      .filter((segment): segment is FlightInstance => segment !== undefined);
    return {
      direction: journey.direction,
      family,
      segments,
      band: longestBand(segments),
      journey,
      departsAt: Date.parse(journey.itinerary.departure.at),
      live: segments.length === journey.itinerary.segments.length,
    };
  });
  return { legs, slots: travellerSlots(order.snapshot.search.passengers) };
}

export function legFor(trip: OrderTrip, flightId: string) {
  for (const leg of trip.legs) {
    const segment = leg.segments.find((candidate) => candidate.id === flightId);
    if (segment) return { leg, segment };
  }
  return null;
}
