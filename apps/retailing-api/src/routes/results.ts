import type { FastifyReply } from 'fastify';
import { sendError } from '../http';
import type { RetailingResult } from '../offers/retailing-service';

/** Offers, prices, and sessions are live and per-traveller: never stored by any cache. */
export const PRIVATE_NO_STORE = 'private, no-store';

export function sendResult<T>(reply: FastifyReply, result: RetailingResult<T>, status = 200) {
  if (!result.ok) {
    const issues =
      result.issues ?? (result.path ? [{ path: result.path, message: result.message }] : undefined);
    return sendError(reply, result.status, result.code, result.message, issues);
  }
  if (result.value === null) return reply.code(204).header('cache-control', 'no-store').send();
  return reply.code(status).header('cache-control', PRIVATE_NO_STORE).send(result.value);
}
