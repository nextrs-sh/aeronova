import { z } from 'zod';
import { iataCodeSchema, type IataCode } from './common';
import { addDays, compareIsoDates, isIsoDate } from './dates';

export const tripTypeSchema = z.enum(['round-trip', 'one-way']);
export type TripType = z.infer<typeof tripTypeSchema>;

export const cabinClassSchema = z.enum(['economy', 'premium-economy', 'business']);
export type CabinClass = z.infer<typeof cabinClassSchema>;

export const CABIN_LABELS: Record<CabinClass, string> = {
  economy: 'Economy',
  'premium-economy': 'Premium Economy',
  business: 'Business',
};

export const TRIP_TYPE_LABELS: Record<TripType, string> = {
  'round-trip': 'Round-trip',
  'one-way': 'One-way',
};

/** Passenger rules shared by the selector UI, the form schema, and URL parsing. */
export const PASSENGER_RULES = {
  /** Adults (12+) and children (2–11) occupy seats; infants (under 2) travel on a lap. */
  maxSeated: 9,
  minAdults: 1,
  /** Each lap infant must travel with their own adult. */
  maxInfantsPerAdult: 1,
} as const;

/** Bookings open this many days ahead of today. */
export const BOOKING_WINDOW_DAYS = 355;

export interface PassengerCounts {
  adults: number;
  children: number;
  infants: number;
}
export type PassengerType = keyof PassengerCounts;

export const PASSENGER_TYPE_DETAILS: Record<PassengerType, { label: string; description: string }> =
  {
    adults: { label: 'Adults', description: '12 years and over' },
    children: { label: 'Children', description: '2–11 years' },
    infants: { label: 'Infants', description: 'Under 2, on lap' },
  };

/** The form/URL shape: everything a user may have half-filled. */
export interface FlightSearchDraft {
  tripType: TripType;
  origin: string;
  destination: string;
  departDate: string;
  /** Empty string when not chosen (always ignored for one-way trips). */
  returnDate: string;
  passengers: PassengerCounts;
  cabin: CabinClass;
}

/** A fully validated search. */
export interface FlightSearch {
  tripType: TripType;
  origin: IataCode;
  destination: IataCode;
  departDate: string;
  returnDate?: string;
  passengers: PassengerCounts;
  cabin: CabinClass;
}

export const DEFAULT_SEARCH_DRAFT: FlightSearchDraft = {
  tripType: 'round-trip',
  origin: '',
  destination: '',
  departDate: '',
  returnDate: '',
  passengers: { adults: 1, children: 0, infants: 0 },
  cabin: 'economy',
};

export interface SearchValidationOptions {
  /** Today's date (`YYYY-MM-DD`) in the airline time zone. Injected for determinism. */
  today: string;
  /** When provided, origin and destination must be in this set. */
  knownAirportCodes?: ReadonlySet<string>;
}

export interface PassengerIssue {
  message: string;
}

export function totalSeated(counts: PassengerCounts): number {
  return counts.adults + counts.children;
}

export function totalPassengers(counts: PassengerCounts): number {
  return counts.adults + counts.children + counts.infants;
}

/** Validation messages for a passenger mix; empty when valid. */
export function validatePassengers(counts: PassengerCounts): PassengerIssue[] {
  const issues: PassengerIssue[] = [];
  const values = [counts.adults, counts.children, counts.infants];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    return [{ message: 'Passenger counts must be whole numbers.' }];
  }
  if (counts.adults < PASSENGER_RULES.minAdults) {
    issues.push({ message: 'At least one adult must travel on every booking.' });
  }
  if (totalSeated(counts) > PASSENGER_RULES.maxSeated) {
    issues.push({
      message: `You can book up to ${PASSENGER_RULES.maxSeated} seated passengers (adults and children).`,
    });
  }
  if (counts.infants > counts.adults * PASSENGER_RULES.maxInfantsPerAdult) {
    issues.push({ message: 'Each infant must travel on the lap of their own adult.' });
  }
  return issues;
}

/** Whether a passenger stepper may move up or down without breaking the rules. */
export function passengerStepLimits(
  counts: PassengerCounts,
): Record<PassengerType, { canIncrement: boolean; canDecrement: boolean }> {
  const seatsLeft = PASSENGER_RULES.maxSeated - totalSeated(counts);
  return {
    adults: {
      canIncrement: seatsLeft > 0,
      // Removing an adult may not strand an infant without a lap.
      canDecrement:
        counts.adults > PASSENGER_RULES.minAdults &&
        counts.infants <= (counts.adults - 1) * PASSENGER_RULES.maxInfantsPerAdult,
    },
    children: { canIncrement: seatsLeft > 0, canDecrement: counts.children > 0 },
    infants: {
      canIncrement: counts.infants < counts.adults * PASSENGER_RULES.maxInfantsPerAdult,
      canDecrement: counts.infants > 0,
    },
  };
}

// NaN is allowed through so malformed URL counts get a friendly message from validatePassengers.
const count = z.union([z.number(), z.nan()]);

/** Structural shape of a {@link FlightSearchDraft} (no business rules). */
export const flightSearchDraftSchema = z.object({
  tripType: tripTypeSchema,
  origin: z.string(),
  destination: z.string(),
  departDate: z.string(),
  returnDate: z.string(),
  passengers: z.object({ adults: count, children: count, infants: count }),
  cabin: cabinClassSchema,
});

/**
 * Build the flight search schema for a given "today". It accepts a
 * {@link FlightSearchDraft} and outputs a {@link FlightSearch}. Every rule runs
 * in one pass so users see all problems at once.
 */
export function createFlightSearchSchema({ today, knownAirportCodes }: SearchValidationOptions) {
  const lastBookableDate = addDays(today, BOOKING_WINDOW_DAYS);

  return flightSearchDraftSchema
    .superRefine((draft, ctx) => {
      const issue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: 'custom', path, message });

      const checkAirport = (field: 'origin' | 'destination', emptyMessage: string) => {
        const code = draft[field];
        if (code.length === 0) return issue([field], emptyMessage);
        if (!iataCodeSchema.safeParse(code).success) {
          return issue([field], 'Choose an airport from the list.');
        }
        if (knownAirportCodes && !knownAirportCodes.has(code)) {
          return issue([field], `AeroNova doesn't serve ${code}. Choose an airport from the list.`);
        }
      };
      checkAirport('origin', 'Choose where you are flying from.');
      checkAirport('destination', 'Choose where you are flying to.');
      if (draft.origin.length > 0 && draft.origin === draft.destination) {
        issue(['destination'], 'Departure and arrival airports must be different.');
      }

      /** Returns true when the date is present and within the booking window. */
      const checkDate = (field: 'departDate' | 'returnDate', emptyMessage: string): boolean => {
        const value = draft[field];
        let message: string | undefined;
        if (value.length === 0) message = emptyMessage;
        else if (!isIsoDate(value)) message = 'Enter a valid date.';
        else if (compareIsoDates(value, today) < 0) message = 'Choose a date from today onwards.';
        else if (compareIsoDates(value, lastBookableDate) > 0) {
          message = `Flights can be searched up to ${BOOKING_WINDOW_DAYS} days ahead.`;
        }
        if (message) issue([field], message);
        return message === undefined;
      };
      const departOk = checkDate('departDate', 'Choose a departure date.');
      if (draft.tripType === 'round-trip') {
        const returnOk = checkDate('returnDate', 'Choose a return date.');
        if (departOk && returnOk && compareIsoDates(draft.returnDate, draft.departDate) < 0) {
          issue(['returnDate'], 'Return date must be on or after the departure date.');
        }
      }

      for (const passengerIssue of validatePassengers(draft.passengers)) {
        issue(['passengers'], passengerIssue.message);
      }
    })
    .transform((draft): FlightSearch => {
      const search: FlightSearch = {
        tripType: draft.tripType,
        origin: draft.origin,
        destination: draft.destination,
        departDate: draft.departDate,
        passengers: { ...draft.passengers },
        cabin: draft.cabin,
      };
      if (draft.tripType === 'round-trip') search.returnDate = draft.returnDate;
      return search;
    });
}

// ---------------------------------------------------------------------------
// URL serialization
// ---------------------------------------------------------------------------

export const SEARCH_PARAM_KEYS = {
  tripType: 'trip',
  origin: 'from',
  destination: 'to',
  departDate: 'depart',
  returnDate: 'return',
  adults: 'adults',
  children: 'children',
  infants: 'infants',
  cabin: 'cabin',
} as const;

export type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

function readParam(params: SearchParamsInput, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** True when the input carries at least one flight search parameter. */
export function hasFlightSearchParams(params: SearchParamsInput): boolean {
  return Object.values(SEARCH_PARAM_KEYS).some((key) => readParam(params, key) !== undefined);
}

function parseCount(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  return /^\d{1,2}$/.test(raw) ? Number(raw) : Number.NaN;
}

/** Leniently convert URL parameters into a draft; validation happens separately. */
export function searchParamsToDraft(params: SearchParamsInput): FlightSearchDraft {
  const k = SEARCH_PARAM_KEYS;
  const rawTrip = readParam(params, k.tripType);
  const returnDate = (readParam(params, k.returnDate) ?? '').trim();
  const tripType = tripTypeSchema.safeParse(rawTrip).success
    ? (rawTrip as TripType)
    : returnDate
      ? 'round-trip'
      : 'one-way';
  const rawCabin = readParam(params, k.cabin);

  return {
    tripType,
    origin: (readParam(params, k.origin) ?? '').trim().toUpperCase(),
    destination: (readParam(params, k.destination) ?? '').trim().toUpperCase(),
    departDate: (readParam(params, k.departDate) ?? '').trim(),
    returnDate: tripType === 'round-trip' ? returnDate : '',
    passengers: {
      adults: parseCount(readParam(params, k.adults), 1),
      children: parseCount(readParam(params, k.children), 0),
      infants: parseCount(readParam(params, k.infants), 0),
    },
    cabin: cabinClassSchema.safeParse(rawCabin).success ? (rawCabin as CabinClass) : 'economy',
  };
}

export function serializeFlightSearch(search: FlightSearch): URLSearchParams {
  const k = SEARCH_PARAM_KEYS;
  const params = new URLSearchParams();
  params.set(k.tripType, search.tripType);
  params.set(k.origin, search.origin);
  params.set(k.destination, search.destination);
  params.set(k.departDate, search.departDate);
  if (search.tripType === 'round-trip' && search.returnDate) {
    params.set(k.returnDate, search.returnDate);
  }
  params.set(k.adults, String(search.passengers.adults));
  if (search.passengers.children > 0) params.set(k.children, String(search.passengers.children));
  if (search.passengers.infants > 0) params.set(k.infants, String(search.passengers.infants));
  params.set(k.cabin, search.cabin);
  return params;
}

export function buildFlightsHref(search: FlightSearch): string {
  return `/flights?${serializeFlightSearch(search).toString()}`;
}

export interface SearchIssue {
  path: string;
  message: string;
}

export type ParsedFlightSearch =
  | { success: true; search: FlightSearch; draft: FlightSearchDraft }
  | { success: false; issues: SearchIssue[]; draft: FlightSearchDraft };

/** Parse and validate `/flights` URL parameters. */
export function parseFlightSearchParams(
  params: SearchParamsInput,
  options: SearchValidationOptions,
): ParsedFlightSearch {
  const draft = searchParamsToDraft(params);
  const result = createFlightSearchSchema(options).safeParse(draft);
  if (result.success) return { success: true, search: result.data, draft };
  return {
    success: false,
    draft,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

const PASSENGER_NOUNS: Record<PassengerType, [singular: string, plural: string]> = {
  adults: ['Adult', 'Adults'],
  children: ['Child', 'Children'],
  infants: ['Infant', 'Infants'],
};

/** e.g. `2 Adults, 1 Child`. Adults are always listed; other types only when present. */
export function formatPassengerSummary(counts: PassengerCounts): string {
  return (['adults', 'children', 'infants'] as const)
    .filter((type) => type === 'adults' || counts[type] > 0)
    .map((type) => `${counts[type]} ${PASSENGER_NOUNS[type][counts[type] === 1 ? 0 : 1]}`)
    .join(', ');
}

export function passengerNoun(type: PassengerType, count: number): string {
  return PASSENGER_NOUNS[type][count === 1 ? 0 : 1];
}
