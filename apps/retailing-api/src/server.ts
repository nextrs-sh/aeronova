import { API_VERSION, buildApp } from './app';
import { describeConfigError, loadConfig, loadRuntimeConfig } from './config';
import { LOG_REDACT_PATHS } from './observability';

/*
 * The retailing API process (Milestone 7: production runtime).
 *
 * - Configuration is validated before anything opens; a bad value stops startup with the
 *   variable's name (never its value).
 * - Logs are JSON (pino, via Fastify) with credentials and personal fields redacted.
 * - SIGTERM/SIGINT: readiness fails at once, the listener closes, in-flight requests finish,
 *   queued TalaDB writes complete, changed shopping sessions are written, the database closes,
 *   and the process exits 0. Past `SHUTDOWN_TIMEOUT_MS` it exits 1 instead; TalaDB commits are
 *   atomic, and anything undecided (a payment the provider hasn't answered) is reconciled at the
 *   next start.
 */

function fail(message: string): never {
  // Before the logger exists: one JSON line on stderr, like every later log line.
  process.stderr.write(
    `${JSON.stringify({ level: 60, time: Date.now(), msg: 'startup failed', reason: message })}\n`,
  );
  process.exit(1);
}

let runtime: ReturnType<typeof loadRuntimeConfig>;
let config: ReturnType<typeof loadConfig>;
try {
  runtime = loadRuntimeConfig();
  config = loadConfig();
} catch (error) {
  fail(describeConfigError(error));
}

const app = buildApp({
  logger: {
    level: runtime.logLevel,
    redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'velasia-retailing-api', version: API_VERSION },
    // Request logs carry the route template, never the raw URL (ids) or the caller's address.
    serializers: {
      req: (request: { method?: string; routeOptions?: { url?: string } }) => ({
        method: request.method,
        route: request.routeOptions?.url ?? '(unmatched)',
      }),
    },
  },
  config,
  observability: { metricsToken: runtime.metricsToken, slowRequestMs: runtime.slowRequestMs },
  access: { serviceToken: runtime.serviceToken },
});

let shuttingDown = false;

async function main() {
  try {
    await app.listen({ port: runtime.port, host: runtime.host });
  } catch (error) {
    // e.g. DatabaseOpenError: the file is locked by another process, or a newer schema.
    app.log.fatal(
      { err: { name: (error as Error)?.name, message: (error as Error)?.message } },
      'retailing API failed to start',
    );
    process.exit(1);
  }
  app.log.info(
    { today: config.today ?? 'system clock', ...config.inventory },
    'flight inventory ready',
  );
  app.log.info(
    {
      schemaVersion: app.persistence.database.schema.schemaVersion,
      recovered: app.persistence.recovered,
      recoveredServicing: app.persistence.recoveredServicing,
      restoredShoppingSessions: app.persistence.restoredSessions,
      holdMinutes: config.checkout.holdMs / 60_000,
      paymentOutcomeControls: config.payments.outcomeControls,
      accountRegistration: config.accounts.registration,
      faults: config.faults.enabled,
      serviceToken: runtime.serviceToken ? 'required' : 'off',
      production: runtime.production,
    },
    'orders database ready',
  );
  if (runtime.production && config.payments.outcomeControls) {
    app.log.warn('PAYMENT_OUTCOME_CONTROLS is enabled in production (demo environments only)');
  }
}

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.lifecycle.shuttingDown = true;
  const started = Date.now();
  app.log.info({ signal, timeoutMs: runtime.shutdownTimeoutMs }, 'shutting down');
  setTimeout(() => {
    app.log.error({ signal, afterMs: Date.now() - started }, 'shutdown timed out; exiting');
    process.exit(1);
  }, runtime.shutdownTimeoutMs).unref();
  app.close().then(
    () => {
      app.log.info({ signal, durationMs: Date.now() - started }, 'shutdown complete');
      process.exit(0);
    },
    (error: unknown) => {
      app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    },
  );
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => shutdown(signal));

process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  app.log.fatal({ err: error }, 'uncaught exception; exiting');
  // Exit without a graceful close: state may be inconsistent in memory, never on disk.
  process.exit(1);
});

void main();
