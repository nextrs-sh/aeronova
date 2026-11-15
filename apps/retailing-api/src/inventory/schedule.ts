import {
  addDays,
  daysBetween,
  distanceBandFor,
  toZonedDateTime,
  zonedDateTimeToUtc,
  type DistanceBand,
} from '@aeronova/contracts';
import { AIRCRAFT_BY_CODE } from '../fixtures/aircraft';
import { AIRPORT_LOCATIONS, AIRPORTS_BY_CODE } from '../fixtures/airports';
import type { Rotation, Weekday } from '../fixtures/network';
import { blockMinutesFor, greatCircleKm } from './geo';

/** A published schedule pattern: one flight number, its times, and operating days. */
export interface ScheduledFlight {
  flightNumber: string;
  routeId: string;
  origin: string;
  destination: string;
  kind: 'domestic' | 'international';
  distanceKm: number;
  distanceBand: DistanceBand;
  /** Local departure time at the origin. */
  departureTime: string;
  /** Local arrival time at the destination. */
  arrivalTime: string;
  /** Local arrival date minus local departure date (0 or 1). */
  arrivalDayOffset: number;
  blockMinutes: number;
  /** ISO weekdays (in the origin's local time) on which the flight departs. */
  days: Weekday[];
  aircraftCode: string;
}

/**
 * Schedule patterns are computed on a fixed reference Monday. Every airport in
 * the network observes no daylight saving time (checked in tests), so local
 * times are the same on every date; dated instances are still converted
 * through the IANA zone individually.
 */
const PATTERN_DATE = '2026-01-05';

function airport(code: string) {
  const found = AIRPORTS_BY_CODE.get(code);
  const location = AIRPORT_LOCATIONS[code];
  if (!found || !location) throw new Error(`Network references unknown airport ${code}`);
  return { ...found, location };
}

function defaultTurnaround(kind: ScheduledFlight['kind'], aircraftCode: string): number {
  if (AIRCRAFT_BY_CODE.get(aircraftCode)?.bodyType === 'widebody') return 80;
  return kind === 'domestic' ? 40 : 60;
}

function pattern(
  flightNumber: number,
  originCode: string,
  destinationCode: string,
  departureTime: string,
  days: readonly Weekday[],
  aircraftCode: string,
): ScheduledFlight {
  const origin = airport(originCode);
  const destination = airport(destinationCode);
  if (!AIRCRAFT_BY_CODE.has(aircraftCode)) throw new Error(`Unknown aircraft ${aircraftCode}`);
  const distanceKm = greatCircleKm(origin.location, destination.location);
  const blockMinutes = blockMinutesFor(distanceKm, origin.location, destination.location);
  const departs = zonedDateTimeToUtc(PATTERN_DATE, departureTime, origin.timeZone);
  const arrives = toZonedDateTime(
    new Date(departs.getTime() + blockMinutes * 60_000),
    destination.timeZone,
  );
  return {
    flightNumber: `NV${flightNumber}`,
    routeId: `${originCode}-${destinationCode}`,
    origin: originCode,
    destination: destinationCode,
    kind: origin.countryCode === destination.countryCode ? 'domestic' : 'international',
    distanceKm,
    distanceBand: distanceBandFor(distanceKm),
    departureTime,
    arrivalTime: arrives.time,
    arrivalDayOffset: daysBetween(PATTERN_DATE, arrives.date),
    blockMinutes,
    days: [...days].sort(),
    aircraftCode,
  };
}

const shiftWeekday = (day: Weekday, by: number) => ((((day - 1 + by) % 7) + 7) % 7) + 1;

/** Expand rotations into outbound and return schedule patterns. */
export function buildSchedule(rotations: readonly Rotation[]): ScheduledFlight[] {
  const flights: ScheduledFlight[] = [];
  for (const rotation of rotations) {
    if (rotation.flightNumber % 2 === 0) {
      throw new Error(`Outbound flight numbers are odd; got NV${rotation.flightNumber}`);
    }
    const outbound = pattern(
      rotation.flightNumber,
      rotation.origin,
      rotation.destination,
      rotation.departs,
      rotation.days,
      rotation.aircraft,
    );
    const turnaround =
      rotation.turnaroundMinutes ?? defaultTurnaround(outbound.kind, rotation.aircraft);

    // The return leaves the outstation `turnaround` minutes after the outbound lands.
    const arrival = zonedDateTimeToUtc(
      addDays(PATTERN_DATE, outbound.arrivalDayOffset),
      outbound.arrivalTime,
      airport(rotation.destination).timeZone,
    );
    const returnDeparture = toZonedDateTime(
      new Date(arrival.getTime() + turnaround * 60_000),
      airport(rotation.destination).timeZone,
    );
    const dayShift = daysBetween(PATTERN_DATE, returnDeparture.date);
    flights.push(
      outbound,
      pattern(
        rotation.flightNumber + 1,
        rotation.destination,
        rotation.origin,
        returnDeparture.time,
        rotation.days.map((day) => shiftWeekday(day, dayShift) as Weekday),
        rotation.aircraft,
      ),
    );
  }

  const numbers = new Set<string>();
  for (const flight of flights) {
    if (numbers.has(flight.flightNumber)) {
      throw new Error(`Duplicate flight number ${flight.flightNumber}`);
    }
    numbers.add(flight.flightNumber);
  }
  return flights;
}
