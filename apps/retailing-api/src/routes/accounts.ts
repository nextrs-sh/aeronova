import {
  changePasswordRequestSchema,
  createTravellerRequestSchema,
  linkBookingsRequestSchema,
  registerRequestSchema,
  signInRequestSchema,
  travellerParamsSchema,
  tripsQuerySchema,
  updateProfileRequestSchema,
  updateTravellerRequestSchema,
  ACCOUNT_RULES,
} from '@velasia/contracts';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  toPublicAccount,
  type AccountService,
  type AuthenticatedSession,
} from '../accounts/account-service';
import { parseInput, sendError } from '../http';
import { accountToken, clientKey } from './principal';
import { sendResult } from './results';
import { bearerToken } from './shopping';

/*
 * Demo accounts (Milestone 6). Every answer is `private, no-store`. Passwords are accepted only
 * in request bodies (never URLs) and never logged: Fastify's request logging records no bodies.
 *
 *   POST   /v1/accounts                 register (demo; switched off unless enabled)
 *   POST   /v1/sessions                 sign in (rotates the presented session, if any)
 *   DELETE /v1/sessions/current         sign out
 *   GET    /v1/me                       the signed-in account
 *   PUT    /v1/me                       update names
 *   POST   /v1/me/password              change password (ends every other session)
 *   POST   /v1/me/sessions/revoke-all   sign out everywhere
 *   GET    /v1/me/orders                My Trips: one section, one page, projections only
 *   GET    /v1/guest/orders             this guest's bookings that can be linked (guest bearer)
 *   POST   /v1/me/orders/link           link those bookings (guest bearer + account)
 *   GET|POST /v1/me/travellers, PUT|DELETE /v1/me/travellers/:travellerId
 */

const BODY_LIMIT = 2 * 1024;

export const accountRoutes: FastifyPluginAsync<{ accounts: AccountService }> = async (
  app,
  { accounts },
) => {
  async function authenticated(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | null> {
    const auth = await accounts.sessionFor(accountToken(request));
    if (!auth) sendError(reply, 401, 'UNAUTHENTICATED', 'Please sign in again.');
    return auth;
  }

  app.post('/v1/accounts', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(registerRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await accounts.register(body, clientKey(request));
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result, 201);
  });

  app.post('/v1/sessions', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(signInRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await accounts.signIn(body, clientKey(request), accountToken(request));
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.delete('/v1/sessions/current', async (request, reply) => {
    await accounts.signOut(accountToken(request));
    return reply.code(204).header('cache-control', 'no-store').send();
  });

  app.get('/v1/me', async (request, reply) => {
    const auth = await authenticated(request, reply);
    if (!auth) return reply;
    return sendResult(reply, {
      ok: true,
      value: {
        data: {
          account: toPublicAccount(auth.account),
          sessionExpiresAt: new Date(auth.session.expiresAt).toISOString(),
        },
      },
    });
  });

  app.put('/v1/me', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(updateProfileRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await accounts.updateProfile(accountToken(request), body);
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post('/v1/me/password', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(changePasswordRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await accounts.changePassword(accountToken(request), body);
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.post('/v1/me/sessions/revoke-all', async (request, reply) => {
    const result = await accounts.signOutEverywhere(accountToken(request));
    return sendResult(reply, result);
  });

  app.get('/v1/me/orders', async (request, reply) => {
    const auth = await authenticated(request, reply);
    if (!auth) return reply;
    const query = parseInput(tripsQuerySchema, request.query ?? {}, reply);
    if (!query) return reply;
    const trips = await accounts.trips(
      auth.account.accountId,
      query.section,
      query.page,
      query.pageSize,
    );
    return sendResult(reply, { ok: true, value: trips });
  });

  app.get('/v1/guest/orders', async (request, reply) => {
    const linkable = await accounts.linkable(bearerToken(request));
    return sendResult(reply, { ok: true, value: { data: linkable } });
  });

  app.post('/v1/me/orders/link', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const auth = await authenticated(request, reply);
    if (!auth) return reply;
    const body = parseInput(linkBookingsRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await accounts.link(auth.account.accountId, bearerToken(request), body.orderIds);
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.get('/v1/me/travellers', async (request, reply) => {
    const auth = await authenticated(request, reply);
    if (!auth) return reply;
    const data = await accounts.listTravellers(auth.account.accountId);
    return sendResult(reply, {
      ok: true,
      value: { data, meta: { max: ACCOUNT_RULES.maxSavedTravellers } },
    });
  });

  app.post('/v1/me/travellers', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const auth = await authenticated(request, reply);
    if (!auth) return reply;
    const body = parseInput(createTravellerRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await accounts.createTraveller(
      auth.account.accountId,
      body.idempotencyKey,
      body.traveller,
    );
    if (!result.ok) return sendResult(reply, result);
    return sendResult(
      reply,
      { ok: true, value: { data: result.value.traveller } },
      result.value.replayed ? 200 : 201,
    );
  });

  app.put('/v1/me/travellers/:travellerId', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const auth = await authenticated(request, reply);
    if (!auth) return reply;
    const params = parseInput(travellerParamsSchema, request.params, reply);
    if (!params) return reply;
    const body = parseInput(updateTravellerRequestSchema, request.body ?? {}, reply);
    if (!body) return reply;
    const result = await accounts.updateTraveller(
      auth.account.accountId,
      params.travellerId,
      body.expectedRevision,
      body.traveller,
    );
    return sendResult(reply, result.ok ? { ok: true, value: { data: result.value } } : result);
  });

  app.delete('/v1/me/travellers/:travellerId', async (request, reply) => {
    const auth = await authenticated(request, reply);
    if (!auth) return reply;
    const params = parseInput(travellerParamsSchema, request.params, reply);
    if (!params) return reply;
    return sendResult(
      reply,
      await accounts.deleteTraveller(auth.account.accountId, params.travellerId),
    );
  });
};
