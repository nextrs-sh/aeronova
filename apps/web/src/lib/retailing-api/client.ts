import 'server-only';
import {
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
  type Aircraft,
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
} from '@aeronova/contracts';
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
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

interface RequestOptions {
  /** Resolve `null` for 404 (and 400, which can never match a resource). */
  allowNotFound?: boolean;
  /** Forward test fault-injection hints. Only for uncached, request-time calls. */
  live?: boolean;
}

async function getJson<T extends z.ZodType>(
  path: string,
  schema: T,
  { allowNotFound = false, live = false }: RequestOptions = {},
): Promise<z.output<T> | null> {
  const env = getServerEnv();
  const url = new URL(path, env.RETAILING_API_URL);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', ...(live ? await faultHeaders() : {}) },
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
  if (!response.ok) {
    const body = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    if (response.status === 404) {
      throw new RetailingApiError(`Not found: ${url.pathname}`, 'not-found', 404);
    }
    if (response.status < 500 && body.success) {
      throw new RetailingApiError(
        body.data.error.message,
        'rejected',
        response.status,
        body.data.error.issues,
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
};
