'use server';

import {
  buildResultsHref,
  journeyDirectionSchema,
  offerIdSchema,
  parseFlightSearchParams,
  parseResultsParams,
  sameSearch,
  type FlightSearch,
  type ResultsState,
  type ShoppingSession,
} from '@velasia/contracts';
import type { Route } from 'next';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { afterSelectionHref } from '@/features/flights/journey';
import { getAirports, loadSection } from '@/lib/content';
import { RetailingApiError, retailingApi } from '@/lib/retailing-api/client';
import { getToday } from '@/lib/today';
import type { ShoppingActionState, ShoppingErrorCode } from './action-state';
import {
  clearSessionCookie,
  readSessionCookie,
  writeSessionCookie,
  type SessionCredentials,
} from './session-cookie';

/*
 * Shopping Server Actions: the storefront's only mutations. Each is a public POST endpoint,
 * so each one parses its input, takes the shopping session only from the HTTP-only cookie,
 * and leaves every price and rule to the retailing API. Nothing here calculates money.
 */

/** The page's own query string: the search the traveller is shopping for. */
const queryField = z.string().max(1024);

const selectInputSchema = z.object({
  query: queryField,
  direction: journeyDirectionSchema,
  offerId: offerIdSchema,
});
const checkInputSchema = z.object({ query: queryField, intent: z.enum(['check', 'continue']) });
const clearInputSchema = z.object({ query: queryField });

/** Read only the named string fields. Anything else in the form (a price, say) is ignored. */
function fields<K extends string>(formData: FormData, keys: readonly K[]) {
  return Object.fromEntries(
    keys.map((key) => {
      const value = formData.get(key);
      return [key, typeof value === 'string' ? value : undefined];
    }),
  ) as Record<K, string | undefined>;
}

const failure = (code: ShoppingErrorCode, message: string): ShoppingActionState => ({
  status: 'error',
  code,
  message,
});

/** Map an API failure to a safe, specific message. Upstream bodies are never returned. */
function fromApiError(error: unknown): ShoppingActionState {
  if (!(error instanceof RetailingApiError)) throw error;
  switch (error.code) {
    case 'OFFER_EXPIRED':
      return failure(
        'offer-expired',
        'These prices have expired. We’ve loaded the latest prices — please check them and choose again.',
      );
    case 'OFFER_UNAVAILABLE':
      // The API's availability messages are written for travellers.
      return failure('offer-unavailable', error.message);
    case 'INVALID_SELECTION':
      return failure('invalid-selection', error.message);
    case 'OFFER_NOT_FOUND':
      return failure(
        'offer-not-found',
        'This offer is no longer available. We’ve loaded the latest prices.',
      );
    case 'SESSION_EXPIRED':
    case 'SESSION_NOT_FOUND':
      return failure('session-expired', 'Your trip selection has expired. Please choose again.');
  }
  if (error.kind === 'rejected') {
    return failure('invalid-input', 'We couldn’t use that choice. Please try again.');
  }
  return failure(
    'unavailable',
    'We couldn’t reach our booking service, so nothing has changed. Please try again in a moment.',
  );
}

interface ShoppingContext {
  search: FlightSearch;
  state: ResultsState;
}

/** Re-validate the search from the page's query string, exactly as the page itself does. */
async function parseContext(query: string): Promise<ShoppingContext | null> {
  const params = new URLSearchParams(query);
  const airports = await loadSection(getAirports);
  const parsed = parseFlightSearchParams(params, {
    today: getToday(),
    knownAirportCodes: airports.ok ? new Set(airports.data.map((a) => a.code)) : undefined,
  });
  if (!parsed.success) return null;
  return { search: parsed.search, state: parseResultsParams(params).state };
}

type EnsuredSession =
  | { ok: true; credentials: SessionCredentials; session: ShoppingSession }
  | { ok: false; state: ShoppingActionState };

/**
 * The guest's session for this search: the one in the cookie when it is still live and for
 * the same search, otherwise a new one (which replaces the cookie).
 */
async function ensureSession(search: FlightSearch): Promise<EnsuredSession> {
  const existing = await readSessionCookie();
  if (existing) {
    try {
      const session = await retailingApi.getSession(existing.id, existing.token);
      if (sameSearch(session.search, search)) {
        return { ok: true, credentials: existing, session };
      }
      // A new search starts a new selection; the old session is discarded.
      await retailingApi.deleteSession(existing.id, existing.token).catch(() => undefined);
    } catch (error) {
      if (!(error instanceof RetailingApiError)) throw error;
      const gone = error.kind === 'not-found' || error.code === 'SESSION_EXPIRED';
      if (!gone) return { ok: false, state: fromApiError(error) };
    }
  }
  try {
    const created = await retailingApi.createSession(search);
    const credentials = { id: created.session.id, token: created.token };
    await writeSessionCookie(credentials);
    return { ok: true, credentials, session: created.session };
  } catch (error) {
    return { ok: false, state: fromApiError(error) };
  }
}

/**
 * Choose an offer for one direction (also: change fare family, change flight, accept a new
 * price). On success, moves to the next step in the same round trip.
 */
export async function selectOfferAction(
  _previous: ShoppingActionState,
  formData: FormData,
): Promise<ShoppingActionState> {
  const input = selectInputSchema.safeParse(fields(formData, ['query', 'direction', 'offerId']));
  if (!input.success)
    return failure('invalid-input', 'We couldn’t read that choice. Please try again.');
  const context = await parseContext(input.data.query);
  if (!context) {
    return failure('invalid-input', 'This search is no longer valid. Please search again.');
  }
  const ensured = await ensureSession(context.search);
  if (!ensured.ok) return ensured.state;

  let next: Route;
  try {
    const { session } = await retailingApi.selectOffer(
      ensured.credentials.id,
      ensured.credentials.token,
      { direction: input.data.direction, offerId: input.data.offerId },
    );
    next = afterSelectionHref(context.search, context.state.sort, {
      outbound: session.selections.outbound?.offer.itineraryId,
      inbound: session.selections.inbound?.offer.itineraryId,
    });
  } catch (error) {
    const result = fromApiError(error);
    // Stale or unsellable offers: re-render with fresh offers next to the explanation.
    if (result.status === 'error' && result.code.startsWith('offer-')) refresh();
    return result;
  }
  redirect(next);
}

/**
 * Re-validate the selected offers with the API (`check`), or do that and continue to the
 * next step when everything is still valid at the same price (`continue`).
 */
export async function checkSelectionAction(
  _previous: ShoppingActionState,
  formData: FormData,
): Promise<ShoppingActionState> {
  const input = checkInputSchema.safeParse(fields(formData, ['query', 'intent']));
  if (!input.success) return failure('invalid-input', 'We couldn’t read that request.');
  const credentials = await readSessionCookie();
  if (!credentials) {
    return failure('no-session', 'There’s no trip selection to check. Please choose your fares.');
  }

  let result;
  try {
    result = await retailingApi.repriceSession(credentials.id, credentials.token);
  } catch (error) {
    return fromApiError(error);
  }
  const unchanged = result.outcomes.every((outcome) => outcome.outcome === 'VALIDATED');
  if (input.data.intent === 'continue' && unchanged && result.session.summary.readyToContinue) {
    redirect('/booking/travellers' as Route);
  }
  // The trip summary shows what changed; re-render it with the session's new state.
  refresh();
  return {
    status: 'checked',
    outcomes: result.outcomes.map(({ direction, outcome }) => ({ direction, outcome })),
    needsReview: !unchanged,
  };
}

/** Discard the trip selection and go back to the search results. */
export async function clearSelectionAction(
  _previous: ShoppingActionState,
  formData: FormData,
): Promise<ShoppingActionState> {
  const input = clearInputSchema.safeParse(fields(formData, ['query']));
  const context = input.success ? await parseContext(input.data.query) : null;
  const credentials = await readSessionCookie();
  if (credentials) {
    await retailingApi.deleteSession(credentials.id, credentials.token).catch(() => undefined);
  }
  await clearSessionCookie();
  redirect(
    (context
      ? buildResultsHref(context.search, { sort: context.state.sort })
      : '/flights') as Route,
  );
}
