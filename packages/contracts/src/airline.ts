import { z } from 'zod';

/**
 * The single source of truth for the fictional airline's identity. The storefront, the mock
 * retailing API, and tests read the brand from here instead of hardcoding it.
 *
 * Velasia Airways is fictional. It holds no IATA or ICAO airline designator: `flightNumberPrefix`
 * is an internal, customer-facing display convention for this demo only.
 */
export const airline = {
  name: 'Velasia Airways',
  shortName: 'Velasia',
  tagline: 'Beyond every horizon.',
  /** ISO 3166-1 alpha-2 home country. */
  country: 'PH',
  /** ISO 4217 default currency. */
  currency: 'PHP',
  /** Display-only flight-number prefix, e.g. "VEL 128". Not an IATA/ICAO designator. */
  flightNumberPrefix: 'VEL',
  isFictional: true,
  disclaimer:
    'Velasia Airways is a fictional airline created for demonstration. No real flights, bookings, or payments are offered.',
} as const;

export type Airline = typeof airline;

/** Public shape of the airline identity served by the retailing API (`GET /v1/airline`). */
export const airlineIdentitySchema = z.object({
  name: z.string().min(1),
  shortName: z.string().min(1),
  tagline: z.string().min(1),
  country: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  flightNumberPrefix: z.string().regex(/^[A-Z]{2,3}$/),
  isFictional: z.literal(true),
  disclaimer: z.string().min(1),
});
export type AirlineIdentity = z.infer<typeof airlineIdentitySchema>;

/**
 * Customer-facing flight number, e.g. `displayFlightNumber(128)` → `"VEL 128"`.
 * Stable internal flight identifiers stay separate from this display string.
 */
export function displayFlightNumber(number: number): string {
  if (!Number.isInteger(number) || number < 1 || number > 9999) {
    throw new RangeError(`Flight number must be an integer from 1 to 9999, got ${number}.`);
  }
  return `${airline.flightNumberPrefix} ${number}`;
}
