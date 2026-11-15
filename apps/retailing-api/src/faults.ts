import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendError } from './http';

/**
 * Simulated network conditions, so the storefront can be tested against a
 * genuinely separate service that is slow or failing. Off by default.
 *
 * - Latency (`RETAILING_API_LATENCY_MS`) applies to `/v1/flights*` when set.
 * - Faults apply only when `RETAILING_API_FAULTS=enabled`, per request, via
 *   the `x-velasia-fault` header: `delay=<ms>`, `timeout`, `unavailable`,
 *   `empty`, or `malformed`.
 */
export const FAULT_HEADER = 'x-velasia-fault';

export type Fault =
  | { kind: 'delay'; ms: number }
  | { kind: 'timeout' }
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'malformed' };

export interface FaultOptions {
  enabled: boolean;
  latency?: { minMs: number; maxMs: number };
  timeoutMs: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set when an `empty` fault asks routes to answer with no results. */
    simulateEmpty: boolean;
  }
}

export function parseFault(header: string | string[] | undefined): Fault | null {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  if (!value) return null;
  const delay = /^delay=(\d{1,6})$/.exec(value);
  if (delay) return { kind: 'delay', ms: Number(delay[1]) };
  if (
    value === 'timeout' ||
    value === 'unavailable' ||
    value === 'empty' ||
    value === 'malformed'
  ) {
    return { kind: value };
  }
  return null;
}

function wait(ms: number, request: FastifyRequest): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Stop waiting once the client has given up.
    request.raw.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Adds the hooks directly to the root instance so they cover every route. */
export function registerFaultInjection(app: FastifyInstance, options: FaultOptions): void {
  app.decorateRequest('simulateEmpty', false);
  if (!options.enabled && !options.latency) return;
  if (options.enabled) app.log.warn('fault injection is ENABLED (x-velasia-fault header honoured)');

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    if (options.latency && request.url.startsWith('/v1/flights')) {
      const { minMs, maxMs } = options.latency;
      await wait(minMs + Math.random() * (maxMs - minMs), request);
    }
    if (!options.enabled) return;

    const fault = parseFault(request.headers[FAULT_HEADER]);
    if (!fault) return;
    reply.header('x-velasia-fault-applied', fault.kind);
    switch (fault.kind) {
      case 'delay':
        await wait(fault.ms, request);
        return;
      case 'timeout':
        await wait(options.timeoutMs, request);
        return;
      case 'unavailable':
        return sendError(
          reply,
          503,
          'SERVICE_UNAVAILABLE',
          'The retailing service is temporarily unavailable (simulated).',
        );
      case 'empty':
        request.simulateEmpty = true;
        return;
      case 'malformed':
        // Replace the body with valid JSON that breaks the response contract.
        reply.header('x-velasia-malformed', '1');
        return;
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    if (reply.getHeader('x-velasia-malformed') !== '1') return payload;
    reply.removeHeader('x-velasia-malformed');
    return JSON.stringify({ data: { legs: 'unexpected' }, meta: null });
  });
}
