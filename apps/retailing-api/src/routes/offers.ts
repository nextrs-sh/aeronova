import {
  airline,
  offerParamsSchema,
  offerSearchQuerySchema,
  type FareFamiliesResponse,
} from '@velasia/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { parseInput } from '../http';
import { PRICING_VERSION } from '../offers/offer-engine';
import type { RetailingService } from '../offers/retailing-service';
import { sendResult } from './results';

/** Fare family descriptions change only with a release: cacheable like other network content. */
const CATALOGUE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

export const offerRoutes: FastifyPluginAsync<{ retailing: RetailingService }> = async (
  app,
  { retailing },
) => {
  app.get('/v1/fare-families', async (_request, reply) => {
    const body: FareFamiliesResponse = {
      data: retailing.fareFamilies(),
      meta: {
        pricingVersion: PRICING_VERSION,
        disclaimer: `Fare families, allowances, and fees are fictional. ${airline.disclaimer}`,
      },
    };
    return reply.header('cache-control', CATALOGUE).send(body);
  });

  /**
   * Offers for one itinerary and party. Creates (or, within a minute, reuses) priced offers
   * in the bounded offer store: safe to repeat, never reserves seats.
   */
  app.get('/v1/offers', async (request, reply) => {
    const query = parseInput(offerSearchQuerySchema, request.query, reply);
    if (!query) return reply;
    return sendResult(reply, retailing.searchOffers(query, request.scenario ?? undefined));
  });

  app.get('/v1/offers/:offerId', async (request, reply) => {
    const params = parseInput(offerParamsSchema, request.params, reply);
    if (!params) return reply;
    return sendResult(reply, retailing.getOffer(params.offerId, request.scenario ?? undefined));
  });

  app.get('/v1/offers/:offerId/price', async (request, reply) => {
    const params = parseInput(offerParamsSchema, request.params, reply);
    if (!params) return reply;
    return sendResult(
      reply,
      retailing.checkOfferPrice(params.offerId, request.scenario ?? undefined),
    );
  });
};
