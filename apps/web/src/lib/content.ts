import 'server-only';
import type { Airport, Destination } from '@aeronova/contracts';
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
