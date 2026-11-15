import { z } from 'zod';
import { currencyCodeSchema, minorAmountSchema } from './common';
import { ancillarySelectionSchema } from './ancillaries';
import { flightInstanceIdSchema, journeyDirectionSchema } from './flights';
import { seatAssignmentSchema } from './seatmaps';
import {
  contactInputSchema,
  travellerIdSchema,
  travellerInputSchema,
  type TravellerSlot,
} from './travellers';

/*
 * The pre-checkout booking (Milestone 4), kept inside the shopping session: traveller details,
 * seat choices, optional services, and the review that checks all of it again.
 *
 * Nothing here is an order. Seats aren't held, nothing is ticketed, and no payment exists; the
 * review produces a *pre-checkout quote* that the order step (a later milestone) re-validates.
 */

export const bookingStepSchema = z.enum(['travellers', 'seats', 'extras', 'review']);
export type BookingStep = z.infer<typeof bookingStepSchema>;
export const BOOKING_STEPS: readonly BookingStep[] = bookingStepSchema.options;

export const BOOKING_STEP_LABELS: Record<BookingStep, string> = {
  travellers: 'Travellers',
  seats: 'Seats',
  extras: 'Extras',
  review: 'Review',
};

/**
 * - `locked`: an earlier step isn't done yet.
 * - `open`: can be used now.
 * - `complete`: done (and still valid).
 */
export const bookingStepStateSchema = z.enum(['locked', 'open', 'complete']);
export type BookingStepState = z.infer<typeof bookingStepStateSchema>;

/** Something the API changed for the traveller, e.g. a seat removed after a fare change. */
export const bookingNoticeSchema = z.object({
  code: z.enum([
    'SEAT_REMOVED',
    'SEATS_RESET',
    'ANCILLARY_REMOVED',
    'NOW_INCLUDED',
    'OFFER_REFRESHED',
  ]),
  message: z.string().min(1),
});
export type BookingNotice = z.infer<typeof bookingNoticeSchema>;

export const reviewIssueSchema = z.object({
  code: z.enum([
    'FLIGHTS_NOT_CONFIRMED',
    'OFFER_UNAVAILABLE',
    'PRICE_CHANGED',
    'TRAVELLERS_INCOMPLETE',
    'SEAT_UNAVAILABLE',
    'SEAT_INELIGIBLE',
    'ANCILLARY_UNAVAILABLE',
    'STEP_INCOMPLETE',
  ]),
  /** Where the traveller fixes it. `flights` is the M3 trip summary. */
  step: z.enum(['flights', 'travellers', 'seats', 'extras']),
  message: z.string().min(1),
  direction: journeyDirectionSchema.nullable(),
  travellerId: travellerIdSchema.nullable(),
  flightId: flightInstanceIdSchema.nullable(),
});
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;

export const reviewStatusSchema = z.enum(['READY', 'ACTION_REQUIRED']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/** The last full validation of the booking. */
export const bookingReviewSchema = z.object({
  status: reviewStatusSchema,
  checkedAt: z.iso.datetime(),
  /** The session version this validation produced. Any later change makes it stale. */
  sessionVersion: z.number().int().nonnegative(),
  /** `false` once the session changed after the check: validate again before continuing. */
  current: z.boolean(),
  totalMinor: minorAmountSchema,
  issues: z.array(reviewIssueSchema),
});
export type BookingReview = z.infer<typeof bookingReviewSchema>;

export const bookingSchema = z.object({
  /** One per priced passenger; the traveller form fills these. */
  slots: z.array(
    z.object({
      id: travellerIdSchema,
      type: z.enum(['adult', 'child', 'infant']),
      ordinal: z.number().int().positive(),
      label: z.string().min(1),
    }),
  ) satisfies z.ZodType<TravellerSlot[]>,
  /** `null` until saved. Private: returned only to the session's owner. */
  passengers: z.array(travellerInputSchema).nullable(),
  contact: contactInputSchema.nullable(),
  seats: z.array(seatAssignmentSchema),
  ancillaries: z.array(ancillarySelectionSchema),
  steps: z.object({
    travellers: bookingStepStateSchema,
    seats: bookingStepStateSchema,
    extras: bookingStepStateSchema,
    review: bookingStepStateSchema,
  }),
  /** What the API adjusted in the last change. */
  notices: z.array(bookingNoticeSchema),
  review: bookingReviewSchema.nullable(),
});
export type Booking = z.infer<typeof bookingSchema>;

/** Seats and services, party-wide, in minor units. */
export const extrasTotalsSchema = z.object({
  seatsMinor: minorAmountSchema,
  baggageMinor: minorAmountSchema,
  mealsMinor: minorAmountSchema,
  priorityMinor: minorAmountSchema,
  totalMinor: minorAmountSchema,
});
export type ExtrasTotals = z.infer<typeof extrasTotalsSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Replace every traveller's details and the contact details at once. */
export const savePassengersRequestSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative().optional(),
    passengers: z.array(travellerInputSchema).min(1).max(18),
    contact: contactInputSchema,
  })
  .strict();
export type SavePassengersRequest = z.input<typeof savePassengersRequestSchema>;

/** Finish the seats or extras step ("Continue"). */
export const completeStepRequestSchema = z
  .object({
    step: z.enum(['seats', 'extras']),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CompleteStepRequest = z.infer<typeof completeStepRequestSchema>;

export const validateBookingRequestSchema = z
  .object({ expectedVersion: z.number().int().nonnegative().optional() })
  .strict();

// ---------------------------------------------------------------------------
// The review: an itemised pre-checkout quote
// ---------------------------------------------------------------------------

export const quoteLineSchema = z.object({
  kind: z.enum(['FLIGHTS', 'SEAT', 'BAGGAGE', 'MEAL', 'PRIORITY']),
  /** `Seat 12A`, `Extra 15 kg`, `Velasia Classic` */
  label: z.string().min(1),
  /** `MNL → SIN · VEL 501` */
  detail: z.string().min(1),
  direction: journeyDirectionSchema,
  travellerId: travellerIdSchema.nullable(),
  flightId: flightInstanceIdSchema.nullable(),
  amountMinor: minorAmountSchema,
  /** Part of the fare: shown as "Included", never charged. */
  included: z.boolean(),
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const quoteSchema = z.object({
  currency: currencyCodeSchema,
  lines: z.array(quoteLineSchema).min(1),
  totals: z.object({
    baseFareMinor: minorAmountSchema,
    fareFamilyMinor: minorAmountSchema,
    taxesMinor: minorAmountSchema,
    flightsMinor: minorAmountSchema,
    seatsMinor: minorAmountSchema,
    baggageMinor: minorAmountSchema,
    mealsMinor: minorAmountSchema,
    priorityMinor: minorAmountSchema,
    totalMinor: minorAmountSchema,
  }),
  /** Offer pricing rules plus the ancillary catalogue the quote was made with. */
  priceVersion: z.string().min(1),
  quotedAt: z.iso.datetime(),
});
export type Quote = z.infer<typeof quoteSchema>;

/** Steps of the booking a traveller must finish before the review is ready, by priority. */
export const REVIEW_STEP_ORDER = ['flights', 'travellers', 'seats', 'extras'] as const;
