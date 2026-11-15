import { z } from 'zod';
import { currencyCodeSchema, iataCodeSchema, minorAmountSchema } from './common';
import { flightInstanceIdSchema, journeyDirectionSchema } from './flights';
import { aircraftCodeSchema } from './network';
import { fareFamilyCodeSchema } from './offers';
import { cabinClassSchema, type CabinClass } from './search';
import { travellerIdSchema } from './travellers';

/*
 * Seat maps (Milestone 4).
 *
 * A seat map describes one dated flight: the aircraft's fixed layout (cabins, rows, seat
 * letters, aisles) plus each seat's availability on that flight. Availability is the airline's
 * inventory — `OCCUPIED` seats are sold to other travellers — and is the same for everybody.
 *
 * A traveller's *choice* is not availability. Choosing a seat records a provisional
 * preference in the shopping session; it doesn't hold the seat, and another guest can still
 * choose it. The API checks every chosen seat again before the booking review, and seats are
 * only ever committed with an order (a later milestone).
 */

/**
 * - `STANDARD`: a regular seat.
 * - `PREFERRED`: the first rows of Economy, closer to the door ("preferred seats" in the fare
 *   families). This is the "front of cabin" product.
 * - `EXTRA_LEGROOM`: exit rows and bulkheads with more space.
 * - `BUSINESS`: a Business cabin seat.
 */
export const seatCategorySchema = z.enum(['STANDARD', 'PREFERRED', 'EXTRA_LEGROOM', 'BUSINESS']);
export type SeatCategory = z.infer<typeof seatCategorySchema>;

export const SEAT_CATEGORY_LABELS: Record<SeatCategory, string> = {
  STANDARD: 'Standard',
  PREFERRED: 'Preferred',
  EXTRA_LEGROOM: 'Extra legroom',
  BUSINESS: 'Business',
};

/**
 * - `AVAILABLE`: can be chosen (subject to the traveller's fare and the seat's restrictions).
 * - `OCCUPIED`: already taken by another traveller.
 * - `UNAVAILABLE`: blocked from advance selection (see `unavailableReason`).
 */
export const seatStatusSchema = z.enum(['AVAILABLE', 'OCCUPIED', 'UNAVAILABLE']);
export type SeatStatus = z.infer<typeof seatStatusSchema>;

export const seatPositionSchema = z.enum(['window', 'middle', 'aisle']);
export type SeatPosition = z.infer<typeof seatPositionSchema>;

export const seatFeatureSchema = z.enum([
  'EXIT_ROW',
  'BULKHEAD',
  'EXTRA_LEGROOM',
  'FRONT_OF_CABIN',
  'LIE_FLAT',
  'LIMITED_RECLINE',
]);
export type SeatFeature = z.infer<typeof seatFeatureSchema>;

export const SEAT_FEATURE_LABELS: Record<SeatFeature, string> = {
  EXIT_ROW: 'Exit row',
  BULKHEAD: 'Bulkhead',
  EXTRA_LEGROOM: 'Extra legroom',
  FRONT_OF_CABIN: 'Front of cabin',
  LIE_FLAT: 'Lie-flat bed',
  LIMITED_RECLINE: 'Limited recline',
};

/**
 * Who may sit in a seat. `EXIT_ROW`: adults only, not travelling with a lap infant, and able
 * to help in an emergency (a simplified, fictional demo rule).
 */
export const seatRestrictionSchema = z.enum(['EXIT_ROW']);
export type SeatRestriction = z.infer<typeof seatRestrictionSchema>;

export const seatUnavailableReasonSchema = z.enum([
  /** Kept for the airport to assign (e.g. for travellers who need special help). */
  'held-for-airport',
  /** The flight can't be sold any more (cancelled or sales closed). */
  'flight-closed',
]);
export type SeatUnavailableReason = z.infer<typeof seatUnavailableReasonSchema>;

/** `12A`: row number and seat letter. */
export const seatIdSchema = z.string().regex(/^[1-9]\d?[A-K]$/, 'Invalid seat.');

export const seatSchema = z.object({
  id: seatIdSchema,
  row: z.number().int().positive(),
  letter: z.string().regex(/^[A-K]$/),
  cabin: cabinClassSchema,
  category: seatCategorySchema,
  status: seatStatusSchema,
  unavailableReason: seatUnavailableReasonSchema.nullable(),
  position: seatPositionSchema,
  features: z.array(seatFeatureSchema),
  restrictions: z.array(seatRestrictionSchema),
});
export type Seat = z.infer<typeof seatSchema>;

export const seatMapRowSchema = z.object({
  number: z.number().int().positive(),
  /** Aligned with the cabin's `columns`: `null` where this row has no seat (e.g. the fuselage narrows). */
  seats: z.array(seatSchema.nullable()),
  exitRow: z.boolean(),
});
export type SeatMapRow = z.infer<typeof seatMapRowSchema>;

export const seatMapCabinSchema = z.object({
  cabin: cabinClassSchema,
  name: z.string().min(1),
  /** `3-3`, `1-2-1` */
  layout: z.string().regex(/^\d(-\d)+$/),
  /** Seat letters left to right as seen facing forward; `null` marks an aisle. */
  columns: z
    .array(
      z
        .string()
        .regex(/^[A-K]$/)
        .nullable(),
    )
    .min(3),
  rows: z.array(seatMapRowSchema).min(1),
  capacity: z.number().int().positive(),
  /** Seats free on this flight: `available + blocked` equals the inventory's seats left. */
  available: z.number().int().nonnegative(),
  occupied: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type SeatMapCabin = z.infer<typeof seatMapCabinSchema>;

export const seatMapSchema = z.object({
  flightId: flightInstanceIdSchema,
  flightNumber: z.string().regex(/^NV\d{1,4}$/),
  origin: iataCodeSchema,
  destination: iataCodeSchema,
  /** Local departure date and time at the origin. */
  departureDate: z.string(),
  departureTime: z.string().regex(/^\d{2}:\d{2}$/),
  aircraft: z.object({
    code: aircraftCodeSchema,
    name: z.string().min(1),
    bodyType: z.enum(['narrowbody', 'widebody']),
  }),
  /** Front to back. */
  cabins: z.array(seatMapCabinSchema).min(1),
  /** Changes when a layout fixture changes, so cached layouts are never mixed with new ones. */
  layoutVersion: z.string().min(1),
});
export type SeatMap = z.infer<typeof seatMapSchema>;

export const seatMapResponseSchema = z.object({
  data: seatMapSchema,
  meta: z.object({ disclaimer: z.string().min(1), serverTime: z.iso.datetime() }),
});
export type SeatMapResponse = z.infer<typeof seatMapResponseSchema>;

export const seatMapParamsSchema = z.object({ flightId: flightInstanceIdSchema });

// ---------------------------------------------------------------------------
// A seat map for one guest: prices for their fare, who may sit where, their choices
// ---------------------------------------------------------------------------

export const seatPriceSchema = z.object({
  category: seatCategorySchema,
  /** What this seat costs per traveller on this flight; `0` when the fare includes it. */
  priceMinor: minorAmountSchema,
  /** The fare family includes this category: no additional charge. */
  included: z.boolean(),
});
export type SeatPrice = z.infer<typeof seatPriceSchema>;

export const seatTravellerSchema = z.object({
  id: travellerIdSchema,
  /** `Adult 1` */
  label: z.string().min(1),
  /** `Maria Santos`, or `null` before traveller details are saved. */
  name: z.string().nullable(),
  type: z.enum(['adult', 'child', 'infant']),
  /** Lap infants don't get a seat of their own. */
  seatable: z.boolean(),
  /** May sit in an exit row (see `seatRestrictionSchema`). */
  exitRowAllowed: z.boolean(),
});
export type SeatTraveller = z.infer<typeof seatTravellerSchema>;

export const seatAssignmentSchema = z.object({
  travellerId: travellerIdSchema,
  flightId: flightInstanceIdSchema,
  seatId: seatIdSchema,
  category: seatCategorySchema,
  priceMinor: minorAmountSchema,
  included: z.boolean(),
});
export type SeatAssignment = z.infer<typeof seatAssignmentSchema>;

export const sessionSeatMapSchema = z.object({
  seatMap: seatMapSchema,
  direction: journeyDirectionSchema,
  fare: z.object({ family: fareFamilyCodeSchema, cabin: cabinClassSchema }),
  currency: currencyCodeSchema,
  /** One entry per category sold in the fare's cabin. */
  pricing: z.array(seatPriceSchema),
  travellers: z.array(seatTravellerSchema).min(1),
  /** This session's choices on this flight. */
  assignments: z.array(seatAssignmentSchema),
});
export type SessionSeatMap = z.infer<typeof sessionSeatMapSchema>;

export const sessionSeatMapResponseSchema = z.object({
  data: sessionSeatMapSchema,
  meta: z.object({ disclaimer: z.string().min(1), serverTime: z.iso.datetime() }),
});
export type SessionSeatMapResponse = z.infer<typeof sessionSeatMapResponseSchema>;

/**
 * Set or clear seats. Each entry replaces the seat of one traveller on one flight
 * (`seatId: null` removes it); travellers and flights not listed keep their seats. There is no
 * field for a price: the API prices every seat itself.
 */
export const updateSeatsRequestSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative().optional(),
    assignments: z
      .array(
        z
          .object({
            travellerId: travellerIdSchema,
            flightId: flightInstanceIdSchema,
            seatId: seatIdSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(36),
  })
  .strict();
export type UpdateSeatsRequest = z.infer<typeof updateSeatsRequestSchema>;

// ---------------------------------------------------------------------------
// Who may sit where: one rule, used by the API and to describe seats in the storefront
// ---------------------------------------------------------------------------

export type SeatProblem =
  'occupied' | 'unavailable' | 'other-cabin' | 'not-seatable' | 'exit-row' | 'taken-by-companion';

export const SEAT_PROBLEM_MESSAGES: Record<SeatProblem, string> = {
  occupied: 'This seat is already taken.',
  unavailable: 'This seat can’t be chosen in advance.',
  'other-cabin': 'This seat isn’t in the cabin of your fare.',
  'not-seatable': 'Lap infants travel on an adult’s lap and don’t get a seat of their own.',
  'exit-row':
    'Exit row seats are for adults travelling without an infant who can help in an emergency.',
  'taken-by-companion': 'Someone else in your party has this seat.',
};

/** Why a traveller can't have a seat, or `null` when they can. */
export function seatProblem(
  seat: Pick<Seat, 'status' | 'cabin' | 'restrictions'>,
  {
    fareCabin,
    traveller,
    takenByOther,
  }: {
    fareCabin: CabinClass;
    traveller: Pick<SeatTraveller, 'seatable' | 'exitRowAllowed'>;
    /** Another traveller in the same session has this seat on this flight. */
    takenByOther: boolean;
  },
): SeatProblem | null {
  if (!traveller.seatable) return 'not-seatable';
  if (seat.status === 'OCCUPIED') return 'occupied';
  if (seat.status === 'UNAVAILABLE') return 'unavailable';
  if (seat.cabin !== fareCabin) return 'other-cabin';
  if (seat.restrictions.includes('EXIT_ROW') && !traveller.exitRowAllowed) return 'exit-row';
  if (takenByOther) return 'taken-by-companion';
  return null;
}

/** All seats of a map, front to back, left to right. */
export function seatsOf(map: Pick<SeatMap, 'cabins'>): Seat[] {
  return map.cabins.flatMap((cabin) =>
    cabin.rows.flatMap((row) => row.seats.filter((seat) => seat !== null)),
  );
}

/**
 * The storefront's `GET /api/flights/[id]/seatmap`: the guest's own view of a flight on their
 * trip (`session`), or the public map for any other flight (`public`). Always private and live.
 */
export const storefrontSeatMapResponseSchema = z.object({
  data: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('session'), seatMap: sessionSeatMapSchema }),
    z.object({ kind: z.literal('public'), seatMap: seatMapSchema }),
  ]),
  meta: z.object({ disclaimer: z.string().min(1), serverTime: z.iso.datetime() }),
});
export type StorefrontSeatMapResponse = z.infer<typeof storefrontSeatMapResponseSchema>;
