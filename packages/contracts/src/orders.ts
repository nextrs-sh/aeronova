import { z } from 'zod';
import { currencyCodeSchema, minorAmountSchema } from './common';
import { ancillarySelectionSchema, travellerBaggageSchema } from './ancillaries';
import { quoteSchema, reviewIssueSchema } from './booking';
import { flightInstanceIdSchema, journeyDirectionSchema } from './flights';
import {
  fareFamilyCodeSchema,
  offerIdSchema,
  offerItinerarySchema,
  offerPriceSchema,
  offerServiceSchema,
} from './offers';
import { seatAssignmentSchema } from './seatmaps';
import { cabinClassSchema, tripTypeSchema } from './search';
import { shoppingSessionIdSchema, shoppingSessionSchema } from './shopping';
import { contactInputSchema, travellerIdSchema, travellerInputSchema } from './travellers';

/*
 * Checkout and orders (Milestone 5).
 *
 * An order is the durable record of a fictional purchase. It is created from a shopping
 * session whose review is ready, holds the seats for a limited time, and becomes CONFIRMED only
 * after a simulated payment succeeded and the hold was committed in the same durable write.
 *
 * Everything an order shows is a snapshot taken when it was created: flights, fares, travellers,
 * seats, services, and every price. Nothing is reconstructed from live inventory later.
 *
 * Ownership: orders belong to a guest. The storefront keeps a random guest token in an HTTP-only
 * cookie and sends it as a bearer token; the API stores only its SHA-256 hash. The booking
 * reference is for display and is never accepted as a credential.
 *
 * Payments are simulated. No card number, bank detail, or credential is ever collected, and no
 * money moves.
 */

/** Internal order id: 128 random bits. Not a credential, but not guessable either. */
export const orderIdSchema = z.string().regex(/^ord_[A-Za-z0-9_-]{22}$/, 'Invalid order.');
export type OrderId = z.infer<typeof orderIdSchema>;

/** Characters that can't be confused with one another (no 0/O, 1/I/L). */
export const BOOKING_REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** `VEL-8K4P2Q`: for display and support conversations only. */
export const bookingReferenceSchema = z
  .string()
  .regex(/^VEL-[A-HJKMNP-Z2-9]{6}$/, 'Invalid booking reference.');

/** The guest's secret: 256 bits, base64url. Sent only server to server. */
export const guestTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** A client-chosen key that makes a retry safe (a UUID fits). */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Invalid idempotency key.');

export const paymentAttemptIdSchema = z.string().regex(/^pay_[A-Za-z0-9_-]{22}$/);

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/**
 * - `PENDING_PAYMENT`: the seats are held; waiting for a successful payment.
 * - `CONFIRMED`: paid (simulated) and the seats committed. Final.
 * - `PAYMENT_FAILED`: every allowed payment attempt failed; the seats were released. Final.
 * - `EXPIRED`: the hold ended before a payment succeeded; the seats were released. Final.
 * - `CANCELLED`: replaced by a newer checkout of the same trip; the seats were released. Final.
 */
export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PAYMENT_FAILED',
  'EXPIRED',
  'CANCELLED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** The inventory an order holds. Only `HELD` (while valid) and `COMMITTED` take seats. */
export const holdStatusSchema = z.enum(['HELD', 'COMMITTED', 'RELEASED', 'EXPIRED']);
export type HoldStatus = z.infer<typeof holdStatusSchema>;

/**
 * - `PROCESSING`: sent to the (simulated) payment provider; no answer yet.
 * - `PENDING`: the provider accepted it and will decide later. Check the status.
 * - `UNKNOWN`: the provider didn't answer in time. It may have succeeded: check the status,
 *   never pay again blindly.
 * - `SUCCEEDED` / `FAILED`: final.
 */
export const paymentStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const UNRESOLVED_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'PROCESSING',
  'PENDING',
  'UNKNOWN',
];

export const paymentMethodSchema = z.enum(['DEMO_CARD', 'DEMO_WALLET', 'DEMO_BANK_TRANSFER']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, { name: string; description: string }> = {
  DEMO_CARD: {
    name: 'Demo Card',
    description: 'A pretend card. No card number is asked for or stored.',
  },
  DEMO_WALLET: {
    name: 'Demo Wallet',
    description: 'A pretend e-wallet. Nothing is linked and nothing is charged.',
  },
  DEMO_BANK_TRANSFER: {
    name: 'Demo Bank Transfer',
    description: 'A pretend transfer. No bank or account details are involved.',
  },
};

/** What the payment simulator should do. Honoured only where outcome controls are enabled. */
export const simulatedOutcomeSchema = z.enum(['SUCCESS', 'DECLINED', 'TIMEOUT', 'PENDING']);
export type SimulatedOutcome = z.infer<typeof simulatedOutcomeSchema>;

export const SIMULATED_OUTCOME_LABELS: Record<
  SimulatedOutcome,
  { name: string; description: string }
> = {
  SUCCESS: { name: 'Approve', description: 'The demo payment succeeds.' },
  DECLINED: { name: 'Decline', description: 'The demo payment is declined. You can try again.' },
  TIMEOUT: {
    name: 'Time out',
    description: 'The provider doesn’t answer in time. Check the status to find out what happened.',
  },
  PENDING: {
    name: 'Pending',
    description: 'The provider decides a few seconds later. Check the status to see the result.',
  },
};

// ---------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------

export const orderItemKindSchema = z.enum(['FLIGHT', 'SEAT', 'BAGGAGE', 'MEAL', 'PRIORITY']);
export type OrderItemKind = z.infer<typeof orderItemKindSchema>;

/** One purchased product, priced when the order was created. */
export const orderItemSchema = z.object({
  id: z.string().min(1),
  kind: orderItemKindSchema,
  label: z.string().min(1),
  detail: z.string().min(1),
  direction: journeyDirectionSchema,
  travellerId: travellerIdSchema.nullable(),
  flightId: flightInstanceIdSchema.nullable(),
  /** The product code: fare family, seat category, or service id. */
  productCode: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceMinor: minorAmountSchema,
  amountMinor: minorAmountSchema,
  /** Part of the fare: never charged. */
  included: z.boolean(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

/** One direction of the trip as it was bought. */
export const orderJourneySchema = z.object({
  direction: journeyDirectionSchema,
  offerId: offerIdSchema,
  family: fareFamilyCodeSchema,
  familyName: z.string().min(1),
  cabin: cabinClassSchema,
  itinerary: offerItinerarySchema,
  services: z.array(offerServiceSchema),
  price: offerPriceSchema,
});
export type OrderJourney = z.infer<typeof orderJourneySchema>;

export const paymentAttemptSchema = z.object({
  id: paymentAttemptIdSchema,
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  amountMinor: minorAmountSchema,
  currency: currencyCodeSchema,
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  /** Why a failed attempt failed, in words the traveller can act on. */
  failureReason: z.string().nullable(),
  /** The simulated provider's reference, once it has one. */
  providerReference: z.string().nullable(),
});
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

export const orderSchema = z.object({
  id: orderIdSchema,
  reference: bookingReferenceSchema,
  status: orderStatusSchema,
  /** The latest payment attempt's status, or `NOT_STARTED`. */
  paymentStatus: z.union([paymentStatusSchema, z.literal('NOT_STARTED')]),
  currency: currencyCodeSchema,
  /** The authoritative amount to pay: the sum of `items`. */
  totalMinor: minorAmountSchema,
  totals: quoteSchema.shape.totals,
  items: z.array(orderItemSchema).min(1),
  search: z.object({
    tripType: tripTypeSchema,
    origin: z.string(),
    destination: z.string(),
    cabin: cabinClassSchema,
    passengers: z.object({
      adults: z.number().int().nonnegative(),
      children: z.number().int().nonnegative(),
      infants: z.number().int().nonnegative(),
    }),
  }),
  journeys: z.array(orderJourneySchema).min(1),
  passengers: z.array(travellerInputSchema).min(1),
  contact: contactInputSchema,
  seats: z.array(seatAssignmentSchema),
  ancillaries: z.array(ancillarySelectionSchema),
  baggage: z.array(travellerBaggageSchema),
  hold: z.object({
    status: holdStatusSchema,
    /** When the hold ends if no payment succeeds. Irrelevant once committed. */
    expiresAt: z.iso.datetime(),
    /** Seats taken on each flight (lap infants don't take one). */
    seatsPerFlight: z.number().int().positive(),
    flightIds: z.array(flightInstanceIdSchema).min(1),
  }),
  payment: z.object({
    attempts: z.array(paymentAttemptSchema),
    /** A new payment attempt can be made now. */
    canPay: z.boolean(),
    /** Check the status before doing anything else: an attempt is still undecided. */
    awaitingResult: z.boolean(),
    attemptsRemaining: z.number().int().nonnegative(),
  }),
  pricingVersion: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().nullable(),
  serverTime: z.iso.datetime(),
});
export type Order = z.infer<typeof orderSchema>;

// ---------------------------------------------------------------------------
// Requests and responses
// ---------------------------------------------------------------------------

/** Re-check a ready booking for checkout. Creates nothing. */
export const checkoutValidateRequestSchema = z
  .object({
    sessionId: shoppingSessionIdSchema,
    /** The total the traveller saw; compared, never used as a price. */
    acceptedTotalMinor: minorAmountSchema.optional(),
  })
  .strict();
export type CheckoutValidateRequest = z.infer<typeof checkoutValidateRequestSchema>;

export const priceChangeSchema = z.object({
  previousTotalMinor: minorAmountSchema,
  currentTotalMinor: minorAmountSchema,
});
export type PriceChange = z.infer<typeof priceChangeSchema>;

export const checkoutValidationSchema = z.object({
  status: z.enum(['READY', 'ACTION_REQUIRED']),
  issues: z.array(reviewIssueSchema),
  /** Set when the total differs from `acceptedTotalMinor`. */
  priceChange: priceChangeSchema.nullable(),
  quote: quoteSchema,
  session: shoppingSessionSchema,
  holdMinutes: z.number().int().positive(),
});
export type CheckoutValidation = z.infer<typeof checkoutValidationSchema>;
export const checkoutValidateResponseSchema = z.object({ data: checkoutValidationSchema });
export type CheckoutValidateResponse = z.infer<typeof checkoutValidateResponseSchema>;

/**
 * Start checkout: re-validate everything, then create the pending order and hold its seats in
 * one durable write. Repeating it with the same key returns the same order.
 */
export const prepareCheckoutRequestSchema = z
  .object({
    sessionId: shoppingSessionIdSchema,
    idempotencyKey: idempotencyKeySchema,
    /** The session version the traveller reviewed. */
    expectedVersion: z.number().int().nonnegative(),
    /** The total the traveller agreed to. A different authoritative total is refused. */
    acceptedTotalMinor: minorAmountSchema,
  })
  .strict();
export type PrepareCheckoutRequest = z.infer<typeof prepareCheckoutRequestSchema>;

export const prepareCheckoutResponseSchema = z.object({
  data: z.object({
    order: orderSchema,
    /** `true` when this answers a retry: no new order or hold was created. */
    replayed: z.boolean(),
  }),
});
export type PrepareCheckoutResponse = z.infer<typeof prepareCheckoutResponseSchema>;

export const orderResponseSchema = z.object({ data: orderSchema });
export type OrderResponse = z.infer<typeof orderResponseSchema>;

/** No amount field: the API always charges the order's own total. */
export const createPaymentAttemptRequestSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    method: paymentMethodSchema,
    /** Test and demo environments only; refused elsewhere. */
    simulatedOutcome: simulatedOutcomeSchema.optional(),
  })
  .strict();
export type CreatePaymentAttemptRequest = z.infer<typeof createPaymentAttemptRequestSchema>;

export const paymentResultSchema = z.object({
  order: orderSchema,
  attempt: paymentAttemptSchema.nullable(),
  /** `true` when this answers a retry of an attempt that already exists. */
  replayed: z.boolean(),
});
export type PaymentResult = z.infer<typeof paymentResultSchema>;
export const paymentResultResponseSchema = z.object({ data: paymentResultSchema });
export type PaymentResultResponse = z.infer<typeof paymentResultResponseSchema>;

export const paymentOptionsSchema = z.object({
  methods: z.array(
    z.object({ code: paymentMethodSchema, name: z.string(), description: z.string() }),
  ),
  /** Whether the tester may choose the simulated outcome. */
  outcomeControls: z.boolean(),
  outcomes: z.array(
    z.object({ code: simulatedOutcomeSchema, name: z.string(), description: z.string() }),
  ),
  maxAttempts: z.number().int().positive(),
  disclaimer: z.string(),
});
export type PaymentOptions = z.infer<typeof paymentOptionsSchema>;
export const paymentOptionsResponseSchema = z.object({ data: paymentOptionsSchema });
export type PaymentOptionsResponse = z.infer<typeof paymentOptionsResponseSchema>;

export const orderParamsSchema = z.object({ orderId: orderIdSchema });
export const orderReferenceParamsSchema = z.object({ reference: bookingReferenceSchema });

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** What the traveller is told, by order status. Only `CONFIRMED` is ever called a booking. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Payment pending',
  CONFIRMED: 'Booking confirmed',
  PAYMENT_FAILED: 'Payment unsuccessful',
  EXPIRED: 'Hold expired',
  CANCELLED: 'Checkout cancelled',
};
