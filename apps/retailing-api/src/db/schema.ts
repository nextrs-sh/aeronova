import {
  accountIdSchema,
  ancillarySelectionSchema,
  bookingReferenceSchema,
  financialAdjustmentSchema,
  journeyDirectionSchema,
  refundStatusSchema,
  savedTravellerIdSchema,
  servicingOperationSchema,
  servicingQuoteLineSchema,
  travellerTitleSchema,
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

export const ORDER_SCHEMA_VERSION = 2;
export const PROVIDER_SCHEMA_VERSION = 1;

export const ORDERS_COLLECTION = 'orders';
export const PROVIDER_COLLECTION = 'payment_provider';
/** Milestone 6. */
export const REFUND_PROVIDER_COLLECTION = 'refund_provider';
export const ACCOUNTS_COLLECTION = 'accounts';
export const SESSIONS_COLLECTION = 'account_sessions';
export const TRAVELLERS_COLLECTION = 'saved_travellers';

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
  // Milestone 6: servicing, refunds, ownership.
  'SERVICING_REQUESTED',
  'SERVICING_INVENTORY_CLAIMED',
  'SERVICING_PAYMENT_INITIATED',
  'SERVICING_PAYMENT_PENDING',
  'SERVICING_PAYMENT_UNKNOWN',
  'SERVICING_PAYMENT_FAILED',
  'SERVICING_PAYMENT_SUCCEEDED',
  'SERVICING_COMPLETED',
  'SERVICING_FAILED',
  'SERVICING_EXPIRED',
  'FLIGHT_CHANGED',
  'SEATS_CHANGED',
  'SERVICES_ADDED',
  'CREDIT_ISSUED',
  'BOOKING_CANCELLED',
  'REFUND_REQUESTED',
  'REFUND_PENDING',
  'REFUND_UNKNOWN',
  'REFUND_SUCCEEDED',
  'REFUND_FAILED',
  'OWNER_LINKED',
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

/**
 * Bounds that keep one order document small (see MILESTONE-6-REPORT.md, "Document size"):
 * every servicing operation adds a handful of events, so 30 operations fit in 300 events.
 */
export const MAX_ORDER_EVENTS = 300;
export const MAX_SERVICING_OPERATIONS = 30;
export const MAX_SERVICING_PAYMENT_ATTEMPTS = 3;
export const MAX_REFUND_ATTEMPTS = 3;

/** Inventory claimed by a servicing operation; unlike a checkout hold, it can add 0 seats. */
export const storedClaimAllocationSchema = storedAllocationSchema.extend({
  seats: z.number().int().nonnegative(),
});
export type StoredClaimAllocation = z.infer<typeof storedClaimAllocationSchema>;

/**
 * Replacement inventory claimed while a change waits for its payment. The booking's own hold
 * stays committed meanwhile, so both take seats until the change is applied or abandoned.
 */
export const storedClaimSchema = z.object({
  status: holdStatusSchema,
  createdAt: epochMs,
  expiresAt: epochMs,
  releasedAt: epochMs.nullable(),
  allocations: z.array(storedClaimAllocationSchema).min(1),
});
export type StoredClaim = z.infer<typeof storedClaimSchema>;

export const storedRefundSchema = z.object({
  refundId: z.string().regex(/^rfd_[A-Za-z0-9_-]{22}$/),
  amountMinor: minorAmountSchema,
  currency: currencyCodeSchema,
  status: refundStatusSchema,
  createdAt: epochMs,
  startedAtWall: epochMs,
  completedAt: epochMs.nullable(),
  failureReason: z.string().nullable(),
  providerReference: z.string().nullable(),
  simulatedOutcome: simulatedOutcomeSchema.nullable(),
});
export type StoredRefund = z.infer<typeof storedRefundSchema>;

/** The booking as it is now: what the traveller will fly, sit in, and has bought. */
export const storedCurrentSchema = z.object({
  /** 1 at confirmation; +1 for every applied change of itinerary, seats, or services. */
  version: z.number().int().positive(),
  journeys: z.array(orderJourneySchema).min(1),
  seats: z.array(seatAssignmentSchema),
  ancillaries: z.array(ancillarySelectionSchema),
  baggage: z.array(travellerBaggageSchema),
  items: z.array(orderItemSchema).min(1),
});
export type StoredCurrent = z.infer<typeof storedCurrentSchema>;

/** What a pending operation will make of the booking once it is paid for. */
export const storedPlanSchema = z.object({
  /** `current.version` the plan was computed from; applying it to any other is refused. */
  baseVersion: z.number().int().positive(),
  current: storedCurrentSchema,
  allocations: z.array(storedAllocationSchema).min(1),
});
export type StoredPlan = z.infer<typeof storedPlanSchema>;

export const storedServicingRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('CHANGE_FLIGHT'),
    direction: journeyDirectionSchema,
    itineraryId: z.string().min(1),
  }),
  z.object({
    operation: z.literal('CHANGE_SEAT'),
    changes: z.array(
      z.object({ travellerId: z.string(), flightId: z.string(), seatId: z.string() }),
    ),
  }),
  z.object({
    operation: z.literal('ADD_ANCILLARY'),
    changes: z.array(
      z.object({
        category: z.string(),
        travellerId: z.string(),
        direction: z.string().nullable(),
        flightId: z.string().nullable(),
        productId: z.string(),
      }),
    ),
  }),
  z.object({ operation: z.literal('CANCEL_ORDER') }),
]);
export type StoredServicingRequest = z.infer<typeof storedServicingRequestSchema>;

/**
 * One servicing operation, kept forever as the booking's history. Everything that must change
 * together — the booking, its inventory, the operation, its payment — is in the order document,
 * so it changes in one compare-and-set write.
 */
export const storedServicingSchema = z.object({
  operationId: z.string().regex(/^svc_[A-Za-z0-9_-]{22}$/),
  operation: servicingOperationSchema,
  status: z.enum(['AWAITING_PAYMENT', 'COMPLETED', 'FAILED', 'EXPIRED']),
  idempotencyKey: idempotencyKeySchema,
  requestHash: z.string().length(64),
  request: storedServicingRequestSchema,
  /** What was applied (or would be), in words without personal data. */
  summary: z.string().min(1).max(300),
  createdAt: epochMs,
  updatedAt: epochMs,
  completedAt: epochMs.nullable(),
  /** Order revision the traveller confirmed against, and the revision that applied it. */
  previousRevision: z.number().int().positive(),
  newRevision: z.number().int().positive().nullable(),
  /** The quote as confirmed. */
  lines: z.array(servicingQuoteLineSchema),
  priceDifferenceMinor: z.number().int(),
  adjustment: financialAdjustmentSchema,
  /** Sum of the booking's items after minus before. Charges − refunds − credits equal it. */
  valueDeltaMinor: z.number().int(),
  /** Pending operations only; cleared once applied or abandoned (the history keeps the rest). */
  plan: storedPlanSchema.nullable(),
  claim: storedClaimSchema.nullable(),
  attempts: z.array(storedAttemptSchema).max(MAX_SERVICING_PAYMENT_ATTEMPTS),
  refunds: z.array(storedRefundSchema).max(MAX_REFUND_ATTEMPTS),
  failureReason: z.string().nullable(),
});
export type StoredServicing = z.infer<typeof storedServicingSchema>;

export const ownershipEntrySchema = z.object({
  kind: z.enum(['GUEST', 'ACCOUNT']),
  /** `gst_…` or `acc_…`: never a token or a hash of one. */
  id: z.string().min(1),
  at: epochMs,
});

/** A projection for trip lists, refreshed on every write so lists never load whole orders. */
export const storedListingSchema = z.object({
  tripType: z.enum(['one-way', 'round-trip']),
  origin: z.string(),
  destination: z.string(),
  departsAt: epochMs,
  returnsAt: epochMs.nullable(),
  endsAt: epochMs,
  families: z.array(z.string()),
  flightNumbers: z.array(z.string()),
  travellers: z.number().int().positive(),
  leadTraveller: z.string(),
  currentTotalMinor: minorAmountSchema,
  currency: currencyCodeSchema,
});
export type StoredListing = z.infer<typeof storedListingSchema>;

const storedOrderV2Schema = z.object({
  schemaVersion: z.literal(ORDER_SCHEMA_VERSION),
  orderId: orderIdSchema,
  reference: bookingReferenceSchema,
  /** Compare-and-set revision: every write requires the revision it read. */
  rev: z.number().int().positive(),
  guestId: z.string().regex(/^gst_[A-Za-z0-9_-]{22}$/),
  /**
   * SHA-256 of the guest token, hex. The token itself is never stored. `null` once the booking
   * was linked to an account: from then on only that account opens it.
   */
  ownerTokenHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  /** Milestone 6: the account that owns the booking, once linked. */
  ownerAccountId: accountIdSchema.nullable(),
  /** Who owned it, and since when (historical attribution; ids only). */
  ownership: z.array(ownershipEntrySchema).min(1),
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
  // Milestone 6.
  current: storedCurrentSchema,
  servicing: z.array(storedServicingSchema).max(MAX_SERVICING_OPERATIONS),
  cancelledAt: epochMs.nullable(),
  // Index mirrors (recomputed by withIndexFields).
  paymentStatus: z.union([paymentStatusSchema, z.literal('NOT_STARTED')]),
  holdState: holdStatusSchema,
  holdExpiresAt: epochMs,
  flightIds: z.array(flightInstanceIdSchema).min(1),
  attemptIds: z.array(paymentAttemptIdSchema),
  /** Payment attempts of servicing operations, for provider lookups. */
  servicingAttemptIds: z.array(paymentAttemptIdSchema),
  /** Something for recovery to finish: a change awaiting payment, or a refund in progress. */
  servicingState: z.enum(['NONE', 'AWAITING_PAYMENT', 'REFUND_PENDING']),
  listing: storedListingSchema,
  /** First departure and last arrival of the booking as it is now (trip list sections). */
  tripStartsAt: epochMs,
  tripEndsAt: epochMs,
});
export type StoredOrder = z.infer<typeof storedOrderV2Schema>;

/**
 * Milestone 5 documents (schema version 1) are upgraded when read: the booking as it is now is
 * the booking as it was bought, it belongs to its guest, and it has no servicing history. They
 * are rewritten as version 2 the next time they change; nothing is migrated in bulk (TalaDB has
 * no multi-document transaction, and a read-time upgrade can't be left half done).
 */
function upgrade(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc;
  const v1 = doc as Record<string, unknown> & { schemaVersion?: number };
  if (v1.schemaVersion !== 1) return doc;
  const snapshot = v1.snapshot as OrderSnapshot;
  const upgraded = {
    ...v1,
    schemaVersion: ORDER_SCHEMA_VERSION,
    ownerAccountId: null,
    ownership: [{ kind: 'GUEST', id: v1.guestId, at: v1.createdAt }],
    current: {
      version: 1,
      journeys: snapshot.journeys,
      seats: snapshot.seats,
      ancillaries: snapshot.ancillaries,
      baggage: snapshot.baggage,
      items: v1.items,
    },
    servicing: [],
    cancelledAt: null,
    servicingAttemptIds: [],
    servicingState: 'NONE',
  } as unknown as StoredOrder;
  const listing = listingFor(upgraded);
  return { ...upgraded, listing, tripStartsAt: listing.departsAt, tripEndsAt: listing.endsAt };
}

export const storedOrderSchema = z.preprocess(upgrade, storedOrderV2Schema);

/** The projection trip lists read. */
export function listingFor(order: Pick<StoredOrder, 'current' | 'snapshot' | 'currency'>) {
  const { journeys, items } = order.current;
  const outbound = journeys[0]!;
  const inbound = journeys.find((journey) => journey.direction === 'inbound') ?? null;
  const last = journeys.at(-1)!;
  const lead = order.snapshot.passengers[0]!;
  return {
    tripType: order.snapshot.search.tripType,
    origin: outbound.itinerary.origin,
    destination: outbound.itinerary.destination,
    departsAt: Date.parse(outbound.itinerary.departure.at),
    returnsAt: inbound ? Date.parse(inbound.itinerary.departure.at) : null,
    endsAt: Date.parse(last.itinerary.arrival.at),
    families: journeys.map((journey) => journey.family),
    flightNumbers: journeys.flatMap((journey) =>
      journey.itinerary.segments.map((segment) => segment.flightNumber),
    ),
    travellers: order.snapshot.passengers.length,
    leadTraveller: `${lead.givenName} ${lead.familyName}`,
    currentTotalMinor: items.reduce((sum, item) => sum + item.amountMinor, 0),
    currency: order.currency,
  } satisfies StoredListing;
}

const UNRESOLVED_REFUND = new Set(['PENDING', 'PROCESSING', 'UNKNOWN']);

/** Recompute the top-level fields that mirror nested state, for TalaDB's indexes. */
export function withIndexFields(order: StoredOrder): StoredOrder {
  const awaiting = order.servicing.some((op) => op.status === 'AWAITING_PAYMENT');
  const refunding = order.servicing.some((op) =>
    op.refunds.some((refund) => UNRESOLVED_REFUND.has(refund.status)),
  );
  const listing = listingFor(order);
  return {
    ...order,
    paymentStatus: order.attempts.at(-1)?.status ?? 'NOT_STARTED',
    holdState: order.hold.status,
    holdExpiresAt: order.hold.expiresAt,
    flightIds: [
      ...new Set([
        ...order.hold.allocations.map((allocation) => allocation.flightId),
        ...order.servicing.flatMap(
          (op) => op.claim?.allocations.map((allocation) => allocation.flightId) ?? [],
        ),
      ]),
    ],
    attemptIds: order.attempts.map((attempt) => attempt.attemptId),
    servicingAttemptIds: order.servicing.flatMap((op) => op.attempts.map((a) => a.attemptId)),
    servicingState: awaiting ? 'AWAITING_PAYMENT' : refunding ? 'REFUND_PENDING' : 'NONE',
    listing,
    tripStartsAt: listing.departsAt,
    tripEndsAt: listing.endsAt,
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

// ---------------------------------------------------------------------------
// Milestone 6: simulated refunds, accounts, sessions, saved travellers
// ---------------------------------------------------------------------------

/** The simulated refund provider's own record of a refund, keyed by the refund id. */
export const providerRefundSchema = z.object({
  schemaVersion: z.literal(PROVIDER_SCHEMA_VERSION),
  refundId: z.string().regex(/^rfd_[A-Za-z0-9_-]{22}$/),
  orderId: orderIdSchema,
  reference: z.string().regex(/^DEMO-R[A-Z0-9]{9}$/),
  amountMinor: minorAmountSchema,
  currency: currencyCodeSchema,
  status: z.enum(['SUCCEEDED', 'FAILED', 'PENDING']),
  failureReason: z.string().nullable(),
  createdAtWall: epochMs,
  resolveAtWall: epochMs.nullable(),
});
export type ProviderRefund = z.infer<typeof providerRefundSchema>;

export const ACCOUNT_SCHEMA_VERSION = 1;

export const storedAccountSchema = z.object({
  schemaVersion: z.literal(ACCOUNT_SCHEMA_VERSION),
  accountId: accountIdSchema,
  /** Lower-cased. Unique: enforced by the serial writer (TalaDB has no unique index). */
  email: z.string().min(3).max(254),
  givenName: z.string().min(1).max(40),
  familyName: z.string().min(1).max(40),
  /** Argon2id, PHC string format. Never logged, never returned. */
  passwordHash: z.string().startsWith('$argon2id$'),
  createdAt: epochMs,
  updatedAt: epochMs,
  rev: z.number().int().positive(),
});
export type StoredAccount = z.infer<typeof storedAccountSchema>;

export const storedSessionSchema = z.object({
  schemaVersion: z.literal(ACCOUNT_SCHEMA_VERSION),
  sessionId: z.string().regex(/^ses_[A-Za-z0-9_-]{22}$/),
  /** SHA-256 of the session token, hex. The token itself is never stored. */
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  accountId: accountIdSchema,
  createdAt: epochMs,
  expiresAt: epochMs,
  revokedAt: epochMs.nullable(),
});
export type StoredSession = z.infer<typeof storedSessionSchema>;

export const storedTravellerSchema = z.object({
  schemaVersion: z.literal(ACCOUNT_SCHEMA_VERSION),
  travellerId: savedTravellerIdSchema,
  accountId: accountIdSchema,
  /** `<accountId>:<idempotency key>` of the request that created it. */
  createKey: z.string().min(1),
  title: travellerTitleSchema.nullable(),
  givenName: z.string(),
  middleName: z.string().nullable(),
  familyName: z.string(),
  dateOfBirth: z.string(),
  nationality: z.string(),
  createdAt: epochMs,
  updatedAt: epochMs,
  rev: z.number().int().positive(),
});
export type StoredTraveller = z.infer<typeof storedTravellerSchema>;
