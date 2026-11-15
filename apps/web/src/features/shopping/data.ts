import 'server-only';
import type { FlightSearch, OfferSearchResponse, ShoppingSession } from '@velasia/contracts';
import { cache } from 'react';
import {
  RetailingApiError,
  retailingApi,
  type RetailingApiErrorKind,
} from '@/lib/retailing-api/client';
import { readSessionCookie } from './session-cookie';

export type OffersResult =
  | { ok: true; data: OfferSearchResponse }
  /** The itinerary doesn't exist (any more). */
  | { ok: true; data: null }
  | { ok: false; error: RetailingApiErrorKind };

/** Live offers for one itinerary, for the traveller's party. Never cached. */
export async function loadOffers(itineraryId: string, search: FlightSearch): Promise<OffersResult> {
  try {
    const data = await retailingApi.searchOffers({
      itineraryId,
      passengers: search.passengers,
      cabin: search.cabin,
    });
    return { ok: true, data };
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    if (error.kind === 'not-found') return { ok: true, data: null };
    console.error(`[offers] ${itineraryId}: ${error.message}`);
    return { ok: false, error: error.kind };
  }
}

export type SessionState =
  /** No shopping cookie: nothing chosen yet. */
  | { status: 'none' }
  /** The cookie names a session the API doesn't know (cleared, restarted, or tampered with). */
  | { status: 'missing' }
  | { status: 'expired' }
  | { status: 'error'; error: RetailingApiErrorKind }
  | { status: 'active'; session: ShoppingSession };

/**
 * The guest's shopping session, read once per request (several sections may need it). It is
 * personal and live: fetched with `no-store`, outside any `use cache` scope.
 */
export const loadShoppingSession = cache(async (): Promise<SessionState> => {
  const credentials = await readSessionCookie();
  if (!credentials) return { status: 'none' };
  try {
    return {
      status: 'active',
      session: await retailingApi.getSession(credentials.id, credentials.token),
    };
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    if (error.code === 'SESSION_EXPIRED') return { status: 'expired' };
    if (error.kind === 'not-found') return { status: 'missing' };
    console.error(`[shopping] session: ${error.message}`);
    return { status: 'error', error: error.kind };
  }
});
