import { offerIdSchema, type OfferResponse } from '@velasia/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { LIVE_CACHE_CONTROL, jsonError, upstreamErrorResponse } from '@/lib/api-response';
import { retailingApi } from '@/lib/retailing-api/client';

/** One offer with its current status (`AVAILABLE`, `EXPIRED`, or `UNAVAILABLE`). */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<'/api/offers/[offerId]'>,
) {
  const offerId = offerIdSchema.safeParse((await params).offerId);
  if (!offerId.success) return jsonError(400, 'BAD_REQUEST', 'Invalid offer identifier.');
  try {
    const body: OfferResponse = await retailingApi.getOffer(offerId.data);
    return NextResponse.json(body, { headers: { 'Cache-Control': LIVE_CACHE_CONTROL } });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/offers/[offerId]', 'Offer');
  }
}
