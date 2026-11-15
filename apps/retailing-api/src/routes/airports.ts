import { airportListQuerySchema, type AirportListResponse } from '@aeronova/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { parseInput } from '../http';
import type { Catalog } from '../services/catalog';

export const airportRoutes: FastifyPluginAsync<{ catalog: Catalog }> = async (app, { catalog }) => {
  app.get('/v1/airports', async (request, reply) => {
    const query = parseInput(airportListQuerySchema, request.query, reply);
    if (!query) return reply;
    const body: AirportListResponse = { data: catalog.listAirports(query.q) };
    return body;
  });
};
