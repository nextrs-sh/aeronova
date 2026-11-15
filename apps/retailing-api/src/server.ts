import { buildApp } from './app';
import { loadConfig } from './config';

const port = Number(process.env.RETAILING_API_PORT ?? process.env.PORT ?? 4010);
const host = process.env.RETAILING_API_HOST ?? '127.0.0.1';
/** A shutdown that takes longer than this is cut short (the database stays consistent). */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const app = buildApp({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  config,
});

async function main() {
  try {
    await app.listen({ port, host });
    app.log.info(
      { today: config.today ?? 'system clock', ...config.inventory },
      'flight inventory ready',
    );
    app.log.info(
      {
        database: config.persistence.path,
        recovered: app.persistence.recovered,
        holdMinutes: config.checkout.holdMs / 60_000,
        paymentOutcomeControls: config.payments.outcomeControls,
      },
      'orders database ready',
    );
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    void app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error);
        process.exit(1);
      },
    );
  });
}

void main();
