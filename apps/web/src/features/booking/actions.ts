'use server';

import {
  createTravellersFormSchema,
  flightInstanceIdSchema,
  journeyDirectionSchema,
  seatIdSchema,
  travellerIdSchema,
  type AncillaryChange,
  type ShoppingSession,
} from '@velasia/contracts';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { readSessionCookie, type SessionCredentials } from '@/features/shopping/session-cookie';
import { RetailingApiError, retailingApi } from '@/lib/retailing-api/client';
import type { BookingActionState, BookingErrorCode } from './action-state';
import { STEP_HREF, travellerRules } from './trip';
import { logUpstreamFailure } from '@/lib/observability';

/*
 * Booking Server Actions. Each is a public POST endpoint, so each one:
 * - takes the shopping session only from the HTTP-only cookie (never from the browser),
 * - validates its own small input with Zod (a field for a price would simply be ignored),
 * - lets the retailing API decide every rule, price, and total, and
 * - returns a typed result without internal details, never retrying an uncertain change.
 *
 * Traveller details are personal: they are never logged, and errors never echo them.
 */

const failure = (
  code: BookingErrorCode,
  message: string,
  fieldErrors?: Record<string, string>,
): BookingActionState => ({
  status: 'error',
  code,
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

const SESSION_GONE = failure(
  'session-expired',
  'Your booking session has expired. Please search again to choose your flights.',
);

/** Map an API failure to a safe result. Upstream bodies and stack traces are never returned. */
function fromApiError(error: unknown, action: string): BookingActionState {
  if (!(error instanceof RetailingApiError)) throw error;
  logUpstreamFailure('booking', action, error);
  switch (error.code) {
    case 'SESSION_EXPIRED':
    case 'SESSION_NOT_FOUND':
      return SESSION_GONE;
    case 'SESSION_CONFLICT':
      refresh();
      return failure(
        'conflict',
        'Your trip was changed in another window or tab. We’ve loaded the latest version — please check it and try again.',
      );
    case 'SEAT_UNAVAILABLE':
      refresh();
      return failure('seat-unavailable', error.message);
    case 'BOOKING_STEP_UNAVAILABLE':
      refresh();
      return failure('step-locked', error.message);
    case 'PASSENGERS_INVALID':
    case 'TRAVELLER_MISSING':
    case 'SEAT_INELIGIBLE':
    case 'ANCILLARY_UNAVAILABLE':
    case 'INVALID_QUANTITY':
    case 'INVALID_SELECTION':
      // The API's rule messages are written for travellers and carry no personal details.
      return failure('rejected', error.message);
  }
  if (error.kind === 'not-found') return SESSION_GONE;
  if (error.kind === 'timeout') {
    // The change may have been saved before the answer was lost. Never resend it blindly:
    // show what the session holds now and let the traveller decide.
    refresh();
    return failure(
      'uncertain',
      'Our booking service took too long to answer, so we can’t tell whether your last change was saved. We’ve reloaded your trip — please check it before continuing.',
    );
  }
  if (error.kind === 'rejected') {
    return failure('invalid-input', 'We couldn’t use that choice. Please try again.');
  }
  refresh();
  return failure(
    'unavailable',
    'We couldn’t reach our booking service. Your last saved choices are shown — please try again in a moment.',
  );
}

async function credentials(): Promise<SessionCredentials | null> {
  return readSessionCookie();
}

/** Read only the named string fields of a form. */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

const versionSchema = z.coerce.number().int().nonnegative().optional();

// ---------------------------------------------------------------------------
// Traveller details
// ---------------------------------------------------------------------------

const TRAVELLER_FIELDS = [
  'id',
  'type',
  'title',
  'givenName',
  'middleName',
  'familyName',
  'dateOfBirth',
  'nationality',
  'specialAssistance',
  'infantOf',
] as const;

/** `passengers.0.givenName` style form fields → the traveller form's shape. Nothing else is read. */
function travellersFromForm(formData: FormData) {
  const passengers: Record<string, string>[] = [];
  for (let index = 0; index < 18; index += 1) {
    if (!formData.has(`passengers.${index}.id`)) break;
    passengers.push(
      Object.fromEntries(
        TRAVELLER_FIELDS.map((field) => [field, text(formData, `passengers.${index}.${field}`)]),
      ),
    );
  }
  return {
    passengers,
    contact: { email: text(formData, 'contact.email'), phone: text(formData, 'contact.phone') },
  };
}

/**
 * Save every traveller's details and the contact details, then go to seats. Validated here with
 * the same schema as the form, and again (authoritatively) by the API.
 */
export async function savePassengersAction(
  _previous: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const session = await credentials();
  if (!session) return SESSION_GONE;
  let current: ShoppingSession;
  try {
    current = await retailingApi.getSession(session.id, session.token);
  } catch (error) {
    return fromApiError(error, 'travellers');
  }
  if (current.booking.steps.travellers === 'locked') {
    return failure('step-locked', 'Please confirm your flights on the trip summary first.');
  }
  const input = createTravellersFormSchema(travellerRules(current)).safeParse(
    travellersFromForm(formData),
  );
  if (!input.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of input.error.issues) {
      fieldErrors[issue.path.join('.')] ??= issue.message;
    }
    return failure('invalid-input', 'Please check the highlighted details.', fieldErrors);
  }
  const version = versionSchema.safeParse(text(formData, 'version') || undefined);
  try {
    await retailingApi.savePassengers(session.id, session.token, {
      ...input.data,
      expectedVersion: version.success ? version.data : undefined,
    });
  } catch (error) {
    if (error instanceof RetailingApiError && error.code === 'PASSENGERS_INVALID') {
      const fieldErrors = Object.fromEntries((error.issues ?? []).map((i) => [i.path, i.message]));
      return failure('invalid-input', 'Please check the highlighted details.', fieldErrors);
    }
    return fromApiError(error, 'travellers');
  }
  redirect(STEP_HREF.seats);
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

const seatInputSchema = z.object({
  flightId: flightInstanceIdSchema,
  travellerId: travellerIdSchema,
  seatId: seatIdSchema.nullable(),
});

async function changeSeat(input: unknown): Promise<BookingActionState> {
  const parsed = seatInputSchema.safeParse(input);
  if (!parsed.success)
    return failure('invalid-input', 'We couldn’t read that seat. Please try again.');
  const session = await credentials();
  if (!session) return SESSION_GONE;
  try {
    await retailingApi.updateSeats(session.id, session.token, { assignments: [parsed.data] });
  } catch (error) {
    return fromApiError(error, 'seats');
  }
  refresh();
  return { status: 'saved', at: Date.now() };
}

/** Choose (or change) one traveller's seat on one flight. The API prices it. */
export async function selectSeatAction(input: {
  flightId: string;
  travellerId: string;
  seatId: string;
}): Promise<BookingActionState> {
  return changeSeat({
    flightId: input?.flightId,
    travellerId: input?.travellerId,
    seatId: input?.seatId ?? '',
  });
}

/** Remove a traveller's seat on one flight: they'll be given one at check-in. */
export async function removeSeatAction(input: {
  flightId: string;
  travellerId: string;
}): Promise<BookingActionState> {
  return changeSeat({ flightId: input?.flightId, travellerId: input?.travellerId, seatId: null });
}

/**
 * Finish a step ("Continue") and move on. No version check: marking a step done changes no
 * choice, and a seat or extra saved a moment earlier (still in flight) must not block it.
 */
async function completeStep(step: 'seats' | 'extras') {
  const session = await credentials();
  if (!session) return { ok: false as const, state: SESSION_GONE };
  try {
    await retailingApi.completeStep(session.id, session.token, { step });
    return { ok: true as const, session };
  } catch (error) {
    return { ok: false as const, state: fromApiError(error, `continue ${step}`) };
  }
}

export async function continueFromSeatsAction(
  _previous: BookingActionState,
  _formData: FormData,
): Promise<BookingActionState> {
  const done = await completeStep('seats');
  if (!done.ok) return done.state;
  redirect(STEP_HREF.extras);
}

// ---------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------

const productField = z.string().regex(/^[A-Z0-9_]{3,40}$/);

const extrasInputSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('BAGGAGE'),
    travellerId: travellerIdSchema,
    direction: journeyDirectionSchema,
    productId: productField.nullable(),
  }),
  z.object({
    category: z.literal('MEAL'),
    travellerId: travellerIdSchema,
    flightId: flightInstanceIdSchema,
    productId: productField.nullable(),
  }),
  z.object({
    category: z.literal('PRIORITY'),
    travellerId: travellerIdSchema,
    direction: journeyDirectionSchema,
    productId: productField,
    selected: z.boolean(),
  }),
]);

async function changeExtra(input: unknown): Promise<BookingActionState> {
  const parsed = extrasInputSchema.safeParse(input);
  if (!parsed.success)
    return failure('invalid-input', 'We couldn’t read that choice. Please try again.');
  const session = await credentials();
  if (!session) return SESSION_GONE;
  try {
    await retailingApi.updateAncillaries(session.id, session.token, {
      changes: [parsed.data as AncillaryChange],
    });
  } catch (error) {
    return fromApiError(error, 'extras');
  }
  refresh();
  return { status: 'saved', at: Date.now() };
}

/** Extra checked baggage for one traveller and direction (`productId: null` for none). */
export async function updateBaggageAction(input: {
  travellerId: string;
  direction: string;
  productId: string | null;
}): Promise<BookingActionState> {
  return changeExtra({
    category: 'BAGGAGE',
    ...pick(input, ['travellerId', 'direction', 'productId']),
  });
}

/** A pre-ordered meal for one traveller on one flight (`productId: null` for none). */
export async function selectMealAction(input: {
  travellerId: string;
  flightId: string;
  productId: string | null;
}): Promise<BookingActionState> {
  return changeExtra({
    category: 'MEAL',
    ...pick(input, ['travellerId', 'flightId', 'productId']),
  });
}

/** Add or remove one priority service for one traveller and direction. */
export async function updatePriorityAction(input: {
  travellerId: string;
  direction: string;
  productId: string;
  selected: boolean;
}): Promise<BookingActionState> {
  return changeExtra({
    category: 'PRIORITY',
    ...pick(input, ['travellerId', 'direction', 'productId', 'selected']),
  });
}

/** Only the named keys of an untrusted object: anything else (a price, say) is dropped. */
function pick<T extends object, K extends string>(input: T, keys: readonly K[]) {
  const source = (input ?? {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

/** Finish extras, then run the full review check and show its result. */
export async function continueFromExtrasAction(
  _previous: BookingActionState,
  _formData: FormData,
): Promise<BookingActionState> {
  const done = await completeStep('extras');
  if (!done.ok) return done.state;
  try {
    await retailingApi.validateBooking(done.session.id, done.session.token);
  } catch (error) {
    return fromApiError(error, 'validate');
  }
  redirect(STEP_HREF.review);
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/** Re-price and re-check everything now. The review page shows the result. */
export async function validateBookingReviewAction(
  _previous: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const session = await credentials();
  if (!session) return SESSION_GONE;
  const version = versionSchema.safeParse(text(formData, 'version') || undefined);
  try {
    await retailingApi.validateBooking(
      session.id,
      session.token,
      version.success ? version.data : undefined,
    );
  } catch (error) {
    return fromApiError(error, 'validate');
  }
  refresh();
  return { status: 'saved', at: Date.now() };
}

/**
 * Accept a changed flight price shown on the review, then check everything again. The new
 * offer is the one the API is holding for this session; the browser only names the direction.
 */
export async function acceptPriceChangeAction(
  _previous: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const direction = journeyDirectionSchema.safeParse(text(formData, 'direction'));
  if (!direction.success) return failure('invalid-input', 'We couldn’t read that request.');
  const session = await credentials();
  if (!session) return SESSION_GONE;
  try {
    const current = await retailingApi.getSession(session.id, session.token);
    const pending = current.selections[direction.data]?.pendingOffer;
    if (!pending) {
      refresh();
      return failure(
        'conflict',
        'There’s no new price waiting to be accepted. We’ve reloaded your trip.',
      );
    }
    await retailingApi.selectOffer(session.id, session.token, {
      direction: direction.data,
      offerId: pending.id,
    });
    await retailingApi.validateBooking(session.id, session.token);
  } catch (error) {
    return fromApiError(error, 'accept price');
  }
  refresh();
  return { status: 'saved', at: Date.now() };
}
