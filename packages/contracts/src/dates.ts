/**
 * Calendar-date helpers. Travel dates are plain `YYYY-MM-DD` strings with no
 * time component, so all arithmetic is done in UTC to avoid DST/offset drift.
 */

/** AeroNova's home time zone. "Today" for booking rules is evaluated here on server and client alike. */
export const AIRLINE_TIME_ZONE = 'Asia/Manila';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toUtcMs(iso: string): number {
  if (!isIsoDate(iso)) throw new RangeError(`Invalid ISO date: ${iso}`);
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's calendar date in the given IANA time zone, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string = AIRLINE_TIME_ZONE, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(iso: string, days: number): string {
  return fromUtcMs(toUtcMs(iso) + days * DAY_MS);
}

/** Negative when `a` is before `b`, zero when equal, positive when after. */
export function compareIsoDates(a: string, b: string): number {
  return toUtcMs(a) - toUtcMs(b);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** e.g. `Tue, 1 Dec 2026`. Formatted in UTC so the calendar day never shifts. */
export function formatTravelDate(iso: string, locale = 'en-PH'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(toUtcMs(iso)));
}
