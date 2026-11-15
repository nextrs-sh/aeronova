import 'server-only';
import { cookies } from 'next/headers';
import { getServerEnv } from '../env';

/** Browser cookie a test sets to ask for a simulated retailing API failure. */
export const FAULT_COOKIE = 'aeronova-fault';
const FAULT_VALUE = /^(delay=\d{1,6}|timeout|unavailable|empty|malformed)$/;

/**
 * Test-only bridge for fault injection: when explicitly enabled, the
 * `aeronova-fault` cookie becomes the API's `x-aeronova-fault` header. In every
 * other configuration this returns no headers and never reads cookies.
 */
export async function faultHeaders(): Promise<Record<string, string>> {
  if (getServerEnv().RETAILING_API_FORWARD_FAULTS !== 'enabled') return {};
  const value = (await cookies()).get(FAULT_COOKIE)?.value;
  return value && FAULT_VALUE.test(value) ? { 'x-aeronova-fault': value } : {};
}
