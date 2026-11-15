import 'server-only';
import type {
  BookingStep,
  ReviewResponse,
  SessionAncillaries,
  SessionSeatMap,
  ShoppingSession,
} from '@velasia/contracts';
import type { Route } from 'next';
import { loadShoppingSession } from '@/features/shopping/data';
import { readSessionCookie } from '@/features/shopping/session-cookie';
import {
  RetailingApiError,
  retailingApi,
  type RetailingApiErrorKind,
} from '@/lib/retailing-api/client';
import { resumeTarget } from './trip';

/*
 * Server-side reads for the booking steps. Personal and live: every call is `no-store`, outside
 * any `use cache` scope, and the session comes only from the HTTP-only cookie.
 */

export type BookingState =
  | { status: 'ready'; session: ShoppingSession }
  /** The step needs an earlier one first; `resume` is where to go. */
  | { status: 'locked'; session: ShoppingSession; resume: { href: Route; label: string } }
  | { status: 'none' | 'missing' | 'expired' }
  | { status: 'error'; error: RetailingApiErrorKind };

/** The session, if this booking step may be shown now. Enforced again by the API on every change. */
export async function loadBookingStep(step: BookingStep): Promise<BookingState> {
  const state = await loadShoppingSession();
  if (state.status !== 'active') return state;
  const { session } = state;
  if (session.booking.steps[step] === 'locked') {
    return { status: 'locked', session, resume: resumeTarget(session) };
  }
  return { status: 'ready', session };
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: RetailingApiErrorKind };

async function withCredentials<T>(
  label: string,
  load: (id: string, token: string) => Promise<T>,
): Promise<Loaded<T>> {
  const credentials = await readSessionCookie();
  if (!credentials) return { ok: false, error: 'not-found' };
  try {
    return { ok: true, data: await load(credentials.id, credentials.token) };
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    // Messages never contain personal details or the session's token.
    console.error(`[booking] ${label}: ${error.kind}`);
    return { ok: false, error: error.kind };
  }
}

export function loadSeatMap(flightId: string): Promise<Loaded<SessionSeatMap>> {
  return withCredentials('seat map', (id, token) =>
    retailingApi.getSessionSeatMap(id, token, flightId),
  );
}

export function loadAncillaries(): Promise<Loaded<SessionAncillaries>> {
  return withCredentials('extras', (id, token) => retailingApi.getSessionAncillaries(id, token));
}

export function loadReview(): Promise<Loaded<ReviewResponse['data']>> {
  return withCredentials('review', (id, token) => retailingApi.getReview(id, token));
}
