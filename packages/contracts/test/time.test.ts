import { describe, expect, it } from 'vitest';
import {
  formatUtcOffset,
  formatUtcOffsetLabel,
  isLocalTime,
  isoWeekday,
  minutesToTime,
  timeToMinutes,
  toZonedDateTime,
  zonedDateTimeToUtc,
} from '../src';

describe('local times', () => {
  it('parses and formats HH:MM', () => {
    expect(isLocalTime('08:15')).toBe(true);
    expect(isLocalTime('24:00')).toBe(false);
    expect(isLocalTime('8:15')).toBe(false);
    expect(timeToMinutes('23:55')).toBe(1435);
    expect(minutesToTime(1435 + 30)).toBe('00:25');
    expect(minutesToTime(-5)).toBe('23:55');
  });
});

describe('time zone conversion', () => {
  it('converts local wall-clock times to UTC through the IANA zone', () => {
    expect(zonedDateTimeToUtc('2026-12-15', '08:15', 'Asia/Manila').toISOString()).toBe(
      '2026-12-15T00:15:00.000Z',
    );
    expect(zonedDateTimeToUtc('2026-12-15', '08:15', 'Asia/Tokyo').toISOString()).toBe(
      '2026-12-14T23:15:00.000Z',
    );
    expect(zonedDateTimeToUtc('2026-12-15', '00:30', 'Asia/Jakarta').toISOString()).toBe(
      '2026-12-14T17:30:00.000Z',
    );
  });

  it('reads an instant back as a local date, time, and offset', () => {
    const instant = new Date('2026-12-17T20:15:00Z');
    expect(toZonedDateTime(instant, 'Asia/Tokyo')).toEqual({
      date: '2026-12-18',
      time: '05:15',
      offsetMinutes: 540,
    });
    expect(toZonedDateTime(instant, 'Asia/Ho_Chi_Minh').offsetMinutes).toBe(420);
  });

  it('round-trips across zones with daylight saving', () => {
    // Sydney switches to daylight time on 4 Oct 2026; New York falls back on 1 Nov 2026.
    for (const [date, time, zone] of [
      ['2026-10-04', '09:00', 'Australia/Sydney'],
      ['2026-11-01', '12:00', 'America/New_York'],
      ['2026-07-01', '23:59', 'Europe/London'],
    ] as const) {
      const local = toZonedDateTime(zonedDateTimeToUtc(date, time, zone), zone);
      expect(local).toMatchObject({ date, time });
    }
    // 02:30 does not exist in Sydney on 4 Oct 2026; it moves forward an hour.
    const gap = toZonedDateTime(
      zonedDateTimeToUtc('2026-10-04', '02:30', 'Australia/Sydney'),
      'Australia/Sydney',
    );
    expect(gap.time).toBe('03:30');
  });

  it('does not depend on the machine time zone', () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(zonedDateTimeToUtc('2026-12-15', '08:15', 'Asia/Manila').toISOString()).toBe(
        '2026-12-15T00:15:00.000Z',
      );
    } finally {
      process.env.TZ = before;
    }
  });

  it('formats offsets and weekdays', () => {
    expect(formatUtcOffset(480)).toBe('+08:00');
    expect(formatUtcOffset(-210)).toBe('-03:30');
    expect(formatUtcOffsetLabel('+08:00')).toBe('UTC+8');
    expect(formatUtcOffsetLabel('+05:30')).toBe('UTC+5:30');
    expect(isoWeekday('2026-12-14')).toBe(1);
    expect(isoWeekday('2026-12-20')).toBe(7);
  });
});
