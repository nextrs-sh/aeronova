import { z } from 'zod';
import { currencyCodeSchema, minorAmountSchema } from './common';
import { isIsoDate } from './dates';
import {
  chargeSchema,
  flightInstanceIdSchema,
  itineraryAvailabilitySchema,
  itineraryIdSchema,
  itinerarySchema,
  pricedPassengerTypeSchema,
} from './flights';
import { cabinClassSchema, validatePassengers, type PassengerCounts } from './search';

/*
 * Offer-based retailing (Milestone 3).
 *
 * - A *fare family* (Light, Classic, Flex, Business) is a product: a cabin plus a set of
 *   included services and conditions. It has no price on its own.
 * - An *offer* is a priced, time-limited proposition: one itinerary (one direction of a
 *   trip), one fare family, one passenger mix. The retailing API creates and prices it; an
 *   offer never reserves seats and is not a booking.
 * - A *selection* (see `shopping.ts`) is a traveller's provisional choice of an offer inside
 *   a shopping session.
 *
 * Prices are integer minor units with an explicit currency, like the M2 indicative prices.
 * The model is inspired by modern airline retailing; it does not implement IATA NDC or
 * ONE Order schemas.
 */

export const fareFamilyCodeSchema = z.enum(['LIGHT', 'CLASSIC', 'FLEX', 'BUSINESS']);
export type FareFamilyCode = z.infer<typeof fareFamilyCodeSchema>;

/** Display order, from the entry-level product to the premium cabin. */
export const FARE_FAMILY_ORDER: readonly FareFamilyCode[] = fareFamilyCodeSchema.options;

// ---------------------------------------------------------------------------
// Services: what a fare family includes, as typed, comparable entries
// ---------------------------------------------------------------------------

export const serviceCodeSchema = z.enum([
  'CABIN_BAGGAGE',
  'CHECKED_BAGGAGE',
  'STANDARD_SEAT',
  'PREFERRED_SEAT',
  'FLIGHT_CHANGE',
  'REFUND',
  'PRIORITY_CHECK_IN',
  'PRIORITY_BOARDING',
  'MEAL',
  'LOUNGE',
]);
export type ServiceCode = z.infer<typeof serviceCodeSchema>;

export const serviceCategorySchema = z.enum(['baggage', 'seating', 'flexibility', 'comfort']);
export type ServiceCategory = z.infer<typeof serviceCategorySchema>;

/**
 * The comparison matrix rows, in order. The storefront renders every row from this list and
 * each family's `services`; it has no per-family markup.
 */
export const SERVICE_ROWS: readonly {
  code: ServiceCode;
  label: string;
  category: ServiceCategory;
}[] = [
  { code: 'CABIN_BAGGAGE', label: 'Cabin baggage', category: 'baggage' },
  { code: 'CHECKED_BAGGAGE', label: 'Checked baggage', category: 'baggage' },
  { code: 'STANDARD_SEAT', label: 'Standard seat selection', category: 'seating' },
  { code: 'PREFERRED_SEAT', label: 'Preferred seats', category: 'seating' },
  { code: 'FLIGHT_CHANGE', label: 'Flight changes', category: 'flexibility' },
  { code: 'REFUND', label: 'Refunds', category: 'flexibility' },
  { code: 'PRIORITY_CHECK_IN', label: 'Priority check-in', category: 'comfort' },
  { code: 'PRIORITY_BOARDING', label: 'Priority boarding', category: 'comfort' },
  { code: 'MEAL', label: 'Meals', category: 'comfort' },
  { code: 'LOUNGE', label: 'Lounge access', category: 'comfort' },
];

/**
 * - `included`: part of the fare, at no extra charge.
 * - `fee`: allowed, for the stated fee (changes and refunds).
 * - `not-included`: not part of this fare.
 */
export const serviceInclusionSchema = z.enum(['included', 'fee', 'not-included']);
export type ServiceInclusion = z.infer<typeof serviceInclusionSchema>;

export const baggageAllowanceSchema = z.object({
  pieces: z.number().int().nonnegative(),
  /** Maximum weight per piece. */
  maxWeightKg: z.number().int().positive(),
});
export type BaggageAllowance = z.infer<typeof baggageAllowanceSchema>;

export const offerServiceSchema = z.object({
  code: serviceCodeSchema,
  inclusion: serviceInclusionSchema,
  /** Baggage services only: pieces and weight per passenger. */
  allowance: baggageAllowanceSchema.nullable(),
  /** `fee` services only: the charge per passenger, per direction. */
  fee: z.object({ currency: currencyCodeSchema, amountMinor: minorAmountSchema }).nullable(),
  /** Short value for a comparison cell, e.g. `1 × 20 kg`. */
  summary: z.string().min(1),
  /** The full condition, e.g. what a change costs and until when it is allowed. */
  detail: z.string().min(1),
});
export type OfferService = z.infer<typeof offerServiceSchema>;

export const fareFamilySchema = z.object({
  code: fareFamilyCodeSchema,
  /** `Velasia Classic` */
  name: z.string().min(1),
  /** `Classic` */
  shortName: z.string().min(1),
  tagline: z.string().min(1),
  /** The cabin this product is sold in. */
  cabin: cabinClassSchema,
  services: z.array(offerServiceSchema).length(SERVICE_ROWS.length),
});
export type FareFamily = z.infer<typeof fareFamilySchema>;

export const fareFamiliesResponseSchema = z.object({
  data: z.array(fareFamilySchema).min(1),
  meta: z.object({ pricingVersion: z.string().min(1), disclaimer: z.string().min(1) }),
});
export type FareFamiliesResponse = z.infer<typeof fareFamiliesResponseSchema>;

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/** Opaque, randomly generated: `off_` + 22 URL-safe characters (128 bits). */
export const offerIdSchema = z
  .string()
  .regex(/^off_[A-Za-z0-9_-]{22}$/, 'Invalid offer identifier.');

export const passengerCountsSchema = z
  .object({
    adults: z.number().int().min(0).max(9),
    children: z.number().int().min(0).max(9),
    infants: z.number().int().min(0).max(9),
  })
  .superRefine((counts, ctx) => {
    for (const problem of validatePassengers(counts)) {
      ctx.addIssue({ code: 'custom', message: problem.message });
    }
  });

/** Derived when the offer is read: offers themselves never change after creation. */
export const offerStatusSchema = z.enum(['AVAILABLE', 'EXPIRED', 'UNAVAILABLE']);
export type OfferStatus = z.infer<typeof offerStatusSchema>;

/** Per passenger type. Each `…Minor` amount is for one passenger unless named `subtotal`. */
export const offerPassengerPriceSchema = z.object({
  passengerType: pricedPassengerTypeSchema,
  count: z.number().int().positive(),
  /** Flight base fare (distance, cabin, advance purchase, demand, day and time). */
  baseFareMinor: minorAmountSchema,
  /** What the fare family adds for its included services and conditions. */
  fareFamilyMinor: minorAmountSchema,
  /** Mandatory taxes and fees, itemised in `taxes`. */
  taxesMinor: minorAmountSchema,
  taxes: z.array(chargeSchema),
  /** `baseFare + fareFamily + taxes` for one passenger. */
  unitTotalMinor: minorAmountSchema,
  /** `count × unitTotal`. */
  subtotalMinor: minorAmountSchema,
});
export type OfferPassengerPrice = z.infer<typeof offerPassengerPriceSchema>;

export const offerPriceSchema = z.object({
  currency: currencyCodeSchema,
  /** What the whole party pays for this offer. */
  totalMinor: minorAmountSchema,
  /** One adult, for comparing with "from" prices. */
  perAdultMinor: minorAmountSchema,
  /** Party-wide sums of each component; they add up to `totalMinor`. */
  totals: z.object({
    baseFareMinor: minorAmountSchema,
    fareFamilyMinor: minorAmountSchema,
    taxesMinor: minorAmountSchema,
  }),
  passengers: z.array(offerPassengerPriceSchema).min(1),
});
export type OfferPrice = z.infer<typeof offerPriceSchema>;

/** The itinerary an offer is for, without its indicative price. */
export const offerItinerarySchema = itinerarySchema.omit({ price: true });
export type OfferItinerary = z.infer<typeof offerItinerarySchema>;

export const offerSchema = z.object({
  id: offerIdSchema,
  itineraryId: itineraryIdSchema,
  flightIds: z.array(flightInstanceIdSchema).min(1).max(2),
  family: fareFamilyCodeSchema,
  cabin: cabinClassSchema,
  passengers: z.object({
    adults: z.number().int(),
    children: z.number().int(),
    infants: z.number().int(),
  }),
  itinerary: offerItinerarySchema,
  services: z.array(offerServiceSchema),
  price: offerPriceSchema,
  status: offerStatusSchema,
  createdAt: z.iso.datetime(),
  /** After this instant the offer can't be selected; ask the API for a fresh one. */
  expiresAt: z.iso.datetime(),
  /** The inventory snapshot the offer was priced against. */
  inventoryVersion: z.string().min(1),
  pricingVersion: z.string().min(1),
});
export type Offer = z.infer<typeof offerSchema>;

export const familyUnavailableReasonSchema = z.enum([
  /** An aircraft on this itinerary has no cabin for this product (e.g. no Business cabin). */
  'cabin-not-offered',
  /** The cabin exists, but not with enough seats for the whole party. */
  'insufficient-seats',
  /** The itinerary itself can't be sold (cancelled, sold out, or sales closed). */
  'itinerary-unavailable',
]);
export type FamilyUnavailableReason = z.infer<typeof familyUnavailableReasonSchema>;

export const unavailableFamilySchema = z.object({
  family: fareFamilyCodeSchema,
  reason: familyUnavailableReasonSchema,
  message: z.string().min(1),
});
export type UnavailableFamily = z.infer<typeof unavailableFamilySchema>;

export const offersMetaSchema = z.object({
  currency: currencyCodeSchema,
  /** "Today" for the inventory the offers were priced against. */
  referenceDate: z.string().refine(isIsoDate),
  inventoryVersion: z.string().min(1),
  pricingVersion: z.string().min(1),
  offerValiditySeconds: z.number().int().positive(),
  /** The API's clock when it answered. Clients measure validity from this, not their own clock. */
  serverTime: z.iso.datetime(),
});
export type OffersMeta = z.infer<typeof offersMetaSchema>;

export const offerSearchResponseSchema = z.object({
  data: z.object({
    itineraryId: itineraryIdSchema,
    itinerary: offerItinerarySchema,
    availability: itineraryAvailabilitySchema,
    /** One per available fare family, cheapest product first. */
    offers: z.array(offerSchema),
    /** Families not offered for this itinerary and party, with the reason. */
    unavailable: z.array(unavailableFamilySchema),
  }),
  meta: offersMetaSchema,
});
export type OfferSearchResponse = z.infer<typeof offerSearchResponseSchema>;

export const offerResponseSchema = z.object({ data: offerSchema, meta: offersMetaSchema });
export type OfferResponse = z.infer<typeof offerResponseSchema>;

/** `GET /v1/offers/:offerId/price`: the offer's price against the current inventory and rules. */
export const offerPriceCheckResponseSchema = z.object({
  data: z.object({
    offerId: offerIdSchema,
    status: offerStatusSchema,
    currency: currencyCodeSchema,
    offerTotalMinor: minorAmountSchema,
    /** `null` when the itinerary can no longer be sold. */
    currentTotalMinor: minorAmountSchema.nullable(),
    priceChanged: z.boolean(),
  }),
  meta: offersMetaSchema,
});
export type OfferPriceCheckResponse = z.infer<typeof offerPriceCheckResponseSchema>;

// ---------------------------------------------------------------------------
// Offer search query (GET /v1/offers, GET /api/offers)
// ---------------------------------------------------------------------------

export interface OfferSearchQuery {
  itineraryId: string;
  passengers: PassengerCounts;
  /** The cabin the traveller searched in. Offers cover every family the itinerary supports. */
  cabin: z.infer<typeof cabinClassSchema>;
}

const firstString = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().trim().optional(),
);

/** Validates `itineraryId`, `adults`, `children`, `infants`, `cabin` query parameters. */
export const offerSearchQuerySchema = z
  .object({
    itineraryId: firstString,
    adults: firstString,
    children: firstString,
    infants: firstString,
    cabin: firstString,
  })
  .transform((raw, ctx): OfferSearchQuery => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    const itineraryId = itineraryIdSchema.safeParse(raw.itineraryId ?? '');
    if (!itineraryId.success) issue('itineraryId', 'Invalid itinerary identifier.');
    const passengers = { adults: 1, children: 0, infants: 0 };
    for (const key of ['adults', 'children', 'infants'] as const) {
      const value = raw[key];
      if (value === undefined || value === '') continue;
      if (/^\d{1,2}$/.test(value)) passengers[key] = Number(value);
      else issue(key, 'Passenger counts must be whole numbers.');
    }
    for (const problem of validatePassengers(passengers)) issue('passengers', problem.message);
    const cabin = cabinClassSchema.safeParse(raw.cabin ?? 'economy');
    if (!cabin.success) issue('cabin', 'Unsupported cabin class.');
    if (ctx.issues.length > 0 || !itineraryId.success || !cabin.success) return z.NEVER;
    return { itineraryId: itineraryId.data, passengers, cabin: cabin.data };
  });

export function offerSearchQueryToParams(query: OfferSearchQuery): URLSearchParams {
  const params = new URLSearchParams({
    itineraryId: query.itineraryId,
    adults: String(query.passengers.adults),
    cabin: query.cabin,
  });
  if (query.passengers.children) params.set('children', String(query.passengers.children));
  if (query.passengers.infants) params.set('infants', String(query.passengers.infants));
  return params;
}

export const offerParamsSchema = z.object({ offerId: offerIdSchema });

/** The service entry for a matrix row, or `undefined` if a family doesn't list it. */
export function serviceFor(services: readonly OfferService[], code: ServiceCode) {
  return services.find((service) => service.code === code);
}
