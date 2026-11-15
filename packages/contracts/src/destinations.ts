import { z } from 'zod';
import { iataCodeSchema, moneySchema, slugSchema } from './common';

export const regionSchema = z.enum(['philippines', 'southeast-asia', 'east-asia']);
export type Region = z.infer<typeof regionSchema>;

export const REGION_LABELS: Record<Region, string> = {
  philippines: 'Philippines',
  'southeast-asia': 'Southeast Asia',
  'east-asia': 'East Asia',
};

export const destinationImageSchema = z.object({
  /** Path under the storefront's `public/` directory. */
  src: z.string().regex(/^\/images\/[a-z0-9/_-]+\.(jpg|jpeg|png|webp|avif)$/),
  alt: z.string().min(1),
});

export const destinationHighlightSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

/** A route in Velasia's fictional network. Durations are approximate block times. */
export const plannedRouteSchema = z.object({
  origin: iataCodeSchema,
  destination: iataCodeSchema,
  durationMinutes: z.number().int().positive(),
  weeklyFrequency: z.number().int().min(1).max(70),
});
export type PlannedRoute = z.infer<typeof plannedRouteSchema>;

/**
 * A deterministic, illustrative "from" price. It is marketing copy, never a
 * bookable offer — real offers arrive with inventory in Milestone 2.
 */
export const illustrativeFareSchema = moneySchema.extend({
  origin: iataCodeSchema,
  cabin: z.literal('economy'),
  kind: z.literal('illustrative'),
});
export type IllustrativeFare = z.infer<typeof illustrativeFareSchema>;

export const destinationSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  country: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  region: regionSchema,
  airportCodes: z.array(iataCodeSchema).min(1),
  featured: z.boolean(),
  tagline: z.string().min(1),
  summary: z.string().min(1),
  description: z.array(z.string().min(1)).min(1),
  image: destinationImageSchema,
  highlights: z.array(destinationHighlightSchema).min(1),
  tags: z.array(z.string().min(1)),
  travelInfo: z.object({
    timeZone: z.string().min(1),
    utcOffset: z.string().regex(/^UTC[+-]\d{1,2}(:\d{2})?$/),
    currency: z.string().min(1),
    language: z.string().min(1),
    bestTimeToVisit: z.string().min(1),
  }),
  routes: z.array(plannedRouteSchema),
  illustrativeFare: illustrativeFareSchema.optional(),
  /** Fictional campaign copy for promotional placements. */
  promotion: z
    .object({
      headline: z.string().min(1),
      blurb: z.string().min(1),
    })
    .optional(),
});
export type Destination = z.infer<typeof destinationSchema>;

export const destinationListQuerySchema = z.object({
  featured: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  region: regionSchema.optional(),
});
export type DestinationListQuery = z.infer<typeof destinationListQuerySchema>;

export const destinationParamsSchema = z.object({ slug: slugSchema });

export const destinationListResponseSchema = z.object({
  data: z.array(destinationSchema),
});
export type DestinationListResponse = z.infer<typeof destinationListResponseSchema>;

export const destinationResponseSchema = z.object({ data: destinationSchema });
export type DestinationResponse = z.infer<typeof destinationResponseSchema>;
