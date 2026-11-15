import 'server-only';
import { createHash } from 'node:crypto';
import { accountSessionTokenSchema } from '@velasia/contracts';
import type { Route } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { readGuestToken } from '@/features/checkout/checkout-cookies';
import { getServerEnv } from '@/lib/env';
import { RetailingApiError } from '@/lib/retailing-api/client';
import { accountApi, type Credentials } from '@/lib/retailing-api/servicing';

/*
 * The demo account session (Milestone 6): an opaque 256-bit token in the HTTP-only
 * `velasia-account` cookie. The retailing API stores only its hash and verifies it on every
 * request; the storefront never decides who is signed in by itself.
 *
 * - `SameSite=Lax`, `Secure` on https, `HttpOnly`, path `/`, and it expires with the session.
 * - Set only by Server Actions (sign-in, registration, password change), never while rendering.
 * - Every page that reads it is rendered per request and never cached (no `use cache`).
 */

export const ACCOUNT_COOKIE = 'velasia-account';

export async function readAccountToken(): Promise<string | null> {
  const parsed = accountSessionTokenSchema.safeParse((await cookies()).get(ACCOUNT_COOKIE)?.value);
  return parsed.success ? parsed.data : null;
}

export async function writeAccountToken(token: string, expiresAt: string): Promise<void> {
  (await cookies()).set(ACCOUNT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getServerEnv().SITE_URL.startsWith('https:'),
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function clearAccountToken(): Promise<void> {
  (await cookies()).delete(ACCOUNT_COOKIE);
}

/**
 * The signed-in account for this request, or `null`. React's request-scoped `cache` (not
 * `use cache`): one API check per request, never shared between requests or people.
 */
export const currentAccount = cache(async () => {
  const token = await readAccountToken();
  if (!token) return null;
  try {
    const me = await accountApi.me(token);
    return me ? { ...me, token } : null;
  } catch (error) {
    if (error instanceof RetailingApiError) {
      console.error(`[account] session: ${error.code ?? error.kind}`);
      return null;
    }
    throw error;
  }
});

/** Protected pages: the account, or a redirect to sign in (and back here afterwards). */
export async function requireAccount(next: string) {
  const account = await currentAccount();
  if (!account) redirect(`/account/sign-in?next=${encodeURIComponent(next)}` as Route);
  return account;
}

/** What proves ownership of bookings in this browser: its guest token and/or its account. */
export async function ownerCredentials(): Promise<Credentials> {
  const [guest, account] = await Promise.all([readGuestToken(), readAccountToken()]);
  return { guest, account };
}

/**
 * An opaque key per browser address, for the API's sign-in rate limits. A hash, so the address
 * itself never reaches the API or its logs. Behind no proxy every request shares one key, which
 * only makes the limit stricter (documented; M7 adds edge rate limiting).
 */
export async function clientKey(): Promise<string> {
  const h = await headers();
  const address = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
  return createHash('sha256').update(`velasia-client:${address}`).digest('base64url').slice(0, 32);
}

/** Only same-site paths are followed after sign-in (no open redirects). */
export function safeNext(value: unknown, fallback = '/account/trips'): Route {
  return (
    typeof value === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(value) ? value : fallback
  ) as Route;
}
