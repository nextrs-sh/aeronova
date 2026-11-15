import {
  addDays,
  compareIsoDates,
  type FareCalendarDay,
  type FareCalendarQuery,
} from '@aeronova/contracts';
import type { Inventory } from '../inventory/inventory';
import { findSellable } from './flight-search';

/** Lowest indicative per-adult price per day, for the nearby-dates strip. */
export function fareCalendar(
  inventory: Inventory,
  now: number,
  query: FareCalendarQuery,
): FareCalendarDay[] {
  return Array.from({ length: query.days }, (_, offset): FareCalendarDay => {
    const date = addDays(query.startDate, offset);
    const day = (status: FareCalendarDay['status']): FareCalendarDay => ({
      date,
      status,
      lowestPerAdultMinor: null,
      itineraries: 0,
    });
    if (compareIsoDates(date, inventory.referenceDate) < 0) return day('past');

    const { itineraries, emptyReason } = findSellable(inventory, now, { ...query, date });
    if (itineraries.length === 0) {
      if (emptyReason === 'beyond-schedule') return day('beyond-schedule');
      return day(emptyReason === 'insufficient-seats' ? 'sold-out' : 'no-flights');
    }
    return {
      date,
      status: 'available',
      lowestPerAdultMinor: Math.min(...itineraries.map((it) => it.price.perAdultMinor)),
      itineraries: itineraries.length,
    };
  });
}
