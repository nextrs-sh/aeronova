import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareIsoDates,
  daysBetween,
  formatTravelDate,
  isIsoDate,
  todayIn,
} from '../src';

describe('date helpers', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2026-12-01')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('computes today in the airline time zone, not the host time zone', () => {
    // 20:30 UTC on 30 Nov is already 1 Dec in Manila (UTC+8).
    const now = new Date('2026-11-30T20:30:00Z');
    expect(todayIn('Asia/Manila', now)).toBe('2026-12-01');
    expect(todayIn('UTC', now)).toBe('2026-11-30');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('compares and diffs dates', () => {
    expect(compareIsoDates('2026-12-01', '2026-12-02')).toBeLessThan(0);
    expect(compareIsoDates('2026-12-02', '2026-12-02')).toBe(0);
    expect(daysBetween('2026-12-01', '2026-12-08')).toBe(7);
  });

  it('formats dates without shifting the calendar day', () => {
    expect(formatTravelDate('2026-12-01')).toMatch(/^Tue, (1 Dec|Dec 1),? 2026$/);
  });
});
