import { buildApp } from './app';

const port = Number(process.env.RETAILING_API_PORT ?? process.env.PORT ?? 4010);
const host = process.env.RETAILING_API_HOST ?? '127.0.0.1';

const app = buildApp({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

async function main() {
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

void main();
