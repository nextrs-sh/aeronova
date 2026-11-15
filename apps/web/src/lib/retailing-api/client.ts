import 'server-only';
import {
  checkoutValidateResponseSchema,
  orderResponseSchema,
  paymentOptionsResponseSchema,
  paymentResultResponseSchema,
  prepareCheckoutResponseSchema,
  type CheckoutValidation,
  type CreatePaymentAttemptRequest,
  type Order,
  type PaymentOptions,
  type PaymentResult,
  type PrepareCheckoutRequest,
  type PrepareCheckoutResponse,
  ancillaryCatalogueResponseSchema,
  reviewResponseSchema,
  seatMapResponseSchema,
  sessionAncillariesResponseSchema,
  sessionSeatMapResponseSchema,
  validateBookingResponseSchema,
  type AncillaryCatalogueResponse,
  type AncillaryChange,
  type CompleteStepRequest,
  type ReviewResponse,
  type SavePassengersRequest,
  type SeatMapResponse,
  type SessionAncillaries,
  type SessionSeatMapResponse,
  type UpdateSeatsRequest,
  type ValidateBookingResponse,
  createSessionResponseSchema,
  fareFamiliesResponseSchema,
  offerPriceCheckResponseSchema,
  offerResponseSchema,
  offerSearchQueryToParams,
  offerSearchResponseSchema,
  repriceResponseSchema,
  selectOfferResponseSchema,
  shoppingSessionResponseSchema,
  aircraftListResponseSchema,
  airportListResponseSchema,
  apiErrorSchema,
  availabilityResponseSchema,
  destinationListResponseSchema,
  destinationResponseSchema,
  fareCalendarQueryToParams,
  fareCalendarResponseSchema,
  flightSearchQueryToParams,
  flightSearchResponseSchema,
  itineraryQueryToParams,
  itineraryResponseSchema,
  routeListResponseSchema,
  type CreateSessionResponse,
  type FareFamiliesResponse,
  type FlightSearch,
  type JourneyDirection,
  type OfferPriceCheckResponse,
  type OfferResponse,
  type OfferSearchQuery,
  type OfferSearchResponse,
  type RepriceResponse,
  type SelectOfferResponse,
  type ShoppingSession,
  type Aircraft,
  type ApiErrorCode,
  type Airport,
  type ApiErrorIssue,
  type AvailabilityResponse,
  type Destination,
  type DestinationListQuery,
  type FareCalendarQuery,
  type FareCalendarResponse,
  type FlightSearchQuery,
  type FlightSearchResponse,
  type ItineraryQuery,
  type ItineraryResponse,
  type NetworkRoute,
  type RouteListQuery,
} from '@velasia/contracts';
import type { z } from 'zod';
import { getServerEnv } from '../env';
import { faultHeaders } from './faults';

export type RetailingApiErrorKind =
  /** Unreachable, or answered 5xx. */
  | 'unavailable'
  /** Did not answer within the time budget. */
  | 'timeout'
  /** Answered with a body that breaks the contract. */
  | 'bad-response'
  /** Rejected the request (4xx other than 404). */
  | 'rejected'
  | 'not-found';

/** The retailing API could not be reached, timed out, or returned something unusable. */
export class RetailingApiError extends Error {
  override readonly name = 'RetailingApiError';
  constructor(
    message: string,
    readonly kind: RetailingApiErrorKind,
    readonly status?: number,
    /** For `rejected`: the API's own (safe, user-facing) validation messages. */
    readonly issues?: ApiErrorIssue[],
    options?: ErrorOptions & {
      /** The API's own error code, e.g. `OFFER_EXPIRED`, when it answered with one. */
      code?: ApiErrorCode;
    },
  ) {
    super(message, options);
    this.code = options?.code;
  }

  readonly code?: ApiErrorCode;
}

interface RequestOptions {
  /** Resolve `null` for 404 (and 400, which can never match a resource). */
  allowNotFound?: boolean;
  /** Forward test fault-injection hints. Only for uncached, request-time calls. */
  live?: boolean;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** JSON request body. */
  body?: unknown;
  /** Shopping session token or guest token, sent as a bearer token. */
  token?: string;
  /** Guest token for checkout, sent as `x-velasia-guest`. */
  guest?: string;
  /** Milestone 6: the account session token, sent as `x-velasia-account`. */
  account?: string;
  /** Milestone 6: an opaque per-browser key for the API's rate limits (`x-velasia-client`). */
  client?: string;
}

export async function getJson<T extends z.ZodType>(
  path: string,
  schema: T,
  {
    allowNotFound = false,
    live = false,
    method = 'GET',
    body,
    token,
    guest,
    account,
    client,
  }: RequestOptions = {},
): Promise<z.output<T> | null> {
  const env = getServerEnv();
  const url = new URL(path, env.RETAILING_API_URL);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(guest ? { 'x-velasia-guest': guest } : {}),
        ...(account ? { 'x-velasia-account': account } : {}),
        ...(client ? { 'x-velasia-client': client } : {}),
        ...(live ? await faultHeaders() : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // Live inventory must never be served from a cache.
      cache: 'no-store',
      signal: AbortSignal.timeout(env.RETAILING_API_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    throw new RetailingApiError(
      timedOut
        ? `Retailing API timed out after ${env.RETAILING_API_TIMEOUT_MS} ms for ${url.pathname}`
        : `Retailing API unreachable at ${url.origin}`,
      timedOut ? 'timeout' : 'unavailable',
      undefined,
      undefined,
      { cause },
    );
  }

  if (allowNotFound && (response.status === 404 || response.status === 400)) return null;
  if (response.status === 204) return null;
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    const code = error.success ? error.data.error.code : undefined;
    if (response.status === 404) {
      // Never echo the path: it can carry a session id.
      throw new RetailingApiError('Not found', 'not-found', 404, undefined, { code });
    }
    if (response.status < 500 && error.success) {
      throw new RetailingApiError(
        error.data.error.message,
        'rejected',
        response.status,
        error.data.error.issues,
        { code },
      );
    }
    throw new RetailingApiError(
      `Retailing API responded ${response.status} for ${url.pathname}`,
      'unavailable',
      response.status,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    throw new RetailingApiError(
      `Invalid JSON from ${url.pathname}`,
      'bad-response',
      response.status,
      undefined,
      { cause },
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new RetailingApiError(`Unexpected response shape from ${url.pathname}`, 'bad-response');
  }
  return parsed.data;
}

const withQuery = (path: string, params: URLSearchParams) =>
  params.size > 0 ? `${path}?${params}` : path;

/**
 * Server-side client for the retailing API. Responses are validated against
 * the shared contracts, so callers receive domain types, not raw upstream bodies.
 * Server Components call this directly; the browser goes through `/api/*`.
 */
export const retailingApi = {
  async listAirports(query?: string): Promise<Airport[]> {
    const params = new URLSearchParams(query ? { q: query } : {});
    const body = await getJson(withQuery('/v1/airports', params), airportListResponseSchema);
    return body!.data;
  },

  async listDestinations(filter: DestinationListQuery = {}): Promise<Destination[]> {
    const params = new URLSearchParams();
    if (filter.featured !== undefined) params.set('featured', String(filter.featured));
    if (filter.region) params.set('region', filter.region);
    const body = await getJson(
      withQuery('/v1/destinations', params),
      destinationListResponseSchema,
    );
    return body!.data;
  },

  /** Resolves `null` when the destination does not exist. */
  async getDestination(slug: string): Promise<Destination | null> {
    const body = await getJson(
      `/v1/destinations/${encodeURIComponent(slug)}`,
      destinationResponseSchema,
      { allowNotFound: true },
    );
    return body?.data ?? null;
  },

  async listRoutes(filter: RouteListQuery = {}): Promise<NetworkRoute[]> {
    const params = new URLSearchParams();
    if (filter.from) params.set('from', filter.from);
    if (filter.to) params.set('to', filter.to);
    const body = await getJson(withQuery('/v1/routes', params), routeListResponseSchema);
    return body!.data;
  },

  async listAircraft(): Promise<Aircraft[]> {
    const body = await getJson('/v1/aircraft', aircraftListResponseSchema);
    return body!.data;
  },

  /** Live search. Never cached. */
  async searchFlights(query: FlightSearchQuery): Promise<FlightSearchResponse> {
    const path = withQuery('/v1/flights', flightSearchQueryToParams(query));
    return (await getJson(path, flightSearchResponseSchema, { live: true }))!;
  },

  /** Resolves `null` when the itinerary does not exist. */
  async getItinerary(id: string, query: ItineraryQuery): Promise<ItineraryResponse | null> {
    const path = withQuery(`/v1/flights/${encodeURIComponent(id)}`, itineraryQueryToParams(query));
    try {
      return await getJson(path, itineraryResponseSchema, { live: true });
    } catch (error) {
      if (error instanceof RetailingApiError && error.kind === 'not-found') return null;
      throw error;
    }
  },

  /** Resolves `null` when the itinerary does not exist. */
  async getAvailability(id: string): Promise<AvailabilityResponse | null> {
    return getJson(
      `/v1/flights/${encodeURIComponent(id)}/availability`,
      availabilityResponseSchema,
      {
        allowNotFound: true,
        live: true,
      },
    );
  },

  async getFareCalendar(query: FareCalendarQuery): Promise<FareCalendarResponse> {
    const path = withQuery('/v1/flights/calendar', fareCalendarQueryToParams(query));
    return (await getJson(path, fareCalendarResponseSchema, { live: true }))!;
  },

  // -------------------------------------------------------------------------
  // Offers (live, never cached)
  // -------------------------------------------------------------------------

  async getFareFamilies(): Promise<FareFamiliesResponse> {
    return (await getJson('/v1/fare-families', fareFamiliesResponseSchema))!;
  },

  /** Priced offers for one itinerary. Throws `not-found` when the itinerary doesn't exist. */
  async searchOffers(query: OfferSearchQuery): Promise<OfferSearchResponse> {
    const path = withQuery('/v1/offers', offerSearchQueryToParams(query));
    return (await getJson(path, offerSearchResponseSchema, { live: true }))!;
  },

  async getOffer(offerId: string): Promise<OfferResponse> {
    const path = `/v1/offers/${encodeURIComponent(offerId)}`;
    return (await getJson(path, offerResponseSchema, { live: true }))!;
  },

  async checkOfferPrice(offerId: string): Promise<OfferPriceCheckResponse> {
    const path = `/v1/offers/${encodeURIComponent(offerId)}/price`;
    return (await getJson(path, offerPriceCheckResponseSchema, { live: true }))!;
  },

  // -------------------------------------------------------------------------
  // Shopping sessions. Callers pass the session's secret token; it comes from an
  // HTTP-only cookie and never from the browser.
  // -------------------------------------------------------------------------

  async createSession(search: FlightSearch): Promise<CreateSessionResponse['data']> {
    const body = await getJson('/v1/shopping-sessions', createSessionResponseSchema, {
      method: 'POST',
      body: { search },
      live: true,
    });
    return body!.data;
  },

  async getSession(id: string, token: string): Promise<ShoppingSession> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}`;
    return (await getJson(path, shoppingSessionResponseSchema, { token, live: true }))!.data;
  },

  async selectOffer(
    id: string,
    token: string,
    request: { direction: JourneyDirection; offerId: string },
  ): Promise<SelectOfferResponse['data']> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/select`;
    const body = await getJson(path, selectOfferResponseSchema, {
      method: 'POST',
      body: request,
      token,
      live: true,
    });
    return body!.data;
  },

  async repriceSession(id: string, token: string): Promise<RepriceResponse['data']> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/reprice`;
    const body = await getJson(path, repriceResponseSchema, {
      method: 'POST',
      body: {},
      token,
      live: true,
    });
    return body!.data;
  },

  async deleteSession(id: string, token: string): Promise<void> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}`;
    await getJson(path, shoppingSessionResponseSchema, { method: 'DELETE', token, live: true });
  },

  // -------------------------------------------------------------------------
  // Booking steps (Milestone 4). Public reads need no token; everything else is private to
  // the session and never cached.
  // -------------------------------------------------------------------------

  async getAncillaryCatalogue(): Promise<AncillaryCatalogueResponse> {
    return (await getJson('/v1/ancillaries', ancillaryCatalogueResponseSchema))!;
  },

  /** Public layout and availability. Throws `not-found` for an unknown flight. */
  async getSeatMap(flightId: string): Promise<SeatMapResponse> {
    const path = `/v1/flights/${encodeURIComponent(flightId)}/seatmap`;
    return (await getJson(path, seatMapResponseSchema, { live: true }))!;
  },

  async getSessionSeatMap(
    id: string,
    token: string,
    flightId: string,
  ): Promise<SessionSeatMapResponse['data']> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/seatmaps/${encodeURIComponent(flightId)}`;
    return (await getJson(path, sessionSeatMapResponseSchema, { token, live: true }))!.data;
  },

  async getSessionAncillaries(id: string, token: string): Promise<SessionAncillaries> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/ancillaries`;
    return (await getJson(path, sessionAncillariesResponseSchema, { token, live: true }))!.data;
  },

  async getReview(id: string, token: string): Promise<ReviewResponse['data']> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/review`;
    return (await getJson(path, reviewResponseSchema, { token, live: true }))!.data;
  },

  async savePassengers(
    id: string,
    token: string,
    request: SavePassengersRequest,
  ): Promise<ShoppingSession> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/passengers`;
    const body = await getJson(path, shoppingSessionResponseSchema, {
      method: 'PUT',
      body: request,
      token,
      live: true,
    });
    return body!.data;
  },

  async updateSeats(
    id: string,
    token: string,
    request: UpdateSeatsRequest,
  ): Promise<ShoppingSession> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/seats`;
    const body = await getJson(path, shoppingSessionResponseSchema, {
      method: 'PUT',
      body: request,
      token,
      live: true,
    });
    return body!.data;
  },

  async updateAncillaries(
    id: string,
    token: string,
    request: { expectedVersion?: number; changes: AncillaryChange[] },
  ): Promise<ShoppingSession> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/ancillaries`;
    const body = await getJson(path, shoppingSessionResponseSchema, {
      method: 'PUT',
      body: request,
      token,
      live: true,
    });
    return body!.data;
  },

  async completeStep(
    id: string,
    token: string,
    request: CompleteStepRequest,
  ): Promise<ShoppingSession> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/steps`;
    const body = await getJson(path, shoppingSessionResponseSchema, {
      method: 'POST',
      body: request,
      token,
      live: true,
    });
    return body!.data;
  },

  async validateBooking(
    id: string,
    token: string,
    expectedVersion?: number,
  ): Promise<ValidateBookingResponse['data']> {
    const path = `/v1/shopping-sessions/${encodeURIComponent(id)}/validate`;
    const body = await getJson(path, validateBookingResponseSchema, {
      method: 'POST',
      body: expectedVersion === undefined ? {} : { expectedVersion },
      token,
      live: true,
    });
    return body!.data;
  },

  // -------------------------------------------------------------------------
  // Checkout and orders (Milestone 5). Orders are private to the guest token.
  // -------------------------------------------------------------------------

  async getPaymentOptions(): Promise<PaymentOptions> {
    const body = await getJson('/v1/payments/options', paymentOptionsResponseSchema);
    return body!.data;
  },

  async validateCheckout(
    sessionId: string,
    sessionToken: string,
    acceptedTotalMinor?: number,
  ): Promise<CheckoutValidation> {
    const body = await getJson('/v1/checkout/validate', checkoutValidateResponseSchema, {
      method: 'POST',
      body: { sessionId, ...(acceptedTotalMinor === undefined ? {} : { acceptedTotalMinor }) },
      token: sessionToken,
      live: true,
    });
    return body!.data;
  },

  async prepareCheckout(
    request: PrepareCheckoutRequest,
    sessionToken: string,
    guestToken: string,
  ): Promise<PrepareCheckoutResponse['data']> {
    const body = await getJson('/v1/checkout/prepare', prepareCheckoutResponseSchema, {
      method: 'POST',
      body: request,
      token: sessionToken,
      guest: guestToken,
      live: true,
    });
    return body!.data;
  },

  /** The guest's order, or `null` when it doesn't exist or isn't theirs (indistinguishable). */
  async getOrder(orderId: string, guestToken: string): Promise<Order | null> {
    const body = await getJson(`/v1/orders/${encodeURIComponent(orderId)}`, orderResponseSchema, {
      token: guestToken,
      allowNotFound: true,
      live: true,
    });
    return body?.data ?? null;
  },

  async createPaymentAttempt(
    orderId: string,
    guestToken: string,
    request: CreatePaymentAttemptRequest,
  ): Promise<PaymentResult> {
    const path = `/v1/orders/${encodeURIComponent(orderId)}/payment-attempts`;
    const body = await getJson(path, paymentResultResponseSchema, {
      method: 'POST',
      body: request,
      token: guestToken,
      live: true,
    });
    return body!.data;
  },

  async getPaymentStatus(orderId: string, guestToken: string): Promise<PaymentResult> {
    const path = `/v1/orders/${encodeURIComponent(orderId)}/payment-status`;
    const body = await getJson(path, paymentResultResponseSchema, {
      token: guestToken,
      live: true,
    });
    return body!.data;
  },
};
