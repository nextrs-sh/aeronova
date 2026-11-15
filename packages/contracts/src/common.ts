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

/** Error envelope returned by the retailing API and the storefront Route Handlers. */
export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'NOT_FOUND',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
