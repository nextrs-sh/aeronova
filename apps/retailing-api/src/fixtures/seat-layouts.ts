import type { CabinClass, Seat, SeatCategory, SeatFeature, SeatPosition } from '@velasia/contracts';
import { AIRCRAFT, AIRCRAFT_BY_CODE } from './aircraft';

/*
 * Seat layouts for Velasia's fictional fleet. Each aircraft type has its own plausible cabin
 * plan, invented for the demo (not any real airline's configuration):
 *
 * | Aircraft       | Business (rows) | Premium Economy | Economy                              |
 * | -------------- | --------------- | --------------- | ------------------------------------ |
 * | A320neo (A20N) | —               | 3-3, rows 1–2   | 3-3, rows 3–31; exits 11–12          |
 * | A321neo (A21N) | 2-2, rows 1–3   | 3-3, rows 4–7   | 3-3, rows 8–35; exits 24–25; 34–35 B–E |
 * | 737-8 (B38M)   | 2-2, rows 1–2   | —               | 3-3, rows 3–30; exits 15–16          |
 * | A330-900 (A339)| 1-2-1, rows 1–6 | 2-3-2, rows 7–9 | 3-3-3, rows 10–38; exit 25; 34–38 2-3-2 |
 *
 * There is no row 13. Seat counts per cabin must equal the fleet definition in `aircraft.ts`
 * (which the inventory sells from); a mismatch fails at startup.
 *
 * Categories: the first Economy row (a bulkhead) and the exit rows are `EXTRA_LEGROOM`; the
 * next four Economy rows are `PREFERRED` ("front of cabin"); Business seats are `BUSINESS`;
 * everything else is `STANDARD`. Premium Economy seats exist on the map but no Velasia fare
 * family sells that cabin yet, so they can't be chosen.
 */

export const LAYOUT_VERSION = 'layouts-2026-11.m4';

interface CabinPlan {
  cabin: CabinClass;
  name: string;
  layout: string;
  /** Letters left to right; `null` is an aisle. */
  columns: (string | null)[];
  rows: number[];
  exitRows?: number[];
  /** Seats missing from a row because the fuselage narrows: row → letters. */
  missing?: Record<number, string[]>;
  /** Number of `PREFERRED` rows after the bulkhead (Economy only). */
  preferredRows?: number;
}

/** Row numbers `from…to`, skipping 13. */
function rowRange(from: number, to: number): number[] {
  const rows: number[] = [];
  for (let row = from; row <= to; row += 1) if (row !== 13) rows.push(row);
  return rows;
}

const NARROW = ['A', 'B', 'C', null, 'D', 'E', 'F'];
const NARROW_BUSINESS = ['A', 'C', null, 'D', 'F'];

const PLANS: Record<string, CabinPlan[]> = {
  A20N: [
    {
      cabin: 'premium-economy',
      name: 'Premium Economy',
      layout: '3-3',
      columns: NARROW,
      rows: rowRange(1, 2),
    },
    {
      cabin: 'economy',
      name: 'Economy',
      layout: '3-3',
      columns: NARROW,
      rows: rowRange(3, 31),
      exitRows: [11, 12],
      preferredRows: 4,
    },
  ],
  A21N: [
    {
      cabin: 'business',
      name: 'Business',
      layout: '2-2',
      columns: NARROW_BUSINESS,
      rows: rowRange(1, 3),
    },
    {
      cabin: 'premium-economy',
      name: 'Premium Economy',
      layout: '3-3',
      columns: NARROW,
      rows: rowRange(4, 7),
    },
    {
      cabin: 'economy',
      name: 'Economy',
      layout: '3-3',
      columns: NARROW,
      rows: rowRange(8, 35),
      exitRows: [24, 25],
      missing: { 34: ['A', 'F'], 35: ['A', 'F'] },
      preferredRows: 4,
    },
  ],
  B38M: [
    {
      cabin: 'business',
      name: 'Business',
      layout: '2-2',
      columns: NARROW_BUSINESS,
      rows: rowRange(1, 2),
    },
    {
      cabin: 'economy',
      name: 'Economy',
      layout: '3-3',
      columns: NARROW,
      rows: rowRange(3, 30),
      exitRows: [15, 16],
      preferredRows: 4,
    },
  ],
  A339: [
    {
      cabin: 'business',
      name: 'Business',
      layout: '1-2-1',
      columns: ['A', null, 'E', 'F', null, 'K'],
      rows: rowRange(1, 6),
    },
    {
      cabin: 'premium-economy',
      name: 'Premium Economy',
      layout: '2-3-2',
      columns: ['A', 'C', null, 'D', 'E', 'F', null, 'H', 'K'],
      rows: rowRange(7, 9),
    },
    {
      cabin: 'economy',
      name: 'Economy',
      layout: '3-3-3',
      columns: ['A', 'B', 'C', null, 'D', 'E', 'F', null, 'H', 'J', 'K'],
      rows: rowRange(10, 38),
      exitRows: [25],
      missing: Object.fromEntries([34, 35, 36, 37, 38].map((row) => [row, ['B', 'J']])),
      preferredRows: 4,
    },
  ],
};

/** A seat without its per-flight status. */
export type SeatTemplate = Omit<Seat, 'status' | 'unavailableReason'>;

export interface CabinLayout {
  cabin: CabinClass;
  name: string;
  layout: string;
  columns: (string | null)[];
  rows: { number: number; exitRow: boolean; seats: (SeatTemplate | null)[] }[];
  capacity: number;
}

export interface AircraftLayout {
  aircraftCode: string;
  cabins: CabinLayout[];
  /** Every seat, by id. */
  seats: ReadonlyMap<string, SeatTemplate>;
}

function positionIn(letters: (string | null)[], index: number): SeatPosition {
  const seatIndexes = letters.flatMap((letter, i) => (letter === null ? [] : [i]));
  if (index === seatIndexes[0] || index === seatIndexes.at(-1)) return 'window';
  if (letters[index - 1] === null || letters[index + 1] === null) return 'aisle';
  return 'middle';
}

function buildCabin(plan: CabinPlan): CabinLayout {
  const exitRows = new Set(plan.exitRows ?? []);
  const firstRow = plan.rows[0]!;
  const preferred = new Set(plan.rows.slice(1, 1 + (plan.preferredRows ?? 0)));
  const rows = plan.rows.map((number, rowIndex) => {
    const missing = new Set(plan.missing?.[number] ?? []);
    // Letters actually present in this row (aisles kept), to find its window seats.
    const present = plan.columns.map((letter) => (letter && !missing.has(letter) ? letter : null));
    const exitRow = exitRows.has(number);
    const beforeExit = exitRows.has(plan.rows[rowIndex + 1] ?? -1) && !exitRow;
    const seats = plan.columns.map((letter, index): SeatTemplate | null => {
      if (letter === null || missing.has(letter)) return null;
      const features: SeatFeature[] = [];
      let category: SeatCategory = 'STANDARD';
      if (plan.cabin === 'business') {
        category = 'BUSINESS';
        if (plan.layout === '1-2-1') features.push('LIE_FLAT');
      } else if (plan.cabin === 'economy') {
        if (number === firstRow) {
          category = 'EXTRA_LEGROOM';
          features.push('BULKHEAD', 'EXTRA_LEGROOM');
        } else if (exitRow) {
          category = 'EXTRA_LEGROOM';
          features.push('EXIT_ROW', 'EXTRA_LEGROOM');
        } else if (preferred.has(number)) {
          category = 'PREFERRED';
          features.push('FRONT_OF_CABIN');
        }
      }
      if (number === firstRow && plan.cabin !== 'economy') features.push('BULKHEAD');
      // The row in front of an exit row (and the first exit row of a pair) can't fully recline.
      if (beforeExit || (exitRow && exitRows.has(plan.rows[rowIndex + 1] ?? -1))) {
        features.push('LIMITED_RECLINE');
      }
      return {
        id: `${number}${letter}`,
        row: number,
        letter,
        cabin: plan.cabin,
        category,
        position: positionIn(present, index),
        features,
        restrictions: exitRow ? ['EXIT_ROW'] : [],
      };
    });
    return { number, exitRow, seats };
  });
  return {
    cabin: plan.cabin,
    name: plan.name,
    layout: plan.layout,
    columns: plan.columns,
    rows,
    capacity: rows.reduce((sum, row) => sum + row.seats.filter(Boolean).length, 0),
  };
}

function buildLayout(aircraftCode: string): AircraftLayout {
  const aircraft = AIRCRAFT_BY_CODE.get(aircraftCode);
  const plans = PLANS[aircraftCode];
  if (!aircraft || !plans) throw new Error(`${aircraftCode}: no seat layout`);
  const cabins = plans.map(buildCabin);
  // The seat map must describe exactly the seats the inventory sells.
  const fleetCabins = aircraft.cabins.map(
    (cabin) => `${cabin.cabin}:${cabin.seats}:${cabin.layout}`,
  );
  const layoutCabins = cabins.map((cabin) => `${cabin.cabin}:${cabin.capacity}:${cabin.layout}`);
  if (fleetCabins.join() !== layoutCabins.join()) {
    throw new Error(
      `${aircraftCode}: seat layout (${layoutCabins.join(', ')}) doesn't match the fleet (${fleetCabins.join(', ')})`,
    );
  }
  const seats = new Map<string, SeatTemplate>();
  for (const cabin of cabins) {
    for (const row of cabin.rows) {
      for (const seat of row.seats) {
        if (!seat) continue;
        if (seats.has(seat.id)) throw new Error(`${aircraftCode}: duplicate seat ${seat.id}`);
        seats.set(seat.id, seat);
      }
    }
  }
  return { aircraftCode, cabins, seats };
}

export const SEAT_LAYOUTS: ReadonlyMap<string, AircraftLayout> = new Map(
  AIRCRAFT.map((aircraft) => [aircraft.code, buildLayout(aircraft.code)]),
);
