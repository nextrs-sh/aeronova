import {
  matchAirports,
  type Airport,
  type Destination,
  type DestinationListQuery,
} from '@aeronova/contracts';
import { AIRPORTS } from '../fixtures/airports';
import { DESTINATIONS } from '../fixtures/destinations';

/**
 * Read-only catalogue backed by in-memory fixtures. Milestone 2 adds inventory
 * and offers as sibling services; persistence (TalaDB) arrives only when orders do.
 */
export const catalog = {
  listAirports(query?: string): Airport[] {
    if (!query) return [...AIRPORTS];
    return matchAirports(query, AIRPORTS, AIRPORTS.length);
  },

  listDestinations(filter: DestinationListQuery = {}): Destination[] {
    return DESTINATIONS.filter(
      (destination) =>
        (filter.featured === undefined || destination.featured === filter.featured) &&
        (filter.region === undefined || destination.region === filter.region),
    );
  },

  getDestination(slug: string): Destination | undefined {
    return DESTINATIONS.find((destination) => destination.slug === slug);
  },
};
