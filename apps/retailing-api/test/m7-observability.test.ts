import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_REDACT_PATHS } from '../src/observability';
import { ADULT, CONTACT, newGuestToken, startHarness, type Harness } from './checkout-harness';
import { confirmedBooking } from './servicing-harness';

/*
 * Milestone 7: correlation ids, health endpoints, Prometheus metrics, and what the logs may
 * contain. Synthetic travellers only.
 */

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(...String(chunk).split('\n').filter(Boolean));
      done();
    },
  });
  return {
    lines,
    logger: {
      level: 'debug',
      stream,
      redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
      serializers: {
        req: (request: { method?: string; routeOptions?: { url?: string } }) => ({
          method: request.method,
          route: request.routeOptions?.url ?? '(unmatched)',
        }),
      },
    },
  };
}

describe('correlation ids', () => {
  it('keeps a well-formed incoming x-request-id and replaces anything else', async () => {
    harness = await startHarness();
    const kept = await harness.app.inject({
      url: '/health',
      headers: { 'x-request-id': 'proxy-req-0001' },
    });
    expect(kept.headers['x-request-id']).toBe('proxy-req-0001');
    const replaced = await harness.app.inject({
      url: '/health',
      headers: { 'x-request-id': 'bad id\nwith "injection"' },
    });
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const minted = await harness.app.inject({ url: '/health' });
    expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(minted.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('health endpoints', () => {
  it('separates liveness from readiness, and fails readiness while shutting down', async () => {
    harness = await startHarness();
    const live = await harness.call('/health/live');
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ status: 'ok', service: 'velasia-retailing-api' });
    expect(live.headers['cache-control']).toBe('no-store');

    const ready = await harness.call('/health/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ok', schemaVersion: 3, database: { ok: true } });
    // Never the database path.
    expect(ready.body).not.toMatch(/velasia\.db|\/tmp|data\//);

    harness.app.lifecycle.shuttingDown = true;
    const draining = await harness.call('/health/ready');
    expect(draining.statusCode).toBe(503);
    expect(draining.json().status).toBe('shutting-down');
    // Liveness is unaffected: the process is healthy, just leaving.
    expect((await harness.call('/health/live')).statusCode).toBe(200);
    harness.app.lifecycle.shuttingDown = false;
  });
});

describe('metrics', () => {
  it('publishes HTTP, writer, TalaDB, provider, and process metrics with bounded labels', async () => {
    harness = await startHarness();
    const booking = await confirmedBooking(harness);
    await harness.call(`/v1/orders/${booking.order.id}`, { token: booking.guest });
    await harness.call('/v1/orders/ord_doesnotexist0000000000', { token: newGuestToken() });

    const response = await harness.call('/metrics');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
    const text = response.body;
    expect(text).toMatch(
      /velasia_http_requests_total\{method="POST",route="\/v1\/checkout\/prepare",status="201"\} 1/,
    );
    expect(text).toMatch(
      /velasia_http_request_duration_seconds_bucket\{method="GET",route="\/v1\/orders\/:orderId",le="\+Inf"\} [1-9]/,
    );
    expect(text).toMatch(/velasia_writer_task_seconds_count [1-9]/);
    expect(text).toMatch(/velasia_writer_queue_depth 0/);
    expect(text).toMatch(
      /velasia_taladb_operation_seconds_count\{collection="orders",operation="insert",kind="write"\} 1/,
    );
    expect(text).toMatch(
      /velasia_simulated_provider_answers_total\{provider="payment",outcome="SUCCEEDED"\} 1/,
    );
    expect(text).toMatch(/velasia_api_errors_total\{code="ORDER_NOT_FOUND"\} 1/);
    expect(text).toMatch(/velasia_taladb_file_bytes \d+/);
    expect(text).toMatch(/velasia_inventory_active_holds 1/);
    expect(text).toMatch(/velasia_ready 1/);
    expect(text).toMatch(/process_resident_memory_bytes\{service="retailing-api"\} \d+/);
    expect(text).toMatch(
      /velasia_reconcile_duration_seconds_count\{scope="orders",trigger="startup"\} 1/,
    );
    // No ids, references, tokens, or personal data ever become labels.
    expect(text).not.toContain(booking.order.id);
    expect(text).not.toContain(booking.order.reference);
    expect(text).not.toContain(booking.guest);
    expect(text).not.toContain(ADULT.familyName);
    expect(text).not.toMatch(/ord_|ses_|off_|VEL-/);
  });

  it('requires the bearer token when one is configured', async () => {
    harness = await startHarness();
    await harness.close();
    const { buildApp } = await import('../src/app');
    const app = buildApp({ observability: { metricsToken: 'metrics-token-for-tests-0001' } });
    await app.ready();
    try {
      expect((await app.inject({ url: '/metrics' })).statusCode).toBe(401);
      expect(
        (await app.inject({ url: '/metrics', headers: { authorization: 'Bearer wrong' } }))
          .statusCode,
      ).toBe(401);
      const ok = await app.inject({
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-token-for-tests-0001' },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await app.close();
      harness = null;
    }
  });
});

describe('logs', () => {
  it('are structured JSON with request ids and route templates, and never carry personal data or credentials', async () => {
    const capture = captureLogs();
    harness = await startHarness({
      logger: capture.logger,
      config: { accounts: { registration: true, sessionMs: 60 * 60_000 } },
    });
    const booking = await confirmedBooking(harness, { passengers: [ADULT] });
    const password = 'Correct-Horse-Battery-9';
    const email = 'log.privacy@example.com';
    const registered = await harness.call('/v1/accounts', {
      method: 'POST',
      body: { email, password, givenName: 'Tala', familyName: 'Privacytest' },
      client: 'client-key-1',
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const session = registered.json().data.session.token as string;
    await harness.call('/v1/sessions', {
      method: 'POST',
      body: { email, password: 'wrong-password-123' },
      client: 'client-key-1',
    });
    await harness.call(`/v1/orders/${booking.order.id}`, {
      token: booking.guest,
      account: session,
    });
    // A request that fails validation, with personal data in the body.
    await harness.call('/v1/sessions', {
      method: 'POST',
      body: { email: 'not-an-email', password: 'x', phone: CONTACT.phone },
    });

    const logs = capture.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const completed = logs.filter((line) => line.msg === 'request completed');
    expect(completed.length).toBeGreaterThan(5);
    for (const line of completed) {
      expect(line.requestId).toEqual(expect.any(String));
      expect(line.route).toEqual(expect.any(String));
      expect(line.durationMs).toEqual(expect.any(Number));
    }
    expect(completed.some((line) => line.route === '/v1/orders/:orderId')).toBe(true);

    const all = capture.lines.join('\n');
    for (const secret of [
      password,
      'wrong-password-123',
      email,
      session,
      booking.guest,
      ADULT.givenName,
      ADULT.familyName,
      CONTACT.email,
      CONTACT.phone,
    ]) {
      expect(all, `log contains ${secret}`).not.toContain(secret);
    }
  });
});
