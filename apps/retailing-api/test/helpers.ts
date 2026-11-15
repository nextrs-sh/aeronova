import type { FlightSearchQuery } from '@aeronova/contracts';
import { createClock } from '../src/clock';
import { Inventory } from '../src/inventory/inventory';

/** A fixed "today" so every test is independent of the wall clock. */
export const TODAY = '2026-12-01';
export const SEED = 'aeronova';

export const inventory = new Inventory({ referenceDate: TODAY, seed: SEED, horizonDays: 120 });
export const clock = createClock(TODAY);

export function query(overrides: Partial<FlightSearchQuery> = {}): FlightSearchQuery {
  return {
    origin: 'MNL',
    destination: 'SIN',
    departureDate: '2026-12-15',
    passengers: { adults: 1, children: 0, infants: 0 },
    cabin: 'economy',
    filters: { departureWindows: [], aircraft: [] },
    sort: 'departure_asc',
    page: 1,
    pageSize: 10,
    ...overrides,
  };
}
