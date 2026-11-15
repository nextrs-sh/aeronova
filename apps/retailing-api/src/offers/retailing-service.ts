import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createFlightSearchSchema,
  requiredDirections,
  type ApiErrorCode,
  type FlightSearch,
  type JourneyDirection,
  type OfferPriceCheckResponse,
  type OfferResponse,
  type OfferSearchQuery,
  type OfferSearchResponse,
  type OffersMeta,
  type RepriceOutcome,
  type RepriceResponse,
  type Selection,
  type SelectionStatus,
  type SelectOfferResponse,
  type ShoppingSession,
} from '@velasia/contracts';
import type { Clock } from '../clock';
import { AIRPORTS } from '../fixtures/airports';
import { FARE_FAMILIES, toPublicFareFamily } from '../fixtures/fare-families';
import { PRICING_CURRENCY } from '../pricing/pricing';
import { resolveCandidate, type Candidate } from '../search/itineraries';
import type { FlightService } from '../services/flights';
import { BoundedStore } from './bounded-store';
import {
  PRICING_VERSION,
  createOffer,
  familyEligibility,
  evaluateFamilies,
  inventoryVersionFor,
  isExpired,
  offerItinerary,
  offerStatus,
  toPublicOffer,
  type PricingContext,
  type StoredOffer,
} from './offer-engine';
import { NO_SCENARIO, type Scenario } from './scenario';

export interface RetailingConfig {
  /** How long an offer can be selected after it is created. */
  offerValidityMs: number;
  /** Requests for the same itinerary and party within this window reuse the same offers. */
  offerReuseMs: number;
  maxOffers: number;
  /** A session expires after this much inactivity… */
  sessionIdleMs: number;
  /** …and never lives longer than this. */
  sessionMaxMs: number;
  maxSessions: number;
}

export const DEFAULT_RETAILING_CONFIG: RetailingConfig = {
  offerValidityMs: 15 * 60_000,
  offerReuseMs: 60_000,
  maxOffers: 20_000,
  sessionIdleMs: 30 * 60_000,
  sessionMaxMs: 3 * 60 * 60_000,
  maxSessions: 5_000,
};

/** Minimum time between the outbound landing and the inbound departing (as in search). */
const MIN_STAY_MS = 120 * 60_000;
/** Expired sessions and offers are remembered this long so callers get "expired", not "unknown". */
const EXPIRED_GRACE_MS = 30 * 60_000;

export type RetailingFailure = {
  ok: false;
  status: 400 | 404 | 409 | 410 | 422;
  code: ApiErrorCode;
  message: string;
  path?: string;
};
export type RetailingResult<T> = { ok: true; value: T } | RetailingFailure;

const fail = (
  status: RetailingFailure['status'],
  code: ApiErrorCode,
  message: string,
  path?: string,
): RetailingFailure => ({ ok: false, status, code, message, path });

interface StoredSelection {
  direction: JourneyDirection;
  offer: StoredOffer;
  /** Stored status; `EXPIRED` is derived when the offer's validity has passed. */
  status: Exclude<SelectionStatus, 'EXPIRED'>;
  selectedAt: number;
  validatedAt: number | null;
  previous: Selection['previous'];
  pendingOffer: StoredOffer | null;
  lastCheck: {
    outcome: RepriceOutcome;
    at: number;
    previousTotalMinor: number;
    currentTotalMinor: number | null;
  } | null;
}

interface StoredSession {
  id: string;
  tokenHash: Buffer;
  search: FlightSearch;
  selections: { outbound: StoredSelection | null; inbound: StoredSelection | null };
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  version: number;
}

const KNOWN_AIRPORTS: ReadonlySet<string> = new Set(AIRPORTS.map((airport) => airport.code));
const hashToken = (token: string) => createHash('sha256').update(token).digest();
const iso = (ms: number) => new Date(ms).toISOString();

export type RetailingService = ReturnType<typeof createRetailingService>;

/**
 * Offers and shopping sessions. Every method is synchronous: a session is read, checked, and
 * written without yielding to the event loop, so concurrent requests can't interleave inside
 * an update. (Durable, multi-instance storage arrives with TalaDB in a later milestone.)
 */
export function createRetailingService({
  flights,
  clock,
  config = DEFAULT_RETAILING_CONFIG,
}: {
  flights: FlightService;
  clock: Clock;
  config?: RetailingConfig;
}) {
  const offers = new BoundedStore<StoredOffer>({
    maxEntries: config.maxOffers,
    graceMs: EXPIRED_GRACE_MS,
    expiresAt: (offer) => offer.expiresAt,
  });
  /** Offer ids by itinerary and party, for reuse within `offerReuseMs`. */
  const recent = new BoundedStore<{ ids: string[]; createdAt: number }>({
    maxEntries: config.maxOffers,
    graceMs: 0,
    expiresAt: (entry) => entry.createdAt + config.offerReuseMs,
  });
  const sessions = new BoundedStore<StoredSession>({
    maxEntries: config.maxSessions,
    graceMs: EXPIRED_GRACE_MS,
    expiresAt: (session) => session.expiresAt,
  });

  function context(scenario: Scenario = NO_SCENARIO): PricingContext {
    const inventory = flights.current();
    return {
      now: clock.now() + scenario.clockOffsetMs,
      inventoryVersion: inventoryVersionFor(inventory.referenceDate),
      demandShift: scenario.demandShift,
      soldOut: scenario.soldOut,
    };
  }

  function meta(ctx: PricingContext): OffersMeta {
    return {
      currency: PRICING_CURRENCY,
      referenceDate: flights.current().referenceDate,
      inventoryVersion: ctx.inventoryVersion,
      pricingVersion: PRICING_VERSION,
      offerValiditySeconds: Math.round(config.offerValidityMs / 1000),
      serverTime: iso(ctx.now),
    };
  }

  const candidateFor = (itineraryId: string): Candidate | null =>
    resolveCandidate(flights.current(), itineraryId);

  function storeOffer(offer: StoredOffer, now: number) {
    offers.set(offer.id, offer, now);
    return offer;
  }

  // -------------------------------------------------------------------------
  // Sessions: internal helpers
  // -------------------------------------------------------------------------

  function selectionStatus(selection: StoredSelection, ctx: PricingContext): SelectionStatus {
    if (
      (selection.status === 'SELECTED' || selection.status === 'VALIDATED') &&
      isExpired(selection.offer, ctx)
    ) {
      return 'EXPIRED';
    }
    return selection.status;
  }

  function toPublicSession(session: StoredSession, ctx: PricingContext): ShoppingSession {
    const view = (selection: StoredSelection | null): Selection | null => {
      if (!selection) return null;
      const candidate = candidateFor(selection.offer.itineraryId);
      return {
        direction: selection.direction,
        status: selectionStatus(selection, ctx),
        offer: toPublicOffer(selection.offer, offerStatus(selection.offer, candidate, ctx)),
        selectedAt: iso(selection.selectedAt),
        validatedAt: selection.validatedAt === null ? null : iso(selection.validatedAt),
        previous: selection.previous,
        pendingOffer: selection.pendingOffer
          ? toPublicOffer(
              selection.pendingOffer,
              offerStatus(selection.pendingOffer, candidate, ctx),
            )
          : null,
        lastCheck: selection.lastCheck
          ? { ...selection.lastCheck, at: iso(selection.lastCheck.at) }
          : null,
      };
    };
    const outbound = view(session.selections.outbound);
    const inbound = view(session.selections.inbound);
    const required = requiredDirections(session.search).map((direction) =>
      direction === 'outbound' ? outbound : inbound,
    );
    const chosen = [outbound, inbound].filter((selection) => selection !== null);
    const sum = (pick: (selection: Selection) => number) =>
      chosen.reduce((total, selection) => total + pick(selection), 0);
    const complete = required.every((selection) => selection !== null);
    return {
      id: session.id,
      search: session.search,
      selections: { outbound, inbound },
      summary: {
        currency: PRICING_CURRENCY,
        complete,
        readyToContinue:
          complete && required.every((selection) => selection!.status === 'VALIDATED'),
        totalMinor: sum((selection) => selection.offer.price.totalMinor),
        totals: {
          baseFareMinor: sum((selection) => selection.offer.price.totals.baseFareMinor),
          fareFamilyMinor: sum((selection) => selection.offer.price.totals.fareFamilyMinor),
          taxesMinor: sum((selection) => selection.offer.price.totals.taxesMinor),
        },
        offersExpireAt:
          chosen.length > 0
            ? iso(Math.min(...chosen.map((selection) => Date.parse(selection.offer.expiresAt))))
            : null,
      },
      createdAt: iso(session.createdAt),
      updatedAt: iso(session.updatedAt),
      expiresAt: iso(session.expiresAt),
      version: session.version,
      serverTime: iso(ctx.now),
    };
  }

  /** Find a session by id and token. A wrong token looks exactly like an unknown id. */
  function authorize(
    id: string,
    token: string | undefined,
    ctx: PricingContext,
  ): RetailingResult<StoredSession> {
    const session = sessions.get(id);
    const provided = token ? hashToken(token) : null;
    if (!session || !provided || !timingSafeEqual(provided, session.tokenHash)) {
      return fail(404, 'SESSION_NOT_FOUND', 'This shopping session doesn’t exist.');
    }
    if (ctx.now >= session.expiresAt) {
      return fail(410, 'SESSION_EXPIRED', 'This shopping session has expired.');
    }
    return { ok: true, value: session };
  }

  function touch(session: StoredSession, now: number) {
    session.updatedAt = now;
    session.expiresAt = Math.min(
      session.createdAt + config.sessionMaxMs,
      now + config.sessionIdleMs,
    );
    session.version += 1;
    sessions.set(session.id, session, now);
  }

  /** Why an offer can't be chosen for this direction of this session, or `null`. */
  function selectionProblem(
    session: StoredSession,
    direction: JourneyDirection,
    offer: StoredOffer,
  ): string | null {
    const { search } = session;
    if (direction === 'inbound' && search.tripType !== 'round-trip') {
      return 'This trip is one-way, so it has no return flight.';
    }
    const expected =
      direction === 'outbound'
        ? { origin: search.origin, destination: search.destination, date: search.departDate }
        : { origin: search.destination, destination: search.origin, date: search.returnDate };
    const { itinerary } = offer;
    if (
      itinerary.origin !== expected.origin ||
      itinerary.destination !== expected.destination ||
      itinerary.departure.date !== expected.date
    ) {
      return `This offer is for a different ${direction === 'outbound' ? 'departing' : 'return'} route or date.`;
    }
    const p = offer.passengers;
    const q = search.passengers;
    if (p.adults !== q.adults || p.children !== q.children || p.infants !== q.infants) {
      return 'This offer was priced for a different number of travellers.';
    }
    if (direction === 'inbound' && session.selections.outbound) {
      const landed = Date.parse(session.selections.outbound.offer.itinerary.arrival.at);
      if (Date.parse(itinerary.departure.at) < landed + MIN_STAY_MS) {
        return 'Your return flight must leave at least 2 hours after your departing flight lands.';
      }
    }
    return null;
  }

  return {
    config,

    // -----------------------------------------------------------------------
    // Fare families and offers
    // -----------------------------------------------------------------------

    fareFamilies() {
      return FARE_FAMILIES.map(toPublicFareFamily);
    },

    searchOffers(
      query: OfferSearchQuery,
      scenario?: Scenario,
    ): RetailingResult<OfferSearchResponse> {
      const ctx = context(scenario);
      const candidate = candidateFor(query.itineraryId);
      if (!candidate) {
        return fail(404, 'NOT_FOUND', `No flight or itinerary found for "${query.itineraryId}".`);
      }
      const { adults, children, infants } = query.passengers;
      const key = [
        query.itineraryId,
        adults,
        children,
        infants,
        ctx.inventoryVersion,
        ctx.demandShift,
      ].join('|');
      const reused = recent.get(key);
      const reusable =
        reused && ctx.now - reused.createdAt < config.offerReuseMs && !ctx.soldOut
          ? reused.ids.map((id) => offers.get(id))
          : null;

      const families = evaluateFamilies(candidate, query.passengers, ctx);
      let stored: StoredOffer[];
      if (
        reusable &&
        reusable.every(Boolean) &&
        reusable.map((offer) => offer!.family.code).join() ===
          families.eligible.map((family) => family.code).join()
      ) {
        // Same itinerary and party moments ago: hand back the same offers, not new ids.
        stored = reusable as StoredOffer[];
      } else {
        stored = families.eligible.map((family) =>
          storeOffer(
            createOffer(candidate, family, query.passengers, ctx, config.offerValidityMs),
            ctx.now,
          ),
        );
        recent.set(key, { ids: stored.map((offer) => offer.id), createdAt: ctx.now }, ctx.now);
      }
      return {
        ok: true,
        value: {
          data: {
            itineraryId: candidate.id,
            // Every aircraft has an Economy cabin, so the itinerary can always be described.
            itinerary:
              stored[0]?.itinerary ?? offerItinerary(candidate, 'economy', query.passengers),
            availability: families.availability,
            offers: stored.map((offer) => toPublicOffer(offer, 'AVAILABLE')),
            unavailable: families.unavailable.map(({ family, reason, message }) => ({
              family: family.code,
              reason,
              message,
            })),
          },
          meta: meta(ctx),
        },
      };
    },

    getOffer(id: string, scenario?: Scenario): RetailingResult<OfferResponse> {
      const ctx = context(scenario);
      const offer = offers.get(id);
      if (!offer) return fail(404, 'OFFER_NOT_FOUND', 'This offer doesn’t exist.');
      const status = offerStatus(offer, candidateFor(offer.itineraryId), ctx);
      return { ok: true, value: { data: toPublicOffer(offer, status), meta: meta(ctx) } };
    },

    /** The offer's price against current inventory and rules. Creates nothing. */
    checkOfferPrice(id: string, scenario?: Scenario): RetailingResult<OfferPriceCheckResponse> {
      const ctx = context(scenario);
      const offer = offers.get(id);
      if (!offer) return fail(404, 'OFFER_NOT_FOUND', 'This offer doesn’t exist.');
      const candidate = candidateFor(offer.itineraryId);
      const status = offerStatus(offer, candidate, ctx);
      const sellable =
        candidate !== null && familyEligibility(candidate, offer.family, offer.passengers, ctx).ok;
      const current = sellable
        ? createOffer(candidate, offer.family, offer.passengers, ctx, config.offerValidityMs).price
            .totalMinor
        : null;
      return {
        ok: true,
        value: {
          data: {
            offerId: offer.id,
            status,
            currency: offer.price.currency,
            offerTotalMinor: offer.price.totalMinor,
            currentTotalMinor: current,
            priceChanged: current !== null && current !== offer.price.totalMinor,
          },
          meta: meta(ctx),
        },
      };
    },

    // -----------------------------------------------------------------------
    // Shopping sessions
    // -----------------------------------------------------------------------

    createSession(
      search: FlightSearch,
      scenario?: Scenario,
    ): RetailingResult<{ session: ShoppingSession; token: string }> {
      const ctx = context(scenario);
      const parsed = createFlightSearchSchema({
        today: flights.current().referenceDate,
        knownAirportCodes: KNOWN_AIRPORTS,
      }).safeParse({ ...search, returnDate: search.returnDate ?? '' });
      if (!parsed.success) {
        const first = parsed.error.issues[0]!;
        return fail(400, 'BAD_REQUEST', first.message, `search.${first.path.join('.')}`);
      }
      const token = randomBytes(32).toString('base64url');
      const session: StoredSession = {
        id: `ses_${randomBytes(16).toString('base64url')}`,
        tokenHash: hashToken(token),
        search: parsed.data,
        selections: { outbound: null, inbound: null },
        createdAt: ctx.now,
        updatedAt: ctx.now,
        expiresAt: ctx.now + config.sessionIdleMs,
        version: 0,
      };
      sessions.set(session.id, session, ctx.now);
      return { ok: true, value: { session: toPublicSession(session, ctx), token } };
    },

    getSession(id: string, token: string | undefined, scenario?: Scenario) {
      const ctx = context(scenario);
      const found = authorize(id, token, ctx);
      if (!found.ok) return found;
      return { ok: true, value: toPublicSession(found.value, ctx) } as const;
    },

    select(
      id: string,
      token: string | undefined,
      request: { direction: JourneyDirection; offerId: string },
      scenario?: Scenario,
    ): RetailingResult<SelectOfferResponse['data']> {
      const ctx = context(scenario);
      const found = authorize(id, token, ctx);
      if (!found.ok) return found;
      const session = found.value;
      const offer = offers.get(request.offerId);
      if (!offer) return fail(404, 'OFFER_NOT_FOUND', 'This offer doesn’t exist.', 'offerId');

      const problem = selectionProblem(session, request.direction, offer);
      if (problem) return fail(422, 'INVALID_SELECTION', problem, 'offerId');
      if (isExpired(offer, ctx)) {
        return fail(410, 'OFFER_EXPIRED', 'This offer has expired. Please check the latest price.');
      }
      const candidate = candidateFor(offer.itineraryId);
      const eligibility = candidate
        ? familyEligibility(candidate, offer.family, offer.passengers, ctx)
        : ({ ok: false, message: 'This flight no longer exists.' } as const);
      if (!eligibility.ok) return fail(409, 'OFFER_UNAVAILABLE', eligibility.message);

      const existing = session.selections[request.direction];
      if (existing?.offer.id === offer.id) {
        return {
          ok: true,
          value: { session: toPublicSession(session, ctx), inboundCleared: false },
        };
      }
      // Accepting a changed price: the pending offer was priced by the last check.
      const accepting = existing?.pendingOffer?.id === offer.id;
      session.selections[request.direction] = {
        direction: request.direction,
        offer,
        status: accepting ? 'VALIDATED' : 'SELECTED',
        selectedAt: ctx.now,
        validatedAt: accepting ? ctx.now : null,
        previous: existing
          ? {
              family: existing.offer.family.code,
              itineraryId: existing.offer.itineraryId,
              totalMinor: existing.offer.price.totalMinor,
            }
          : null,
        pendingOffer: null,
        lastCheck: null,
      };

      // A new departing flight may no longer leave time for the chosen return.
      let inboundCleared = false;
      const inbound = session.selections.inbound;
      if (
        request.direction === 'outbound' &&
        inbound &&
        Date.parse(inbound.offer.itinerary.departure.at) <
          Date.parse(offer.itinerary.arrival.at) + MIN_STAY_MS
      ) {
        session.selections.inbound = null;
        inboundCleared = true;
      }
      touch(session, ctx.now);
      return { ok: true, value: { session: toPublicSession(session, ctx), inboundCleared } };
    },

    /**
     * Re-validate selections against current inventory and rules. A valid offer keeps its price
     * until it expires; an expired one is replaced by a fresh offer, and a different price is
     * never applied without the traveller accepting it.
     */
    reprice(
      id: string,
      token: string | undefined,
      directions: JourneyDirection[] | undefined,
      scenario?: Scenario,
    ): RetailingResult<RepriceResponse['data']> {
      const ctx = context(scenario);
      const found = authorize(id, token, ctx);
      if (!found.ok) return found;
      const session = found.value;
      const outcomes: RepriceResponse['data']['outcomes'] = [];

      for (const direction of directions ?? (['outbound', 'inbound'] as const)) {
        const selection = session.selections[direction];
        if (!selection) continue;
        const previousTotalMinor = selection.offer.price.totalMinor;
        const record = (outcome: RepriceOutcome, currentTotalMinor: number | null) => {
          selection.lastCheck = { outcome, at: ctx.now, previousTotalMinor, currentTotalMinor };
          outcomes.push({ direction, outcome, previousTotalMinor, currentTotalMinor });
        };

        const candidate = candidateFor(selection.offer.itineraryId);
        const eligibility = candidate
          ? familyEligibility(candidate, selection.offer.family, selection.offer.passengers, ctx)
          : { ok: false as const };
        if (!candidate || !eligibility.ok) {
          selection.status = 'UNAVAILABLE';
          selection.pendingOffer = null;
          record('UNAVAILABLE', null);
          continue;
        }
        if (!isExpired(selection.offer, ctx)) {
          selection.status = 'VALIDATED';
          selection.validatedAt = ctx.now;
          selection.pendingOffer = null;
          record('VALIDATED', previousTotalMinor);
          continue;
        }
        // A price change already waiting for an answer stays as it is while it is valid.
        if (selection.pendingOffer && !isExpired(selection.pendingOffer, ctx)) {
          record('PRICE_CHANGED', selection.pendingOffer.price.totalMinor);
          continue;
        }
        const fresh = storeOffer(
          createOffer(
            candidate,
            selection.offer.family,
            selection.offer.passengers,
            ctx,
            config.offerValidityMs,
          ),
          ctx.now,
        );
        if (fresh.price.totalMinor === previousTotalMinor) {
          selection.offer = fresh;
          selection.status = 'VALIDATED';
          selection.validatedAt = ctx.now;
          selection.pendingOffer = null;
          record('REFRESHED', fresh.price.totalMinor);
        } else {
          selection.status = 'PRICE_CHANGED';
          selection.pendingOffer = fresh;
          record('PRICE_CHANGED', fresh.price.totalMinor);
        }
      }
      touch(session, ctx.now);
      return { ok: true, value: { session: toPublicSession(session, ctx), outcomes } };
    },

    deleteSession(id: string, token: string | undefined): RetailingResult<null> {
      const session = sessions.get(id);
      const provided = token ? hashToken(token) : null;
      if (!session || !provided || !timingSafeEqual(provided, session.tokenHash)) {
        return fail(404, 'SESSION_NOT_FOUND', 'This shopping session doesn’t exist.');
      }
      sessions.delete(id);
      return { ok: true, value: null };
    },

    /** For tests and diagnostics: how much is held in memory. */
    stats() {
      return { offers: offers.size, sessions: sessions.size };
    },
  };
}
