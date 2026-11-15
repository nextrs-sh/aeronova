import {
  formatUtcOffset,
  toZonedDateTime,
  type CabinClass,
  type FlightEndpoint,
  type FlightSegment,
  type Itinerary,
  type PassengerCounts,
} from '@aeronova/contracts';
import { AIRCRAFT_BY_CODE } from './fixtures/aircraft';
import { AIRPORTS_BY_CODE } from './fixtures/airports';
import { seatsAvailable, type FlightInstance } from './inventory/inventory';
import { priceItinerary } from './pricing/pricing';
import type { Candidate } from './search/itineraries';

/*
 * Internal inventory → public DTOs. Nothing internal (load factors, demand,
 * seeds, sold counts) leaves the API except through these functions.
 */

export function toEndpoint(airport: string, utcMs: number): FlightEndpoint {
  const zoned = toZonedDateTime(new Date(utcMs), AIRPORTS_BY_CODE.get(airport)!.timeZone);
  return {
    airport,
    date: zoned.date,
    time: zoned.time,
    utcOffset: formatUtcOffset(zoned.offsetMinutes),
    at: new Date(utcMs).toISOString(),
  };
}

export function toSegment(instance: FlightInstance, cabin: CabinClass): FlightSegment {
  const { schedule } = instance;
  const aircraft = AIRCRAFT_BY_CODE.get(schedule.aircraftCode)!;
  return {
    id: instance.id,
    flightNumber: schedule.flightNumber,
    status: instance.status,
    departure: toEndpoint(schedule.origin, instance.departureUtc),
    arrival: toEndpoint(schedule.destination, instance.arrivalUtc),
    durationMinutes: schedule.blockMinutes,
    distanceKm: schedule.distanceKm,
    aircraft: { code: aircraft.code, name: aircraft.name },
    cabin,
    seatsAvailable: seatsAvailable(instance, cabin),
  };
}

export function toItinerary(
  candidate: Candidate,
  cabin: CabinClass,
  passengers: PassengerCounts,
): Itinerary {
  const segments = candidate.segments.map((instance) => toSegment(instance, cabin));
  const first = candidate.segments[0]!;
  const last = candidate.segments.at(-1)!;
  const connections = candidate.segments.slice(1).map((next, index) => {
    const previous = segments[index]!;
    const following = segments[index + 1]!;
    return {
      airport: next.schedule.origin,
      durationMinutes: Math.round(
        (next.departureUtc - candidate.segments[index]!.arrivalUtc) / 60_000,
      ),
      overnight: following.departure.date !== previous.arrival.date,
    };
  });
  return {
    id: candidate.id,
    origin: first.schedule.origin,
    destination: last.schedule.destination,
    departure: segments[0]!.departure,
    arrival: segments.at(-1)!.arrival,
    durationMinutes: Math.round((last.arrivalUtc - first.departureUtc) / 60_000),
    stops: segments.length - 1,
    segments,
    connections,
    cabin,
    seatsAvailable: Math.min(...segments.map((segment) => segment.seatsAvailable)),
    price: priceItinerary(candidate.segments, cabin, passengers),
  };
}
