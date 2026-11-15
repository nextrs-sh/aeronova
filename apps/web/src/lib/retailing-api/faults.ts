import 'server-only';
import { cookies } from 'next/headers';
import { getServerEnv } from '../env';

/** Browser cookie a test sets to ask for a simulated retailing API failure. */
export const FAULT_COOKIE = 'velasia-fault';
const FAULT_VALUE = /^(delay=\d{1,6}|timeout|unavailable|empty|malformed)$/;
/** Browser cookie a test sets to run a deterministic retailing scenario (offer expiry, …). */
export const SCENARIO_COOKIE = 'velasia-scenario';
const SCENARIO_VALUE = /^(offer-expired|price-increase|sold-out|session-expired)$/;

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
