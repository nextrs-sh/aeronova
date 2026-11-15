import {
  createFareCalendarQuerySchema,
  createFlightSearchQuerySchema,
  itineraryParamsSchema,
  itineraryQuerySchema,
  type FlightSearchResponse,
  type LegResult,
} from '@aeronova/contracts';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { AIRCRAFT } from '../fixtures/aircraft';
import { AIRPORTS } from '../fixtures/airports';
import { parseInput, sendError } from '../http';
import type { FlightService, ServiceResult } from '../services/flights';

const KNOWN_AIRPORTS: ReadonlySet<string> = new Set(AIRPORTS.map((airport) => airport.code));
const KNOWN_AIRCRAFT: ReadonlySet<string> = new Set(AIRCRAFT.map((aircraft) => aircraft.code));

/** Live inventory: never cache at a shared layer. */
const LIVE = 'private, no-store';

function send<T>(reply: FastifyReply, result: ServiceResult<T>) {
  if (!result.ok) {
    const issues = result.path ? [{ path: result.path, message: result.message }] : undefined;
    return sendError(
      reply,
      result.status,
      result.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
      result.message,
      issues,
    );
  }
  return reply.header('cache-control', LIVE).send(result.value);
}

function emptied(leg: LegResult): LegResult {
  return {
    ...leg,
    itineraries: [],
    pagination: { ...leg.pagination, totalItems: 0, totalPages: 0 },
    summary: {
      availableItineraries: 0,
      matchingItineraries: 0,
      lowestPerAdultMinor: null,
      emptyReason: 'no-flights-on-date',
      facets: { stops: [], departureWindows: [], aircraft: [], price: null },
    },
  };
}

export const flightRoutes: FastifyPluginAsync<{ flights: FlightService }> = async (
  app,
  { flights },
) => {
  // Validators depend on "today", which moves; build them per request (cheap).
  const searchSchema = () =>
    createFlightSearchQuerySchema({
      today: flights.current().referenceDate,
      knownAirportCodes: KNOWN_AIRPORTS,
      knownAircraftCodes: KNOWN_AIRCRAFT,
    });

  app.get('/v1/flights', async (request, reply) => {
    const query = parseInput(searchSchema(), request.query, reply);
    if (!query) return reply;
    const result = flights.search(query);
    if (result.ok && request.simulateEmpty) {
      const value: FlightSearchResponse = {
        ...result.value,
        data: { legs: result.value.data.legs.map(emptied) },
      };
      return send(reply, { ok: true, value });
    }
    return send(reply, result);
  });

  app.get('/v1/flights/calendar', async (request, reply) => {
    const schema = createFareCalendarQuerySchema({
      today: flights.current().referenceDate,
      knownAirportCodes: KNOWN_AIRPORTS,
    });
    const query = parseInput(schema, request.query, reply);
    if (!query) return reply;
    return send(reply, { ok: true, value: flights.calendar(query) });
  });

  app.get('/v1/flights/:id', async (request, reply) => {
    const params = parseInput(itineraryParamsSchema, request.params, reply);
    if (!params) return reply;
    const query = parseInput(itineraryQuerySchema, request.query, reply);
    if (!query) return reply;
    return send(reply, flights.itinerary(params.id, query));
  });

  app.get('/v1/flights/:id/availability', async (request, reply) => {
    const params = parseInput(itineraryParamsSchema, request.params, reply);
    if (!params) return reply;
    return send(reply, flights.availability(params.id));
  });
};
