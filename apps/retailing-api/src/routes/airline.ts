import { airline, type AirlineIdentity } from '@velasia/contracts';
import type { FastifyPluginAsync } from 'fastify';

/** The fictional operating airline's identity, so clients never hardcode the brand. */
export const airlineRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/airline', async (): Promise<AirlineIdentity> => ({
    name: airline.name,
    shortName: airline.shortName,
    tagline: airline.tagline,
    country: airline.country,
    currency: airline.currency,
    flightNumberPrefix: airline.flightNumberPrefix,
    isFictional: airline.isFictional,
    disclaimer: airline.disclaimer,
  }));
};
