import {
  destinationListQuerySchema,
  destinationParamsSchema,
  type DestinationListResponse,
  type DestinationResponse,
} from '@aeronova/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { parseInput, sendError } from '../http';
import type { Catalog } from '../services/catalog';

export const destinationRoutes: FastifyPluginAsync<{ catalog: Catalog }> = async (
  app,
  { catalog },
) => {
  app.get('/v1/destinations', async (request, reply) => {
    const query = parseInput(destinationListQuerySchema, request.query, reply);
    if (!query) return reply;
    const body: DestinationListResponse = { data: catalog.listDestinations(query) };
    return body;
  });

  app.get('/v1/destinations/:slug', async (request, reply) => {
    const params = parseInput(destinationParamsSchema, request.params, reply);
    if (!params) return reply;
    const destination = catalog.getDestination(params.slug);
    if (!destination) {
      return sendError(reply, 404, 'NOT_FOUND', `No destination found for "${params.slug}".`);
    }
    const body: DestinationResponse = { data: destination };
    return body;
  });
};
