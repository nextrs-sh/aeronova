import 'server-only';
import { shoppingSessionIdSchema, shoppingSessionTokenSchema } from '@velasia/contracts';
import { cookies } from 'next/headers';
import { getServerEnv } from '@/lib/env';

/**
 * The guest's shopping session: `<session id>.<secret token>` in an HTTP-only cookie. It is
 * the only place the storefront gets a session from — Server Actions never accept a session
 * id or token from the browser, so one guest can't act on another's selection.
 */
export const SESSION_COOKIE = 'velasia-shopping';

/** Matches the API's maximum session lifetime; the API decides when a session has expired. */
const MAX_AGE_SECONDS = 3 * 60 * 60;

export interface SessionCredentials {
  id: string;
  token: string;
}

export function parseSessionCookie(value: string | undefined): SessionCredentials | null {
  if (!value) return null;
  const [id, token, extra] = value.split('.');
  if (extra !== undefined) return null;
  if (!shoppingSessionIdSchema.safeParse(id).success) return null;
  if (!shoppingSessionTokenSchema.safeParse(token).success) return null;
  return { id: id!, token: token! };
}

export async function readSessionCookie(): Promise<SessionCredentials | null> {
  return parseSessionCookie((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Server Actions only: cookies can't be set while a page renders. */
export async function writeSessionCookie({ id, token }: SessionCredentials): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, `${id}.${token}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getServerEnv().SITE_URL.startsWith('https:'),
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
