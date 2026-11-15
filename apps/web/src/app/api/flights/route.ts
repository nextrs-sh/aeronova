import { createFlightSearchQuerySchema, type FlightSearchResponse } from '@velasia/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { LIVE_CACHE_CONTROL, jsonError, toIssues, upstreamErrorResponse } from '@/lib/api-response';
import { getAirports, loadSection } from '@/lib/content';
import { retailingApi } from '@/lib/retailing-api/client';
import { getToday } from '@/lib/today';

/**
 * Live flight search for browser clients. Same parameters as the retailing
 * API's `GET /v1/flights` (`from`, `to`, `departureDate`, `returnDate`,
 * passengers, `cabin`, filters, `sort`, `page`, `pageSize`).
 */
export async function GET(request: NextRequest) {
  const airports = await loadSection(getAirports);
  const schema = createFlightSearchQuerySchema({
    today: getToday(),
    // If the catalogue is unavailable, the API still rejects unknown airports.
    knownAirportCodes: airports.ok ? new Set(airports.data.map((a) => a.code)) : undefined,
  });
  // The upstream request is rebuilt from parsed values; unknown parameters are dropped.
  const query = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return jsonError(
      400,
      'BAD_REQUEST',
      'Check your search and try again.',
      toIssues(query.error.issues),
    );
  }

  try {
    const body: FlightSearchResponse = await retailingApi.searchFlights(query.data);
    return NextResponse.json(body, { headers: { 'Cache-Control': LIVE_CACHE_CONTROL } });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/flights', 'Flights');
  }
}
