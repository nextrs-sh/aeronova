import { offerSearchQuerySchema, type OfferSearchResponse } from '@velasia/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { LIVE_CACHE_CONTROL, jsonError, toIssues, upstreamErrorResponse } from '@/lib/api-response';
import { retailingApi } from '@/lib/retailing-api/client';

/**
 * Live offers for one itinerary (`itineraryId`, `adults`, `children`, `infants`, `cabin`).
 * The query is validated and rebuilt; prices come from the retailing API unchanged.
 */
export async function GET(request: NextRequest) {
  const query = offerSearchQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return jsonError(
      400,
      'BAD_REQUEST',
      'Check the flight and passengers.',
      toIssues(query.error.issues),
    );
  }
  try {
    const body: OfferSearchResponse = await retailingApi.searchOffers(query.data);
    return NextResponse.json(body, { headers: { 'Cache-Control': LIVE_CACHE_CONTROL } });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/offers', 'Offers');
  }
}
