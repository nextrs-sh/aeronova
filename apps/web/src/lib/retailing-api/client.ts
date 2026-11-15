import 'server-only';
import {
  airportListResponseSchema,
  destinationListResponseSchema,
  destinationResponseSchema,
  type Airport,
  type Destination,
  type DestinationListQuery,
} from '@aeronova/contracts';
import type { z } from 'zod';
import { getServerEnv } from '../env';

export type RetailingApiErrorKind = 'unavailable' | 'bad-response';

/** The retailing API could not be reached or returned something unusable. */
export class RetailingApiError extends Error {
  override readonly name = 'RetailingApiError';
  constructor(
    message: string,
    readonly kind: RetailingApiErrorKind,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const REQUEST_TIMEOUT_MS = 5_000;

async function getJson<T extends z.ZodType>(
  path: string,
  schema: T,
  { allowNotFound = false } = {},
): Promise<z.output<T> | null> {
  const url = new URL(path, getServerEnv().RETAILING_API_URL);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new RetailingApiError(
      `Retailing API unreachable at ${url.origin}`,
      'unavailable',
      undefined,
      {
        cause,
      },
    );
  }

  // A malformed identifier (400) can never match a resource, so it is a miss too.
  if (allowNotFound && (response.status === 404 || response.status === 400)) return null;
  if (!response.ok) {
    throw new RetailingApiError(
      `Retailing API responded ${response.status} for ${url.pathname}`,
      'unavailable',
      response.status,
    );
  }

  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new RetailingApiError(`Unexpected response shape from ${url.pathname}`, 'bad-response');
  }
  return parsed.data;
}

/**
 * Server-side client for the retailing API. Responses are validated against
 * the shared contracts, so callers receive domain types, not raw upstream bodies.
 */
export const retailingApi = {
  async listAirports(query?: string): Promise<Airport[]> {
    const search = query ? `?${new URLSearchParams({ q: query })}` : '';
    const body = await getJson(`/v1/airports${search}`, airportListResponseSchema);
    return body!.data;
  },

  async listDestinations(filter: DestinationListQuery = {}): Promise<Destination[]> {
    const params = new URLSearchParams();
    if (filter.featured !== undefined) params.set('featured', String(filter.featured));
    if (filter.region) params.set('region', filter.region);
    const search = params.size > 0 ? `?${params}` : '';
    const body = await getJson(`/v1/destinations${search}`, destinationListResponseSchema);
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
};
