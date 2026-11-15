import type { ApiError, ApiErrorCode, ApiErrorIssue } from '@aeronova/contracts';
import { NextResponse } from 'next/server';
import { RetailingApiError } from './retailing-api/client';

/** Public, non-personalised data: short browser cache, longer shared cache. */
export const PUBLIC_CACHE_CONTROL =
  'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/** Live inventory and prices: never stored by browsers or shared caches. */
export const LIVE_CACHE_CONTROL = 'private, no-store';

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  issues?: ApiErrorIssue[],
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message, ...(issues?.length ? { issues } : {}) } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Map a retailing API failure to a safe storefront response. Upstream
 * validation messages are ours and user-facing, so they are forwarded;
 * hostnames, status codes, and stack traces never are.
 */
export function upstreamErrorResponse(error: unknown, label: string, what: string) {
  if (!(error instanceof RetailingApiError)) throw error;
  console.error(`[${label}] ${error.message}`);
  switch (error.kind) {
    case 'rejected':
      return jsonError(400, 'BAD_REQUEST', error.message, error.issues);
    case 'not-found':
      return jsonError(404, 'NOT_FOUND', `${what} not found.`);
    case 'timeout':
      return jsonError(504, 'UPSTREAM_TIMEOUT', `${what} took too long to load. Please try again.`);
    default:
      return jsonError(
        503,
        'UPSTREAM_UNAVAILABLE',
        `${what} are temporarily unavailable. Please try again.`,
      );
  }
}

/** Flatten Zod issues into the error envelope's `issues`. */
export function toIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): ApiErrorIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.') || 'input',
    message: issue.message,
  }));
}
