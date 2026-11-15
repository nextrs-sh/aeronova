import { z } from 'zod';
import {
  ancillaryOfferSchema,
  flightMealServiceSchema,
  travellerBaggageSchema,
} from './ancillaries';
import { currencyCodeSchema, minorAmountSchema } from './common';
import { isIsoDate } from './dates';
import { flightInstanceIdSchema, itineraryIdSchema, journeyDirectionSchema } from './flights';
import { fareFamilyCodeSchema, offerItinerarySchema, offerPriceSchema } from './offers';
import {
  financialAdjustmentSchema,
  idempotencyKeySchema,
  orderJourneySchema,
  orderSchema,
  paymentMethodSchema,
  refundSchema,
  servicingOperationSchema,
  servicingRecordSchema,
  simulatedOutcomeSchema,
} from './orders';
import { seatAssignmentSchema, seatIdSchema, sessionSeatMapSchema } from './seatmaps';
import { travellerIdSchema } from './travellers';

/*
 * Order servicing (Milestone 6): what a traveller can do with a confirmed booking — change a
 * flight, change seats, add services, cancel — and what each costs.
 *
 * Every price comes from the API. A request never carries a price: it carries the amount the
 * traveller agreed to (`acceptedAmountMinor`), which the API only compares with its own quote,
 * exactly like the checkout total. A different authoritative amount is `PRICE_CHANGED`.
 *
 * Every change names the order revision the traveller saw (`expectedRevision`) and an
 * idempotency key, so a retry never applies a change twice and a change made in another tab is
 * never overwritten.
 *
 * All rules, fees, cut-offs, and refunds are fictional. No real ticket is changed and no money
 * moves.
 */

// ---------------------------------------------------------------------------
// Fare rules and what the booking allows right now
// ---------------------------------------------------------------------------

/** The fare family's change and refund rules, as structured data (the M3 texts describe them). */
export const fareRulesSchema = z.object({
  family: fareFamilyCodeSchema,
  change: z.object({
    allowed: z.boolean(),
    /** Per traveller (lap infants exempt), per direction changed. */
    feePerTravellerMinor: minorAmountSchema,
    /** Changes close this long before the direction's first departure. */
    cutoffMinutes: z.number().int().nonnegative(),
  }),
  refund: z.object({
    /**
     * - `FULL`: the fare is refunded.
     * - `FEE`: refunded less a fee per traveller and direction.
     * - `TAXES_ONLY`: the fare is kept; unused taxes and charges are refunded.
     */
    kind: z.enum(['FULL', 'FEE', 'TAXES_ONLY']),
    feePerTravellerMinor: minorAmountSchema,
    /** Whether paid seats and services are refunded when the booking is cancelled. */
    extrasRefundable: z.boolean(),
    /** Cancellation closes this long before the first departure. */
    cutoffMinutes: z.number().int().nonnegative(),
  }),
});
export type FareRules = z.infer<typeof fareRulesSchema>;

export const actionAvailabilitySchema = z.object({
  allowed: z.boolean(),
  /** Why not, in words the traveller can act on. */
  reason: z.string().nullable(),
  /** When the action closes (ISO), when it has a deadline. */
  closesAt: z.iso.datetime().nullable(),
});
export type ActionAvailability = z.infer<typeof actionAvailabilitySchema>;

export const servicingOverviewSchema = z.object({
  changeFlight: z.array(
    actionAvailabilitySchema.extend({
      direction: journeyDirectionSchema,
      family: fareFamilyCodeSchema,
      feePerTravellerMinor: minorAmountSchema,
    }),
  ),
  seats: actionAvailabilitySchema,
  extras: actionAvailabilitySchema,
  cancel: actionAvailabilitySchema,
  rules: z.array(fareRulesSchema.extend({ direction: journeyDirectionSchema })),
  /** A change waiting for its payment: finish or discard it before starting another. */
  pendingOperationId: z.string().nullable(),
  /** A refund still being processed. */
  refundPending: z.boolean(),
});
export type ServicingOverview = z.infer<typeof servicingOverviewSchema>;
export const servicingOverviewResponseSchema = z.object({
  data: z.object({ order: orderSchema, servicing: servicingOverviewSchema }),
});
export type ServicingOverviewResponse = z.infer<typeof servicingOverviewResponseSchema>;

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/** One line of a servicing quote. Charges are positive, credits negative. */
export const servicingQuoteLineSchema = z.object({
  kind: z.enum([
    'NEW_FARE',
    'CURRENT_FARE',
    'RELEASED_EXTRA',
    'CHANGE_FEE',
    'SEAT',
    'SERVICE',
    'ALREADY_PAID',
    'REFUND',
    'NON_REFUNDABLE',
    'CANCELLATION_FEE',
  ]),
  label: z.string().min(1),
  detail: z.string(),
  amountMinor: z.number().int(),
});
export type ServicingQuoteLine = z.infer<typeof servicingQuoteLineSchema>;

export const servicingQuoteSchema = z.object({
  operation: servicingOperationSchema,
  status: z.literal('QUOTED'),
  /** The revision the quote was made against: send it back as `expectedRevision`. */
  orderRevision: z.number().int().positive(),
  currency: currencyCodeSchema,
  lines: z.array(servicingQuoteLineSchema),
  /** Positive: to pay. Negative: refunded or kept as credit (see `adjustment`). */
  netMinor: z.number().int(),
  /** Before fees and credits, for flight changes: new fare minus current fare. */
  priceDifferenceMinor: z.number().int(),
  adjustment: financialAdjustmentSchema,
  /** Plain-language consequences: what is released, carried over, or not refunded. */
  notes: z.array(z.string()),
  quotedAt: z.iso.datetime(),
  /** Prices are held only in the sense that a different price at confirmation is refused. */
  validUntil: z.iso.datetime(),
});
export type ServicingQuote = z.infer<typeof servicingQuoteSchema>;

/** An additional payment, when the quote asks for one. */
export const servicingPaymentInputSchema = z
  .object({
    method: paymentMethodSchema,
    /** Test and demo environments only. */
    simulatedOutcome: simulatedOutcomeSchema.optional(),
  })
  .strict();
export type ServicingPaymentInput = z.infer<typeof servicingPaymentInputSchema>;

const confirmBase = {
  idempotencyKey: idempotencyKeySchema,
  expectedRevision: z.number().int().positive(),
  /** The `netMinor` the traveller agreed to; compared, never charged. */
  acceptedAmountMinor: z.number().int(),
  payment: servicingPaymentInputSchema.optional(),
  /** Test and demo environments only: what the simulated refund provider should do. */
  simulatedRefundOutcome: simulatedOutcomeSchema.optional(),
};

// ---------------------------------------------------------------------------
// Change flight
// ---------------------------------------------------------------------------

export const changeSearchRequestSchema = z
  .object({
    direction: journeyDirectionSchema,
    date: z.string().refine(isIsoDate, 'Use YYYY-MM-DD.'),
  })
  .strict();
export type ChangeSearchRequest = z.infer<typeof changeSearchRequestSchema>;

export const changeAlternativeSchema = z.object({
  itineraryId: itineraryIdSchema,
  itinerary: offerItinerarySchema,
  price: offerPriceSchema,
  quote: servicingQuoteSchema,
});
export type ChangeAlternative = z.infer<typeof changeAlternativeSchema>;

export const changeSearchResultSchema = z.object({
  direction: journeyDirectionSchema,
  date: z.string(),
  current: orderJourneySchema,
  alternatives: z.array(changeAlternativeSchema),
  /** Why there are none, when there are none. */
  emptyReason: z.string().nullable(),
  /** The fare family is kept: changes are priced in the family the traveller bought. */
  family: fareFamilyCodeSchema,
});
export type ChangeSearchResult = z.infer<typeof changeSearchResultSchema>;
export const changeSearchResponseSchema = z.object({ data: changeSearchResultSchema });

export const confirmChangeRequestSchema = z
  .object({ ...confirmBase, direction: journeyDirectionSchema, itineraryId: itineraryIdSchema })
  .strict();
export type ConfirmChangeRequest = z.infer<typeof confirmChangeRequestSchema>;

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

export const seatChangeSchema = z
  .object({
    travellerId: travellerIdSchema,
    flightId: flightInstanceIdSchema,
    seatId: seatIdSchema,
  })
  .strict();
export type SeatChange = z.infer<typeof seatChangeSchema>;

export const seatQuoteRequestSchema = z
  .object({ changes: z.array(seatChangeSchema).min(1).max(9) })
  .strict();
export const confirmSeatChangeRequestSchema = z
  .object({ ...confirmBase, changes: z.array(seatChangeSchema).min(1).max(9) })
  .strict();
export type ConfirmSeatChangeRequest = z.infer<typeof confirmSeatChangeRequestSchema>;

/** The seat map of a flight in the booking, for its owner: their own seats are marked. */
export const orderSeatMapSchema = sessionSeatMapSchema.extend({
  /** What each traveller has already paid for their seat on this flight (credited to a new one). */
  paid: z.array(z.object({ travellerId: travellerIdSchema, amountMinor: minorAmountSchema })),
  /** Seat changes close this long before departure. */
  closesAt: z.iso.datetime(),
});
export type OrderSeatMap = z.infer<typeof orderSeatMapSchema>;
export const orderSeatMapResponseSchema = z.object({ data: orderSeatMapSchema });

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/** One service to add. Baggage and priority are per direction; meals per flight. */
export const ancillaryPurchaseSchema = z.discriminatedUnion('category', [
  z
    .object({
      category: z.literal('BAGGAGE'),
      travellerId: travellerIdSchema,
      direction: journeyDirectionSchema,
      productId: z.string().max(40),
    })
    .strict(),
  z
    .object({
      category: z.literal('MEAL'),
      travellerId: travellerIdSchema,
      flightId: flightInstanceIdSchema,
      productId: z.string().max(40),
    })
    .strict(),
  z
    .object({
      category: z.literal('PRIORITY'),
      travellerId: travellerIdSchema,
      direction: journeyDirectionSchema,
      productId: z.string().max(40),
    })
    .strict(),
]);
export type AncillaryPurchase = z.infer<typeof ancillaryPurchaseSchema>;

export const ancillaryQuoteRequestSchema = z
  .object({ changes: z.array(ancillaryPurchaseSchema).min(1).max(20) })
  .strict();
export const confirmAncillaryPurchaseRequestSchema = z
  .object({ ...confirmBase, changes: z.array(ancillaryPurchaseSchema).min(1).max(20) })
  .strict();
export type ConfirmAncillaryPurchaseRequest = z.infer<typeof confirmAncillaryPurchaseRequestSchema>;

/** What can still be added to a confirmed booking, priced against what was already bought. */
export const orderAncillariesSchema = z.object({
  currency: currencyCodeSchema,
  /** Price is what it would cost now; `payableMinor` is that less what this slot already paid. */
  offers: z.array(
    ancillaryOfferSchema.extend({
      payableMinor: minorAmountSchema,
      /** Already bought for this traveller and slot. */
      owned: z.boolean(),
      /** Sold, but not right now (e.g. a smaller bag than one already bought). */
      unavailableReason: z.string().nullable(),
    }),
  ),
  allowances: z.array(travellerBaggageSchema),
  mealService: z.array(flightMealServiceSchema),
  /** Per category: when purchases close. */
  cutoffs: z.object({ baggageHours: z.number(), mealHours: z.number(), priorityHours: z.number() }),
  catalogueVersion: z.string().min(1),
});
export type OrderAncillaries = z.infer<typeof orderAncillariesSchema>;
export const orderAncillariesResponseSchema = z.object({ data: orderAncillariesSchema });

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export const cancellationQuoteSchema = servicingQuoteSchema.extend({
  paidMinor: minorAmountSchema,
  refundMinor: minorAmountSchema,
  nonRefundableMinor: minorAmountSchema,
  feeMinor: minorAmountSchema,
});
export type CancellationQuote = z.infer<typeof cancellationQuoteSchema>;

export const confirmCancellationRequestSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    expectedRevision: z.number().int().positive(),
    /** The refund the traveller was shown; compared, never paid out as such. */
    acceptedRefundMinor: minorAmountSchema,
    simulatedRefundOutcome: simulatedOutcomeSchema.optional(),
  })
  .strict();
export type ConfirmCancellationRequest = z.infer<typeof confirmCancellationRequestSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const quoteResponseSchema = z.object({ data: servicingQuoteSchema });
export const cancellationQuoteResponseSchema = z.object({ data: cancellationQuoteSchema });

export const servicingResultSchema = z.object({
  order: orderSchema,
  operation: servicingRecordSchema,
  /** `true` when this answers a retry: nothing was applied again. */
  replayed: z.boolean(),
});
export type ServicingResult = z.infer<typeof servicingResultSchema>;
export const servicingResultResponseSchema = z.object({ data: servicingResultSchema });

export const servicingPaymentRequestSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    method: paymentMethodSchema,
    simulatedOutcome: simulatedOutcomeSchema.optional(),
  })
  .strict();
export type ServicingPaymentRequest = z.infer<typeof servicingPaymentRequestSchema>;

export const servicingParamsSchema = z.object({
  orderId: z.string(),
  operationId: z.string().regex(/^svc_[A-Za-z0-9_-]{22}$/),
});

export const orderEventSchema = z.object({
  seq: z.number().int().positive(),
  type: z.string(),
  at: z.iso.datetime(),
  /** Never personal data. */
  detail: z.string().nullable(),
});
export type OrderEvent = z.infer<typeof orderEventSchema>;
export const orderEventsResponseSchema = z.object({
  data: z.array(orderEventSchema),
  meta: z.object({ total: z.number().int().nonnegative() }),
});
export const refundsResponseSchema = z.object({ data: z.array(refundSchema) });

export const seatAssignmentsSchema = z.array(seatAssignmentSchema);

/** Short labels for the servicing history. */
export const SERVICING_OPERATION_LABELS: Record<
  z.infer<typeof servicingOperationSchema>,
  string
> = {
  CHANGE_FLIGHT: 'Flight change',
  CHANGE_SEAT: 'Seat change',
  ADD_ANCILLARY: 'Services added',
  CANCEL_ORDER: 'Cancellation',
};
