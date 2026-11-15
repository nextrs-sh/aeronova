import { connection } from 'next/server';
import { getServerEnv } from '@/lib/env';

/**
 * Milestone 7: readiness. The server is up *and* the retailing API it depends on for every
 * booking page is ready (TalaDB open, recovery done). Internal only (see `../live`).
 */
export async function GET() {
  await connection();
  const env = getServerEnv();
  let api: 'ready' | 'unready' | 'unreachable' = 'unreachable';
  try {
    const response = await fetch(new URL('/health/ready', env.RETAILING_API_URL), {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    api = response.ok ? 'ready' : 'unready';
  } catch {
    api = 'unreachable';
  }
  const ready = api === 'ready';
  return Response.json(
    { status: ready ? 'ok' : 'unavailable', service: 'velasia-web', retailingApi: api },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
