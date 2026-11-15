import type { HealthResponse } from '@aeronova/contracts';
import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync<{ version: string }> = async (app, options) => {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'aeronova-retailing-api',
    version: options.version,
  }));
};
