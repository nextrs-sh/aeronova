import { randomUUID } from 'node:crypto';

/** The header that carries a request's correlation id between the proxy, Next.js, and the API. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * What an incoming correlation id may look like. Anything else (too long, odd characters, a
 * value smuggling log syntax) is replaced, so a client can't inject text into logs.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/** The incoming id when it is well formed, otherwise a fresh one. */
export function requestIdFrom(header: string | string[] | null | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return isValidRequestId(value) ? value : randomUUID();
}
