import 'server-only';
import type {
  Aircraft,
  AncillaryCatalogueResponse,
  Airport,
  Destination,
  FareFamiliesResponse,
  NetworkRoute,
} from '@velasia/contracts';
import { cacheLife, cacheTag } from 'next/cache';
import { RetailingApiError, retailingApi } from './retailing-api/client';

/*
 * Cached public content for Server Components.
 *
 * `use cache` entries are prerendered at build time and revalidated in the
 * background. A failed fetch throws, so errors are never cached: a stale entry
 * keeps being served while the API is down.
 */

export async function getDestinations(): Promise<Destination[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('destinations');
  return retailingApi.listDestinations();
}

export async function getDestination(slug: string): Promise<Destination | null> {
  'use cache';
  cacheLife('hours');
  cacheTag('destinations', `destination:${slug}`);
  return retailingApi.getDestination(slug);
}

export async function getAirports(): Promise<Airport[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('airports');
  return retailingApi.listAirports();
}

/** The route network changes only with schedule releases: cache like other content. */
export async function getRoutes(): Promise<NetworkRoute[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('network');
  return retailingApi.listRoutes();
}

export async function getAircraft(): Promise<Aircraft[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('network');
  return retailingApi.listAircraft();
}

/**
 * Fare family descriptions: public product content, the same for every traveller, so it is
 * cached like the network. Prices never come from here — only from live offers.
 */
export async function getFareFamilies(): Promise<FareFamiliesResponse> {
  'use cache';
  cacheLife('hours');
  cacheTag('fare-families');
  return retailingApi.getFareFamilies();
}

/**
 * Service descriptions and list prices (bags, meals, priority): public catalogue content.
 * What a guest actually pays for their fare comes from their session, never from here.
 */
export async function getAncillaryCatalogue(): Promise<AncillaryCatalogueResponse> {
  'use cache';
  cacheLife('hours');
  cacheTag('ancillaries');
  return retailingApi.getAncillaryCatalogue();
}

export type ContentResult<T> = { ok: true; data: T } | { ok: false };

/**
 * Resolve content for an optional page section. Retailing API failures become
 * `{ ok: false }` so the section can render a fallback instead of failing the
 * whole route; anything else (including Next.js control flow) is rethrown.
 */
export async function loadSection<T>(load: () => Promise<T>): Promise<ContentResult<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    if (error instanceof RetailingApiError) {
      console.error(`[content] ${error.message}`);
      return { ok: false };
    }
    throw error;
  }
}
