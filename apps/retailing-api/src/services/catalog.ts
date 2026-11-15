import {
  destinationSchema,
  matchAirports,
  minorToMajor,
  type Airport,
  type Destination,
  type DestinationListQuery,
} from '@aeronova/contracts';
import { AIRPORTS } from '../fixtures/airports';
import { DESTINATION_CONTENT, type DestinationContent } from '../fixtures/destinations';
import type { FlightService } from './flights';

export type Catalog = ReturnType<typeof createCatalog>;

/**
 * Airports and destination guides. Editorial content comes from fixtures; each
 * guide's routes and "from" fare are derived from the live network and
 * indicative pricing, so the two can never drift apart.
 */
export function createCatalog(flights: FlightService) {
  const cache = new Map<string, Destination[]>();

  function withNetwork(content: DestinationContent): Destination {
    const { fareOrigin, ...editorial } = content;
    const routes = flights
      .routes()
      .filter((route) => content.airportCodes.includes(route.destination))
      .sort((a, b) => b.weeklyFrequency - a.weeklyFrequency || a.id.localeCompare(b.id))
      .map((route) => ({
        origin: route.origin,
        destination: route.destination,
        durationMinutes: route.blockMinutes,
        weeklyFrequency: route.weeklyFrequency,
      }));

    const fares = fareOrigin
      ? content.airportCodes
          .map((code) => flights.lowestFare(fareOrigin, code))
          .filter((fare): fare is number => fare !== null)
      : [];
    const lowest = fares.length > 0 ? Math.min(...fares) : null;

    return destinationSchema.parse({
      ...editorial,
      routes,
      ...(fareOrigin && lowest !== null
        ? {
            illustrativeFare: {
              amount: Math.floor(minorToMajor(lowest, 'PHP')),
              currency: 'PHP',
              origin: fareOrigin,
              cabin: 'economy',
              kind: 'illustrative',
            },
          }
        : {}),
    });
  }

  function all(): Destination[] {
    const key = flights.current().referenceDate;
    let destinations = cache.get(key);
    if (!destinations) {
      cache.clear();
      destinations = DESTINATION_CONTENT.map(withNetwork);
      cache.set(key, destinations);
    }
    return destinations;
  }

  return {
    listAirports(query?: string): Airport[] {
      if (!query) return [...AIRPORTS];
      return matchAirports(query, AIRPORTS, AIRPORTS.length);
    },

    listDestinations(filter: DestinationListQuery = {}): Destination[] {
      return all().filter(
        (destination) =>
          (filter.featured === undefined || destination.featured === filter.featured) &&
          (filter.region === undefined || destination.region === filter.region),
      );
    },

    getDestination(slug: string): Destination | undefined {
      return all().find((destination) => destination.slug === slug);
    },
  };
}
