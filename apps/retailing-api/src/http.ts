import type { ApiError, ApiErrorCode } from '@aeronova/contracts';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

export function sendError(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  message: string,
): FastifyReply {
  const body: ApiError = { error: { code, message } };
  return reply.code(status).send(body);
}

/**
 * Parse request input with a shared contract. On failure, replies 400 and
 * returns `undefined` so the handler can return early.
 */
export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
  reply: FastifyReply,
): z.output<T> | undefined {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ');
  sendError(reply, 400, 'BAD_REQUEST', `Invalid request. ${detail}`);
  return undefined;
}
