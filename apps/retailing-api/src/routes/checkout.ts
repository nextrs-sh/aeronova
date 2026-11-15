import {
  PAYMENT_METHOD_LABELS,
  SIMULATED_OUTCOME_LABELS,
  airline,
  checkoutValidateRequestSchema,
  guestTokenSchema,
  paymentMethodSchema,
  prepareCheckoutRequestSchema,
  simulatedOutcomeSchema,
  type PaymentOptionsResponse,
  type PrepareCheckoutResponse,
} from '@velasia/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { parseInput, sendError } from '../http';
import type { CheckoutService } from '../orders/checkout-service';
import type { OrderService } from '../orders/order-service';
import { toPublicOrder } from '../orders/public';
import type { RetailingService } from '../offers/retailing-service';
import { sendResult } from './results';
import { bearerToken } from './shopping';

/*
 * Milestone 5 checkout. Both routes are authorised by the shopping session's bearer token, like
 * every booking step. `prepare` also takes the guest token (`x-velasia-guest`) that will own the
 * order; the API stores only its hash. Strict bodies: a price field is a 400.
 */

export const GUEST_HEADER = 'x-velasia-guest';
const BODY_LIMIT = 4 * 1024;
const PAYMENT_DISCLAIMER = `Payments are simulated: no card, bank, or wallet details are collected and no money moves. ${airline.disclaimer}`;

export const checkoutRoutes: FastifyPluginAsync<{
  checkout: CheckoutService;
  orders: OrderService;
  retailing: RetailingService;
}> = async (app, { checkout, orders, retailing }) => {
  app.post('/v1/checkout/validate', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(checkoutValidateRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await checkout.validate(
      body.sessionId,
      bearerToken(request),
      body.acceptedTotalMinor,
      request.scenario ?? undefined,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post('/v1/checkout/prepare', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(prepareCheckoutRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const guest = guestTokenSchema.safeParse(request.headers[GUEST_HEADER]);
    if (!guest.success) {
      return sendError(reply, 400, 'BAD_REQUEST', 'A guest token is required to start checkout.');
    }
    const result = await checkout.prepare(
      body,
      bearerToken(request),
      guest.data,
      request.scenario ?? undefined,
      request.crashPoint,
    );
    if (!result.ok) return sendResult(reply, result);
    const response: PrepareCheckoutResponse = {
      data: {
        order: toPublicOrder(
          result.value.order,
          retailing.now(request.scenario ?? undefined),
          orders.config.maxPaymentAttempts,
        ),
        replayed: result.value.replayed,
      },
    };
    return sendResult(reply, { ok: true, value: response }, result.value.replayed ? 200 : 201);
  });

  /** Which demo methods exist and whether outcomes can be chosen. Public, the same for all. */
  app.get('/v1/payments/options', async (_request, reply) => {
    const body: PaymentOptionsResponse = {
      data: {
        methods: paymentMethodSchema.options.map((code) => ({
          code,
          ...PAYMENT_METHOD_LABELS[code],
        })),
        outcomeControls: orders.config.outcomeControls,
        outcomes: orders.config.outcomeControls
          ? simulatedOutcomeSchema.options.map((code) => ({
              code,
              ...SIMULATED_OUTCOME_LABELS[code],
            }))
          : [],
        maxAttempts: orders.config.maxPaymentAttempts,
        disclaimer: PAYMENT_DISCLAIMER,
      },
    };
    return reply.header('cache-control', 'public, max-age=60').send(body);
  });
};
