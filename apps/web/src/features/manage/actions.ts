'use server';

import { randomUUID } from 'node:crypto';
import {
  ancillaryPurchaseSchema,
  bookingReferenceSchema,
  flightInstanceIdSchema,
  idempotencyKeySchema,
  itineraryIdSchema,
  journeyDirectionSchema,
  orderIdSchema,
  paymentMethodSchema,
  seatIdSchema,
  simulatedOutcomeSchema,
  travellerIdSchema,
  type ServicingResult,
} from '@velasia/contracts';
import type { Route } from 'next';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ownerCredentials } from '@/features/account/session';
import { RetailingApiError } from '@/lib/retailing-api/client';
import { servicingApi } from '@/lib/retailing-api/servicing';
import type { ManageActionState } from './action-state';
import { logUpstreamFailure } from '@/lib/observability';

/*
 * Manage Booking Server Actions (Milestone 6). Each is a public POST endpoint, so each one:
 * - parses a small Zod input; no price, total, or status from the browser is ever used as one
 *   (the accepted amount is only compared by the API with its own quote);
 * - takes credentials only from HTTP-only cookies (guest token, account session); the order id
 *   in the form grants nothing — the API checks ownership on every call;
 * - sends the order revision the traveller saw and an idempotency key rendered with the page, so
 *   a double submit or a retry applies nothing twice;
 * - never retries an uncertain request, and reports success only when the API says the change
 *   is COMPLETED.
 * Every durable write happens in the retailing API; nothing here changes an order itself.
 */

const overview = (orderId: string, updated?: string) =>
  `/manage-booking/${orderId}${updated ? `?updated=${updated}` : ''}` as Route;

const now = () => Date.now();
const failure = (
  code: string,
  message: string,
  fields?: Record<string, string>,
): ManageActionState => ({
  status: 'error',
  code,
  message,
  ...(fields ? { fields } : {}),
  at: now(),
});

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

const keyFrom = (formData: FormData) => {
  const parsed = idempotencyKeySchema.safeParse(text(formData, 'idempotencyKey'));
  return parsed.success ? parsed.data : randomUUID();
};

const NOT_FOUND = failure(
  'not-found',
  'We couldn’t open this booking in this browser. Sign in, or use the browser you booked with.',
);

/** Map an API failure to a safe result. API messages are ours and user-facing. */
function fromApiError(error: unknown, action: string): ManageActionState {
  if (!(error instanceof RetailingApiError)) throw error;
  logUpstreamFailure('manage', action, error);
  switch (error.code) {
    case 'ORDER_NOT_FOUND':
      return NOT_FOUND;
    case 'SERVICING_CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
      refresh();
      return failure(
        'conflict',
        'Your booking was changed in another window or tab. We’ve loaded the latest version — please check it and try again.',
      );
    case 'PRICE_CHANGED':
    case 'INVENTORY_UNAVAILABLE':
    case 'SEAT_UNAVAILABLE':
    case 'PAYMENT_PENDING':
    case 'REFUND_PENDING':
    case 'HOLD_EXPIRED':
    case 'ORDER_NOT_MODIFIABLE':
    case 'ORDER_NOT_PAYABLE':
      refresh();
      return failure(error.code.toLowerCase(), error.message);
  }
  if (error.kind === 'timeout') {
    refresh();
    return failure(
      'uncertain',
      'Our booking service took too long to answer, so we can’t tell yet whether this went through. Nothing will be charged twice — check the status before trying again.',
    );
  }
  if (error.kind === 'rejected')
    return failure(error.code?.toLowerCase() ?? 'invalid-input', error.message);
  if (error.kind === 'not-found') return NOT_FOUND;
  return failure(
    'unavailable',
    'We couldn’t reach our booking service. Nothing has changed — please try again in a moment.',
  );
}

/**
 * After a confirmed change: back to the booking, with what happened. A declined or undecided
 * payment also goes back to the booking, where the change waiting for payment can be paid
 * again, checked, or discarded (the change page itself is closed while one is waiting).
 */
function afterServicing(result: ServicingResult, updated: string): ManageActionState {
  const { operation, order } = result;
  if (operation.status === 'COMPLETED') redirect(overview(order.id, updated));
  const attempt = operation.payment?.attempts.at(-1);
  if (operation.status === 'AWAITING_PAYMENT') {
    redirect(overview(order.id, attempt?.status === 'FAILED' ? 'declined' : 'pending'));
  }
  refresh();
  return failure(
    'failed',
    operation.failureReason ?? 'This change wasn’t applied. Your booking is unchanged.',
  );
}

const confirmFields = z.object({
  orderId: orderIdSchema,
  revision: z.coerce.number().int().positive(),
  accepted: z.coerce.number().int(),
  method: paymentMethodSchema.optional(),
  outcome: simulatedOutcomeSchema.optional(),
  refundOutcome: simulatedOutcomeSchema.optional(),
});

function confirmInput(formData: FormData) {
  return confirmFields.safeParse({
    orderId: text(formData, 'orderId'),
    revision: text(formData, 'revision'),
    accepted: text(formData, 'accepted'),
    method: text(formData, 'method') || undefined,
    outcome: text(formData, 'outcome') || undefined,
    refundOutcome: text(formData, 'refundOutcome') || undefined,
  });
}

function confirmBase(input: z.output<typeof confirmFields>, formData: FormData) {
  return {
    idempotencyKey: keyFrom(formData),
    expectedRevision: input.revision,
    acceptedAmountMinor: input.accepted,
    ...(input.accepted > 0 && input.method
      ? {
          payment: {
            method: input.method,
            ...(input.outcome ? { simulatedOutcome: input.outcome } : {}),
          },
        }
      : {}),
    ...(input.refundOutcome ? { simulatedRefundOutcome: input.refundOutcome } : {}),
  };
}

const NEEDS_METHOD = failure('invalid-input', 'Choose a demo payment method.');

// ---------------------------------------------------------------------------
// Finding a booking
// ---------------------------------------------------------------------------

/**
 * Open a booking by its reference. The reference is only a hint: it opens a booking only if
 * this browser's guest token or signed-in account already owns it, and an unknown reference
 * gets exactly the same answer as someone else's.
 */
export async function lookupBookingAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const reference = bookingReferenceSchema.safeParse(
    text(formData, 'reference').trim().toUpperCase(),
  );
  if (!reference.success) {
    return failure('invalid-input', 'Enter a booking reference like VEL-8K4P2Q.', {
      reference: 'Enter a booking reference like VEL-8K4P2Q.',
    });
  }
  const credentials = await ownerCredentials();
  let orderId: string | null = null;
  if (credentials.guest || credentials.account) {
    try {
      orderId = (await servicingApi.byReference(reference.data, credentials))?.id ?? null;
    } catch (error) {
      return fromApiError(error, 'lookup');
    }
  }
  if (!orderId) {
    return failure(
      'not-found',
      'We couldn’t open a booking with that reference here. A booking opens only in the browser that made it, or in the account it was added to — sign in, or use that browser.',
    );
  }
  redirect(overview(orderId));
}

// ---------------------------------------------------------------------------
// Change flight
// ---------------------------------------------------------------------------

export async function confirmFlightChangeAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const input = confirmInput(formData);
  const target = z
    .object({ direction: journeyDirectionSchema, itineraryId: itineraryIdSchema })
    .safeParse({
      direction: text(formData, 'direction'),
      itineraryId: text(formData, 'itineraryId'),
    });
  if (!input.success || !target.success)
    return failure('invalid-input', 'We couldn’t read that request.');
  if (input.data.accepted > 0 && !input.data.method) return NEEDS_METHOD;
  let result;
  try {
    result = await servicingApi.confirmChange(input.data.orderId, await ownerCredentials(), {
      ...confirmBase(input.data, formData),
      ...target.data,
    });
  } catch (error) {
    return fromApiError(error, 'change');
  }
  return afterServicing(result, 'flight');
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

const seatChange = z.object({
  orderId: orderIdSchema,
  travellerId: travellerIdSchema,
  flightId: flightInstanceIdSchema,
  seatId: seatIdSchema,
});

/** Price one seat change for the confirmation panel. Changes nothing. */
export async function quoteSeatChangeAction(
  input: z.input<typeof seatChange>,
): Promise<ManageActionState> {
  const parsed = seatChange.safeParse(input);
  if (!parsed.success) return failure('invalid-input', 'We couldn’t read that seat.');
  const { orderId, ...change } = parsed.data;
  try {
    const quote = await servicingApi.seatQuote(orderId, await ownerCredentials(), [change]);
    return { status: 'quoted', quote, at: now() };
  } catch (error) {
    return fromApiError(error, 'seat quote');
  }
}

export async function confirmSeatChangeAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const input = confirmInput(formData);
  const change = seatChange.omit({ orderId: true }).safeParse({
    travellerId: text(formData, 'travellerId'),
    flightId: text(formData, 'flightId'),
    seatId: text(formData, 'seatId'),
  });
  if (!input.success || !change.success)
    return failure('invalid-input', 'We couldn’t read that seat.');
  if (input.data.accepted > 0 && !input.data.method) return NEEDS_METHOD;
  let result;
  try {
    result = await servicingApi.confirmSeats(input.data.orderId, await ownerCredentials(), {
      ...confirmBase(input.data, formData),
      changes: [change.data],
    });
  } catch (error) {
    return fromApiError(error, 'seat change');
  }
  return afterServicing(result, 'seats');
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

function purchaseFrom(formData: FormData) {
  const category = text(formData, 'category');
  return ancillaryPurchaseSchema.safeParse(
    category === 'MEAL'
      ? {
          category,
          travellerId: text(formData, 'travellerId'),
          flightId: text(formData, 'flightId'),
          productId: text(formData, 'productId'),
        }
      : {
          category,
          travellerId: text(formData, 'travellerId'),
          direction: text(formData, 'direction'),
          productId: text(formData, 'productId'),
        },
  );
}

/** Price one service for the confirmation panel. Changes nothing. */
export async function quoteAncillaryAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const orderId = orderIdSchema.safeParse(text(formData, 'orderId'));
  const purchase = purchaseFrom(formData);
  if (!orderId.success || !purchase.success)
    return failure('invalid-input', 'We couldn’t read that service.');
  try {
    const quote = await servicingApi.ancillaryQuote(orderId.data, await ownerCredentials(), [
      purchase.data,
    ]);
    return { status: 'quoted', quote, at: now() };
  } catch (error) {
    return fromApiError(error, 'service quote');
  }
}

export async function purchaseAncillaryAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const input = confirmInput(formData);
  const purchase = purchaseFrom(formData);
  if (!input.success || !purchase.success)
    return failure('invalid-input', 'We couldn’t read that service.');
  if (input.data.accepted > 0 && !input.data.method) return NEEDS_METHOD;
  let result;
  try {
    result = await servicingApi.confirmAncillaries(input.data.orderId, await ownerCredentials(), {
      ...confirmBase(input.data, formData),
      changes: [purchase.data],
    });
  } catch (error) {
    return fromApiError(error, 'service purchase');
  }
  return afterServicing(result, 'extras');
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export async function confirmCancellationAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const input = confirmInput(formData);
  if (!input.success || input.data.accepted > 0)
    return failure('invalid-input', 'We couldn’t read that request.');
  if (text(formData, 'confirm') !== 'yes') {
    return failure(
      'invalid-input',
      'Tick the box to confirm that you want to cancel this booking.',
      {
        confirm: 'Confirm that you want to cancel this booking.',
      },
    );
  }
  let result;
  try {
    result = await servicingApi.confirmCancellation(input.data.orderId, await ownerCredentials(), {
      idempotencyKey: keyFrom(formData),
      expectedRevision: input.data.revision,
      acceptedRefundMinor: -input.data.accepted,
      ...(input.data.refundOutcome ? { simulatedRefundOutcome: input.data.refundOutcome } : {}),
    });
  } catch (error) {
    return fromApiError(error, 'cancel');
  }
  redirect(overview(result.order.id, 'cancelled'));
}

// ---------------------------------------------------------------------------
// A change waiting for payment, and refunds
// ---------------------------------------------------------------------------

const operationFields = z.object({
  orderId: orderIdSchema,
  operationId: z.string().regex(/^svc_[A-Za-z0-9_-]{22}$/),
});

export async function payServicingAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const ids = operationFields.safeParse({
    orderId: text(formData, 'orderId'),
    operationId: text(formData, 'operationId'),
  });
  const method = paymentMethodSchema.safeParse(text(formData, 'method'));
  const outcome = simulatedOutcomeSchema
    .optional()
    .safeParse(text(formData, 'outcome') || undefined);
  if (!ids.success || !method.success || !outcome.success) return NEEDS_METHOD;
  let result;
  try {
    result = await servicingApi.pay(
      ids.data.orderId,
      await ownerCredentials(),
      ids.data.operationId,
      {
        idempotencyKey: keyFrom(formData),
        method: method.data,
        ...(outcome.data ? { simulatedOutcome: outcome.data } : {}),
      },
    );
  } catch (error) {
    return fromApiError(error, 'servicing payment');
  }
  return afterServicing(result, 'paid');
}

export async function abandonServicingAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const ids = operationFields.safeParse({
    orderId: text(formData, 'orderId'),
    operationId: text(formData, 'operationId'),
  });
  if (!ids.success) return failure('invalid-input', 'We couldn’t read that request.');
  try {
    await servicingApi.abandon(ids.data.orderId, await ownerCredentials(), ids.data.operationId);
  } catch (error) {
    return fromApiError(error, 'discard');
  }
  redirect(overview(ids.data.orderId, 'discarded'));
}

/** Ask what happened to undecided payments and refunds. Safe to repeat; never pays. */
export async function refreshServicingAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const orderId = orderIdSchema.safeParse(text(formData, 'orderId'));
  if (!orderId.success) return failure('invalid-input', 'We couldn’t read that request.');
  try {
    await servicingApi.refreshStatus(orderId.data, await ownerCredentials());
  } catch (error) {
    return fromApiError(error, 'status');
  }
  refresh();
  return { status: 'done', message: 'Status updated.', at: now() };
}

export async function retryRefundAction(
  _previous: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const orderId = orderIdSchema.safeParse(text(formData, 'orderId'));
  if (!orderId.success) return failure('invalid-input', 'We couldn’t read that request.');
  try {
    await servicingApi.retryRefund(orderId.data, await ownerCredentials());
  } catch (error) {
    return fromApiError(error, 'refund retry');
  }
  refresh();
  return { status: 'done', message: 'We’ve sent the refund again.', at: now() };
}
