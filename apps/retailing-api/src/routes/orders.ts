import {
  createPaymentAttemptRequestSchema,
  orderParamsSchema,
  orderReferenceParamsSchema,
  type OrderResponse,
  type PaymentResultResponse,
} from '@velasia/contracts';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { parseInput } from '../http';
import { paymentHttpStatus, type OrderService, type PaymentOutcome } from '../orders/order-service';
import { toPublicAttempt, toPublicOrder } from '../orders/public';
import type { RetailingResult, RetailingService } from '../offers/retailing-service';
import { sendResult } from './results';
import { bearerToken } from './shopping';

/*
 * Orders are private to the guest who created them: every route needs the guest token as a
 * bearer token, and a wrong or missing token gets the same 404 as an unknown order. The booking
 * reference is never enough on its own. Every answer is `private, no-store`.
 */

const BODY_LIMIT = 2 * 1024;

export const orderRoutes: FastifyPluginAsync<{
  orders: OrderService;
  retailing: RetailingService;
}> = async (app, { orders, retailing }) => {
  const max = orders.config.maxPaymentAttempts;

  function sendOrder(
    reply: FastifyReply,
    result: RetailingResult<Parameters<typeof toPublicOrder>[0]>,
    now: number,
  ) {
    if (!result.ok) return sendResult(reply, result);
    const body: OrderResponse = { data: toPublicOrder(result.value, now, max) };
    return sendResult(reply, { ok: true, value: body });
  }

  function sendPayment(
    reply: FastifyReply,
    result: RetailingResult<PaymentOutcome>,
    now: number,
    { lookup = false } = {},
  ) {
    if (!result.ok) return sendResult(reply, result);
    const { order, attempt, replayed } = result.value;
    const body: PaymentResultResponse = {
      data: {
        order: toPublicOrder(order, now, max),
        attempt: attempt ? toPublicAttempt(attempt) : null,
        replayed,
      },
    };
    // A status lookup creates nothing: 200, or 202 while still undecided.
    return sendResult(
      reply,
      { ok: true, value: body },
      paymentHttpStatus(attempt?.status, replayed || lookup),
    );
  }

  app.get('/v1/orders/:orderId', async (request, reply) => {
    const params = parseInput(orderParamsSchema, request.params, reply);
    if (!params) return reply;
    const scenario = request.scenario ?? undefined;
    const result = await orders.get(params.orderId, bearerToken(request), scenario);
    return sendOrder(reply, result, retailing.now(scenario));
  });

  app.get('/v1/orders/reference/:reference', async (request, reply) => {
    const params = parseInput(orderReferenceParamsSchema, request.params, reply);
    if (!params) return reply;
    const scenario = request.scenario ?? undefined;
    const result = await orders.getByReference(params.reference, bearerToken(request), scenario);
    return sendOrder(reply, result, retailing.now(scenario));
  });

  app.post(
    '/v1/orders/:orderId/payment-attempts',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const params = parseInput(orderParamsSchema, request.params, reply);
      if (!params) return reply;
      const body = parseInput(createPaymentAttemptRequestSchema, request.body ?? {}, reply);
      if (!body) return reply;
      const scenario = request.scenario ?? undefined;
      const result = await orders.pay(
        params.orderId,
        bearerToken(request),
        body,
        scenario,
        request.crashPoint,
      );
      return sendPayment(reply, result, retailing.now(scenario));
    },
  );

  /** Ask the (simulated) provider about an undecided payment and apply its answer. */
  app.get('/v1/orders/:orderId/payment-status', async (request, reply) => {
    const params = parseInput(orderParamsSchema, request.params, reply);
    if (!params) return reply;
    const scenario = request.scenario ?? undefined;
    const result = await orders.refreshStatus(params.orderId, bearerToken(request), scenario);
    return sendPayment(reply, result, retailing.now(scenario), { lookup: true });
  });
};
