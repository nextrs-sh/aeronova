import { addDays, isoWeekday, toZonedDateTime, zonedDateTimeToUtc } from '@aeronova/contracts';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_BY_CODE } from '../src/fixtures/aircraft';
import { AIRPORTS, AIRPORTS_BY_CODE, AIRPORT_LOCATIONS } from '../src/fixtures/airports';
import { ROTATIONS } from '../src/fixtures/network';
import { Inventory, seatsAvailable } from '../src/inventory/inventory';
import { buildSchedule } from '../src/inventory/schedule';
import { SEED, TODAY, inventory } from './helpers';

const instances = [...inventory.allInstances()];

describe('network fixtures', () => {
  it('has 20–25 airports, each with coordinates and a valid IANA zone', () => {
    expect(AIRPORTS.length).toBeGreaterThanOrEqual(20);
    expect(AIRPORTS.length).toBeLessThanOrEqual(25);
    for (const airport of AIRPORTS) {
      expect(AIRPORT_LOCATIONS[airport.code], airport.code).toBeDefined();
      expect(() => new Intl.DateTimeFormat('en', { timeZone: airport.timeZone })).not.toThrow();
    }
  });

  it('only uses time zones without daylight saving (schedule patterns rely on it)', () => {
    for (const airport of AIRPORTS) {
      const offsets = ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'].map(
        (date) => toZonedDateTime(new Date(`${date}T12:00:00Z`), airport.timeZone).offsetMinutes,
      );
      expect(new Set(offsets).size, airport.code).toBe(1);
    }
  });

  it('every aircraft can fly every route assigned to it', () => {
    for (const flight of inventory.schedule) {
      const aircraft = AIRCRAFT_BY_CODE.get(flight.aircraftCode)!;
      expect(flight.distanceKm, flight.flightNumber).toBeLessThan(aircraft.rangeKm);
    }
  });

  it('cabin seats add up to each aircraft’s capacity', () => {
    for (const aircraft of AIRCRAFT) {
      expect(aircraft.cabins.reduce((sum, cabin) => sum + cabin.seats, 0)).toBe(
        aircraft.totalSeats,
      );
    }
  });
});

describe('schedule generation', () => {
  const schedule = buildSchedule(ROTATIONS);

  it('creates an outbound and a return for every rotation, with unique flight numbers', () => {
    expect(schedule).toHaveLength(ROTATIONS.length * 2);
    expect(new Set(schedule.map((flight) => flight.flightNumber)).size).toBe(schedule.length);
  });

  it('publishes 40–60 directional routes, each with its return', () => {
    expect(inventory.routes.length).toBeGreaterThanOrEqual(40);
    expect(inventory.routes.length).toBeLessThanOrEqual(60);
    for (const route of inventory.routes) {
      expect(inventory.hasRoute(route.destination, route.origin), route.id).toBe(true);
    }
  });

  it('uses realistic block times for the distance', () => {
    for (const flight of schedule) {
      const hours = flight.blockMinutes / 60;
      const speed = flight.distanceKm / hours;
      // Short hops spend most of their block time taxiing, climbing, and descending.
      expect(speed, flight.flightNumber).toBeGreaterThan(flight.distanceKm < 500 ? 150 : 350);
      expect(speed, flight.flightNumber).toBeLessThan(800);
    }
    const mnlSin = schedule.find((flight) => flight.routeId === 'MNL-SIN')!;
    expect(mnlSin.blockMinutes).toBeGreaterThanOrEqual(200);
    expect(mnlSin.blockMinutes).toBeLessThanOrEqual(240);
  });

  it('times the return after the outbound lands plus a turnaround', () => {
    const out = schedule.find((flight) => flight.flightNumber === 'NV501')!;
    const back = schedule.find((flight) => flight.flightNumber === 'NV502')!;
    expect(back.origin).toBe(out.destination);
    expect(back.destination).toBe(out.origin);
    const landed = zonedDateTimeToUtc('2026-01-05', out.arrivalTime, 'Asia/Singapore');
    const leaves = zonedDateTimeToUtc('2026-01-05', back.departureTime, 'Asia/Singapore');
    expect((leaves.getTime() - landed.getTime()) / 60_000).toBe(60);
  });

  it('shifts the operating days of returns that leave after midnight', () => {
    // NV555 leaves Manila at 23:55 on Mon/Thu/Fri/Sun and lands in Tokyo the next morning.
    const out = schedule.find((flight) => flight.flightNumber === 'NV555')!;
    const back = schedule.find((flight) => flight.flightNumber === 'NV556')!;
    expect(out.arrivalDayOffset).toBe(1);
    expect(back.days).toEqual([1, 2, 5, 6]);
  });
});

describe('dated flight instances', () => {
  it('cover exactly the booking horizon', () => {
    const dates = new Set(instances.map((instance) => instance.date));
    expect([...dates].sort()[0]).toBe(TODAY);
    expect([...dates].sort().at(-1)).toBe(addDays(TODAY, 119));
    expect(inventory.scheduleEndDate).toBe(addDays(TODAY, 119));
  });

  it('have unique, stable identifiers', () => {
    expect(new Set(instances.map((instance) => instance.id)).size).toBe(instances.length);
    expect(inventory.getInstance('NV501-20261215')?.schedule.flightNumber).toBe('NV501');
  });

  it('only operate on scheduled weekdays', () => {
    for (const instance of instances) {
      expect(instance.schedule.days).toContain(isoWeekday(instance.date));
    }
  });

  it('depart at the published local time, converted through the airport’s zone', () => {
    for (const instance of instances.slice(0, 500)) {
      const tz = AIRPORTS_BY_CODE.get(instance.schedule.origin)!.timeZone;
      const local = toZonedDateTime(new Date(instance.departureUtc), tz);
      expect(local.date).toBe(instance.date);
      expect(local.time).toBe(instance.schedule.departureTime);
    }
  });

  it('arrive exactly one block time later, in the destination’s local time', () => {
    for (const instance of instances) {
      expect((instance.arrivalUtc - instance.departureUtc) / 60_000).toBe(
        instance.schedule.blockMinutes,
      );
    }
    // A red-eye arriving the next local day.
    const redEye = inventory.getInstance('NV555-20261203')!;
    const arrival = toZonedDateTime(new Date(redEye.arrivalUtc), 'Asia/Tokyo');
    expect(arrival.date).toBe('2026-12-04');
  });

  it('never oversell a cabin and match the aircraft configuration', () => {
    for (const instance of instances) {
      const aircraft = AIRCRAFT_BY_CODE.get(instance.schedule.aircraftCode)!;
      expect(instance.cabins.map((cabin) => cabin.cabin)).toEqual(
        aircraft.cabins.map((cabin) => cabin.cabin),
      );
      for (const cabin of instance.cabins) {
        expect(cabin.sold).toBeGreaterThanOrEqual(0);
        expect(cabin.sold).toBeLessThanOrEqual(cabin.capacity);
        expect(seatsAvailable(instance, cabin.cabin)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('fill up as departure approaches', () => {
    const share = (days: [number, number]) => {
      const relevant = instances.filter(
        (i) => i.daysToDeparture >= days[0] && i.daysToDeparture <= days[1],
      );
      const sold = relevant.reduce((sum, i) => sum + i.cabins[i.cabins.length - 1]!.sold, 0);
      const capacity = relevant.reduce(
        (sum, i) => sum + i.cabins[i.cabins.length - 1]!.capacity,
        0,
      );
      return sold / capacity;
    };
    expect(share([0, 7])).toBeGreaterThan(share([60, 119]) + 0.2);
  });

  it('include a small, deterministic number of cancellations and sold-out flights', () => {
    const cancelled = instances.filter((instance) => instance.status === 'cancelled');
    expect(cancelled.length).toBeGreaterThan(0);
    expect(cancelled.length / instances.length).toBeLessThan(0.02);
    expect(seatsAvailable(cancelled[0]!, 'economy')).toBe(0);
  });
});

describe('determinism', () => {
  it('generates identical inventory from the same seed and reference date', () => {
    const again = new Inventory({ referenceDate: TODAY, seed: SEED, horizonDays: 120 });
    expect([...again.allInstances()]).toEqual(instances);
  });

  it('keeps schedules but changes demand when the seed changes', () => {
    const other = new Inventory({ referenceDate: TODAY, seed: 'another-seed', horizonDays: 120 });
    const otherInstances = [...other.allInstances()];
    expect(otherInstances.map((i) => i.id)).toEqual(instances.map((i) => i.id));
    expect(otherInstances.map((i) => i.cabins)).not.toEqual(instances.map((i) => i.cabins));
  });

  it('keeps a flight’s identity when the reference date moves', () => {
    const tomorrow = new Inventory({
      referenceDate: addDays(TODAY, 1),
      seed: SEED,
      horizonDays: 120,
    });
    const a = inventory.getInstance('NV501-20261215')!;
    const b = tomorrow.getInstance('NV501-20261215')!;
    expect(b.departureUtc).toBe(a.departureUtc);
    expect(b.daysToDeparture).toBe(a.daysToDeparture - 1);
    expect(tomorrow.getInstance(`NV501-${TODAY.replaceAll('-', '')}`)).toBeUndefined();
  });
});
