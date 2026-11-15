import { z } from 'zod';
import { iataCodeSchema } from './common';
import { cabinClassSchema } from './search';

/**
 * AeroNova's fictional fleet and route network. Aircraft types and airports
 * are real; which aircraft flies where, and when, is invented.
 */

/** ICAO aircraft type designator, e.g. `A21N` for the Airbus A321neo. */
export const aircraftCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}$/, 'Use a four-character aircraft type code, for example A21N.');
export type AircraftCode = z.infer<typeof aircraftCodeSchema>;

export const aircraftCabinSchema = z.object({
  cabin: cabinClassSchema,
  seats: z.number().int().positive(),
  /** Seat pitch, for display, e.g. `30 in`. */
  pitch: z.string().min(1),
  /** Seat layout across the aisle(s), e.g. `3-3`. */
  layout: z.string().regex(/^\d(-\d){1,2}$/),
});
export type AircraftCabin = z.infer<typeof aircraftCabinSchema>;

export const aircraftSchema = z.object({
  code: aircraftCodeSchema,
  name: z.string().min(1),
  manufacturer: z.string().min(1),
  bodyType: z.enum(['narrowbody', 'widebody']),
  /** Cabins in the order they appear from the front of the aircraft. */
  cabins: z.array(aircraftCabinSchema).min(1),
  totalSeats: z.number().int().positive(),
  rangeKm: z.number().int().positive(),
});
export type Aircraft = z.infer<typeof aircraftSchema>;

export const aircraftSummarySchema = aircraftSchema.pick({ code: true, name: true });
export type AircraftSummary = z.infer<typeof aircraftSummarySchema>;

export const aircraftListResponseSchema = z.object({ data: z.array(aircraftSchema) });
export type AircraftListResponse = z.infer<typeof aircraftListResponseSchema>;

/** Distance bands used for scheduling and pricing. */
export const distanceBandSchema = z.enum(['short', 'medium', 'long']);
export type DistanceBand = z.infer<typeof distanceBandSchema>;

export const DISTANCE_BAND_LABELS: Record<DistanceBand, string> = {
  short: 'Short haul (under 1,000 km)',
  medium: 'Medium haul (1,000–2,500 km)',
  long: 'Long haul (over 2,500 km)',
};

export function distanceBandFor(distanceKm: number): DistanceBand {
  if (distanceKm < 1000) return 'short';
  if (distanceKm <= 2500) return 'medium';
  return 'long';
}

/** A directional route, e.g. `MNL-SIN`. */
export const routeIdSchema = z.string().regex(/^[A-Z]{3}-[A-Z]{3}$/);

export const networkRouteSchema = z.object({
  id: routeIdSchema,
  origin: iataCodeSchema,
  destination: iataCodeSchema,
  kind: z.enum(['domestic', 'international']),
  distanceKm: z.number().int().positive(),
  distanceBand: distanceBandSchema,
  /** Scheduled block time (gate to gate). */
  blockMinutes: z.number().int().positive(),
  /** Departures per week across all flight numbers. */
  weeklyFrequency: z.number().int().positive(),
  flightNumbers: z.array(z.string().min(1)).min(1),
  aircraftCodes: z.array(aircraftCodeSchema).min(1),
  /** Cabins offered on at least one flight on this route. */
  cabins: z.array(cabinClassSchema).min(1),
});
export type NetworkRoute = z.infer<typeof networkRouteSchema>;

export const routeListQuerySchema = z.object({
  from: iataCodeSchema.optional(),
  to: iataCodeSchema.optional(),
});
export type RouteListQuery = z.infer<typeof routeListQuerySchema>;

export const routeListResponseSchema = z.object({ data: z.array(networkRouteSchema) });
export type RouteListResponse = z.infer<typeof routeListResponseSchema>;
