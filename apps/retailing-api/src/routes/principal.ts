import { accountSessionTokenSchema } from '@velasia/contracts';
import type { FastifyRequest } from 'fastify';
import type { AccountService } from '../accounts/account-service';
import type { Principal } from '../orders/access';
import { bearerToken } from './shopping';

/*
 * Request credentials (Milestone 6). The storefront's server sends, server to server:
 * - `Authorization: Bearer <guest token>` for the browser's guest bookings (as in M5);
 * - `x-velasia-account: <session token>` for a signed-in account, verified here against the
 *   stored session hash on every request (never trusted as an account id);
 * - `x-velasia-client: <opaque key>`, a hash of the browser's address, for rate limits.
 */

export const ACCOUNT_HEADER = 'x-velasia-account';
export const CLIENT_HEADER = 'x-velasia-client';

export function accountToken(request: FastifyRequest): string | undefined {
  const parsed = accountSessionTokenSchema.safeParse(request.headers[ACCOUNT_HEADER]);
  return parsed.success ? parsed.data : undefined;
}

export function clientKey(request: FastifyRequest): string {
  const value = request.headers[CLIENT_HEADER];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : `ip:${request.ip}`;
}

export async function principalOf(request: FastifyRequest, accounts: AccountService): Promise<Principal> {
  const auth = await accounts.sessionFor(accountToken(request));
  return { guestToken: bearerToken(request), ...(auth ? { accountId: auth.account.accountId } : {}) };
}
