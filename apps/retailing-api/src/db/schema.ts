import {
  ancillarySelectionSchema,
  bookingReferenceSchema,
  cabinClassSchema,
  contactInputSchema,
  currencyCodeSchema,
  flightInstanceIdSchema,
  holdStatusSchema,
  idempotencyKeySchema,
  minorAmountSchema,
  orderIdSchema,
  orderItemSchema,
  orderJourneySchema,
  orderSchema,
  orderStatusSchema,
  paymentAttemptIdSchema,
  paymentMethodSchema,
  paymentStatusSchema,
  quoteSchema,
  seatAssignmentSchema,
  seatIdSchema,
  shoppingSessionIdSchema,
  simulatedOutcomeSchema,
  travellerBaggageSchema,
  travellerInputSchema,
} from '@velasia/contracts';
import { z } from 'zod';

/*
 * The documents the retailing API stores in TalaDB, with an explicit schema version each.
 *
 * Physical layout (see docs/ARCHITECTURE.md, "Checkout consistency"):
 *
 * - `orders`: one document per order, holding the order, its items, its inventory hold, its
 *   payment attempts, and its event history. TalaDB commits one document write atomically, and
 *   it has no multi-document transaction, so everything that must change together lives in one
 *   document and changes in one compare-and-set write.
 * - `payment_provider`: the simulated payment provider's own ledger of charges. It stands for an
 *   external system, so it is deliberately separate: an order learns a charge's outcome only by
 *   asking the provider, exactly as it would with a real one.
 *
 * Seat inventory is not stored as counters. It is derived from the orders whose hold is active
 * (see `inventory/ledger.ts`), so there is one source of truth.
 *
 * Fields in the "index mirrors" group repeat nested values at the top level, because TalaDB
 * indexes top-level fields; `withIndexFields` recomputes them before every write.
 */

export const ORDER_SCHEMA_VERSION = 1;
export const PROVIDER_SCHEMA_VERSION = 1;

export const ORDERS_COLLECTION = 'orders';
export const PROVIDER_COLLECTION = 'payment_provider';

const epochMs = z.number().int().nonnegative();

export const storedAllocationSchema = z.object({
  flightId: flightInstanceIdSchema,
  cabin: cabinClassSchema,
  /** Seats taken on this flight: the party minus lap infants. */
  seats: z.number().int().positive(),
  /** Seats chosen in advance; the rest are assigned at check-in. */
  seatIds: z.array(seatIdSchema),
});
export type StoredAllocation = z.infer<typeof storedAllocationSchema>;

export const storedHoldSchema = z.object({
  holdId: z.string().regex(/^hld_[A-Za-z0-9_-]{22}$/),
  status: holdStatusSchema,
  createdAt: epochMs,
  expiresAt: epochMs,
  committedAt: epochMs.nullable(),
  releasedAt: epochMs.nullable(),
  releaseReason: z.string().nullable(),
  /** The inventory snapshot the hold was checked against. */
  inventoryVersion: z.string().min(1),
  allocations: z.array(storedAllocationSchema).min(1),
});
export type StoredHold = z.infer<typeof storedHoldSchema>;

export const storedAttemptSchema = z.object({
  attemptId: paymentAttemptIdSchema,
  idempotencyKey: idempotencyKeySchema,
  /** Hash of the request's parameters, to tell a retry from a reused key. */
  requestHash: z.string().length(64),
  method: paymentMethodSchema,
  simulatedOutcome: simulatedOutcomeSchema.nullable(),
  amountMinor: minorAmountSchema,
  currency: currencyCodeSchema,
  status: paymentStatusSchema,
  createdAt: epochMs,
  /** Wall-clock start, for provider timing (independent of a pinned business clock). */
  startedAtWall: epochMs,
  completedAt: epochMs.nullable(),
  failureReason: z.string().nullable(),
  providerReference: z.string().nullable(),
});
export type StoredAttempt = z.infer<typeof storedAttemptSchema>;

export const orderEventTypeSchema = z.enum([
  'ORDER_CREATED',
  'INVENTORY_HELD',
  'PAYMENT_INITIATED',
  'PAYMENT_PENDING',
  'PAYMENT_UNKNOWN',
  'PAYMENT_FAILED',
  'PAYMENT_SUCCEEDED',
  'INVENTORY_COMMITTED',
  'ORDER_CONFIRMED',
  'HOLD_RELEASED',
  'HOLD_EXPIRED',
  'ORDER_EXPIRED',
  'ORDER_CANCELLED',
  'ORDER_PAYMENT_FAILED',
]);
export type OrderEventType = z.infer<typeof orderEventTypeSchema>;

/** Append-only history. `detail` never contains personal data. */
export const storedEventSchema = z.object({
  seq: z.number().int().positive(),
  type: orderEventTypeSchema,
  at: epochMs,
  detail: z.string().max(200).nullable(),
});
export type StoredEvent = z.infer<typeof storedEventSchema>;

/** Immutable snapshot of what was bought. Never re-derived from live inventory. */
export const orderSnapshotSchema = z.object({
  search: orderSchema.shape.search,
  journeys: z.array(orderJourneySchema).min(1),
  passengers: z.array(travellerInputSchema).min(1),
  contact: contactInputSchema,
  seats: z.array(seatAssignmentSchema),
  ancillaries: z.array(ancillarySelectionSchema),
  baggage: z.array(travellerBaggageSchema),
});
export type OrderSnapshot = z.infer<typeof orderSnapshotSchema>;

export const MAX_ORDER_EVENTS = 60;

export const storedOrderSchema = z.object({
  schemaVersion: z.literal(ORDER_SCHEMA_VERSION),
  orderId: orderIdSchema,
  reference: bookingReferenceSchema,
  /** Compare-and-set revision: every write requires the revision it read. */
  rev: z.number().int().positive(),
  guestId: z.string().regex(/^gst_[A-Za-z0-9_-]{22}$/),
  /** SHA-256 of the guest token, hex. The token itself is never stored. */
  ownerTokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  sessionId: shoppingSessionIdSchema,
  /** `<sessionId>:<idempotency key>` of the checkout request that created the order. */
  checkoutKey: z.string().min(1),
  /** Hash of that request's parameters. */
  checkoutRequestHash: z.string().length(64),
  /** Hash of what was bought, to recognise the same checkout made twice. */
  contentHash: z.string().length(64),
  status: orderStatusSchema,
  createdAt: epochMs,
  updatedAt: epochMs,
  confirmedAt: epochMs.nullable(),
  currency: currencyCodeSchema,
  totalMinor: minorAmountSchema,
  totals: quoteSchema.shape.totals,
  pricingVersion: z.string().min(1),
  snapshot: orderSnapshotSchema,
  items: z.array(orderItemSchema).min(1),
  hold: storedHoldSchema,
  attempts: z.array(storedAttemptSchema),
  events: z.array(storedEventSchema).max(MAX_ORDER_EVENTS),
  // Index mirrors (recomputed by withIndexFields).
  paymentStatus: z.union([paymentStatusSchema, z.literal('NOT_STARTED')]),
  holdState: holdStatusSchema,
  holdExpiresAt: epochMs,
  flightIds: z.array(flightInstanceIdSchema).min(1),
  attemptIds: z.array(paymentAttemptIdSchema),
});
export type StoredOrder = z.infer<typeof storedOrderSchema>;

/** Recompute the top-level fields that mirror nested state, for TalaDB's indexes. */
export function withIndexFields(order: StoredOrder): StoredOrder {
  return {
    ...order,
    paymentStatus: order.attempts.at(-1)?.status ?? 'NOT_STARTED',
    holdState: order.hold.status,
    holdExpiresAt: order.hold.expiresAt,
    flightIds: order.hold.allocations.map((allocation) => allocation.flightId),
    attemptIds: order.attempts.map((attempt) => attempt.attemptId),
  };
}

/** The simulated provider's record of one charge, keyed by the payment attempt. */
export const providerChargeSchema = z.object({
  schemaVersion: z.literal(PROVIDER_SCHEMA_VERSION),
  attemptId: paymentAttemptIdSchema,
  orderId: orderIdSchema,
  reference: z.string().regex(/^DEMO-[A-Z0-9]{10}$/),
  amountMinor: minorAmountSchema,
  currency: currencyCodeSchema,
  method: paymentMethodSchema,
  status: z.enum(['SUCCEEDED', 'DECLINED', 'PENDING']),
  declineReason: z.string().nullable(),
  createdAtWall: epochMs,
  /** A `PENDING` charge is decided at this wall-clock time. */
  resolveAtWall: epochMs.nullable(),
});
export type ProviderCharge = z.infer<typeof providerChargeSchema>;
