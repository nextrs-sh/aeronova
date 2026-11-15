import 'server-only';
import { REQUEST_ID_HEADER, isValidRequestId } from '@velasia/observability';
import { cookies, headers } from 'next/headers';
import { getServerEnv } from '../env';

/** Browser cookie a test sets to ask for a simulated retailing API failure. */
export const FAULT_COOKIE = 'velasia-fault';
const FAULT_VALUE = /^(delay=\d{1,6}|timeout|unavailable|empty|malformed|slow-commit)$/;
/** Browser cookie a test sets to run a deterministic retailing scenario (offer expiry, …). */
export const SCENARIO_COOKIE = 'velasia-scenario';
const SCENARIO_VALUE =
  /^(offer-expired|price-increase|sold-out|session-expired|seat-taken|hold-expired)$/;

/**
 * Test-only bridge for fault injection: when explicitly enabled, the
 * `velasia-fault` and `velasia-scenario` cookies become the API's `x-velasia-fault` and
 * `x-velasia-scenario` headers. In every
 * other configuration this returns no headers and never reads cookies.
 */
export async function faultHeaders(): Promise<Record<string, string>> {
  if (getServerEnv().RETAILING_API_FORWARD_FAULTS !== 'enabled') return {};
  const jar = await cookies();
  const fault = jar.get(FAULT_COOKIE)?.value;
  const scenario = jar.get(SCENARIO_COOKIE)?.value;
  return {
    ...(fault && FAULT_VALUE.test(fault) ? { 'x-velasia-fault': fault } : {}),
    ...(scenario && SCENARIO_VALUE.test(scenario) ? { 'x-velasia-scenario': scenario } : {}),
  };
}

/**
 * Milestone 7: the incoming request's correlation id (set by the reverse proxy), forwarded so
 * API log lines can be matched to the storefront request. Only for request-time calls.
 */
export async function requestIdHeaders(): Promise<Record<string, string>> {
  const id = (await headers()).get(REQUEST_ID_HEADER);
  return isValidRequestId(id) ? { [REQUEST_ID_HEADER]: id } : {};
}
