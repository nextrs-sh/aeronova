import { flightInstanceIdSchema, type StorefrontSeatMapResponse } from '@velasia/contracts';
import { NextResponse } from 'next/server';
import { readSessionCookie } from '@/features/shopping/session-cookie';
import { LIVE_CACHE_CONTROL, jsonError, upstreamErrorResponse } from '@/lib/api-response';
import { RetailingApiError, retailingApi } from '@/lib/retailing-api/client';

/**
 * Seat map for one flight, for client-side seat selection. A guest whose trip includes the
 * flight gets their own view (their fare's prices, who may sit where, their choices); anyone
 * else gets the public layout and availability. Personal and live: never cached anywhere.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/flights/[id]/seatmap'>,
) {
  const id = flightInstanceIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError(400, 'BAD_REQUEST', 'Invalid flight identifier.');
  const headers = { 'Cache-Control': LIVE_CACHE_CONTROL, Vary: 'Cookie' };
  try {
    const credentials = await readSessionCookie();
    if (credentials) {
      try {
        const seatMap = await retailingApi.getSessionSeatMap(
          credentials.id,
          credentials.token,
          id.data,
        );
        const body: StorefrontSeatMapResponse = {
          data: { kind: 'session', seatMap },
          meta: {
            disclaimer: 'Choosing a seat doesn’t reserve it.',
            serverTime: new Date().toISOString(),
          },
        };
        return NextResponse.json(body, { headers });
      } catch (error) {
        // Not this guest's flight (or no live session): fall back to the public map.
        if (
          !(error instanceof RetailingApiError) ||
          (error.kind !== 'not-found' && error.status !== 410)
        ) {
          throw error;
        }
      }
    }
    const { data, meta } = await retailingApi.getSeatMap(id.data);
    const body: StorefrontSeatMapResponse = { data: { kind: 'public', seatMap: data }, meta };
    return NextResponse.json(body, { headers });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/flights/[id]/seatmap', 'Seat maps');
  }
}
