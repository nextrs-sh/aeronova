import { airportListResponseSchema, type Airport } from '@velasia/contracts';
import { httpClient } from '@/lib/http-client';

/** Fetch the airport catalogue from the storefront's GET Route Handler. */
export async function fetchAirports(signal?: AbortSignal): Promise<Airport[]> {
  const response = await httpClient.get<unknown>('/api/airports', { signal });
  return airportListResponseSchema.parse(response.data).data;
}
