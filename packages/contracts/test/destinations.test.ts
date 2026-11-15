import { describe, expect, it } from 'vitest';
import { destinationListQuerySchema, destinationSchema, type Destination } from '../src';

const destination: Destination = {
  slug: 'tokyo',
  name: 'Tokyo',
  country: 'Japan',
  countryCode: 'JP',
  region: 'east-asia',
  airportCodes: ['NRT', 'HND'],
  featured: true,
  tagline: 'Neon nights and quiet shrines.',
  summary: 'A city of contrasts.',
  description: ['Paragraph one.'],
  image: { src: '/images/destinations/tokyo.jpg', alt: 'Tokyo skyline' },
  highlights: [{ title: 'Shibuya', description: 'Famous crossing.' }],
  tags: ['city'],
  travelInfo: {
    timeZone: 'Asia/Tokyo',
    utcOffset: 'UTC+9',
    currency: 'Japanese yen (JPY)',
    language: 'Japanese',
    bestTimeToVisit: 'March to May',
  },
  routes: [{ origin: 'MNL', destination: 'NRT', durationMinutes: 260, weeklyFrequency: 14 }],
  illustrativeFare: {
    amount: 8999,
    currency: 'PHP',
    origin: 'MNL',
    cabin: 'economy',
    kind: 'illustrative',
  },
};

describe('destinationSchema', () => {
  it('accepts a complete destination', () => {
    expect(destinationSchema.parse(destination)).toEqual(destination);
  });

  it('only accepts local image paths', () => {
    const remote = { ...destination, image: { src: 'https://example.com/t.jpg', alt: 'x' } };
    expect(destinationSchema.safeParse(remote).success).toBe(false);
  });

  it('requires illustrative fares to be labelled as such', () => {
    const live = {
      ...destination,
      illustrativeFare: { ...destination.illustrativeFare, kind: 'live' },
    };
    expect(destinationSchema.safeParse(live).success).toBe(false);
  });

  it('requires at least one airport', () => {
    expect(destinationSchema.safeParse({ ...destination, airportCodes: [] }).success).toBe(false);
  });

  it('rejects slugs that are not URL-safe', () => {
    expect(destinationSchema.safeParse({ ...destination, slug: 'Tokyo City' }).success).toBe(false);
  });
});

describe('destinationListQuerySchema', () => {
  it('parses boolean and region filters', () => {
    expect(destinationListQuerySchema.parse({ featured: 'true', region: 'east-asia' })).toEqual({
      featured: true,
      region: 'east-asia',
    });
    expect(destinationListQuerySchema.parse({})).toEqual({});
  });

  it('rejects unknown regions', () => {
    expect(destinationListQuerySchema.safeParse({ region: 'europe' }).success).toBe(false);
  });
});
