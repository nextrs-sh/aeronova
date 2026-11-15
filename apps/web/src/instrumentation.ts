import type { Instrumentation } from 'next';

/*
 * Milestone 7: runs once when a Next.js server starts.
 *
 * - `register`: validates the server environment, so a misconfigured production container
 *   stops at boot (with variable names, never values) instead of failing on its first request.
 * - `onRequestError`: one structured log line and a metric per server error, with the route
 *   template (never the URL, which can carry booking ids) and Next.js's error digest, which is
 *   what the browser sees and support can match.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkStartupEnvironment } = await import('./lib/startup');
  checkStartupEnvironment();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { log, webMetrics } = await import('./lib/observability');
  webMetrics().requestErrors.inc({
    route_type: context.routeType,
    render_source: context.renderSource ?? 'none',
  });
  const err = error as { name?: string; digest?: string };
  log('error', 'request error', {
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource ?? null,
    errorName: err.name ?? 'Error',
    digest: err.digest ?? null,
    requestId: (request.headers['x-request-id'] as string | undefined) ?? null,
  });
};
