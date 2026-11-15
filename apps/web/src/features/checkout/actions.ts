'use server';

import { randomUUID } from 'node:crypto';
import {
  idempotencyKeySchema,
  orderIdSchema,
  paymentMethodSchema,
  simulatedOutcomeSchema,
  type Order,
} from '@velasia/contracts';
import type { Route } from 'next';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { readSessionCookie } from '@/features/shopping/session-cookie';
import { RetailingApiError, retailingApi } from '@/lib/retailing-api/client';
import { STEP_HREF } from '@/features/booking/trip';
import type { CheckoutActionState, CheckoutErrorCode } from './action-state';
import {
  ensureGuestToken,
  readCheckoutOrderId,
  readGuestToken,
  writeCheckoutOrderId,
} from './checkout-cookies';

/*
 * Checkout Server Actions. Each is a public POST endpoint, so each one:
 * - reads the shopping session and the guest token only from HTTP-only cookies;
 * - accepts an order id only if it is the checkout this browser started (its cookie), and the
 *   retailing API checks the guest owns it again;
 * - parses a small Zod input — no price, total, or status from the browser is ever used as one
 *   (the agreed total is only compared by the API, never charged);
 * - sends an idempotency key, so a double click or a retry can't create a second order or
 *   charge;
 * - never retries a request whose outcome is unknown, and never claims success the API hasn't
 *   confirmed durably.
 * TalaDB is never touched here: every read and write goes to the retailing API over HTTP.
 */

const confirmationHref = (orderId: string) => `/booking/confirmation/${orderId}` as Route;

const failure = (code: CheckoutErrorCode, message: string): CheckoutActionState => ({
  status: 'error',
  code,
  message,
  at: Date.now(),
});

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

/** The browser's key, or a fresh one when the form was posted without JavaScript. */
const keyFrom = (formData: FormData) => {
  const parsed = idempotencyKeySchema.safeParse(text(formData, 'idempotencyKey'));
  return parsed.success ? parsed.data : randomUUID();
};

const SESSION_GONE = failure(
  'session-expired',
  'Your booking session has expired. Please search again to choose your flights.',
);
const NOT_THIS_BROWSER = failure(
  'not-found',
  'We couldn’t find this checkout in this browser. Please start again from your booking review.',
);

/** Map an API failure to a safe result. Upstream bodies and stack traces are never returned. */
function fromApiError(error: unknown, action: string): CheckoutActionState {
  if (!(error instanceof RetailingApiError)) throw error;
  // Error codes only: never order ids, tokens, or traveller details.
  console.error(`[checkout] ${action}: ${error.code ?? error.kind}`);
  switch (error.code) {
    case 'SESSION_EXPIRED':
    case 'SESSION_NOT_FOUND':
      return SESSION_GONE;
    case 'PRICE_CHANGED':
      refresh();
      return failure('price-changed', error.message);
    case 'CHECKOUT_NOT_READY':
    case 'BOOKING_STEP_UNAVAILABLE':
      refresh();
      return failure(
        'not-ready',
        `${error.message} We’ve updated your booking review below — please check it before you continue.`,
      );
    case 'INVENTORY_UNAVAILABLE':
      refresh();
      return failure('sold-out', error.message);
    case 'SESSION_CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
      refresh();
      return failure(
        'conflict',
        'Your trip was changed in another window or tab. We’ve loaded the latest version — please check it and try again.',
      );
    case 'SESSION_ORDERED':
      return failure('already-booked', 'This trip has already been booked in this browser.');
    case 'HOLD_EXPIRED':
      refresh();
      return failure('hold-expired', error.message);
    case 'PAYMENT_IN_PROGRESS':
      refresh();
      return failure('in-progress', error.message);
    case 'ORDER_NOT_PAYABLE':
      refresh();
      return failure('not-payable', error.message);
    case 'ORDER_NOT_FOUND':
      return NOT_THIS_BROWSER;
  }
  if (error.kind === 'timeout') {
    refresh();
    return failure(
      'uncertain',
      'Our booking service took too long to answer, so we can’t tell yet whether this went through. Nothing will be charged twice — check the status before trying again.',
    );
  }
  if (error.kind === 'not-found') return NOT_THIS_BROWSER;
  if (error.kind === 'rejected') {
    return failure('invalid-input', 'We couldn’t use that request. Please try again.');
  }
  return failure(
    'unavailable',
    'We couldn’t reach our booking service. Nothing has changed — please try again in a moment.',
  );
}

/** The order this browser is checking out, with its owner's token, or `null`. */
async function ownedCheckout(formData: FormData) {
  const orderId = orderIdSchema.safeParse(text(formData, 'orderId'));
  if (!orderId.success) return null;
  const [current, guest] = await Promise.all([readCheckoutOrderId(), readGuestToken()]);
  if (current !== orderId.data || !guest) return null;
  return { orderId: orderId.data, guest };
}

/** After a payment answer: go to the confirmation, or say what happened. */
function afterPayment(order: Order, attemptStatus: string | undefined): CheckoutActionState {
  if (order.status === 'CONFIRMED') redirect(confirmationHref(order.id));
  refresh();
  if (attemptStatus === 'FAILED') {
    const attempt = order.payment.attempts.at(-1);
    return {
      status: 'declined',
      message: attempt?.failureReason ?? 'The demo payment was declined.',
      attemptsRemaining: order.payment.attemptsRemaining,
      at: Date.now(),
    };
  }
  if (attemptStatus === 'PENDING') return { status: 'pending', at: Date.now() };
  return failure(
    'uncertain',
    'The payment provider didn’t answer in time, so we don’t know the result yet. Don’t pay again — check the payment status.',
  );
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

const prepareSchema = z.object({
  version: z.coerce.number().int().nonnegative(),
  total: z.coerce.number().int().nonnegative(),
});

/**
 * Start checkout: the API validates everything once more, then creates the pending order and
 * holds the seats. Then on to payment.
 */
export async function prepareCheckoutAction(
  _previous: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const input = prepareSchema.safeParse({
    version: text(formData, 'version'),
    total: text(formData, 'total'),
  });
  if (!input.success) return failure('invalid-input', 'We couldn’t read that request.');
  const session = await readSessionCookie();
  if (!session) return SESSION_GONE;
  // Set before the call: an order must never exist without its owner's cookie.
  const guest = await ensureGuestToken();
  let orderId: string;
  try {
    const { order } = await retailingApi.prepareCheckout(
      {
        sessionId: session.id,
        idempotencyKey: keyFrom(formData),
        expectedVersion: input.data.version,
        acceptedTotalMinor: input.data.total,
      },
      session.token,
      guest,
    );
    orderId = order.id;
  } catch (error) {
    return fromApiError(error, 'prepare');
  }
  await writeCheckoutOrderId(orderId);
  redirect(STEP_HREF.checkout);
}

/** Re-check prices and availability for checkout without holding anything. */
export async function validateCheckoutAction(
  _previous: CheckoutActionState,
  _formData: FormData,
): Promise<CheckoutActionState> {
  const session = await readSessionCookie();
  if (!session) return SESSION_GONE;
  try {
    await retailingApi.validateCheckout(session.id, session.token);
  } catch (error) {
    return fromApiError(error, 'validate');
  }
  refresh();
  return { status: 'checked', at: Date.now() };
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

const paymentSchema = z.object({
  method: paymentMethodSchema,
  outcome: simulatedOutcomeSchema.optional(),
});

function paymentInput(formData: FormData) {
  return paymentSchema.safeParse({
    method: text(formData, 'method'),
    outcome: text(formData, 'outcome') || undefined,
  });
}

/** Submit a simulated payment. The API decides the outcome and every state change. */
export async function submitDemoPaymentAction(
  _previous: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const input = paymentInput(formData);
  if (!input.success) return failure('invalid-input', 'Choose a demo payment method.');
  const owned = await ownedCheckout(formData);
  if (!owned) return NOT_THIS_BROWSER;
  let result;
  try {
    result = await retailingApi.createPaymentAttempt(owned.orderId, owned.guest, {
      idempotencyKey: keyFrom(formData),
      method: input.data.method,
      ...(input.data.outcome ? { simulatedOutcome: input.data.outcome } : {}),
    });
  } catch (error) {
    if (error instanceof RetailingApiError && error.code === 'ORDER_ALREADY_CONFIRMED') {
      redirect(confirmationHref(owned.orderId));
    }
    return fromApiError(error, 'payment');
  }
  return afterPayment(result.order, result.attempt?.status);
}

/** Try again after a declined payment: only allowed while the order can still be paid. */
export async function retryPaymentAction(
  previous: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const owned = await ownedCheckout(formData);
  if (!owned) return NOT_THIS_BROWSER;
  try {
    const order = await retailingApi.getOrder(owned.orderId, owned.guest);
    if (!order) return NOT_THIS_BROWSER;
    if (order.status === 'CONFIRMED') redirect(confirmationHref(order.id));
    if (!order.payment.canPay || order.payment.attempts.at(-1)?.status !== 'FAILED') {
      refresh();
      return failure(
        order.payment.awaitingResult ? 'in-progress' : 'not-payable',
        order.payment.awaitingResult
          ? 'Your last payment is still being processed. Check its status first.'
          : 'This checkout can’t take another payment.',
      );
    }
  } catch (error) {
    return fromApiError(error, 'retry');
  }
  return submitDemoPaymentAction(previous, formData);
}

/** Ask what happened to an undecided payment. Safe to repeat; never pays. */
export async function refreshPaymentStatusAction(
  _previous: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const owned = await ownedCheckout(formData);
  if (!owned) return NOT_THIS_BROWSER;
  let result;
  try {
    result = await retailingApi.getPaymentStatus(owned.orderId, owned.guest);
  } catch (error) {
    return fromApiError(error, 'payment status');
  }
  if (result.order.status === 'CONFIRMED') redirect(confirmationHref(result.order.id));
  refresh();
  if (result.order.status === 'EXPIRED') {
    return failure('hold-expired', 'Your seat hold has ended, so we released the seats.');
  }
  if (result.attempt?.status === 'FAILED') {
    return {
      status: 'declined',
      message: result.attempt.failureReason ?? 'The demo payment didn’t go through.',
      attemptsRemaining: result.order.payment.attemptsRemaining,
      at: Date.now(),
    };
  }
  return { status: 'pending', at: Date.now() };
}
