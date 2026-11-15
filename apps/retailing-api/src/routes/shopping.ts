import {
  createSessionRequestSchema,
  repriceRequestSchema,
  selectOfferRequestSchema,
  shoppingSessionIdSchema,
  type CreateSessionResponse,
} from '@velasia/contracts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../http';
import type { RetailingService } from '../offers/retailing-service';
import { sendResult } from './results';

const sessionParamsSchema = z.object({ id: shoppingSessionIdSchema });

/** Sessions are authorised by the secret token returned at creation, as a bearer token. */
function bearerToken(request: FastifyRequest): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
  return match?.[1];
}

/** Small JSON bodies only. */
const BODY_LIMIT = 4 * 1024;

export const shoppingRoutes: FastifyPluginAsync<{ retailing: RetailingService }> = async (
  app,
  { retailing },
) => {
  app.post('/v1/shopping-sessions', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(createSessionRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = retailing.createSession(body.search, request.scenario ?? undefined);
    if (!result.ok) return sendResult(reply, result);
    const created: CreateSessionResponse = { data: result.value };
    return sendResult(reply, { ok: true, value: created }, 201);
  });

  app.get('/v1/shopping-sessions/:id', async (request, reply) => {
    const params = parseInput(sessionParamsSchema, request.params, reply);
    if (!params) return reply;
    const result = retailing.getSession(
      params.id,
      bearerToken(request),
      request.scenario ?? undefined,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post(
    '/v1/shopping-sessions/:id/select',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const params = parseInput(sessionParamsSchema, request.params, reply);
      if (!params) return reply;
      const body = parseInput(selectOfferRequestSchema, request.body ?? {}, reply);
      if (!body) return reply;
      const result = retailing.select(
        params.id,
        bearerToken(request),
        body,
        request.scenario ?? undefined,
      );
      return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
    },
  );

  app.post(
    '/v1/shopping-sessions/:id/reprice',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const params = parseInput(sessionParamsSchema, request.params, reply);
      if (!params) return reply;
      const body = parseInput(repriceRequestSchema, request.body ?? {}, reply);
      if (!body) return reply;
      const result = retailing.reprice(
        params.id,
        bearerToken(request),
        body.directions,
        request.scenario ?? undefined,
      );
      return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
    },
  );

  app.delete('/v1/shopping-sessions/:id', async (request, reply) => {
    const params = parseInput(sessionParamsSchema, request.params, reply);
    if (!params) return reply;
    return sendResult(reply, retailing.deleteSession(params.id, bearerToken(request)));
  });
};
