'use server';

import { randomUUID } from 'node:crypto';
import {
  changePasswordRequestSchema,
  idempotencyKeySchema,
  orderIdSchema,
  registerRequestSchema,
  savedTravellerIdSchema,
  savedTravellerInputSchema,
  signInRequestSchema,
  updateProfileRequestSchema,
} from '@velasia/contracts';
import type { Route } from 'next';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { readGuestToken } from '@/features/checkout/checkout-cookies';
import type { ManageActionState } from '@/features/manage/action-state';
import { RetailingApiError } from '@/lib/retailing-api/client';
import { accountApi } from '@/lib/retailing-api/servicing';
import {
  clearAccountToken,
  clientKey,
  readAccountToken,
  safeNext,
  writeAccountToken,
} from './session';
import { logUpstreamFailure } from '@/lib/observability';

/*
 * Demo account Server Actions (Milestone 6). Passwords travel only in the POST body to the
 * retailing API, which hashes them with Argon2id; they are never logged, stored, or echoed back
 * (a failed form returns field messages, never the values). The session token is set as an
 * HTTP-only cookie here and never shown to page scripts. Sign-in replaces any previous session
 * (rotation); sign-out revokes it in the API and deletes the cookie.
 */

const at = () => Date.now();
const failure = (
  code: string,
  message: string,
  fields?: Record<string, string>,
): ManageActionState => ({
  status: 'error',
  code,
  message,
  ...(fields ? { fields } : {}),
  at: at(),
});
const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    fields[key] ??= issue.message;
  }
  return fields;
}

function fromApiError(error: unknown, action: string): ManageActionState {
  if (!(error instanceof RetailingApiError)) throw error;
  // Codes only: never emails, names, or tokens.
  logUpstreamFailure('account', action, error);
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
    case 'ACCOUNT_EXISTS':
    case 'RATE_LIMITED':
    case 'REGISTRATION_DISABLED':
    case 'LIMIT_REACHED':
    case 'SERVICING_CONFLICT':
    case 'ORDER_NOT_FOUND':
    case 'ORDER_NOT_MODIFIABLE':
      return failure(error.code.toLowerCase(), error.message);
    case 'UNAUTHENTICATED':
      return failure('unauthenticated', 'Your session has ended. Please sign in again.');
  }
  if (error.kind === 'rejected') return failure('invalid-input', error.message);
  if (error.kind === 'not-found') return failure('not-found', 'We couldn’t find that.');
  return failure('unavailable', 'We couldn’t reach our service. Please try again in a moment.');
}

async function signedIn() {
  const token = await readAccountToken();
  if (!token) redirect('/account/sign-in' as Route);
  return token;
}

export async function signInAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const input = signInRequestSchema.safeParse({
    email: text(formData, 'email'),
    password: text(formData, 'password'),
  });
  if (!input.success)
    return failure('invalid-input', 'Check the highlighted fields.', fieldErrors(input.error));
  let session;
  try {
    ({ session } = await accountApi.signIn(
      input.data,
      await clientKey(),
      await readAccountToken(),
    ));
  } catch (error) {
    return fromApiError(error, 'sign-in');
  }
  await writeAccountToken(session.token, session.expiresAt);
  redirect(safeNext(text(formData, 'next')));
}

export async function registerDemoAccountAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const input = registerRequestSchema.safeParse({
    email: text(formData, 'email'),
    password: text(formData, 'password'),
    givenName: text(formData, 'givenName'),
    familyName: text(formData, 'familyName'),
  });
  if (!input.success)
    return failure('invalid-input', 'Check the highlighted fields.', fieldErrors(input.error));
  if (text(formData, 'password') !== text(formData, 'confirmPassword')) {
    return failure('invalid-input', 'The passwords don’t match.', {
      confirmPassword: 'The passwords don’t match.',
    });
  }
  if (text(formData, 'demo') !== 'yes') {
    return failure('invalid-input', 'Please confirm you understand this is a demo account.', {
      demo: 'Confirm you understand this is a demo account.',
    });
  }
  let session;
  try {
    ({ session } = await accountApi.register(input.data, await clientKey()));
  } catch (error) {
    return fromApiError(error, 'register');
  }
  await writeAccountToken(session.token, session.expiresAt);
  redirect(safeNext(text(formData, 'next'), '/account'));
}

export async function signOutAction(): Promise<void> {
  const token = await readAccountToken();
  if (token) {
    try {
      await accountApi.signOut(token);
    } catch (error) {
      // The cookie goes regardless; the session expires on its own if the API missed this.
      if (!(error instanceof RetailingApiError)) throw error;
      logUpstreamFailure('account', 'sign-out', error);
    }
  }
  await clearAccountToken();
  redirect('/account/sign-in?signedOut=1' as Route);
}

export async function updateProfileAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const input = updateProfileRequestSchema.safeParse({
    givenName: text(formData, 'givenName'),
    familyName: text(formData, 'familyName'),
  });
  if (!input.success)
    return failure('invalid-input', 'Check the highlighted fields.', fieldErrors(input.error));
  try {
    await accountApi.updateProfile(await signedIn(), input.data);
  } catch (error) {
    return fromApiError(error, 'profile');
  }
  refresh();
  return { status: 'done', message: 'Your name was updated.', at: at() };
}

export async function changePasswordAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const input = changePasswordRequestSchema.safeParse({
    currentPassword: text(formData, 'currentPassword'),
    newPassword: text(formData, 'newPassword'),
  });
  if (!input.success)
    return failure('invalid-input', 'Check the highlighted fields.', fieldErrors(input.error));
  let session;
  try {
    session = await accountApi.changePassword(await signedIn(), input.data);
  } catch (error) {
    return fromApiError(error, 'password');
  }
  await writeAccountToken(session.token, session.expiresAt);
  return {
    status: 'done',
    message: 'Password changed. You were signed out everywhere else.',
    at: at(),
  };
}

/** Link bookings this browser owns as a guest to the signed-in account. Explicit, never automatic. */
export async function linkBookingsAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const ids = z.array(orderIdSchema).min(1).max(10).safeParse(formData.getAll('orderId'));
  if (!ids.success) return failure('invalid-input', 'Choose at least one booking to add.');
  if (text(formData, 'confirm') !== 'yes') {
    return failure(
      'invalid-input',
      'Confirm that you want to add these bookings to your account.',
      {
        confirm: 'Confirm that you want to add these bookings to your account.',
      },
    );
  }
  const guest = await readGuestToken();
  if (!guest) return failure('not-found', 'This browser has no bookings to add.');
  let result;
  try {
    result = await accountApi.link(await signedIn(), guest, ids.data);
  } catch (error) {
    return fromApiError(error, 'link');
  }
  refresh();
  const count = result.linked.length + result.alreadyLinked.length;
  return {
    status: 'done',
    message: `${count} ${count === 1 ? 'booking is' : 'bookings are'} now in My Trips.`,
    at: at(),
  };
}

const travellerFields = (formData: FormData) =>
  savedTravellerInputSchema.safeParse({
    title: text(formData, 'title'),
    givenName: text(formData, 'givenName'),
    middleName: text(formData, 'middleName'),
    familyName: text(formData, 'familyName'),
    dateOfBirth: text(formData, 'dateOfBirth'),
    nationality: text(formData, 'nationality'),
  });

export async function saveTravellerAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const input = travellerFields(formData);
  if (!input.success)
    return failure('invalid-input', 'Check the highlighted fields.', fieldErrors(input.error));
  const token = await signedIn();
  const id = savedTravellerIdSchema.safeParse(text(formData, 'travellerId'));
  try {
    if (id.success) {
      const revision = z.coerce.number().int().positive().parse(text(formData, 'revision'));
      await accountApi.updateTraveller(token, id.data, revision, input.data);
    } else {
      const key = idempotencyKeySchema.safeParse(text(formData, 'idempotencyKey'));
      await accountApi.createTraveller(token, key.success ? key.data : randomUUID(), input.data);
    }
  } catch (error) {
    return fromApiError(error, 'traveller');
  }
  redirect('/account/travellers?saved=1' as Route);
}

export async function deleteTravellerAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const id = savedTravellerIdSchema.safeParse(text(formData, 'travellerId'));
  if (!id.success) return failure('invalid-input', 'We couldn’t read that request.');
  try {
    await accountApi.deleteTraveller(await signedIn(), id.data);
  } catch (error) {
    return fromApiError(error, 'traveller delete');
  }
  refresh();
  return {
    status: 'done',
    message: 'Traveller removed. Your existing bookings are unchanged.',
    at: at(),
  };
}
