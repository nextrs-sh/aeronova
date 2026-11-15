import type { AircraftListResponse } from '@aeronova/contracts';
import { NextResponse } from 'next/server';
import { PUBLIC_CACHE_CONTROL, upstreamErrorResponse } from '@/lib/api-response';
import { getAircraft } from '@/lib/content';

/** AeroNova's fleet with cabin configurations. */
export async function GET() {
  try {
    const body: AircraftListResponse = { data: await getAircraft() };
    return NextResponse.json(body, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/aircraft', 'Aircraft');
  }
}
