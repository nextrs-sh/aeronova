import type { ApiError, ApiErrorCode, ApiErrorIssue } from '@velasia/contracts';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

declare module 'fastify' {
  interface FastifyReply {
    /** The API error code sent, for metrics (Milestone 7). */
    apiErrorCode?: ApiErrorCode;
  }
}

export function sendError(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  message: string,
  issues?: ApiErrorIssue[],
): FastifyReply {
  const body: ApiError = { error: { code, message, ...(issues?.length ? { issues } : {}) } };
  reply.apiErrorCode = code;
  return reply.code(status).header('cache-control', 'no-store').send(body);
}

/**
 * Parse request input with a shared contract. On failure, replies 400 with
 * every field-level issue and returns `undefined` so the handler can return early.
 */
export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
  reply: FastifyReply,
): z.output<T> | undefined {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || 'input',
    message: issue.message,
  }));
  const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
  sendError(reply, 400, 'BAD_REQUEST', `Invalid request. ${detail}`, issues);
  return undefined;
}
