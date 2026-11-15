import { AIRLINE_TIME_ZONE, minorToMajor, toZonedDateTime, type Money } from '@velasia/contracts';

const LOCALE = 'en-PH';

export function formatMoney({ amount, currency }: Money): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format an amount in minor units. Shows centavos only when there are any. */
export function formatMinor(amountMinor: number, currency: string): string {
  const major = minorToMajor(amountMinor, currency);
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

/** `265` → `4h 25m` */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** `265` → `4 hours 25 minutes`, for screen readers. */
export function formatDurationLong(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [];
  if (hours > 0) parts.push(pluralize(hours, 'hour'));
  if (rest > 0) parts.push(pluralize(rest, 'minute'));
  return parts.join(' ');
}

/** `14` → `2× daily`, `7` → `Daily`, `4` → `4× weekly` */
export function formatFrequency(weekly: number): string {
  if (weekly % 7 === 0) return weekly === 7 ? 'Daily' : `${weekly / 7}× daily`;
  return `${weekly}× weekly`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** `2026-12-15` → `Tue 15 Dec`. Calendar-only, so no time zone can shift it. */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(',', '');
}

/** A price difference with an explicit sign: `+₱1,560`, `−₱200`, or `₱0`. */
export function formatMinorDifference(differenceMinor: number, currency: string): string {
  if (differenceMinor === 0) return formatMinor(0, currency);
  const sign = differenceMinor > 0 ? '+' : '−';
  return `${sign}${formatMinor(Math.abs(differenceMinor), currency)}`;
}

/** `2026-12-01T02:15:00Z` → `10:15` in the airline's time zone (Manila), for validity times. */
export function formatAirlineTime(instant: string): string {
  return toZonedDateTime(new Date(instant), AIRLINE_TIME_ZONE).time;
}

/** `2026-12-01T02:15:00Z` → `Tue 1 Dec 2026, 10:15` in the airline's time zone (Manila). */
export function formatAirlineDateTime(instant: string): string {
  const zoned = toZonedDateTime(new Date(instant), AIRLINE_TIME_ZONE);
  return `${formatShortDate(zoned.date)} ${zoned.date.slice(0, 4)}, ${zoned.time}`;
}
