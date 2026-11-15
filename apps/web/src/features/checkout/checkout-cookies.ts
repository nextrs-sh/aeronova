import 'server-only';
import { randomBytes } from 'node:crypto';
import { guestTokenSchema, orderIdSchema } from '@velasia/contracts';
import { cookies } from 'next/headers';
import { getServerEnv } from '@/lib/env';

/*
 * Checkout cookies. Both are HTTP-only, so page scripts can't read them, and neither ever
 * appears in a URL.
 *
 * - `velasia-guest`: the guest's secret (256 random bits). It is what proves ownership of an
 *   order: the storefront sends it to the retailing API, which stores only its hash. It
 *   outlives the shopping session, so a confirmation still opens after the API restarts.
 * - `velasia-checkout`: which order the checkout page shows. Not a credential — the API still
 *   checks the guest token on every read.
 */

export const GUEST_COOKIE = 'velasia-guest';
export const CHECKOUT_COOKIE = 'velasia-checkout';

/** How long this browser can reopen its demo bookings. */
const GUEST_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CHECKOUT_MAX_AGE_SECONDS = 24 * 60 * 60;

const options = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: getServerEnv().SITE_URL.startsWith('https:'),
  path: '/',
  maxAge,
});

export async function readGuestToken(): Promise<string | null> {
  const parsed = guestTokenSchema.safeParse((await cookies()).get(GUEST_COOKIE)?.value);
  return parsed.success ? parsed.data : null;
}

/**
 * The guest token, creating one first if the browser has none. Server Actions only (cookies
 * can't be set while a page renders). The cookie is set before the API call that uses it, so
 * an answer lost on the way back never leaves an order its owner can't open.
 */
export async function ensureGuestToken(): Promise<string> {
  const existing = await readGuestToken();
  if (existing) return existing;
  const token = randomBytes(32).toString('base64url');
  (await cookies()).set(GUEST_COOKIE, token, options(GUEST_MAX_AGE_SECONDS));
  return token;
}

export async function readCheckoutOrderId(): Promise<string | null> {
  const parsed = orderIdSchema.safeParse((await cookies()).get(CHECKOUT_COOKIE)?.value);
  return parsed.success ? parsed.data : null;
}

export async function writeCheckoutOrderId(orderId: string): Promise<void> {
  (await cookies()).set(CHECKOUT_COOKIE, orderId, options(CHECKOUT_MAX_AGE_SECONDS));
}
