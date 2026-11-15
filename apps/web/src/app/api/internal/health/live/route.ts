import { connection } from 'next/server';

/**
 * Milestone 7: liveness. The Next.js server answers; nothing else is checked, so a retailing
 * API outage never makes an orchestrator restart a healthy web container.
 *
 * `/api/internal/*` is for the container network only: the bundled proxy answers 404 for it.
 */
export async function GET() {
  await connection();
  return Response.json(
    { status: 'ok', service: 'velasia-web', uptimeSeconds: Math.round(process.uptime()) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
