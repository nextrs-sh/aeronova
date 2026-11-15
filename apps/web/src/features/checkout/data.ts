import 'server-only';
import { orderIdSchema, type Order, type PaymentOptions } from '@velasia/contracts';
import {
  RetailingApiError,
  retailingApi,
  type RetailingApiErrorKind,
} from '@/lib/retailing-api/client';
import { readCheckoutOrderId, readGuestToken } from './checkout-cookies';
import { logUpstreamFailure } from '@/lib/observability';

/*
 * Server-side reads for checkout and confirmation. Personal: always `no-store`, outside any
 * `use cache` scope, and authorised by the guest token from the HTTP-only cookie — the retailing
 * API checks ownership on every read.
 */

export type OrderState =
  /** This browser hasn't started a checkout (or has no guest token). */
  | { status: 'none' }
  /** No such order for this guest: unknown, or someone else's (indistinguishable). */
  | { status: 'missing' }
  | { status: 'error'; error: RetailingApiErrorKind }
  | { status: 'ready'; order: Order };

async function load(orderId: string): Promise<OrderState> {
  const guest = await readGuestToken();
  if (!guest) return { status: 'missing' };
  try {
    const order = await retailingApi.getOrder(orderId, guest);
    return order ? { status: 'ready', order } : { status: 'missing' };
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    logUpstreamFailure('checkout', 'order', error);
    return { status: 'error', error: error.kind };
  }
}

/** The checkout this browser started, if any. */
export async function loadCheckoutOrder(): Promise<OrderState> {
  const orderId = await readCheckoutOrderId();
  return orderId ? load(orderId) : { status: 'none' };
}

/** An order by id, for its owner only. */
export async function loadOwnedOrder(orderId: string): Promise<OrderState> {
  return orderIdSchema.safeParse(orderId).success ? load(orderId) : { status: 'missing' };
}

export async function loadPaymentOptions(): Promise<PaymentOptions | null> {
  try {
    return await retailingApi.getPaymentOptions();
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    logUpstreamFailure('checkout', 'payment options', error);
    return null;
  }
}
