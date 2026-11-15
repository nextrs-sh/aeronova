import { addDays, toZonedDateTime } from '@velasia/contracts';
import { AIRPORT_LOCATIONS, AIRPORTS_BY_CODE } from '../fixtures/airports';
import { CONNECTION_HUBS } from '../fixtures/network';
import { greatCircleKm } from '../inventory/geo';
import type { FlightInstance, Inventory } from '../inventory/inventory';

/** One way to travel from origin to destination: one flight, or two connecting flights. */
export interface Candidate {
  id: string;
  segments: readonly FlightInstance[];
}

export const CONNECTION_RULES = {
  /** Minimum connection time when both flights are domestic. */
  minDomesticMinutes: 45,
  /** Minimum connection time when either flight is international (immigration, bag recheck). */
  minInternationalMinutes: 90,
  maxMinutes: 360,
  /** Flown distance may be at most this multiple of the direct great-circle distance. */
  maxDetourRatio: 1.5,
} as const;

const MINUTE_MS = 60_000;

export function candidateId(segments: readonly FlightInstance[]): string {
  return segments.map((segment) => segment.id).join('_');
}

function detourAllowed(origin: string, hub: string, destination: string): boolean {
  const [o, h, d] = [
    AIRPORT_LOCATIONS[origin],
    AIRPORT_LOCATIONS[hub],
    AIRPORT_LOCATIONS[destination],
  ];
  if (!o || !h || !d) return false;
  const flown = greatCircleKm(o, h) + greatCircleKm(h, d);
  return flown <= greatCircleKm(o, d) * CONNECTION_RULES.maxDetourRatio;
}

/** Why two flights cannot form a connection, or `null` when they can. */
export function connectionProblem(first: FlightInstance, second: FlightInstance): string | null {
  const a = first.schedule;
  const b = second.schedule;
  if (a.destination !== b.origin) return 'flights do not connect at the same airport';
  if (b.destination === a.origin) return 'connection returns to the origin';
  if (!CONNECTION_HUBS.includes(a.destination)) return `${a.destination} is not a connection hub`;
  if (!detourAllowed(a.origin, a.destination, b.destination)) return 'connection is too indirect';
  const layover = (second.departureUtc - first.arrivalUtc) / MINUTE_MS;
  const minimum =
    a.kind === 'international' || b.kind === 'international'
      ? CONNECTION_RULES.minInternationalMinutes
      : CONNECTION_RULES.minDomesticMinutes;
  if (layover < minimum) return `connection is shorter than the ${minimum}-minute minimum`;
  if (layover > CONNECTION_RULES.maxMinutes) return 'connection is too long';
  return null;
}

/** True when Velasia can ever sell this city pair: direct, or one stop through a hub. */
export function isServed(inventory: Inventory, origin: string, destination: string): boolean {
  if (inventory.hasRoute(origin, destination)) return true;
  return CONNECTION_HUBS.some(
    (hub) =>
      hub !== origin &&
      hub !== destination &&
      inventory.hasRoute(origin, hub) &&
      inventory.hasRoute(hub, destination) &&
      detourAllowed(origin, hub, destination),
  );
}

/**
 * Every direct and (when allowed) one-stop itinerary departing `origin` on
 * the local `date`, regardless of status or seats — callers decide what is sellable.
 */
export function buildCandidates(
  inventory: Inventory,
  origin: string,
  destination: string,
  date: string,
  maxStops: number,
): Candidate[] {
  const departures = inventory.departures(origin, date);
  const candidates: Candidate[] = departures
    .filter((flight) => flight.schedule.destination === destination)
    .map((flight) => ({ id: flight.id, segments: [flight] }));
  if (maxStops < 1) return candidates;

  for (const first of departures) {
    const hub = first.schedule.destination;
    if (hub === destination || !CONNECTION_HUBS.includes(hub)) continue;
    if (!detourAllowed(origin, hub, destination)) continue;
    const arrivalDate = toZonedDateTime(
      new Date(first.arrivalUtc),
      AIRPORTS_BY_CODE.get(hub)!.timeZone,
    ).date;
    for (const day of [arrivalDate, addDays(arrivalDate, 1)]) {
      for (const second of inventory.departures(hub, day)) {
        if (second.schedule.destination !== destination) continue;
        if (connectionProblem(first, second) === null) {
          candidates.push({ id: candidateId([first, second]), segments: [first, second] });
        }
      }
    }
  }
  return candidates;
}

/** Resolve an itinerary id back to its flights, or `null` if it is not a valid itinerary. */
export function resolveCandidate(inventory: Inventory, id: string): Candidate | null {
  const segments = id.split('_').map((part) => inventory.getInstance(part));
  if (segments.some((segment) => segment === undefined)) return null;
  const flights = segments as FlightInstance[];
  if (flights.length === 2 && connectionProblem(flights[0]!, flights[1]!) !== null) return null;
  return { id, segments: flights };
}
