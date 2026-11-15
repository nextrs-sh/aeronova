import {
  itineraryIdSchema,
  itineraryQuerySchema,
  type FlightDetailResponse,
} from '@aeronova/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { LIVE_CACHE_CONTROL, jsonError, toIssues, upstreamErrorResponse } from '@/lib/api-response';
import { retailingApi } from '@/lib/retailing-api/client';

/**
 * One itinerary priced for the party (`adults`, `children`, `infants`,
 * `cabin`), with seat availability in every cabin of each flight.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/flights/[id]'>) {
  const id = itineraryIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError(400, 'BAD_REQUEST', 'Invalid flight identifier.');
  const query = itineraryQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return jsonError(
      400,
      'BAD_REQUEST',
      'Check the passengers and cabin.',
      toIssues(query.error.issues),
    );
  }

  try {
    // Independent upstream calls, made in parallel.
    const [itinerary, availability] = await Promise.all([
      retailingApi.getItinerary(id.data, query.data),
      retailingApi.getAvailability(id.data),
    ]);
    if (!itinerary || !availability) return jsonError(404, 'NOT_FOUND', 'Flight not found.');
    const body: FlightDetailResponse = {
      data: { itinerary: itinerary.data, segments: availability.data.segments },
      meta: itinerary.meta,
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': LIVE_CACHE_CONTROL } });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/flights/[id]', 'Flight details');
  }
}
