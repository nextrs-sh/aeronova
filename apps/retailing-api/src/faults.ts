import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendError } from './http';
import { SCENARIO_HEADER, parseScenarioName, scenarioFor, type Scenario } from './offers/scenario';

/**
 * Simulated network conditions, so the storefront can be tested against a
 * genuinely separate service that is slow or failing. Off by default.
 *
 * - Latency (`RETAILING_API_LATENCY_MS`) applies to `/v1/flights*` and `/v1/offers*` when set.
 * - Faults apply only when `RETAILING_API_FAULTS=enabled`, per request, via
 *   the `x-velasia-fault` header: `delay=<ms>`, `timeout`, `unavailable`,
 *   `empty`, `malformed`, or `slow-commit` (a mutation is applied, then its answer is held for
 *   the timeout, as if the response were lost).
 * - Retailing scenarios (offer expiry, price change, sell-out, session expiry) apply under the
 *   same switch, via `x-velasia-scenario` (see `offers/scenario.ts`).
 */
export const FAULT_HEADER = 'x-velasia-fault';

export type Fault =
  | { kind: 'delay'; ms: number }
  | { kind: 'timeout' }
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'malformed' }
  /** Mutations only: apply the change, then hold the response (an answer lost in transit). */
  | { kind: 'slow-commit' };

export interface FaultOptions {
  enabled: boolean;
  latency?: { minMs: number; maxMs: number };
  timeoutMs: number;
}

/** Durations the retailing scenarios are derived from. */
export interface ScenarioTimings {
  offerValidityMs: number;
  sessionMaxMs: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set when an `empty` fault asks routes to answer with no results. */
    simulateEmpty: boolean;
    /** Retailing scenario for this request (see `offers/scenario.ts`); `null` for none. */
    scenario: Scenario | null;
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
    value === 'malformed' ||
    value === 'slow-commit'
  ) {
    return { kind: value };
  }
  return null;
}

function wait(ms: number, request: FastifyRequest): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Stop waiting once the client has given up. (The request stream itself emits \`close\` as
    // soon as a body has been read, so listen on the connection.)
    request.raw.socket?.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Adds the hooks directly to the root instance so they cover every route. */
export function registerFaultInjection(
  app: FastifyInstance,
  options: FaultOptions,
  timings: ScenarioTimings,
): void {
  app.decorateRequest('simulateEmpty', false);
  app.decorateRequest('scenario', null);
  if (!options.enabled && !options.latency) return;
  if (options.enabled) app.log.warn('fault injection is ENABLED (x-velasia-fault header honoured)');

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    if (
      options.latency &&
      (request.url.startsWith('/v1/flights') || request.url.startsWith('/v1/offers'))
    ) {
      const { minMs, maxMs } = options.latency;
      await wait(minMs + Math.random() * (maxMs - minMs), request);
    }
    if (!options.enabled) return;

    const scenario = parseScenarioName(request.headers[SCENARIO_HEADER]);
    if (scenario) {
      request.scenario = scenarioFor(scenario, timings);
      reply.header('x-velasia-scenario-applied', scenario);
    }

    const fault = parseFault(request.headers[FAULT_HEADER]);
    if (!fault) return;
    if (fault.kind === 'slow-commit') {
      // Reads answer normally, so the storefront can find out what was saved.
      if (request.method === 'GET') return;
      reply.header('x-velasia-fault-applied', fault.kind);
      reply.header('x-velasia-slow-commit', '1');
      return;
    }
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

  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.getHeader('x-velasia-slow-commit') === '1') {
      reply.removeHeader('x-velasia-slow-commit');
      await wait(options.timeoutMs, request);
      return payload;
    }
    if (reply.getHeader('x-velasia-malformed') !== '1') return payload;
    reply.removeHeader('x-velasia-malformed');
    return JSON.stringify({ data: { legs: 'unexpected' }, meta: null });
  });
}
