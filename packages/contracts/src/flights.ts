import { z } from 'zod';
import { airline, displayFlightNumber } from './airline';
import { currencyCodeSchema, iataCodeSchema, minorAmountSchema } from './common';
import { addDays, compareIsoDates, isIsoDate } from './dates';
import { aircraftCodeSchema, aircraftSummarySchema } from './network';
import {
  BOOKING_WINDOW_DAYS,
  cabinClassSchema,
  createFlightSearchSchema,
  validatePassengers,
  type CabinClass,
  type PassengerCounts,
  type SearchValidationOptions,
} from './search';
import { isLocalTime, timeToMinutes } from './time';

/*
 * Flight inventory, itineraries, and indicative pricing.
 *
 * A *scheduled flight* (e.g. NV501, shown to customers as VEL 501, daily at 08:15) is a pattern. A *flight
 * instance* (`NV501-20261201`) is one dated departure of it, with its own seat
 * inventory. An *itinerary* is what a traveller buys for one direction of a
 * trip: one instance (direct) or two connecting instances.
 */

/**
 * Prefix of the stable *internal* flight identifiers (`NV501`, `NV501-20261201`). These keys are
 * persistent and deterministic, so they did not change with the Velasia rebrand; customers only
 * ever see the display form from {@link formatFlightNumber} (`VEL 501`). Neither prefix is a
 * claim to any registered IATA or ICAO airline designator.
 */
export const FLIGHT_NUMBER_PREFIX = 'NV';

export const flightNumberSchema = z.string().regex(/^NV\d{1,4}$/, 'Invalid flight number.');

/** One dated departure: `NV501-20261201`. */
export const flightInstanceIdSchema = z
  .string()
  .regex(/^NV\d{1,4}-\d{8}$/, 'Invalid flight identifier.');

/** One or two flight instance ids joined by `_`: direct or one-stop. */
export const itineraryIdSchema = z
  .string()
  .max(64)
  .regex(/^NV\d{1,4}-\d{8}(_NV\d{1,4}-\d{8})?$/, 'Invalid itinerary identifier.');

/** Customer-facing display of an internal flight number: `NV501` → `VEL 501`. */
export function formatFlightNumber(flightNumber: string): string {
  const match = /^NV(\d{1,4})$/.exec(flightNumber);
  return match ? displayFlightNumber(Number(match[1])) : flightNumber;
}

export const flightStatusSchema = z.enum(['scheduled', 'cancelled']);
export type FlightStatus = z.infer<typeof flightStatusSchema>;

/** A departure or arrival, in the local time of its airport. */
export const flightEndpointSchema = z.object({
  airport: iataCodeSchema,
  /** Local calendar date at the airport, `YYYY-MM-DD`. */
  date: z.string().refine(isIsoDate, 'Invalid date.'),
  /** Local wall-clock time at the airport, `HH:MM`. */
  time: z.string().refine(isLocalTime, 'Invalid time.'),
  /** Offset from UTC at that moment, e.g. `+08:00`. */
  utcOffset: z.string().regex(/^[+-]\d{2}:\d{2}$/),
  /** The same moment as a UTC timestamp. */
  at: z.iso.datetime(),
});
export type FlightEndpoint = z.infer<typeof flightEndpointSchema>;

export const flightSegmentSchema = z.object({
  id: flightInstanceIdSchema,
  flightNumber: flightNumberSchema,
  status: flightStatusSchema,
  departure: flightEndpointSchema,
  arrival: flightEndpointSchema,
  durationMinutes: z.number().int().positive(),
  distanceKm: z.number().int().positive(),
  aircraft: aircraftSummarySchema,
  cabin: cabinClassSchema,
  /** Seats still for sale in the requested cabin. */
  seatsAvailable: z.number().int().nonnegative(),
});
export type FlightSegment = z.infer<typeof flightSegmentSchema>;

export const connectionSchema = z.object({
  airport: iataCodeSchema,
  /** Time on the ground between arrival and the next departure. */
  durationMinutes: z.number().int().positive(),
  /** True when the connecting flight leaves on a later local date than the arrival. */
  overnight: z.boolean(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const pricedPassengerTypeSchema = z.enum(['adult', 'child', 'infant']);
export type PricedPassengerType = z.infer<typeof pricedPassengerTypeSchema>;

export const chargeSchema = z.object({
  code: z.string().regex(/^[A-Z_]+$/),
  label: z.string().min(1),
  /** Per passenger, in minor units. */
  amountMinor: minorAmountSchema,
});
export type Charge = z.infer<typeof chargeSchema>;

export const priceBreakdownItemSchema = z.object({
  passengerType: pricedPassengerTypeSchema,
  count: z.number().int().positive(),
  /** Per passenger: the indicative fare before charges. */
  fareMinor: minorAmountSchema,
  /** Per passenger: the mandatory charges listed below, summed. */
  chargesMinor: minorAmountSchema,
  charges: z.array(chargeSchema),
  /** `count × (fare + charges)`. */
  subtotalMinor: minorAmountSchema,
});
export type PriceBreakdownItem = z.infer<typeof priceBreakdownItemSchema>;

/**
 * An indicative price: what this itinerary would cost today, including every
 * simulated mandatory charge. It is not an offer and is never guaranteed —
 * sellable offers with fare families arrive in Milestone 3.
 */
export const indicativePriceSchema = z.object({
  kind: z.literal('indicative'),
  currency: currencyCodeSchema,
  /** One adult, fare plus mandatory charges: the "From" figure. */
  perAdultMinor: minorAmountSchema,
  /** Every passenger in the search, fare plus mandatory charges. */
  totalMinor: minorAmountSchema,
  breakdown: z.array(priceBreakdownItemSchema).min(1),
});
export type IndicativePrice = z.infer<typeof indicativePriceSchema>;

export const journeyDirectionSchema = z.enum(['outbound', 'inbound']);
export type JourneyDirection = z.infer<typeof journeyDirectionSchema>;

export const itinerarySchema = z.object({
  id: itineraryIdSchema,
  origin: iataCodeSchema,
  destination: iataCodeSchema,
  departure: flightEndpointSchema,
  arrival: flightEndpointSchema,
  /** First departure to last arrival, including connections. */
  durationMinutes: z.number().int().positive(),
  stops: z.number().int().min(0).max(1),
  segments: z.array(flightSegmentSchema).min(1).max(2),
  connections: z.array(connectionSchema).max(1),
  cabin: cabinClassSchema,
  /** The lowest seat count across segments in the requested cabin. */
  seatsAvailable: z.number().int().nonnegative(),
  price: indicativePriceSchema,
});
export type Itinerary = z.infer<typeof itinerarySchema>;

// ---------------------------------------------------------------------------
// Search query
// ---------------------------------------------------------------------------

/** Local departure-time windows used for filtering. */
export const departureWindowSchema = z.enum(['early-morning', 'morning', 'afternoon', 'evening']);
export type DepartureWindow = z.infer<typeof departureWindowSchema>;

export const DEPARTURE_WINDOWS: Record<
  DepartureWindow,
  { label: string; range: string; fromMinutes: number; toMinutes: number }
> = {
  'early-morning': { label: 'Early morning', range: '00:00–05:59', fromMinutes: 0, toMinutes: 360 },
  morning: { label: 'Morning', range: '06:00–11:59', fromMinutes: 360, toMinutes: 720 },
  afternoon: { label: 'Afternoon', range: '12:00–17:59', fromMinutes: 720, toMinutes: 1080 },
  evening: { label: 'Evening', range: '18:00–23:59', fromMinutes: 1080, toMinutes: 1440 },
};

export function departureWindowFor(localTime: string): DepartureWindow {
  const minutes = timeToMinutes(localTime);
  return departureWindowSchema.options.find(
    (window) =>
      minutes >= DEPARTURE_WINDOWS[window].fromMinutes &&
      minutes < DEPARTURE_WINDOWS[window].toMinutes,
  )!;
}

export const flightSortSchema = z.enum([
  'departure_asc',
  'departure_desc',
  'price_asc',
  'duration_asc',
]);
export type FlightSort = z.infer<typeof flightSortSchema>;
export const DEFAULT_FLIGHT_SORT: FlightSort = 'departure_asc';

export const FLIGHT_SORT_LABELS: Record<FlightSort, string> = {
  departure_asc: 'Earliest departure',
  departure_desc: 'Latest departure',
  price_asc: 'Lowest price',
  duration_asc: 'Shortest duration',
};

export const MAX_STOPS = 1;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 500;

export interface FlightFilters {
  /** `0` for direct flights only. Unset allows every itinerary Velasia sells (up to one stop). */
  maxStops?: number;
  /** Empty means any time of day. */
  departureWindows: DepartureWindow[];
  /** Per adult, minor units, inclusive. */
  minPriceMinor?: number;
  maxPriceMinor?: number;
  /** Empty means any aircraft. */
  aircraft: string[];
}

/** A validated `GET /v1/flights` request. */
export interface FlightSearchQuery {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: PassengerCounts;
  cabin: CabinClass;
  filters: FlightFilters;
  sort: FlightSort;
  page: number;
  pageSize: number;
  /** Restrict a round-trip search to one direction. */
  leg?: JourneyDirection;
  /** For round trips: inbound options must leave after this outbound itinerary lands. */
  outboundId?: string;
}

export interface FlightQueryValidationOptions extends SearchValidationOptions {
  knownAircraftCodes?: ReadonlySet<string>;
}

/** Query-string names for `GET /v1/flights` (and `/api/flights`). */
export const FLIGHT_QUERY_KEYS = {
  origin: 'from',
  destination: 'to',
  departureDate: 'departureDate',
  returnDate: 'returnDate',
  adults: 'adults',
  children: 'children',
  infants: 'infants',
  cabin: 'cabin',
  maxStops: 'maxStops',
  departureWindows: 'departureTimes',
  minPrice: 'minPrice',
  maxPrice: 'maxPrice',
  aircraft: 'aircraft',
  sort: 'sort',
  page: 'page',
  pageSize: 'pageSize',
  leg: 'leg',
  outboundId: 'outboundId',
} as const;

const optionalString = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().trim().optional(),
);

const rawFlightQuerySchema = z.object(
  Object.fromEntries(Object.values(FLIGHT_QUERY_KEYS).map((key) => [key, optionalString])) as {
    [K in (typeof FLIGHT_QUERY_KEYS)[keyof typeof FLIGHT_QUERY_KEYS]]: typeof optionalString;
  },
);
type RawFlightQuery = z.infer<typeof rawFlightQuerySchema>;

/** Maps the storefront form's field names onto the API's query names. */
const DRAFT_TO_QUERY_PATH: Record<string, string> = {
  origin: FLIGHT_QUERY_KEYS.origin,
  destination: FLIGHT_QUERY_KEYS.destination,
  departDate: FLIGHT_QUERY_KEYS.departureDate,
  returnDate: FLIGHT_QUERY_KEYS.returnDate,
  passengers: 'passengers',
};

const INTEGER = /^\d{1,9}$/;

function parseInteger(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  return INTEGER.test(value) ? Number(value) : null;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((item) => item.trim()))].filter(Boolean);
}

/**
 * Build the validator for flight search queries. It reuses the storefront's
 * search rules (airports, dates, passengers) so the form, the Route Handler,
 * and the API cannot disagree, and adds the API-only filters, sort, and paging.
 */
export function createFlightSearchQuerySchema(options: FlightQueryValidationOptions) {
  const searchSchema = createFlightSearchSchema(options);
  const K = FLIGHT_QUERY_KEYS;

  return rawFlightQuerySchema.transform((raw: RawFlightQuery, ctx): FlightSearchQuery => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    const counts: Record<'adults' | 'children' | 'infants', number> = {
      adults: 1,
      children: 0,
      infants: 0,
    };
    for (const key of ['adults', 'children', 'infants'] as const) {
      const value = parseInteger(raw[key]);
      if (value === null || (value !== undefined && value > 99)) {
        issue(key, 'Passenger counts must be whole numbers.');
      } else if (value !== undefined) counts[key] = value;
    }

    const cabin = raw.cabin === undefined ? 'economy' : raw.cabin;
    if (!cabinClassSchema.safeParse(cabin).success) {
      issue(K.cabin, `Unsupported cabin class. Use ${cabinClassSchema.options.join(', ')}.`);
    }

    const returnDate = raw.returnDate || undefined;
    const search = searchSchema.safeParse({
      tripType: returnDate ? 'round-trip' : 'one-way',
      origin: (raw.from ?? '').toUpperCase(),
      destination: (raw.to ?? '').toUpperCase(),
      departDate: raw.departureDate ?? '',
      returnDate: returnDate ?? '',
      passengers: counts,
      cabin: cabinClassSchema.safeParse(cabin).success ? cabin : 'economy',
    });
    if (!search.success) {
      for (const searchIssue of search.error.issues) {
        const field = String(searchIssue.path[0] ?? '');
        issue(DRAFT_TO_QUERY_PATH[field] ?? field, searchIssue.message);
      }
    }

    const maxStops = parseInteger(raw.maxStops);
    if (maxStops === null || (maxStops !== undefined && maxStops > MAX_STOPS)) {
      issue(K.maxStops, `maxStops must be 0 (direct only) or ${MAX_STOPS}.`);
    }

    const windows = splitList(raw.departureTimes);
    const unknownWindow = windows.find((w) => !departureWindowSchema.safeParse(w).success);
    if (unknownWindow) {
      issue(
        K.departureWindows,
        `Unknown departure time window "${unknownWindow}". Use ${departureWindowSchema.options.join(', ')}.`,
      );
    }

    const minPrice = parseInteger(raw.minPrice);
    const maxPrice = parseInteger(raw.maxPrice);
    if (minPrice === null) issue(K.minPrice, 'minPrice must be a whole amount in minor units.');
    if (maxPrice === null) issue(K.maxPrice, 'maxPrice must be a whole amount in minor units.');
    if (typeof minPrice === 'number' && typeof maxPrice === 'number' && minPrice > maxPrice) {
      issue(K.maxPrice, 'maxPrice must be greater than or equal to minPrice.');
    }

    const aircraft = splitList(raw.aircraft).map((code) => code.toUpperCase());
    for (const code of aircraft) {
      if (!aircraftCodeSchema.safeParse(code).success) {
        issue(K.aircraft, `Invalid aircraft code "${code}".`);
      } else if (options.knownAircraftCodes && !options.knownAircraftCodes.has(code)) {
        issue(K.aircraft, `${airline.shortName} doesn't operate aircraft type ${code}.`);
      }
    }

    const sort = raw.sort ?? DEFAULT_FLIGHT_SORT;
    if (!flightSortSchema.safeParse(sort).success) {
      issue(K.sort, `Unsupported sort order. Use ${flightSortSchema.options.join(', ')}.`);
    }

    const page = parseInteger(raw.page) ?? (raw.page === undefined ? 1 : null);
    if (page === null || page < 1 || page > MAX_PAGE) {
      issue(K.page, `page must be a whole number from 1 to ${MAX_PAGE}.`);
    }
    const pageSize =
      parseInteger(raw.pageSize) ?? (raw.pageSize === undefined ? DEFAULT_PAGE_SIZE : null);
    if (pageSize === null || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      issue(K.pageSize, `pageSize must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
    }

    const leg = raw.leg || undefined;
    if (leg !== undefined && !journeyDirectionSchema.safeParse(leg).success) {
      issue(K.leg, 'leg must be outbound or inbound.');
    } else if (leg === 'inbound' && !returnDate) {
      issue(K.leg, 'An inbound leg needs a returnDate.');
    }

    const outboundId = raw.outboundId || undefined;
    if (outboundId !== undefined) {
      if (!itineraryIdSchema.safeParse(outboundId).success) {
        issue(K.outboundId, 'Invalid outbound itinerary identifier.');
      } else if (!returnDate) {
        issue(K.outboundId, 'outboundId only applies to round trips.');
      }
    }

    if (!search.success || ctx.issues.length > 0) return z.NEVER;

    const query: FlightSearchQuery = {
      origin: search.data.origin,
      destination: search.data.destination,
      departureDate: search.data.departDate,
      passengers: search.data.passengers,
      cabin: search.data.cabin,
      filters: {
        departureWindows: windows as DepartureWindow[],
        aircraft,
        ...(maxStops !== undefined && maxStops !== null ? { maxStops } : {}),
        ...(typeof minPrice === 'number' ? { minPriceMinor: minPrice } : {}),
        ...(typeof maxPrice === 'number' ? { maxPriceMinor: maxPrice } : {}),
      },
      sort: sort as FlightSort,
      page: page!,
      pageSize: pageSize!,
    };
    if (search.data.returnDate) query.returnDate = search.data.returnDate;
    if (leg) query.leg = leg as JourneyDirection;
    if (outboundId) query.outboundId = outboundId;
    return query;
  });
}

/** Serialise a validated query with the API's parameter names, omitting defaults. */
export function flightSearchQueryToParams(query: FlightSearchQuery): URLSearchParams {
  const K = FLIGHT_QUERY_KEYS;
  const params = new URLSearchParams();
  params.set(K.origin, query.origin);
  params.set(K.destination, query.destination);
  params.set(K.departureDate, query.departureDate);
  if (query.returnDate) params.set(K.returnDate, query.returnDate);
  params.set(K.adults, String(query.passengers.adults));
  if (query.passengers.children) params.set(K.children, String(query.passengers.children));
  if (query.passengers.infants) params.set(K.infants, String(query.passengers.infants));
  params.set(K.cabin, query.cabin);
  const { filters } = query;
  if (filters.maxStops !== undefined) params.set(K.maxStops, String(filters.maxStops));
  if (filters.departureWindows.length > 0) {
    params.set(K.departureWindows, filters.departureWindows.join(','));
  }
  if (filters.minPriceMinor !== undefined) params.set(K.minPrice, String(filters.minPriceMinor));
  if (filters.maxPriceMinor !== undefined) params.set(K.maxPrice, String(filters.maxPriceMinor));
  if (filters.aircraft.length > 0) params.set(K.aircraft, filters.aircraft.join(','));
  if (query.sort !== DEFAULT_FLIGHT_SORT) params.set(K.sort, query.sort);
  if (query.page !== 1) params.set(K.page, String(query.page));
  if (query.pageSize !== DEFAULT_PAGE_SIZE) params.set(K.pageSize, String(query.pageSize));
  if (query.leg) params.set(K.leg, query.leg);
  if (query.outboundId) params.set(K.outboundId, query.outboundId);
  return params;
}

// ---------------------------------------------------------------------------
// Search response
// ---------------------------------------------------------------------------

/**
 * Why a leg has no results, so the storefront can explain it instead of
 * showing a generic "nothing found".
 */
export const emptyReasonSchema = z.enum([
  /** Velasia has no direct or one-stop connection between these airports. */
  'no-route',
  /** The route exists but no flight on it offers the requested cabin. */
  'cabin-not-offered',
  /** The date is bookable but schedules are not published that far ahead yet. */
  'beyond-schedule',
  /** Nothing operates (or is still open for sale) on that date. */
  'no-flights-on-date',
  /** Flights operate but none has enough seats for the whole party. */
  'insufficient-seats',
  /** Flights are available but none matches the filters. */
  'filtered-out',
]);
export type EmptyReason = z.infer<typeof emptyReasonSchema>;

export const paginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const searchFacetsSchema = z.object({
  stops: z.array(z.object({ stops: z.number().int().min(0), count: z.number().int().positive() })),
  departureWindows: z.array(
    z.object({ window: departureWindowSchema, count: z.number().int().positive() }),
  ),
  aircraft: z.array(aircraftSummarySchema.extend({ count: z.number().int().positive() })),
  /** Per-adult price range across available itineraries, before filters. */
  price: z.object({ minMinor: minorAmountSchema, maxMinor: minorAmountSchema }).nullable(),
});
export type SearchFacets = z.infer<typeof searchFacetsSchema>;

export const legResultSchema = z.object({
  direction: journeyDirectionSchema,
  origin: iataCodeSchema,
  destination: iataCodeSchema,
  date: z.string().refine(isIsoDate),
  itineraries: z.array(itinerarySchema),
  pagination: paginationSchema,
  summary: z.object({
    /** Sellable itineraries for the date, cabin, and party, before filters. */
    availableItineraries: z.number().int().nonnegative(),
    /** Itineraries left after filters (across all pages). */
    matchingItineraries: z.number().int().nonnegative(),
    /** Lowest per-adult price among matching itineraries. */
    lowestPerAdultMinor: minorAmountSchema.nullable(),
    emptyReason: emptyReasonSchema.nullable(),
    facets: searchFacetsSchema,
  }),
});
export type LegResult = z.infer<typeof legResultSchema>;

export const inventoryMetaSchema = z.object({
  currency: currencyCodeSchema,
  priceKind: z.literal('indicative'),
  /** "Today" for the inventory: prices and availability are as of this date. */
  referenceDate: z.string().refine(isIsoDate),
  /** Last departure date with published schedules. */
  scheduleEndDate: z.string().refine(isIsoDate),
});
export type InventoryMeta = z.infer<typeof inventoryMetaSchema>;

export const flightSearchResponseSchema = z.object({
  data: z.object({ legs: z.array(legResultSchema).min(1).max(2) }),
  meta: inventoryMetaSchema,
});
export type FlightSearchResponse = z.infer<typeof flightSearchResponseSchema>;

// ---------------------------------------------------------------------------
// Detail and availability
// ---------------------------------------------------------------------------

export const itineraryAvailabilitySchema = z.enum([
  'available',
  'insufficient-seats',
  'sold-out',
  'cancelled',
  'departed',
]);
export type ItineraryAvailability = z.infer<typeof itineraryAvailabilitySchema>;

export const itineraryParamsSchema = z.object({ id: itineraryIdSchema });

export const itineraryQuerySchema = z
  .object({
    adults: optionalString,
    children: optionalString,
    infants: optionalString,
    cabin: optionalString,
  })
  .transform((raw, ctx) => {
    const passengers = { adults: 1, children: 0, infants: 0 };
    for (const key of ['adults', 'children', 'infants'] as const) {
      const value = parseInteger(raw[key]);
      if (value === null || (value !== undefined && value > 99)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Passenger counts must be whole numbers.',
        });
      } else if (value !== undefined) passengers[key] = value;
    }
    for (const problem of validatePassengers(passengers)) {
      ctx.addIssue({ code: 'custom', path: ['passengers'], message: problem.message });
    }
    const cabin = cabinClassSchema.safeParse(raw.cabin ?? 'economy');
    if (!cabin.success) {
      ctx.addIssue({ code: 'custom', path: ['cabin'], message: 'Unsupported cabin class.' });
    }
    if (ctx.issues.length > 0 || !cabin.success) return z.NEVER;
    return { passengers, cabin: cabin.data };
  });
export type ItineraryQuery = z.output<typeof itineraryQuerySchema>;

export const itineraryResponseSchema = z.object({
  data: itinerarySchema.extend({ availability: itineraryAvailabilitySchema }),
  meta: inventoryMetaSchema,
});
export type ItineraryResponse = z.infer<typeof itineraryResponseSchema>;
export type ItineraryDetail = ItineraryResponse['data'];

export const cabinAvailabilitySchema = z.object({
  cabin: cabinClassSchema,
  capacity: z.number().int().positive(),
  available: z.number().int().nonnegative(),
});
export type CabinAvailability = z.infer<typeof cabinAvailabilitySchema>;

export const availabilityResponseSchema = z.object({
  data: z.object({
    id: itineraryIdSchema,
    segments: z
      .array(
        z.object({
          id: flightInstanceIdSchema,
          flightNumber: flightNumberSchema,
          status: flightStatusSchema,
          aircraft: aircraftSummarySchema,
          cabins: z.array(cabinAvailabilitySchema).min(1),
        }),
      )
      .min(1),
  }),
  meta: inventoryMetaSchema,
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

// ---------------------------------------------------------------------------
// Fare calendar (nearby dates)
// ---------------------------------------------------------------------------

export const MAX_CALENDAR_DAYS = 14;

export const calendarDayStatusSchema = z.enum([
  'available',
  'sold-out',
  'no-flights',
  'beyond-schedule',
  'past',
]);
export type CalendarDayStatus = z.infer<typeof calendarDayStatusSchema>;

export const fareCalendarDaySchema = z.object({
  date: z.string().refine(isIsoDate),
  status: calendarDayStatusSchema,
  /** Lowest per-adult indicative price that day, when anything is available. */
  lowestPerAdultMinor: minorAmountSchema.nullable(),
  itineraries: z.number().int().nonnegative(),
});
export type FareCalendarDay = z.infer<typeof fareCalendarDaySchema>;

export const fareCalendarResponseSchema = z.object({
  data: z.array(fareCalendarDaySchema),
  meta: inventoryMetaSchema,
});
export type FareCalendarResponse = z.infer<typeof fareCalendarResponseSchema>;

export interface FareCalendarQuery {
  origin: string;
  destination: string;
  startDate: string;
  days: number;
  passengers: PassengerCounts;
  cabin: CabinClass;
  maxStops?: number;
}

export function createFareCalendarQuerySchema({
  today,
  knownAirportCodes,
}: SearchValidationOptions) {
  const lastDate = addDays(today, BOOKING_WINDOW_DAYS);
  return z
    .object({
      from: optionalString,
      to: optionalString,
      startDate: optionalString,
      days: optionalString,
      adults: optionalString,
      children: optionalString,
      infants: optionalString,
      cabin: optionalString,
      maxStops: optionalString,
    })
    .transform((raw, ctx): FareCalendarQuery => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      const origin = (raw.from ?? '').toUpperCase();
      const destination = (raw.to ?? '').toUpperCase();
      for (const [path, code] of [
        ['from', origin],
        ['to', destination],
      ] as const) {
        if (!iataCodeSchema.safeParse(code).success)
          issue(path, 'Choose an airport from the list.');
        else if (knownAirportCodes && !knownAirportCodes.has(code)) {
          issue(path, `${airline.shortName} doesn't serve ${code}.`);
        }
      }
      if (origin && origin === destination) {
        issue('to', 'Departure and arrival airports must be different.');
      }
      const startDate = raw.startDate ?? '';
      if (!isIsoDate(startDate)) issue('startDate', 'Enter a valid date.');
      else if (compareIsoDates(startDate, addDays(today, -MAX_CALENDAR_DAYS)) < 0) {
        issue('startDate', 'startDate is too far in the past.');
      } else if (compareIsoDates(startDate, lastDate) > 0) {
        issue('startDate', `Flights can be searched up to ${BOOKING_WINDOW_DAYS} days ahead.`);
      }
      const days = parseInteger(raw.days) ?? (raw.days === undefined ? 7 : null);
      if (days === null || days < 1 || days > MAX_CALENDAR_DAYS) {
        issue('days', `days must be from 1 to ${MAX_CALENDAR_DAYS}.`);
      }
      const passengers = { adults: 1, children: 0, infants: 0 };
      for (const key of ['adults', 'children', 'infants'] as const) {
        const value = parseInteger(raw[key]);
        if (value === null || (value !== undefined && value > 99)) {
          issue(key, 'Passenger counts must be whole numbers.');
        } else if (value !== undefined) passengers[key] = value;
      }
      for (const problem of validatePassengers(passengers)) issue('passengers', problem.message);
      const cabin = cabinClassSchema.safeParse(raw.cabin ?? 'economy');
      if (!cabin.success) issue('cabin', 'Unsupported cabin class.');
      const maxStops = parseInteger(raw.maxStops);
      if (maxStops === null || (maxStops !== undefined && maxStops > MAX_STOPS)) {
        issue('maxStops', `maxStops must be 0 (direct only) or ${MAX_STOPS}.`);
      }
      if (ctx.issues.length > 0 || !cabin.success) return z.NEVER;
      return {
        origin,
        destination,
        startDate,
        days: days!,
        passengers,
        cabin: cabin.data,
        ...(typeof maxStops === 'number' ? { maxStops } : {}),
      };
    });
}

export function fareCalendarQueryToParams(query: FareCalendarQuery): URLSearchParams {
  const params = new URLSearchParams({
    from: query.origin,
    to: query.destination,
    startDate: query.startDate,
    days: String(query.days),
    adults: String(query.passengers.adults),
    cabin: query.cabin,
  });
  if (query.passengers.children) params.set('children', String(query.passengers.children));
  if (query.passengers.infants) params.set('infants', String(query.passengers.infants));
  if (query.maxStops !== undefined) params.set('maxStops', String(query.maxStops));
  return params;
}

/** Itinerary query parameters (`adults`, `cabin`, …) for detail lookups. */
export function itineraryQueryToParams(query: ItineraryQuery): URLSearchParams {
  const params = new URLSearchParams({
    adults: String(query.passengers.adults),
    cabin: query.cabin,
  });
  if (query.passengers.children) params.set('children', String(query.passengers.children));
  if (query.passengers.infants) params.set('infants', String(query.passengers.infants));
  return params;
}

/**
 * Storefront `GET /api/flights/[id]`: an itinerary priced for the party, plus
 * seat availability in every cabin of each flight (for the details panel).
 */
export const flightDetailResponseSchema = z.object({
  data: z.object({
    itinerary: itineraryResponseSchema.shape.data,
    segments: availabilityResponseSchema.shape.data.shape.segments,
  }),
  meta: inventoryMetaSchema,
});
export type FlightDetailResponse = z.infer<typeof flightDetailResponseSchema>;
