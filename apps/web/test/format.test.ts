import { describe, expect, it } from 'vitest';
import { formatDuration, formatFrequency, formatMoney } from '@/lib/format';

describe('formatting', () => {
  it('formats PHP without decimals', () => {
    expect(formatMoney({ amount: 9999, currency: 'PHP' })).toBe('₱9,999');
  });

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(265)).toBe('4h 25m');
  });

  it('formats weekly frequencies', () => {
    expect(formatFrequency(7)).toBe('Daily');
    expect(formatFrequency(21)).toBe('3× daily');
    expect(formatFrequency(4)).toBe('4× weekly');
  });
});
