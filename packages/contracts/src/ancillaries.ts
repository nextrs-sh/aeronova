import { z } from 'zod';
import { currencyCodeSchema, minorAmountSchema } from './common';
import { flightInstanceIdSchema, journeyDirectionSchema } from './flights';
import { travellerIdSchema } from './travellers';

/*
 * Ancillaries (Milestone 4): optional services added to the offers in a shopping session.
 *
 * Seats are priced through the seat map (`seatmaps.ts`); this catalogue covers extra checked
 * baggage, pre-ordered meals, and priority services. Every product, price, and rule is
 * fictional. What a fare family already includes — its checked bags, its meal service,
 * Flex and Business priority — comes from the fare family itself and is never sold again.
 *
 * Scope:
 * - Baggage and priority are bought per traveller, per direction: one purchase covers every
 *   flight in that direction, including a connection, and is never charged twice.
 * - Meals are pre-ordered per traveller, per flight, because each flight has its own service.
 */

export const ancillaryCategorySchema = z.enum(['SEAT', 'BAGGAGE', 'MEAL', 'PRIORITY']);
export type AncillaryCategory = z.infer<typeof ancillaryCategorySchema>;

export const baggageProductIdSchema = z.enum(['BAG_10', 'BAG_15', 'BAG_20']);
export const mealProductIdSchema = z.enum([
  'MEAL_HOT',
  'MEAL_VEGETARIAN',
  'MEAL_VEGAN',
  'MEAL_CHILD',
  'MEAL_PREMIUM',
]);
export const priorityProductIdSchema = z.enum(['PRIORITY_CHECK_IN', 'PRIORITY_BOARDING']);
export const ancillaryProductIdSchema = z.enum([
  ...baggageProductIdSchema.options,
  ...mealProductIdSchema.options,
  ...priorityProductIdSchema.options,
]);
export type AncillaryProductId = z.infer<typeof ancillaryProductIdSchema>;
export type BaggageProductId = z.infer<typeof baggageProductIdSchema>;
export type MealProductId = z.infer<typeof mealProductIdSchema>;
export type PriorityProductId = z.infer<typeof priorityProductIdSchema>;

export const ancillaryScopeSchema = z.enum(['direction', 'flight']);

export const ancillaryProductSchema = z.object({
  id: ancillaryProductIdSchema,
  category: z.enum(['BAGGAGE', 'MEAL', 'PRIORITY']),
  name: z.string().min(1),
  description: z.string().min(1),
  scope: ancillaryScopeSchema,
  /** Baggage only: kilograms added to the traveller's checked allowance. */
  extraWeightKg: z.number().int().positive().nullable(),
  /** Who can buy it and where, in plain language. */
  eligibility: z.string().min(1),
  /** Price per traveller (per direction or per flight, see `scope`) by route length. */
  prices: z.object({
    short: minorAmountSchema,
    medium: minorAmountSchema,
    long: minorAmountSchema,
  }),
  currency: currencyCodeSchema,
});
export type AncillaryProduct = z.infer<typeof ancillaryProductSchema>;

export const ancillaryCatalogueResponseSchema = z.object({
  data: z.array(ancillaryProductSchema).min(1),
  meta: z.object({ catalogueVersion: z.string().min(1), disclaimer: z.string().min(1) }),
});
export type AncillaryCatalogueResponse = z.infer<typeof ancillaryCatalogueResponseSchema>;

export const ancillaryProductResponseSchema = z.object({
  data: ancillaryProductSchema,
  meta: z.object({ catalogueVersion: z.string().min(1), disclaimer: z.string().min(1) }),
});
export const ancillaryParamsSchema = z.object({ productId: ancillaryProductIdSchema });

// ---------------------------------------------------------------------------
// What one session can buy
// ---------------------------------------------------------------------------

/** A product a traveller can choose, priced for their fare. */
export const ancillaryOfferSchema = z.object({
  productId: ancillaryProductIdSchema,
  category: z.enum(['BAGGAGE', 'MEAL', 'PRIORITY']),
  travellerId: travellerIdSchema,
  direction: journeyDirectionSchema,
  /** Meals only: the flight the meal is served on. */
  flightId: flightInstanceIdSchema.nullable(),
  priceMinor: minorAmountSchema,
  /** The fare includes this choice (e.g. Business meals): selecting it adds no charge. */
  included: z.boolean(),
});
export type AncillaryOffer = z.infer<typeof ancillaryOfferSchema>;

/** What the fare family includes, per traveller and direction, so extra bags add to it. */
export const travellerBaggageSchema = z.object({
  travellerId: travellerIdSchema,
  direction: journeyDirectionSchema,
  includedPieces: z.number().int().nonnegative(),
  includedMaxWeightKg: z.number().int().nonnegative(),
  /** `pieces × maxWeight`: the total weight the fare includes. */
  includedKg: z.number().int().nonnegative(),
  /** Extra weight bought for this traveller and direction. */
  extraKg: z.number().int().nonnegative(),
  totalKg: z.number().int().nonnegative(),
});
export type TravellerBaggage = z.infer<typeof travellerBaggageSchema>;

/**
 * - `pre-order`: choose a meal for a charge (Economy, flights of 90 minutes or more).
 * - `complimentary`: choose a meal at no charge (Business, flights of 90 minutes or more).
 * - `snack-only`: the fare's snack and drink; no pre-order on this flight.
 */
export const mealServiceSchema = z.enum(['pre-order', 'complimentary', 'snack-only']);
export type MealService = z.infer<typeof mealServiceSchema>;

export const flightMealServiceSchema = z.object({
  flightId: flightInstanceIdSchema,
  direction: journeyDirectionSchema,
  service: mealServiceSchema,
  /** Why, for travellers: e.g. "No meal pre-order on flights under 90 minutes." */
  note: z.string().min(1),
});
export type FlightMealService = z.infer<typeof flightMealServiceSchema>;

export const sessionAncillariesSchema = z.object({
  currency: currencyCodeSchema,
  offers: z.array(ancillaryOfferSchema),
  allowances: z.array(travellerBaggageSchema),
  mealService: z.array(flightMealServiceSchema),
  catalogueVersion: z.string().min(1),
});
export type SessionAncillaries = z.infer<typeof sessionAncillariesSchema>;

export const sessionAncillariesResponseSchema = z.object({ data: sessionAncillariesSchema });

/** A chosen service, priced by the API. */
export const ancillarySelectionSchema = z.object({
  /** Stable per slot, e.g. `BAGGAGE:ADT1:outbound`. */
  id: z.string().min(1),
  productId: ancillaryProductIdSchema,
  category: z.enum(['BAGGAGE', 'MEAL', 'PRIORITY']),
  travellerId: travellerIdSchema,
  direction: journeyDirectionSchema,
  flightId: flightInstanceIdSchema.nullable(),
  quantity: z.number().int().positive(),
  priceMinor: minorAmountSchema,
  included: z.boolean(),
});
export type AncillarySelection = z.infer<typeof ancillarySelectionSchema>;

/**
 * One change to a traveller's services. Baggage and meals are one choice per slot (`productId:
 * null` removes it); priority services are independent switches. No field carries a price.
 */
export const ancillaryChangeSchema = z.discriminatedUnion('category', [
  z
    .object({
      category: z.literal('BAGGAGE'),
      travellerId: travellerIdSchema,
      direction: journeyDirectionSchema,
      productId: z.string().max(40).nullable(),
      quantity: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      category: z.literal('MEAL'),
      travellerId: travellerIdSchema,
      flightId: flightInstanceIdSchema,
      productId: z.string().max(40).nullable(),
      quantity: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      category: z.literal('PRIORITY'),
      travellerId: travellerIdSchema,
      direction: journeyDirectionSchema,
      productId: z.string().max(40),
      selected: z.boolean(),
      quantity: z.number().int().optional(),
    })
    .strict(),
]);
export type AncillaryChange = z.infer<typeof ancillaryChangeSchema>;

export const updateAncillariesRequestSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative().optional(),
    changes: z.array(ancillaryChangeSchema).min(1).max(40),
  })
  .strict();
export type UpdateAncillariesRequest = z.infer<typeof updateAncillariesRequestSchema>;

/** Slot key: one baggage choice per traveller and direction, one meal per traveller and flight. */
export function ancillarySlotId(
  change: Pick<AncillarySelection, 'category' | 'travellerId' | 'direction' | 'flightId'> & {
    productId?: string | null;
  },
): string {
  switch (change.category) {
    case 'BAGGAGE':
      return `BAGGAGE:${change.travellerId}:${change.direction}`;
    case 'MEAL':
      return `MEAL:${change.travellerId}:${change.flightId}`;
    case 'PRIORITY':
      return `PRIORITY:${change.travellerId}:${change.direction}:${change.productId}`;
  }
}
