import { z } from 'zod';
import { iataCodeSchema, slugSchema } from './common';

export const airportSchema = z.object({
  code: iataCodeSchema,
  name: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  /** IANA time zone, e.g. `Asia/Manila`. */
  timeZone: z.string().min(1),
  /** Velasia hub airports are listed first in suggestions. */
  hub: z.boolean(),
  /** Destination guide for this airport's city, when one exists. */
  destinationSlug: slugSchema.optional(),
});
export type Airport = z.infer<typeof airportSchema>;

export const airportListQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
});
export type AirportListQuery = z.infer<typeof airportListQuerySchema>;

export const airportListResponseSchema = z.object({
  data: z.array(airportSchema),
});
export type AirportListResponse = z.infer<typeof airportListResponseSchema>;

/** Lower-case and strip diacritics so "Đà" matches "da" and "Cebú" matches "cebu". */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
}

function scoreAirport(query: string, airport: Airport): number {
  const code = airport.code.toLowerCase();
  const city = normalizeSearchText(airport.city);
  const name = normalizeSearchText(airport.name);
  const country = normalizeSearchText(airport.country);

  if (code === query) return 100;
  if (city === query) return 90;
  if (code.startsWith(query)) return 80;
  if (city.startsWith(query)) return 70;

  const words = `${city} ${name} ${country}`.split(/[\s\-–()/]+/).filter(Boolean);
  if (words.some((word) => word.startsWith(query))) return 50;
  if (`${city} ${name} ${country}`.includes(query)) return 20;
  return 0;
}

/**
 * Rank airports for an autocomplete query. Matches airport code, city, airport
 * name, and country. An empty query returns hubs first, then alphabetical by city.
 */
export function matchAirports(query: string, airports: readonly Airport[], limit = 8): Airport[] {
  const normalized = normalizeSearchText(query);
  const byDefaultOrder = (a: Airport, b: Airport) =>
    Number(b.hub) - Number(a.hub) || a.city.localeCompare(b.city) || a.code.localeCompare(b.code);

  if (normalized.length === 0) {
    return [...airports].sort(byDefaultOrder).slice(0, limit);
  }

  return airports
    .map((airport) => ({ airport, score: scoreAirport(normalized, airport) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || byDefaultOrder(a.airport, b.airport))
    .slice(0, limit)
    .map((entry) => entry.airport);
}

export function formatAirportLabel(airport: Pick<Airport, 'city' | 'code'>): string {
  return `${airport.city} (${airport.code})`;
}
