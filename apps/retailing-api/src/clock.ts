import { AIRLINE_TIME_ZONE, todayIn, zonedDateTimeToUtc } from '@aeronova/contracts';

/** Source of "today" and "now" for inventory, pricing, and validation. */
export interface Clock {
  /** Today's date in the airline time zone, `YYYY-MM-DD`. */
  today(): string;
  /** Current instant, epoch milliseconds. */
  now(): number;
  /** True when the date is fixed (tests, demos) rather than read from the system clock. */
  readonly pinned: boolean;
}

/**
 * The system clock, or a pinned date. A pinned clock reads "now" as midnight
 * at the start of that day in Manila, so every flight that day is still on sale.
 */
export function createClock(pinnedDate?: string): Clock {
  if (pinnedDate) {
    const midnight = zonedDateTimeToUtc(pinnedDate, '00:00', AIRLINE_TIME_ZONE).getTime();
    return { today: () => pinnedDate, now: () => midnight, pinned: true };
  }
  return { today: () => todayIn(AIRLINE_TIME_ZONE), now: () => Date.now(), pinned: false };
}
