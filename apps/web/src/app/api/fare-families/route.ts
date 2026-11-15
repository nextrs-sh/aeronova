import type { FareFamiliesResponse } from '@velasia/contracts';
import { NextResponse } from 'next/server';
import { PUBLIC_CACHE_CONTROL, upstreamErrorResponse } from '@/lib/api-response';
import { getFareFamilies } from '@/lib/content';

/** Fare family descriptions (no prices): public product content, cacheable. */
export async function GET() {
  try {
    const body: FareFamiliesResponse = await getFareFamilies();
    return NextResponse.json(body, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/fare-families', 'Fare families');
  }
}
