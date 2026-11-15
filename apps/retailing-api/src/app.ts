import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { sendError } from './http';
import { airportRoutes } from './routes/airports';
import { destinationRoutes } from './routes/destinations';
import { healthRoutes } from './routes/health';

export const API_VERSION = '0.1.0';

/** Build the app without listening, so tests can use `app.inject()`. */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, ...options });

  app.register(healthRoutes, { version: API_VERSION });
  app.register(airportRoutes);
  app.register(destinationRoutes);

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, 404, 'NOT_FOUND', `Route ${request.method} ${request.url} not found.`),
  );

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) {
      return sendError(reply, status, 'BAD_REQUEST', (error as Error).message);
    }
    request.log.error(error);
    return sendError(reply, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  });

  return app;
}
