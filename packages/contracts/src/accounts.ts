import { z } from 'zod';
import { minorAmountSchema } from './common';
import { fareFamilyCodeSchema } from './offers';
import { orderIdSchema, orderStatusSchema, bookingReferenceSchema } from './orders';
import { tripTypeSchema } from './search';
import {
  dateOfBirthSchema,
  familyNameSchema,
  givenNameSchema,
  nationalitySchema,
  optional,
  optionalName,
  travellerTitleSchema,
} from './travellers';

/*
 * Demo customer accounts (Milestone 6).
 *
 * A first-party account for this fictional airline: email and password, nothing else. There is
 * no email service, so an address is never verified and can't be used to recover an account;
 * every account says so (`emailVerified: false`, `demo: true`). Passwords are hashed with
 * Argon2id by the API and never stored or logged in the clear.
 *
 * Sessions are opaque 256-bit tokens in an HTTP-only cookie; the API stores only their SHA-256
 * hash. Orders stay in the order repository: an account owns orders by reference, it never
 * holds a copy of them.
 */

export const ACCOUNT_RULES = {
  passwordMinLength: 10,
  passwordMaxLength: 128,
  maxSavedTravellers: 10,
  /** Absolute session lifetime. */
  sessionDays: 7,
} as const;

export const accountIdSchema = z.string().regex(/^acc_[A-Za-z0-9_-]{22}$/);
export const accountSessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const savedTravellerIdSchema = z.string().regex(/^trv_[A-Za-z0-9_-]{22}$/);

export const accountEmailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .max(254, 'This email address is too long.')
  .pipe(z.email('Enter a valid email address, like name@example.com.'))
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(ACCOUNT_RULES.passwordMinLength, `Use at least ${ACCOUNT_RULES.passwordMinLength} characters.`)
  .max(ACCOUNT_RULES.passwordMaxLength, `Use at most ${ACCOUNT_RULES.passwordMaxLength} characters.`);

export const registerRequestSchema = z
  .object({
    email: accountEmailSchema,
    password: passwordSchema,
    givenName: givenNameSchema,
    familyName: familyNameSchema,
  })
  .strict();
export type RegisterRequest = z.input<typeof registerRequestSchema>;

/** Sign-in checks no length rules on the password: a wrong one is simply wrong. */
export const signInRequestSchema = z
  .object({
    email: accountEmailSchema,
    password: z.string().min(1, 'Enter your password.').max(ACCOUNT_RULES.passwordMaxLength),
  })
  .strict();
export type SignInRequest = z.input<typeof signInRequestSchema>;

export const accountSchema = z.object({
  id: accountIdSchema,
  email: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  createdAt: z.iso.datetime(),
  /** Always `true`: a demo account in a fictional airline. */
  demo: z.literal(true),
  /** Always `false`: there is no email service to verify an address with. */
  emailVerified: z.literal(false),
});
export type Account = z.infer<typeof accountSchema>;

export const accountSessionSchema = z.object({
  token: accountSessionTokenSchema,
  expiresAt: z.iso.datetime(),
});

export const authResponseSchema = z.object({
  data: z.object({ account: accountSchema, session: accountSessionSchema }),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
export const accountResponseSchema = z.object({
  data: z.object({ account: accountSchema, sessionExpiresAt: z.iso.datetime() }),
});
export type AccountResponse = z.infer<typeof accountResponseSchema>;

export const updateProfileRequestSchema = z
  .object({ givenName: givenNameSchema, familyName: familyNameSchema })
  .strict();
export const changePasswordRequestSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict();

// ---------------------------------------------------------------------------
// Saved travellers
// ---------------------------------------------------------------------------

/**
 * A reusable traveller profile. Names, date of birth, and nationality only: no travel
 * documents, no contact details, no assistance needs.
 */
export const savedTravellerInputSchema = z
  .object({
    title: optional(travellerTitleSchema).optional(),
    givenName: givenNameSchema,
    middleName: optionalName.optional(),
    familyName: familyNameSchema,
    dateOfBirth: dateOfBirthSchema,
    nationality: nationalitySchema,
  })
  .strict();
export type SavedTravellerInput = z.input<typeof savedTravellerInputSchema>;

export const savedTravellerSchema = z.object({
  id: savedTravellerIdSchema,
  title: travellerTitleSchema.nullable(),
  givenName: z.string(),
  middleName: z.string().nullable(),
  familyName: z.string(),
  dateOfBirth: z.string(),
  nationality: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SavedTraveller = z.infer<typeof savedTravellerSchema>;

export const createTravellerRequestSchema = z
  .object({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), traveller: savedTravellerInputSchema })
  .strict();
export const updateTravellerRequestSchema = z
  .object({ expectedRevision: z.number().int().positive(), traveller: savedTravellerInputSchema })
  .strict();
export const travellerParamsSchema = z.object({ travellerId: savedTravellerIdSchema });
export const savedTravellersResponseSchema = z.object({
  data: z.array(savedTravellerSchema),
  meta: z.object({ max: z.number().int().positive() }),
});
export const savedTravellerResponseSchema = z.object({ data: savedTravellerSchema });

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export const tripSectionSchema = z.enum(['upcoming', 'past', 'cancelled', 'attention']);
export type TripSection = z.infer<typeof tripSectionSchema>;

export const tripsQuerySchema = z.object({
  section: tripSectionSchema.default('upcoming'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(6),
});
export type TripsQuery = z.input<typeof tripsQuerySchema>;

/** One booking as listed in My Trips: a projection, never the whole order. */
export const tripSummarySchema = z.object({
  orderId: orderIdSchema,
  reference: bookingReferenceSchema,
  status: orderStatusSchema,
  tripType: tripTypeSchema,
  origin: z.string(),
  destination: z.string(),
  departsAt: z.iso.datetime(),
  returnsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime(),
  families: z.array(fareFamilyCodeSchema),
  flightNumbers: z.array(z.string()),
  /** `scheduled`, or `cancelled` when the airline cancelled a flight (simulated). */
  flightStatus: z.enum(['scheduled', 'disrupted']),
  travellers: z.number().int().positive(),
  leadTraveller: z.string(),
  /** A change awaiting payment or a refund still processing. */
  attention: z.string().nullable(),
  currentTotalMinor: minorAmountSchema,
  currency: z.string(),
});
export type TripSummary = z.infer<typeof tripSummarySchema>;

export const tripsResponseSchema = z.object({
  data: z.array(tripSummarySchema),
  meta: z.object({
    section: tripSectionSchema,
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    counts: z.record(tripSectionSchema, z.number().int().nonnegative()),
  }),
});
export type TripsResponse = z.infer<typeof tripsResponseSchema>;

/** Bookings this browser made as a guest that can be linked to the signed-in account. */
export const linkableBookingsResponseSchema = z.object({ data: z.array(tripSummarySchema) });
export const linkBookingsRequestSchema = z
  .object({ orderIds: z.array(orderIdSchema).min(1).max(10) })
  .strict();
export const linkBookingsResponseSchema = z.object({
  data: z.object({ linked: z.array(orderIdSchema), alreadyLinked: z.array(orderIdSchema) }),
});
export type LinkBookingsResponse = z.infer<typeof linkBookingsResponseSchema>;
