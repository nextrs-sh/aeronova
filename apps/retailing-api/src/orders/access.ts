import type { StoredOrder } from '../db/schema';
import { ownsOrder } from './ids';

/*
 * Who is asking for an order (Milestone 6). A request can carry:
 * - the guest token of the browser that made a booking (a bearer token, as in M5), and/or
 * - an account, but only once the API itself has verified the account session token.
 *
 * A booking belongs to its guest until it is linked to an account; from then on only that
 * account opens it (the guest token's hash is removed at linking). Everything else — the booking
 * reference, the order id, the traveller's name or email — grants nothing.
 */
export interface Principal {
  guestToken?: string;
  /** Set only by the API, from a session it verified. */
  accountId?: string;
}

export const NOBODY: Principal = {};

export function canAccess(order: StoredOrder, principal: Principal): boolean {
  if (order.ownerAccountId) return principal.accountId === order.ownerAccountId;
  return order.ownerTokenHash !== null && ownsOrder(principal.guestToken, order.ownerTokenHash);
}
