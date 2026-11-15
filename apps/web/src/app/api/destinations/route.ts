import { destinationListQuerySchema, type DestinationListResponse } from '@aeronova/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { PUBLIC_CACHE_CONTROL, jsonError, upstreamErrorResponse } from '@/lib/api-response';
import { retailingApi } from '@/lib/retailing-api/client';

/** Destination list. Supports `?featured=true|false` and `?region=`. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = destinationListQuerySchema.safeParse({
    featured: params.get('featured') ?? undefined,
    region: params.get('region') ?? undefined,
  });
  if (!query.success) {
    return jsonError(400, 'BAD_REQUEST', 'Use featured=true|false and a known region.');
  }

  try {
    const body: DestinationListResponse = { data: await retailingApi.listDestinations(query.data) };
    return NextResponse.json(body, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/destinations', 'Destinations');
  }
}
