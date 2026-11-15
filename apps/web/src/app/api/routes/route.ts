import { routeListQuerySchema, type RouteListResponse } from '@velasia/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { PUBLIC_CACHE_CONTROL, jsonError, upstreamErrorResponse } from '@/lib/api-response';
import { getRoutes } from '@/lib/content';

/** Velasia's route network. Supports `?from=` and `?to=` (airport codes). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = routeListQuerySchema.safeParse({
    from: params.get('from')?.toUpperCase() || undefined,
    to: params.get('to')?.toUpperCase() || undefined,
  });
  if (!query.success) return jsonError(400, 'BAD_REQUEST', 'Use three-letter airport codes.');

  try {
    const { from, to } = query.data;
    const routes = await getRoutes();
    const body: RouteListResponse = {
      data: routes.filter(
        (route) => (!from || route.origin === from) && (!to || route.destination === to),
      ),
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/routes', 'Routes');
  }
}
