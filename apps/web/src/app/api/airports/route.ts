import { airportListQuerySchema, type AirportListResponse } from '@aeronova/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { PUBLIC_CACHE_CONTROL, jsonError } from '@/lib/api-response';
import { RetailingApiError, retailingApi } from '@/lib/retailing-api/client';

/** Airport list for browser autocomplete. `?q=` narrows and ranks results. */
export async function GET(request: NextRequest) {
  const query = airportListQuerySchema.safeParse({
    q: request.nextUrl.searchParams.get('q') ?? undefined,
  });
  if (!query.success) {
    return jsonError(400, 'BAD_REQUEST', 'The airport search query is invalid.');
  }

  try {
    const body: AirportListResponse = { data: await retailingApi.listAirports(query.data.q) };
    return NextResponse.json(body, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  } catch (error) {
    if (error instanceof RetailingApiError) {
      console.error(`[api/airports] ${error.message}`);
      return jsonError(
        503,
        'UPSTREAM_UNAVAILABLE',
        'Airports are temporarily unavailable. Please try again.',
      );
    }
    throw error;
  }
}
