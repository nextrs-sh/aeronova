import { z } from 'zod';
import { daysBetween, formatTravelDate, isIsoDate } from './dates';
import type { PricedPassengerType } from './flights';
import type { PassengerCounts } from './search';

/*
 * Traveller details (Milestone 4).
 *
 * The number and type of travellers are fixed by the offers the guest chose: the API creates
 * one *slot* per priced passenger (`ADT1`, `ADT2`, `CHD1`, `INF1`, …) and the traveller form
 * fills those slots. It can't add, remove, or retype a traveller; that needs a new search,
 * because the offers were priced for this exact party.
 *
 * Every rule below is a simplified, fictional demo rule. Velasia doesn't collect passport
 * details and makes no claim about real airline, immigration, or travel-document rules.
 */

/** Fictional demo rules. Ages are whole years on the local departure date of a flight. */
export const TRAVELLER_RULES = {
  /** Adults are 12 or older on the first flight. */
  adultMinAge: 12,
  /** Nobody is older than this; anything above is a typing mistake. */
  maxAge: 120,
  /** Children are 2–11 on the first flight (turning 12 during the trip is fine). */
  childMinAge: 2,
  childMaxAge: 11,
  /** Lap infants must be under 2 on every flight, including the last one… */
  infantMaxAge: 1,
  /** …and at least this many days old on the first flight. */
  infantMinAgeDays: 14,
  /** An adult travelling with a lap infant must be at least this old. */
  infantEscortMinAge: 16,
  nameMaxLength: 40,
  givenNameMinLength: 1,
  familyNameMinLength: 2,
} as const;

export type TravellerType = PricedPassengerType;

const SLOT_PREFIX = { adult: 'ADT', child: 'CHD', infant: 'INF' } as const;
const SLOT_TYPE = { ADT: 'adult', CHD: 'child', INF: 'infant' } as const;

export const travellerIdSchema = z
  .string()
  .regex(/^(ADT|CHD|INF)[1-9]$/, 'Invalid traveller identifier.');
export type TravellerId = z.infer<typeof travellerIdSchema>;

export interface TravellerSlot {
  id: TravellerId;
  type: TravellerType;
  /** 1-based within the type: Adult 1, Adult 2, Child 1. */
  ordinal: number;
  /** `Adult 1` */
  label: string;
}

const TYPE_LABEL: Record<TravellerType, string> = {
  adult: 'Adult',
  child: 'Child',
  infant: 'Infant',
};

export function travellerTypeLabel(type: TravellerType): string {
  return TYPE_LABEL[type];
}

/** The type a slot id stands for (`CHD2` → `child`), or `null` for anything else. */
export function travellerTypeOf(id: string): TravellerType | null {
  const prefix = id.slice(0, 3) as keyof typeof SLOT_TYPE;
  return travellerIdSchema.safeParse(id).success ? SLOT_TYPE[prefix] : null;
}

/** One slot per priced passenger, adults first, in a stable order. */
export function travellerSlots(counts: PassengerCounts): TravellerSlot[] {
  const slots: TravellerSlot[] = [];
  const add = (type: TravellerType, count: number) => {
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      slots.push({
        id: `${SLOT_PREFIX[type]}${ordinal}`,
        type,
        ordinal,
        label: `${TYPE_LABEL[type]} ${ordinal}`,
      });
    }
  };
  add('adult', counts.adults);
  add('child', counts.children);
  add('infant', counts.infants);
  return slots;
}

export function slotLabel(id: string): string {
  const type = travellerTypeOf(id);
  return type ? `${TYPE_LABEL[type]} ${id.slice(3)}` : 'Traveller';
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export const travellerTitleSchema = z.enum(['MR', 'MS', 'MRS', 'MX', 'DR']);
export type TravellerTitle = z.infer<typeof travellerTitleSchema>;
export const TRAVELLER_TITLES: Record<TravellerTitle, string> = {
  MR: 'Mr',
  MS: 'Ms',
  MRS: 'Mrs',
  MX: 'Mx',
  DR: 'Dr',
};

/**
 * Assistance a traveller can ask for. A short list of service requests, never free text, so the
 * demo doesn't collect health details.
 */
export const specialAssistanceSchema = z.enum([
  'WHEELCHAIR',
  'VISION',
  'HEARING',
  'MEET_AND_ASSIST',
]);
export type SpecialAssistance = z.infer<typeof specialAssistanceSchema>;
export const SPECIAL_ASSISTANCE: Record<SpecialAssistance, string> = {
  WHEELCHAIR: 'Wheelchair to and from the aircraft door',
  VISION: 'Support for blind or low-vision travellers',
  HEARING: 'Support for deaf or hard-of-hearing travellers',
  MEET_AND_ASSIST: 'Meet and assist through the airport',
};

/**
 * Nationalities offered in the form (ISO 3166-1 alpha-2). A demo list: Velasia's region first,
 * then frequent visitors. It describes nothing about entry requirements.
 */
export const COUNTRIES: readonly { code: string; name: string }[] = [
  { code: 'PH', name: 'Philippines' },
  { code: 'BN', name: 'Brunei' },
  { code: 'KH', name: 'Cambodia' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'LA', name: 'Laos' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MM', name: 'Myanmar' },
  { code: 'SG', name: 'Singapore' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TL', name: 'Timor-Leste' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'HK', name: 'Hong Kong SAR' },
  { code: 'IN', name: 'India' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NO', name: 'Norway' },
  { code: 'QA', name: 'Qatar' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ES', name: 'Spain' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
];
const COUNTRY_CODES: ReadonlySet<string> = new Set(COUNTRIES.map((country) => country.code));

export function countryName(code: string): string {
  return COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

/** Letters (including common Latin accents), spaces, hyphens, and apostrophes. */
const NAME_PATTERN = /^\p{Script=Latin}(?:[\p{Script=Latin}' -]*\p{Script=Latin})?$/u;

export const nameSchema = (label: string, min: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(1, `Enter the ${label}.`)
        .min(min, `The ${label} must be at least ${min} letters.`)
        .max(
          TRAVELLER_RULES.nameMaxLength,
          `The ${label} can be up to ${TRAVELLER_RULES.nameMaxLength} characters.`,
        )
        .regex(
          NAME_PATTERN,
          `Use letters, spaces, hyphens, or apostrophes for the ${label}, as on your ID.`,
        ),
    );

/** Optional text field: an empty string means "not given" and becomes `null`. */
export const optional = <T extends z.ZodType>(schema: T) =>
  z
    .union([z.literal(''), z.null(), z.undefined(), schema])
    .transform(
      (value) => (value === '' || value === undefined ? null : value) as z.output<T> | null,
    );

export const optionalName = optional(nameSchema('middle name', 1));
export const givenNameSchema = nameSchema('given name', TRAVELLER_RULES.givenNameMinLength);
export const familyNameSchema = nameSchema('family name', TRAVELLER_RULES.familyNameMinLength);
export const dateOfBirthSchema = z
  .string()
  .min(1, 'Enter the date of birth.')
  .refine(isIsoDate, 'Enter a valid date of birth.');
export const nationalitySchema = z
  .string()
  .min(1, 'Choose a nationality.')
  .refine((code) => COUNTRY_CODES.has(code), 'Choose a nationality from the list.');

export const travellerInputSchema = z.object({
  id: travellerIdSchema,
  type: z.enum(['adult', 'child', 'infant']),
  title: optional(travellerTitleSchema),
  givenName: givenNameSchema,
  middleName: optionalName,
  familyName: familyNameSchema,
  dateOfBirth: dateOfBirthSchema,
  nationality: nationalitySchema,
  specialAssistance: optional(specialAssistanceSchema),
  /** Infants only: the adult (`ADT…`) whose lap the infant travels on. */
  infantOf: optional(travellerIdSchema),
});
export type TravellerInput = z.input<typeof travellerInputSchema>;
export type Traveller = z.output<typeof travellerInputSchema>;

/** Spaces, hyphens, dots, and brackets are ignored; the result is `+` and 8–15 digits. */
export function normalizePhone(value: string): string {
  return value.trim().replace(/[\s().-]/g, '');
}

export const contactInputSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter an email address.')
    .max(254, 'This email address is too long.')
    .pipe(z.email('Enter a valid email address, like name@example.com.'))
    .transform((value) => value.toLowerCase()),
  phone: z
    .string()
    .transform(normalizePhone)
    .pipe(
      z
        .string()
        .min(1, 'Enter a phone number.')
        .regex(
          /^\+[1-9]\d{7,14}$/,
          'Enter the number with its country code, for example +63 917 555 0123.',
        ),
    ),
});
export type ContactInput = z.input<typeof contactInputSchema>;
export type Contact = z.output<typeof contactInputSchema>;

// ---------------------------------------------------------------------------
// Rules that need the trip: ages, slots, and infant escorts
// ---------------------------------------------------------------------------

/** Whole years between a birth date and a date (both `YYYY-MM-DD`). */
export function ageOn(dateOfBirth: string, date: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export interface TravellerRulesContext {
  slots: readonly TravellerSlot[];
  /** Local departure date of the first flight of the trip. */
  firstTravelDate: string;
  /** Local departure date of the last flight of the trip (the first one for one flight). */
  lastTravelDate: string;
}

export interface TravellerIssue {
  /** Form path, e.g. `passengers.1.dateOfBirth`. */
  path: (string | number)[];
  message: string;
}

/**
 * Rules that depend on the trip. Shared by the storefront form and the API, which applies them
 * again: a traveller's type is fixed by their slot, and their age must fit it on the travel dates.
 */
export function travellerIssues(
  passengers: readonly Pick<Traveller, 'id' | 'type' | 'dateOfBirth' | 'infantOf'>[],
  context: TravellerRulesContext,
): TravellerIssue[] {
  const issues: TravellerIssue[] = [];
  const { slots, firstTravelDate, lastTravelDate } = context;
  const first = formatTravelDate(firstTravelDate);
  if (passengers.length !== slots.length) {
    return [
      {
        path: ['passengers'],
        message: `This trip was priced for ${slots.length} ${slots.length === 1 ? 'traveller' : 'travellers'}. To change who is travelling, start a new search.`,
      },
    ];
  }
  const seen = new Set<string>();
  passengers.forEach((passenger, index) => {
    const slot = slots[index]!;
    const at = (field: string) => ['passengers', index, field];
    if (seen.has(passenger.id)) {
      issues.push({ path: at('id'), message: 'Each traveller can appear only once.' });
    }
    seen.add(passenger.id);
    if (passenger.id !== slot.id || passenger.type !== slot.type) {
      issues.push({
        path: at('id'),
        message: `Traveller ${index + 1} must be ${slot.label}, as priced in your offer.`,
      });
      return;
    }
    const dob = passenger.dateOfBirth;
    if (!isIsoDate(dob)) return;
    const age = ageOn(dob, firstTravelDate);
    if (daysBetween(dob, firstTravelDate) < 0) {
      issues.push({
        path: at('dateOfBirth'),
        message: 'The date of birth can’t be after the flight.',
      });
      return;
    }
    if (age > TRAVELLER_RULES.maxAge) {
      issues.push({ path: at('dateOfBirth'), message: 'Check the year of birth.' });
      return;
    }
    if (slot.type === 'adult' && age < TRAVELLER_RULES.adultMinAge) {
      issues.push({
        path: at('dateOfBirth'),
        message: `Adults must be ${TRAVELLER_RULES.adultMinAge} or older on ${first}. To book this traveller as a child, start a new search.`,
      });
    }
    if (
      slot.type === 'child' &&
      (age < TRAVELLER_RULES.childMinAge || age > TRAVELLER_RULES.childMaxAge)
    ) {
      issues.push({
        path: at('dateOfBirth'),
        message: `Children must be ${TRAVELLER_RULES.childMinAge}–${TRAVELLER_RULES.childMaxAge} years old on ${first}. For a different age group, start a new search.`,
      });
    }
    if (slot.type === 'infant') {
      if (ageOn(dob, lastTravelDate) > TRAVELLER_RULES.infantMaxAge) {
        issues.push({
          path: at('dateOfBirth'),
          message: `Lap infants must be under 2 on every flight, including ${formatTravelDate(lastTravelDate)}. To book a seat for this child, start a new search.`,
        });
      } else if (daysBetween(dob, firstTravelDate) < TRAVELLER_RULES.infantMinAgeDays) {
        issues.push({
          path: at('dateOfBirth'),
          message: `Infants must be at least ${TRAVELLER_RULES.infantMinAgeDays} days old on ${first}.`,
        });
      }
    }
  });

  // Each lap infant travels with a different adult, old enough to look after them.
  const escorts = new Map<string, number>();
  passengers.forEach((passenger, index) => {
    if (passenger.type !== 'infant') {
      if (passenger.infantOf) {
        issues.push({
          path: ['passengers', index, 'infantOf'],
          message: 'Only infants travel with an adult.',
        });
      }
      return;
    }
    const at = ['passengers', index, 'infantOf'];
    const escort = passengers.find(
      (candidate) => candidate.id === passenger.infantOf && candidate.type === 'adult',
    );
    if (!escort) {
      issues.push({ path: at, message: 'Choose the adult this infant travels with.' });
      return;
    }
    if (escorts.has(escort.id)) {
      issues.push({ path: at, message: 'Each adult can travel with one lap infant.' });
      return;
    }
    escorts.set(escort.id, index);
    if (
      isIsoDate(escort.dateOfBirth) &&
      ageOn(escort.dateOfBirth, firstTravelDate) < TRAVELLER_RULES.infantEscortMinAge
    ) {
      issues.push({
        path: at,
        message: `An adult travelling with an infant must be ${TRAVELLER_RULES.infantEscortMinAge} or older.`,
      });
    }
  });
  return issues;
}

/** The traveller form: one entry per slot plus contact details. */
export const travellersFormSchema = z.object({
  passengers: z.array(travellerInputSchema).min(1).max(18),
  contact: contactInputSchema,
});
export type TravellersFormInput = z.input<typeof travellersFormSchema>;
export type TravellersForm = z.output<typeof travellersFormSchema>;

/** The form schema with the trip's rules applied, for React Hook Form and the API alike. */
export function createTravellersFormSchema(context: TravellerRulesContext) {
  return travellersFormSchema.superRefine((value, ctx) => {
    for (const issue of travellerIssues(value.passengers, context)) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });
}

/** `Maria Clara Santos` (title and middle name are left out unless asked for). */
export function travellerName(
  traveller: Pick<Traveller, 'givenName' | 'familyName' | 'middleName' | 'title'>,
  { full = false }: { full?: boolean } = {},
): string {
  const parts = full
    ? [
        traveller.title ? TRAVELLER_TITLES[traveller.title] : null,
        traveller.givenName,
        traveller.middleName,
        traveller.familyName,
      ]
    : [traveller.givenName, traveller.familyName];
  return parts.filter(Boolean).join(' ');
}
