import { describe, expect, it } from 'vitest';
import { airline, airlineIdentitySchema, displayFlightNumber } from '../src';

describe('airline identity', () => {
  it('is the fictional Velasia Airways, headquartered in the Philippines and priced in PHP', () => {
    expect(airline).toMatchObject({
      name: 'Velasia Airways',
      shortName: 'Velasia',
      tagline: 'Beyond every horizon.',
      country: 'PH',
      currency: 'PHP',
      isFictional: true,
    });
  });

  it('satisfies the public identity contract', () => {
    expect(() => airlineIdentitySchema.parse(airline)).not.toThrow();
  });

  it('says plainly that the airline is fictional', () => {
    expect(airline.disclaimer).toMatch(/fictional/i);
  });
});

describe('displayFlightNumber', () => {
  it('formats a customer-facing number with the display prefix', () => {
    expect(displayFlightNumber(128)).toBe('VEL 128');
    expect(displayFlightNumber(1)).toBe('VEL 1');
    expect(displayFlightNumber(9999)).toBe('VEL 9999');
  });

  it.each([0, -5, 10_000, 1.5, Number.NaN])('rejects %s', (value) => {
    expect(() => displayFlightNumber(value)).toThrow(RangeError);
  });
});
