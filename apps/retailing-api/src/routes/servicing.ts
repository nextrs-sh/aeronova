import {
  UNRESOLVED_REFUND_STATUSES,
  ancillaryQuoteRequestSchema,
  changeSearchRequestSchema,
  confirmAncillaryPurchaseRequestSchema,
  confirmCancellationRequestSchema,
  confirmChangeRequestSchema,
  confirmSeatChangeRequestSchema,
  flightInstanceIdSchema,
  orderParamsSchema,
  seatQuoteRequestSchema,
  servicingParamsSchema,
  servicingPaymentRequestSchema,
  simulatedOutcomeSchema,
  type OrderResponse,
  type ServicingResult,
} from '@velasia/contracts';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AccountService } from '../accounts/account-service';
import { parseInput } from '../http';
import type { RetailingResult, RetailingService } from '../offers/retailing-service';
import { isUnresolved } from '../orders/lifecycle';
import { toPublicOrder, toPublicRefund, toPublicServicing } from '../orders/public';
import type { ServicingOutcome, ServicingService } from '../servicing/servicing-service';
import { principalOf } from './principal';
import { sendResult } from './results';

/*
 * Order servicing (Milestone 6). Same rules as every order route: the owner only (guest token or
 * verified account), the same 404 for unknown and not-yours, `private, no-store` answers, strict
 * bodies with no price field (`acceptedAmountMinor` is compared, never charged), an idempotency
 * key and the expected order revision on every change.
 *
 *   GET  /v1/orders/:orderId/servicing                 what can be done now, and the fare rules
 *   POST /v1/orders/:orderId/change-quotes             replacement flights for a date, each quoted
 *   POST /v1/orders/:orderId/changes                   confirm a flight change (and pay)
 *   GET  /v1/orders/:orderId/seatmaps/:flightId        the owner's seat map
 *   POST /v1/orders/:orderId/seat-quotes / seat-changes
 *   GET  /v1/orders/:orderId/ancillaries               services that can still be added
 *   POST /v1/orders/:orderId/ancillary-quotes / ancillary-purchases
 *   POST /v1/orders/:orderId/cancellation-quotes / cancellations
 *   POST /v1/orders/:orderId/servicing/:operationId/payment-attempts   pay again after a decline
 *   POST /v1/orders/:orderId/servicing/:operationId/abandon            discard a change awaiting payment
 *   GET  /v1/orders/:orderId/servicing-status          settle undecided payments and refunds
 *   POST /v1/orders/:orderId/refunds/retry             try a declined refund again
 *   GET  /v1/orders/:orderId/events                    the booking's history (no personal data)
 *   GET  /v1/orders/:orderId/refunds
 */

const BODY_LIMIT = 4 * 1024;

export const servicingRoutes: FastifyPluginAsync<{
  servicing: ServicingService;
  retailing: RetailingService;
  accounts: AccountService;
  maxPaymentAttempts: number;
}> = async (app, { servicing, retailing, accounts, maxPaymentAttempts }) => {
  const now = (request: { scenario?: unknown }) => retailing.now((request.scenario ?? undefined) as never);

  function sendOutcome(reply: FastifyReply, result: RetailingResult<ServicingOutcome>, at: number) {
    if (!result.ok) return sendResult(reply, result);
    const { order, operation, replayed } = result.value;
    const body: { data: ServicingResult } = {
      data: {
        order: toPublicOrder(order, at, maxPaymentAttempts),
        operation: toPublicServicing(operation, at),
        replayed,
      },
    };
    const undecided =
      operation.attempts.some(isUnresolved) ||
      operation.refunds.some((refund) => UNRESOLVED_REFUND_STATUSES.includes(refund.status));
    return sendResult(reply, { ok: true, value: body }, undecided ? 202 : replayed ? 200 : 201);
  }

  const params = (request: { params: unknown }, reply: FastifyReply) =>
    parseInput(orderParamsSchema, request.params, reply);

  app.get('/v1/orders/:orderId/servicing', async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const scenario = request.scenario ?? undefined;
    const result = await servicing.overview(p.orderId, await principalOf(request, accounts), scenario);
    if (!result.ok) return sendResult(reply, result);
    return sendResult(reply, {
      ok: true,
      value: {
        data: {
          order: toPublicOrder(result.value.order, now(request), maxPaymentAttempts),
          servicing: result.value.servicing,
        },
      },
    });
  });

  app.post('/v1/orders/:orderId/change-quotes', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const body = parseInput(changeSearchRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await servicing.changeSearch(
      p.orderId,
      await principalOf(request, accounts),
      body,
      request.scenario ?? undefined,
      request.crashPoint,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post('/v1/orders/:orderId/changes', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const body = parseInput(confirmChangeRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await servicing.confirmChange(
      p.orderId,
      await principalOf(request, accounts),
      body,
      request.scenario ?? undefined,
      request.crashPoint,
    );
    return sendOutcome(reply, result, now(request));
  });

  app.get('/v1/orders/:orderId/seatmaps/:flightId', async (request, reply) => {
    const p = parseInput(
      orderParamsSchema.extend({ flightId: flightInstanceIdSchema }),
      request.params,
      reply,
    );
    if (!p) return reply;
    const result = await servicing.seatMap(
      p.orderId,
      await principalOf(request, accounts),
      p.flightId,
      request.scenario ?? undefined,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post('/v1/orders/:orderId/seat-quotes', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const body = parseInput(seatQuoteRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await servicing.seatQuote(
      p.orderId,
      await principalOf(request, accounts),
      body.changes,
      request.scenario ?? undefined,
      request.crashPoint,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post('/v1/orders/:orderId/seat-changes', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const body = parseInput(confirmSeatChangeRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await servicing.confirmSeats(
      p.orderId,
      await principalOf(request, accounts),
      body,
      request.scenario ?? undefined,
      request.crashPoint,
    );
    return sendOutcome(reply, result, now(request));
  });

  app.get('/v1/orders/:orderId/ancillaries', async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const result = await servicing.ancillaries(
      p.orderId,
      await principalOf(request, accounts),
      request.scenario ?? undefined,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post('/v1/orders/:orderId/ancillary-quotes', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const body = parseInput(ancillaryQuoteRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await servicing.ancillaryQuote(
      p.orderId,
      await principalOf(request, accounts),
      body.changes,
      request.scenario ?? undefined,
      request.crashPoint,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post('/v1/orders/:orderId/ancillary-purchases', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const body = parseInput(confirmAncillaryPurchaseRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await servicing.confirmAncillaries(
      p.orderId,
      await principalOf(request, accounts),
      body,
      request.scenario ?? undefined,
      request.crashPoint,
    );
    return sendOutcome(reply, result, now(request));
  });

  app.post('/v1/orders/:orderId/cancellation-quotes', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    if (!parseInput(z.object({}).strict(), request.body ?? {}, reply)) return reply;
    const result = await servicing.cancellationQuote(
      p.orderId,
      await principalOf(request, accounts),
      request.scenario ?? undefined,
      request.crashPoint,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post('/v1/orders/:orderId/cancellations', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const body = parseInput(confirmCancellationRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await servicing.confirmCancellation(
      p.orderId,
      await principalOf(request, accounts),
      body,
      request.scenario ?? undefined,
      request.crashPoint,
    );
    return sendOutcome(reply, result, now(request));
  });

  app.post(
    '/v1/orders/:orderId/servicing/:operationId/payment-attempts',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const p = parseInput(servicingParamsSchema, request.params, reply);
      if (!p) return reply;
      const body = parseInput(servicingPaymentRequestSchema, request.body ?? {}, reply);
      if (!body) return reply;
      const result = await servicing.pay(
        p.orderId,
        await principalOf(request, accounts),
        p.operationId,
        body,
        request.scenario ?? undefined,
        request.crashPoint,
      );
      return sendOutcome(reply, result, now(request));
    },
  );

  app.post(
    '/v1/orders/:orderId/servicing/:operationId/abandon',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const p = parseInput(servicingParamsSchema, request.params, reply);
      if (!p) return reply;
      if (!parseInput(z.object({}).strict(), request.body ?? {}, reply)) return reply;
      const result = await servicing.abandon(
        p.orderId,
        await principalOf(request, accounts),
        p.operationId,
        request.scenario ?? undefined,
      );
      return sendOutcome(reply, result, now(request));
    },
  );

  app.get('/v1/orders/:orderId/servicing-status', async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const result = await servicing.refreshStatus(
      p.orderId,
      await principalOf(request, accounts),
      request.scenario ?? undefined,
    );
    if (!result.ok) return sendResult(reply, result);
    const body: OrderResponse = { data: toPublicOrder(result.value, now(request), maxPaymentAttempts) };
    return sendResult(reply, { ok: true, value: body });
  });

  app.post('/v1/orders/:orderId/refunds/retry', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const body = parseInput(
      z.object({ simulatedRefundOutcome: simulatedOutcomeSchema.optional() }).strict(),
      request.body ?? {},
      reply,
    );
    if (!body) return reply;
    const result = await servicing.retryRefund(
      p.orderId,
      await principalOf(request, accounts),
      body.simulatedRefundOutcome,
      request.scenario ?? undefined,
    );
    if (!result.ok) return sendResult(reply, result);
    const order = result.value;
    const undecided = order.servicingState === 'REFUND_PENDING';
    return sendResult(
      reply,
      { ok: true, value: { data: toPublicOrder(order, now(request), maxPaymentAttempts) } },
      undecided ? 202 : 201,
    );
  });

  app.get('/v1/orders/:orderId/events', async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const result = await servicing.events(
      p.orderId,
      await principalOf(request, accounts),
      request.scenario ?? undefined,
    );
    if (!result.ok) return sendResult(reply, result);
    const { events } = result.value;
    const recent = events.slice(-100).reverse();
    return sendResult(reply, {
      ok: true,
      value: {
        data: recent.map((event) => ({ ...event, at: new Date(event.at).toISOString() })),
        meta: { total: events.length },
      },
    });
  });

  app.get('/v1/orders/:orderId/refunds', async (request, reply) => {
    const p = params(request, reply);
    if (!p) return reply;
    const result = await servicing.events(
      p.orderId,
      await principalOf(request, accounts),
      request.scenario ?? undefined,
    );
    if (!result.ok) return sendResult(reply, result);
    return sendResult(reply, {
      ok: true,
      value: {
        data: result.value.servicing.flatMap((op) =>
          op.refunds.map((refund) => toPublicRefund(op.operationId, refund)),
        ),
      },
    });
  });
};
