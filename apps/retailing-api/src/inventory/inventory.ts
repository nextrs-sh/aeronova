import {
  addDays,
  compareIsoDates,
  daysBetween,
  isoWeekday,
  zonedDateTimeToUtc,
  type CabinClass,
  type FlightStatus,
  type NetworkRoute,
} from '@aeronova/contracts';
import { AIRCRAFT_BY_CODE } from '../fixtures/aircraft';
import { AIRPORTS_BY_CODE } from '../fixtures/airports';
import { ROTATIONS } from '../fixtures/network';
import { hashToUnit } from './hash';
import { buildSchedule, type ScheduledFlight } from './schedule';

export interface InventoryOptions {
  /** "Today" for the inventory (`YYYY-MM-DD`, airline time zone). */
  referenceDate: string;
  /** Changing the seed changes load factors, demand, and cancellations — never schedules. */
  seed: string;
  /** Days of dated flights to publish, starting at the reference date. */
  horizonDays: number;
}

export interface CabinInventory {
  cabin: CabinClass;
  capacity: number;
  sold: number;
  /** Projected load factor at departure (0–1+), which drives the demand band. */
  projectedLoad: number;
}

/** One dated departure with its own seat inventory. */
export interface FlightInstance {
  id: string;
  schedule: ScheduledFlight;
  /** Local departure date at the origin. */
  date: string;
  departureUtc: number;
  arrivalUtc: number;
  status: FlightStatus;
  /** Cabins in aircraft order (front to back). */
  cabins: CabinInventory[];
  /** Whole days between the reference date and departure. */
  daysToDeparture: number;
}

const MINUTE_MS = 60_000;
/** Share of published flights cancelled for operational reasons (deterministic). */
const CANCELLATION_RATE = 0.006;
/** Christmas and New Year: the network's busiest fortnight. */
const PEAK_SEASON = { from: '12-18', to: '01-04' } as const;

export function isPeakSeason(date: string): boolean {
  const monthDay = date.slice(5);
  return monthDay >= PEAK_SEASON.from || monthDay <= PEAK_SEASON.to;
}

/**
 * Seats sold so far as a share of the final load: bookings build up as
 * departure approaches, so a flight 90 days out is far emptier than tomorrow's.
 */
function bookingCurve(daysToDeparture: number): number {
  return 1 - 0.7 * (Math.min(daysToDeparture, 120) / 120);
}

/**
 * Deterministic flight inventory for a booking horizon. Built once (in a few
 * milliseconds) and indexed, so searches never generate data on the request path.
 */
export class Inventory {
  readonly referenceDate: string;
  readonly scheduleEndDate: string;
  readonly seed: string;
  readonly schedule: readonly ScheduledFlight[];
  readonly routes: readonly NetworkRoute[];
  private readonly instances = new Map<string, FlightInstance>();
  private readonly departuresByAirportDate = new Map<string, FlightInstance[]>();
  private readonly instancesByRoute = new Map<string, FlightInstance[]>();
  private readonly routeIds: ReadonlySet<string>;

  constructor({ referenceDate, seed, horizonDays }: InventoryOptions) {
    this.referenceDate = referenceDate;
    this.seed = seed;
    this.scheduleEndDate = addDays(referenceDate, horizonDays - 1);
    this.schedule = buildSchedule(ROTATIONS);
    this.routes = buildRoutes(this.schedule);
    this.routeIds = new Set(this.routes.map((route) => route.id));

    for (let offset = 0; offset < horizonDays; offset += 1) {
      const date = addDays(referenceDate, offset);
      const weekday = isoWeekday(date);
      for (const flight of this.schedule) {
        if (!flight.days.includes(weekday as never)) continue;
        const instance = this.createInstance(flight, date);
        this.instances.set(instance.id, instance);
        const key = `${flight.origin}|${date}`;
        const list = this.departuresByAirportDate.get(key) ?? [];
        list.push(instance);
        this.departuresByAirportDate.set(key, list);
        const onRoute = this.instancesByRoute.get(flight.routeId) ?? [];
        onRoute.push(instance);
        this.instancesByRoute.set(flight.routeId, onRoute);
      }
    }
    for (const list of this.departuresByAirportDate.values()) {
      list.sort((a, b) => a.departureUtc - b.departureUtc);
    }
  }

  get size(): number {
    return this.instances.size;
  }

  getInstance(id: string): FlightInstance | undefined {
    return this.instances.get(id);
  }

  allInstances(): IterableIterator<FlightInstance> {
    return this.instances.values();
  }

  /** Departures from an airport on a local date, in departure order. */
  departures(airport: string, date: string): readonly FlightInstance[] {
    return this.departuresByAirportDate.get(`${airport}|${date}`) ?? [];
  }

  /** Every dated flight on a directional route (e.g. `MNL-SIN`) across the horizon. */
  onRoute(origin: string, destination: string): readonly FlightInstance[] {
    return this.instancesByRoute.get(`${origin}-${destination}`) ?? [];
  }

  hasRoute(origin: string, destination: string): boolean {
    return this.routeIds.has(`${origin}-${destination}`);
  }

  isWithinSchedule(date: string): boolean {
    return (
      compareIsoDates(date, this.referenceDate) >= 0 &&
      compareIsoDates(date, this.scheduleEndDate) <= 0
    );
  }

  private createInstance(flight: ScheduledFlight, date: string): FlightInstance {
    const id = `${flight.flightNumber}-${date.replaceAll('-', '')}`;
    const origin = AIRPORTS_BY_CODE.get(flight.origin)!;
    const departureUtc = zonedDateTimeToUtc(date, flight.departureTime, origin.timeZone).getTime();
    const aircraft = AIRCRAFT_BY_CODE.get(flight.aircraftCode)!;
    const daysToDeparture = daysBetween(this.referenceDate, date);
    const unit = (key: string) => hashToUnit(this.seed, `${id}:${key}`);

    // Demand: a stable per-route base, busier at weekends, peaks, and popular times.
    const weekday = isoWeekday(date);
    const routeBase = 0.55 + 0.25 * hashToUnit(this.seed, `route:${flight.routeId}`);
    const hour = Number(flight.departureTime.slice(0, 2));
    const projected =
      routeBase +
      (weekday === 5 || weekday === 7 ? 0.08 : weekday === 2 || weekday === 3 ? -0.06 : 0) +
      (isPeakSeason(date) ? 0.15 : 0) +
      ((hour >= 6 && hour < 9) || (hour >= 17 && hour < 20) ? 0.05 : 0) +
      (hour < 6 ? -0.08 : 0) +
      (unit('demand') - 0.5) * 0.3;

    const share = bookingCurve(daysToDeparture);
    const cabins = aircraft.cabins.map((cabin): CabinInventory => {
      const cabinScale =
        cabin.cabin === 'economy'
          ? 1
          : cabin.cabin === 'premium-economy'
            ? 0.7 + 0.35 * unit('pe')
            : 0.55 + 0.45 * unit('business');
      const projectedLoad = Math.max(0.2, projected * cabinScale);
      const sold = Math.min(cabin.seats, Math.round(cabin.seats * projectedLoad * share));
      return { cabin: cabin.cabin, capacity: cabin.seats, sold, projectedLoad };
    });

    return {
      id,
      schedule: flight,
      date,
      departureUtc,
      arrivalUtc: departureUtc + flight.blockMinutes * MINUTE_MS,
      status: unit('ops') < CANCELLATION_RATE ? 'cancelled' : 'scheduled',
      cabins,
      daysToDeparture,
    };
  }
}

export function cabinInventory(
  instance: FlightInstance,
  cabin: CabinClass,
): CabinInventory | undefined {
  return instance.cabins.find((entry) => entry.cabin === cabin);
}

export function seatsAvailable(instance: FlightInstance, cabin: CabinClass): number {
  if (instance.status !== 'scheduled') return 0;
  const entry = cabinInventory(instance, cabin);
  return entry ? entry.capacity - entry.sold : 0;
}

function buildRoutes(schedule: readonly ScheduledFlight[]): NetworkRoute[] {
  const byRoute = new Map<string, ScheduledFlight[]>();
  for (const flight of schedule) {
    byRoute.set(flight.routeId, [...(byRoute.get(flight.routeId) ?? []), flight]);
  }
  const cabinOrder: CabinClass[] = ['economy', 'premium-economy', 'business'];
  return [...byRoute.values()]
    .map((flights): NetworkRoute => {
      const [first] = flights as [ScheduledFlight];
      const aircraftCodes = [...new Set(flights.map((flight) => flight.aircraftCode))].sort();
      const cabins = new Set(
        aircraftCodes.flatMap((code) =>
          AIRCRAFT_BY_CODE.get(code)!.cabins.map((cabin) => cabin.cabin),
        ),
      );
      return {
        id: first.routeId,
        origin: first.origin,
        destination: first.destination,
        kind: first.kind,
        distanceKm: first.distanceKm,
        distanceBand: first.distanceBand,
        blockMinutes: first.blockMinutes,
        weeklyFrequency: flights.reduce((sum, flight) => sum + flight.days.length, 0),
        flightNumbers: flights
          .map((flight) => flight.flightNumber)
          .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))),
        aircraftCodes,
        cabins: cabinOrder.filter((cabin) => cabins.has(cabin)),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
