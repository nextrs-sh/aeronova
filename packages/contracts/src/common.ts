import { z } from 'zod';

/** IATA airport code, e.g. `MNL`. Always upper-case. */
export const iataCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter airport code, for example MNL.');
export type IataCode = z.infer<typeof iataCodeSchema>;

/** URL-safe slug, e.g. `ho-chi-minh-city`. */
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug.');

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const moneySchema = z.object({
  /** Amount in major units (e.g. pesos). Integers only for illustrative fares. */
  amount: z.number().int().nonnegative(),
  currency: currencyCodeSchema,
});
export type Money = z.infer<typeof moneySchema>;

/**
 * Integer amount in the currency's minor unit (centavos for PHP). Used for
 * every server-calculated price so no floating-point rounding is involved.
 */
export const minorAmountSchema = z.number().int().nonnegative();

/** Error envelope returned by the retailing API and the storefront Route Handlers. */
export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'NOT_FOUND',
  /** The retailing API itself is temporarily unable to answer (503). */
  'SERVICE_UNAVAILABLE',
  /** The storefront could not reach the retailing API, or got an unusable answer. */
  'UPSTREAM_UNAVAILABLE',
  /** The retailing API did not answer within the storefront's time budget. */
  'UPSTREAM_TIMEOUT',
  'INTERNAL_ERROR',
  /** No offer with this id (never existed, or long gone). */
  'OFFER_NOT_FOUND',
  /** The offer's validity ended; ask for a fresh offer. */
  'OFFER_EXPIRED',
  /** The offer's flights can no longer be sold for this party. */
  'OFFER_UNAVAILABLE',
  /** The offer doesn't fit the session: wrong route, date, direction, passengers, or timing. */
  'INVALID_SELECTION',
  /** No session with this id and token. Deliberately the same answer for a wrong token. */
  'SESSION_NOT_FOUND',
  /** The session's lifetime ended. */
  'SESSION_EXPIRED',
  /** The session changed since the caller last read it (`expectedVersion`); reload and retry. */
  'SESSION_CONFLICT',
  /** A booking step was used before the steps it depends on. */
  'BOOKING_STEP_UNAVAILABLE',
  /** Traveller details break a rule (ages, names, slots, infant escorts). */
  'PASSENGERS_INVALID',
  /** A traveller id that isn't part of this booking. */
  'TRAVELLER_MISSING',
  /** The seat is taken or blocked on this flight. */
  'SEAT_UNAVAILABLE',
  /** The seat exists but this traveller can't have it with this fare (cabin, exit row, infant). */
  'SEAT_INELIGIBLE',
  /** The service isn't sold for this traveller, flight, or fare (or the fare already includes it). */
  'ANCILLARY_UNAVAILABLE',
  /** Quantities other than one are not sold. */
  'INVALID_QUANTITY',
  /** The price changed since the traveller last saw it; they must accept it first. */
  'PRICE_CHANGED',
  /** Checkout refused: the booking review has issues to resolve first. */
  'CHECKOUT_NOT_READY',
  /** Not enough seats are left to hold this booking. */
  'INVENTORY_UNAVAILABLE',
  /** An idempotency key was reused for a different request. */
  'IDEMPOTENCY_CONFLICT',
  /** No order with this id for this guest. Deliberately the same answer for a wrong guest. */
  'ORDER_NOT_FOUND',
  /** The order's seat hold ended before a payment succeeded. */
  'HOLD_EXPIRED',
  /** The order can't take a payment in its current state (failed, cancelled). */
  'ORDER_NOT_PAYABLE',
  /** The order is already confirmed: nothing was charged again. */
  'ORDER_ALREADY_CONFIRMED',
  /** An earlier payment attempt is still undecided: check its status first. */
  'PAYMENT_IN_PROGRESS',
  /** This trip was already booked from this shopping session. */
  'SESSION_ORDERED',
  // Milestone 6: servicing and accounts.
  /** The booking can't be changed in its current state (cancelled, flown, still pending). */
  'ORDER_NOT_MODIFIABLE',
  /** The fare rules don't allow this change (or its deadline has passed). */
  'CHANGE_NOT_ALLOWED',
  /** The booking changed since the traveller last read it (`expectedRevision`); reload. */
  'SERVICING_CONFLICT',
  /** Another change on this booking is waiting for its payment to be decided. */
  'PAYMENT_PENDING',
  /** A refund on this booking is still being processed. */
  'REFUND_PENDING',
  /** No valid account session. */
  'UNAUTHENTICATED',
  /** Email or password is wrong. Deliberately the same answer for an unknown email. */
  'INVALID_CREDENTIALS',
  /** An account with this email already exists. */
  'ACCOUNT_EXISTS',
  /** Too many attempts; try again later. */
  'RATE_LIMITED',
  /** Demo account registration is switched off in this environment. */
  'REGISTRATION_DISABLED',
  /** A per-account or per-order limit was reached. */
  'LIMIT_REACHED',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorIssueSchema = z.object({
  /** Request field the issue refers to, e.g. `departureDate`. */
  path: z.string(),
  message: z.string(),
});
export type ApiErrorIssue = z.infer<typeof apiErrorIssueSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    /** Field-level validation problems, when the request was rejected as invalid. */
    issues: z.array(apiErrorIssueSchema).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Minor units per major unit. Every currency Velasia prices in uses two decimals. */
const MINOR_UNIT_FACTOR: Record<string, number> = { PHP: 100 };

export function minorUnitFactor(currency: string): number {
  return MINOR_UNIT_FACTOR[currency] ?? 100;
}

/** `345000` PHP centavos → `3450` pesos. */
export function minorToMajor(amountMinor: number, currency: string): number {
  return amountMinor / minorUnitFactor(currency);
}

export function majorToMinor(amount: number, currency: string): number {
  return Math.round(amount * minorUnitFactor(currency));
}

/**
 * Milestone 8: the header that carries the storefront's shared service token to the retailing
 * API (`RETAILING_API_SERVICE_TOKEN` on both). Required by the API only when it is configured,
 * i.e. when the API is reachable from outside a private network (DigitalOcean App Platform).
 */
export const SERVICE_TOKEN_HEADER = 'x-velasia-service-token';
