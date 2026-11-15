import type { ApiError, ApiErrorCode } from '@aeronova/contracts';
import { NextResponse } from 'next/server';

/** Public, non-personalised data: short browser cache, longer shared cache. */
export const PUBLIC_CACHE_CONTROL =
  'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
