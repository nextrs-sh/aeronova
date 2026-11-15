/**
 * Wall-clock helpers for airline schedules. Schedules are published in each
 * airport's local time; instants are converted through the IANA time zone so
 * nothing depends on the time zone of the machine (or browser) running the code.
 */
import { isIsoDate } from './dates';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE_MS = 60_000;

/** `HH:MM`, 24-hour clock. */
export function isLocalTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** `08:15` → `495` */
export function timeToMinutes(time: string): number {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new RangeError(`Invalid local time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `495` → `08:15`. Wraps around midnight in either direction. */
export function minutesToTime(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  return `${String(hours).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export interface ZonedDateTime {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Local wall-clock time, `HH:MM`. */
  time: string;
  /** Offset from UTC in minutes at that instant, e.g. `480` for UTC+8. */
  offsetMinutes: number;
}

/** Local date, time, and UTC offset of an instant in a time zone. */
export function toZonedDateTime(instant: Date, timeZone: string): ZonedDateTime {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const [year, month, day, hour, minute] = [
    get('year'),
    get('month'),
    get('day'),
    get('hour'),
    get('minute'),
  ];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const instantToMinute = Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
    offsetMinutes: Math.round((wallAsUtc - instantToMinute) / MINUTE_MS),
  };
}

/**
 * The instant at which a local wall-clock time occurs in a time zone. For a
 * time skipped by a DST change, the result moves forward by the gap, matching
 * how airlines retime flights.
 */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  if (!isIsoDate(date)) throw new RangeError(`Invalid ISO date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d) + timeToMinutes(time) * MINUTE_MS;
  // Two passes settle the offset even when the first guess lands across a DST boundary.
  let instant =
    wallAsUtc - toZonedDateTime(new Date(wallAsUtc), timeZone).offsetMinutes * MINUTE_MS;
  instant = wallAsUtc - toZonedDateTime(new Date(instant), timeZone).offsetMinutes * MINUTE_MS;
  return new Date(instant);
}

/** `480` → `+08:00`, `-210` → `-03:30` */
export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** `+08:00` → `UTC+8`, `+05:30` → `UTC+5:30` */
export function formatUtcOffsetLabel(offset: string): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return offset;
  const hours = String(Number(match[2]));
  return `UTC${match[1]}${hours}${match[3] === '00' ? '' : `:${match[3]}`}`;
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  if (!isIsoDate(date)) throw new RangeError(`Invalid ISO date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}
