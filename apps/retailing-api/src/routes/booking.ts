import {
  airline,
  ancillaryParamsSchema,
  completeStepRequestSchema,
  flightInstanceIdSchema,
  savePassengersRequestSchema,
  shoppingSessionIdSchema,
  updateAncillariesRequestSchema,
  updateSeatsRequestSchema,
  validateBookingRequestSchema,
  type AncillaryCatalogueResponse,
  type SeatMapResponse,
  type SessionSeatMapResponse,
} from '@velasia/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parseInput, sendError } from '../http';
import type { RetailingService } from '../offers/retailing-service';
import { sendResult } from './results';
import { bearerToken, sessionParamsSchema } from './shopping';

/*
 * Milestone 4: seat maps, the ancillary catalogue, and the booking steps of a shopping session.
 *
 * Public reads (layouts and availability, the product catalogue) need no session. Everything
 * else is private to a session and authorised by its bearer token, like the M3 session routes.
 * Every mutation is a strict JSON body with no price fields, applied atomically.
 */

const SEAT_DISCLAIMER = `Seat layouts are fictional. Choosing a seat doesn’t reserve it. ${airline.disclaimer}`;
const CATALOGUE_DISCLAIMER = `Services and prices are fictional. ${airline.disclaimer}`;
/** Product descriptions change only with a release, like fare families. */
const CATALOGUE_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

const flightParamsSchema = z.object({ id: flightInstanceIdSchema });
const sessionFlightParamsSchema = z.object({
  id: shoppingSessionIdSchema,
  flightId: flightInstanceIdSchema,
});
/** Traveller details for up to 18 people fit comfortably; anything larger is refused. */
const BODY_LIMIT = 16 * 1024;

export const bookingRoutes: FastifyPluginAsync<{ retailing: RetailingService }> = async (
  app,
  { retailing },
) => {
  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /** Layout plus live availability: the same for everyone, but never cached (it changes). */
  app.get('/v1/flights/:id/seatmap', async (request, reply) => {
    const params = parseInput(flightParamsSchema, request.params, reply);
    if (!params) return reply;
    const result = retailing.seatMap(params.id, request.scenario ?? undefined);
    if (!result.ok) return sendResult(reply, result);
    const body: SeatMapResponse = {
      data: result.value,
      meta: { disclaimer: SEAT_DISCLAIMER, serverTime: new Date().toISOString() },
    };
    return reply.header('cache-control', 'no-store').send(body);
  });

  app.get('/v1/ancillaries', async (_request, reply) => {
    const catalogue = retailing.ancillaryCatalogue();
    const body: AncillaryCatalogueResponse = {
      data: catalogue.data,
      meta: { ...catalogue.meta, disclaimer: CATALOGUE_DISCLAIMER },
    };
    return reply.header('cache-control', CATALOGUE_CACHE).send(body);
  });

  app.get('/v1/ancillaries/:productId', async (request, reply) => {
    const params = parseInput(ancillaryParamsSchema, request.params, reply);
    if (!params) return reply;
    const product = retailing.ancillaryProduct(params.productId);
    if (!product) return sendError(reply, 404, 'NOT_FOUND', 'We don’t offer that service.');
    return reply.header('cache-control', CATALOGUE_CACHE).send({
      data: product,
      meta: {
        catalogueVersion: retailing.ancillaryCatalogue().meta.catalogueVersion,
        disclaimer: CATALOGUE_DISCLAIMER,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Private to a session
  // ---------------------------------------------------------------------------

  app.get('/v1/shopping-sessions/:id/seatmaps/:flightId', async (request, reply) => {
    const params = parseInput(sessionFlightParamsSchema, request.params, reply);
    if (!params) return reply;
    const result = retailing.sessionSeatMap(
      params.id,
      bearerToken(request),
      params.flightId,
      request.scenario ?? undefined,
    );
    if (!result.ok) return sendResult(reply, result);
    const body: SessionSeatMapResponse = {
      data: result.value,
      meta: { disclaimer: SEAT_DISCLAIMER, serverTime: new Date().toISOString() },
    };
    return sendResult(reply, { ok: true, value: body });
  });

  app.get('/v1/shopping-sessions/:id/ancillaries', async (request, reply) => {
    const params = parseInput(sessionParamsSchema, request.params, reply);
    if (!params) return reply;
    const result = retailing.sessionAncillaries(
      params.id,
      bearerToken(request),
      request.scenario ?? undefined,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.get('/v1/shopping-sessions/:id/review', async (request, reply) => {
    const params = parseInput(sessionParamsSchema, request.params, reply);
    if (!params) return reply;
    const result = retailing.review(params.id, bearerToken(request), request.scenario ?? undefined);
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.put(
    '/v1/shopping-sessions/:id/passengers',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const params = parseInput(sessionParamsSchema, request.params, reply);
      if (!params) return reply;
      const body = parseInput(savePassengersRequestSchema, request.body ?? {}, reply);
      if (!body) return reply;
      const result = retailing.savePassengers(
        params.id,
        bearerToken(request),
        body,
        request.scenario ?? undefined,
      );
      return sendResult(
        reply,
        result.ok ? { ok: true, value: { data: result.value.session } } : result,
      );
    },
  );

  app.put('/v1/shopping-sessions/:id/seats', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const params = parseInput(sessionParamsSchema, request.params, reply);
    if (!params) return reply;
    const body = parseInput(updateSeatsRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = retailing.updateSeats(
      params.id,
      bearerToken(request),
      body,
      request.scenario ?? undefined,
    );
    return sendResult(
      reply,
      result.ok ? { ok: true, value: { data: result.value.session } } : result,
    );
  });

  app.put(
    '/v1/shopping-sessions/:id/ancillaries',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const params = parseInput(sessionParamsSchema, request.params, reply);
      if (!params) return reply;
      const body = parseInput(updateAncillariesRequestSchema, request.body ?? {}, reply);
      if (!body) return reply;
      const result = retailing.updateAncillaries(
        params.id,
        bearerToken(request),
        body,
        request.scenario ?? undefined,
      );
      return sendResult(
        reply,
        result.ok ? { ok: true, value: { data: result.value.session } } : result,
      );
    },
  );

  app.post('/v1/shopping-sessions/:id/steps', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const params = parseInput(sessionParamsSchema, request.params, reply);
    if (!params) return reply;
    const body = parseInput(completeStepRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = retailing.completeStep(
      params.id,
      bearerToken(request),
      body,
      request.scenario ?? undefined,
    );
    return sendResult(
      reply,
      result.ok ? { ok: true, value: { data: result.value.session } } : result,
    );
  });

  app.post(
    '/v1/shopping-sessions/:id/validate',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const params = parseInput(sessionParamsSchema, request.params, reply);
      if (!params) return reply;
      const body = parseInput(validateBookingRequestSchema, request.body ?? {}, reply);
      if (!body) return reply;
      const result = retailing.validateBooking(
        params.id,
        bearerToken(request),
        body.expectedVersion,
        request.scenario ?? undefined,
      );
      return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
    },
  );
};
