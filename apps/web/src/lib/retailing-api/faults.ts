import 'server-only';
import { cookies } from 'next/headers';
import { getServerEnv } from '../env';

/** Browser cookie a test sets to ask for a simulated retailing API failure. */
export const FAULT_COOKIE = 'velasia-fault';
const FAULT_VALUE = /^(delay=\d{1,6}|timeout|unavailable|empty|malformed)$/;

/**
 * Test-only bridge for fault injection: when explicitly enabled, the
 * `velasia-fault` cookie becomes the API's `x-velasia-fault` header. In every
 * other configuration this returns no headers and never reads cookies.
 */
export async function faultHeaders(): Promise<Record<string, string>> {
  if (getServerEnv().RETAILING_API_FORWARD_FAULTS !== 'enabled') return {};
  const value = (await cookies()).get(FAULT_COOKIE)?.value;
  return value && FAULT_VALUE.test(value) ? { 'x-velasia-fault': value } : {};
}
