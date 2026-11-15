import { z } from 'zod';
import { currencyCodeSchema, iataCodeSchema, minorAmountSchema } from './common';
import { isIsoDate } from './dates';
import { journeyDirectionSchema, type JourneyDirection } from './flights';
import {
  bookingReviewSchema,
  bookingSchema,
  extrasTotalsSchema,
  quoteSchema,
  reviewIssueSchema,
  reviewStatusSchema,
} from './booking';
import { fareFamilyCodeSchema, offerIdSchema, offerSchema } from './offers';
import { cabinClassSchema, tripTypeSchema, type FlightSearch } from './search';

/*
 * Shopping sessions (Milestone 3): a guest's provisional choice of offers for one search.
 *
 * A session is not an order and holds no inventory. It records which offer the traveller
 * chose for each direction, whether that offer has been re-validated, and the API's
 * authoritative total. It lives in the retailing API's memory with a bounded lifetime.
 *
 * Ownership: the API returns a session `id` and a separate secret `token` once, at
 * creation. Every later call must present the token (`Authorization: Bearer …`). The
 * storefront keeps both in an HTTP-only cookie and never accepts them from the browser.
 */

export const shoppingSessionIdSchema = z
  .string()
  .regex(/^ses_[A-Za-z0-9_-]{22}$/, 'Invalid shopping session identifier.');

/** 256-bit secret, base64url. */
export const shoppingSessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** The search a session belongs to: the same fields as a validated `FlightSearch`. */
export const shoppingSearchSchema = z.object({
  tripType: tripTypeSchema,
  origin: iataCodeSchema,
  destination: iataCodeSchema,
  departDate: z.string().refine(isIsoDate, 'Invalid date.'),
  returnDate: z.string().refine(isIsoDate, 'Invalid date.').optional(),
  passengers: z.object({
    adults: z.number().int().min(0).max(9),
    children: z.number().int().min(0).max(9),
    infants: z.number().int().min(0).max(9),
  }),
  cabin: cabinClassSchema,
}) satisfies z.ZodType<FlightSearch>;

/**
 * Where a selected offer is in its lifecycle. (An offer is GENERATED and immediately
 * AVAILABLE when the API creates it; these are the states once a traveller chooses it.)
 *
 * - `SELECTED`: chosen, not yet re-validated.
 * - `VALIDATED`: re-checked against current inventory and rules at the offer's price.
 * - `PRICE_CHANGED`: the offer expired and a fresh one costs a different amount; the
 *   traveller must accept `pendingOffer` (or choose again) before continuing.
 * - `EXPIRED`: the offer's validity ended; re-validate to get a fresh one.
 * - `UNAVAILABLE`: the flights can no longer be sold for this party.
 */
export const selectionStatusSchema = z.enum([
  'SELECTED',
  'VALIDATED',
  'PRICE_CHANGED',
  'EXPIRED',
  'UNAVAILABLE',
]);
export type SelectionStatus = z.infer<typeof selectionStatusSchema>;

/** What the last re-validation of a selection found. */
export const repriceOutcomeSchema = z.enum([
  /** Still valid at the same price. */
  'VALIDATED',
  /** The offer had expired; a fresh offer at the same price replaced it. */
  'REFRESHED',
  /** The offer had expired and a fresh offer costs a different amount. */
  'PRICE_CHANGED',
  'UNAVAILABLE',
]);
export type RepriceOutcome = z.infer<typeof repriceOutcomeSchema>;

export const selectionSchema = z.object({
  direction: journeyDirectionSchema,
  status: selectionStatusSchema,
  offer: offerSchema,
  selectedAt: z.iso.datetime(),
  validatedAt: z.iso.datetime().nullable(),
  /** The selection this one replaced for the same direction, to show the price difference. */
  previous: z
    .object({
      family: fareFamilyCodeSchema,
      itineraryId: z.string(),
      totalMinor: minorAmountSchema,
    })
    .nullable(),
  /** A fresh offer waiting for the traveller to accept its new price. */
  pendingOffer: offerSchema.nullable(),
  lastCheck: z
    .object({
      outcome: repriceOutcomeSchema,
      at: z.iso.datetime(),
      previousTotalMinor: minorAmountSchema,
      /** `null` when the flights can no longer be sold. */
      currentTotalMinor: minorAmountSchema.nullable(),
    })
    .nullable(),
});
export type Selection = z.infer<typeof selectionSchema>;

export const sessionSummarySchema = z.object({
  currency: currencyCodeSchema,
  /** Every direction the trip needs has a selection. */
  complete: z.boolean(),
  /** Complete, every selection is `VALIDATED`, and none has expired. */
  readyToContinue: z.boolean(),
  /**
   * The whole trip: the selected offers plus chosen seats and services. There are no
   * per-booking charges, so nothing is counted twice.
   */
  totalMinor: minorAmountSchema,
  /** Sum of the selected offers alone. */
  flightsTotalMinor: minorAmountSchema,
  /** `baseFare + fareFamily + taxes + extras = totalMinor`. */
  totals: z.object({
    baseFareMinor: minorAmountSchema,
    fareFamilyMinor: minorAmountSchema,
    taxesMinor: minorAmountSchema,
    extrasMinor: minorAmountSchema,
  }),
  /** Seats, baggage, meals, and priority, as chosen in the booking steps. */
  extras: extrasTotalsSchema,
  /** The earliest expiry among the selected offers. */
  offersExpireAt: z.iso.datetime().nullable(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const shoppingSessionSchema = z.object({
  id: shoppingSessionIdSchema,
  search: shoppingSearchSchema,
  selections: z.object({
    outbound: selectionSchema.nullable(),
    inbound: selectionSchema.nullable(),
  }),
  summary: sessionSummarySchema,
  /** Traveller details, seats, services, and review (Milestone 4). */
  booking: bookingSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Sliding expiry: extended by each change, up to a maximum lifetime. */
  expiresAt: z.iso.datetime(),
  /** Incremented by every change. */
  version: z.number().int().nonnegative(),
  /** The API's clock when it answered. */
  serverTime: z.iso.datetime(),
});
export type ShoppingSession = z.infer<typeof shoppingSessionSchema>;

export const shoppingSessionResponseSchema = z.object({ data: shoppingSessionSchema });
export type ShoppingSessionResponse = z.infer<typeof shoppingSessionResponseSchema>;

export const createSessionRequestSchema = z.object({ search: shoppingSearchSchema }).strict();
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const createSessionResponseSchema = z.object({
  data: z.object({ session: shoppingSessionSchema, token: shoppingSessionTokenSchema }),
});
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

/**
 * Choose an offer for one direction. Strict: there is nowhere to send a price, a family, or a
 * total — the offer id is the only input, and the API prices it.
 */
export const selectOfferRequestSchema = z
  .object({ direction: journeyDirectionSchema, offerId: offerIdSchema })
  .strict();
export type SelectOfferRequest = z.infer<typeof selectOfferRequestSchema>;

export const selectOfferResponseSchema = z.object({
  data: z.object({
    session: shoppingSessionSchema,
    /** The return selection was removed because it no longer fits the new departing flight. */
    inboundCleared: z.boolean(),
  }),
});
export type SelectOfferResponse = z.infer<typeof selectOfferResponseSchema>;

export const repriceRequestSchema = z
  .object({ directions: z.array(journeyDirectionSchema).min(1).max(2).optional() })
  .strict();

export const repriceResponseSchema = z.object({
  data: z.object({
    session: shoppingSessionSchema,
    outcomes: z.array(
      z.object({
        direction: journeyDirectionSchema,
        outcome: repriceOutcomeSchema,
        previousTotalMinor: minorAmountSchema,
        currentTotalMinor: minorAmountSchema.nullable(),
      }),
    ),
  }),
});
export type RepriceResponse = z.infer<typeof repriceResponseSchema>;

/** Directions a trip needs before it is complete. */
export function requiredDirections(search: Pick<FlightSearch, 'tripType'>): JourneyDirection[] {
  return search.tripType === 'round-trip' ? ['outbound', 'inbound'] : ['outbound'];
}

/** True when two searches describe the same trip (route, dates, passengers, cabin). */
export function sameSearch(a: FlightSearch, b: FlightSearch): boolean {
  return (
    a.tripType === b.tripType &&
    a.origin === b.origin &&
    a.destination === b.destination &&
    a.departDate === b.departDate &&
    (a.returnDate ?? '') === (b.returnDate ?? '') &&
    a.passengers.adults === b.passengers.adults &&
    a.passengers.children === b.passengers.children &&
    a.passengers.infants === b.passengers.infants &&
    a.cabin === b.cabin
  );
}

// ---------------------------------------------------------------------------
// Booking steps (Milestone 4)
// ---------------------------------------------------------------------------

/** `GET /v1/shopping-sessions/:id/review`: the itemised quote and what still needs doing. */
export const reviewResponseSchema = z.object({
  data: z.object({
    session: shoppingSessionSchema,
    quote: quoteSchema,
    /** Readiness from the session as it is, without re-pricing (see `POST …/validate`). */
    readiness: z.object({ status: reviewStatusSchema, issues: z.array(reviewIssueSchema) }),
  }),
});
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

/** `POST /v1/shopping-sessions/:id/validate`: re-price and re-check everything, then record it. */
export const validateBookingResponseSchema = z.object({
  data: z.object({
    session: shoppingSessionSchema,
    review: bookingReviewSchema,
    quote: quoteSchema,
  }),
});
export type ValidateBookingResponse = z.infer<typeof validateBookingResponseSchema>;
