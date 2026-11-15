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
