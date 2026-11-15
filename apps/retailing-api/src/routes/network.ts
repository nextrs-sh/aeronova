import {
  routeListQuerySchema,
  type AircraftListResponse,
  type RouteListResponse,
} from '@aeronova/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { parseInput } from '../http';
import type { FlightService } from '../services/flights';

const PUBLIC = 'public, max-age=300';

export const networkRoutes: FastifyPluginAsync<{ flights: FlightService }> = async (
  app,
  { flights },
) => {
  app.get('/v1/routes', async (request, reply) => {
    const query = parseInput(routeListQuerySchema, request.query, reply);
    if (!query) return reply;
    const body: RouteListResponse = { data: flights.routes(query) };
    return reply.header('cache-control', PUBLIC).send(body);
  });

  app.get('/v1/aircraft', async (_request, reply) => {
    const body: AircraftListResponse = { data: flights.aircraft() };
    return reply.header('cache-control', PUBLIC).send(body);
  });
};
