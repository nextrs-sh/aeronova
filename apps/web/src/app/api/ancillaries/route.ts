import type { AncillaryCatalogueResponse } from '@velasia/contracts';
import { NextResponse } from 'next/server';
import { PUBLIC_CACHE_CONTROL, upstreamErrorResponse } from '@/lib/api-response';
import { getAncillaryCatalogue } from '@/lib/content';

/**
 * The optional-services catalogue (descriptions and list prices by route length): public
 * product content, cacheable. What a guest pays for their fare comes from their own session.
 */
export async function GET() {
  try {
    const body: AncillaryCatalogueResponse = await getAncillaryCatalogue();
    return NextResponse.json(body, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  } catch (error) {
    return upstreamErrorResponse(error, 'api/ancillaries', 'Travel extras');
  }
}
