import type { Page, Request } from '@playwright/test';
import { expectConfirmed, pay, toCheckout } from './checkout-flow';
import { toReview } from './booking-flow';
import { expect, test } from './helpers';

/*
 * Milestone 7: production-mode behaviour of the standalone server — security headers, CSP
 * against the real Next.js output, Server Action origin checks, internal endpoints, and
 * requests that try to reach files. Synthetic travellers only.
 */

const SEARCH = '/flights?from=MNL&to=SIN&departureDate=2026-12-15&adults=1&children=0&infants=0';

function cspViolations(page: Page) {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  return violations;
}

test.describe('security headers', () => {
  for (const [label, path] of [
    ['static page', '/'],
    ['partial prerender', '/booking/travellers'],
    ['request-time search', SEARCH],
    ['route handler', '/api/flights?from=MNL&to=SIN&departureDate=2026-12-15&adults=1'],
  ] as const) {
    test(`are sent on a ${label}`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect(headers['content-security-policy']).toContain("default-src 'self'");
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['content-security-policy']).toContain("object-src 'none'");
      expect(headers['content-security-policy']).not.toContain('unsafe-eval');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['permissions-policy']).toContain('camera=()');
      expect(headers['x-powered-by']).toBeUndefined();
    });
  }

  test('keep personal pages out of shared caches and let static pages be cached', async ({
    request,
  }) => {
    for (const path of ['/account/trips', '/booking/travellers', '/manage-booking', SEARCH]) {
      const cacheControl = (await request.get(path)).headers()['cache-control'] ?? '';
      expect(cacheControl, path).toMatch(/private/);
      expect(cacheControl, path).toMatch(/no-store/);
    }
    expect((await request.get('/')).headers()['cache-control']).toMatch(/s-maxage=\d+/);
    const live = await request.get(
      '/api/flights?from=MNL&to=SIN&departureDate=2026-12-15&adults=1',
    );
    expect(live.headers()['cache-control']).toBe('private, no-store');
  });
});

test('a full booking runs under the Content Security Policy with no violations', async ({
  page,
}) => {
  const violations = cspViolations(page);
  await toReview(page);
  await toCheckout(page);
  await pay(page, 'Demo Card', 'Approve');
  await expectConfirmed(page);
  await page.goto('/destinations');
  await page.goto('/');
  // Images (next/image), fonts (next/font), streamed RSC, and Server Actions all worked.
  expect(violations).toEqual([]);
});

async function captureServerAction(page: Page): Promise<Request> {
  await page.goto('/manage-booking');
  const action = page.waitForRequest(
    (request) => request.method() === 'POST' && Boolean(request.headers()['next-action']),
  );
  await page.getByRole('textbox', { name: 'Booking reference' }).fill('VEL-8K4P2Q');
  await page.getByTestId('lookup-submit').click();
  return action;
}

test.describe('Server Actions', () => {
  test('refuse a cross-site request and accept the same request from the site', async ({
    page,
  }) => {
    const captured = await captureServerAction(page);
    const headers = { ...captured.headers() };
    delete headers['content-length'];
    const body = captured.postDataBuffer()!;

    const sameSite = await page.request.post(captured.url(), { headers, data: body });
    expect(sameSite.status()).toBe(200);
    expect(await sameSite.text()).toContain('couldn’t open a booking');

    const crossSite = await page.request.post(captured.url(), {
      headers: { ...headers, origin: 'https://evil.example' },
      data: body,
    });
    expect(crossSite.status()).toBeGreaterThanOrEqual(400);
    expect(await crossSite.text()).not.toContain('couldn’t open a booking');
  });

  test('refuse oversized request bodies', async ({ page }) => {
    const captured = await captureServerAction(page);
    const headers = { ...captured.headers() };
    delete headers['content-length'];
    const boundary = /boundary=(.+)$/.exec(headers['content-type'] ?? '')?.[1];
    test.skip(!boundary, 'the action is not multipart in this build');
    const padding = `--${boundary}\r\nContent-Disposition: form-data; name="padding"\r\n\r\n${'x'.repeat(200 * 1024)}\r\n`;
    const response = await page.request.post(captured.url(), {
      headers,
      data: Buffer.concat([Buffer.from(padding), captured.postDataBuffer()!]),
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe('internal endpoints', () => {
  test('liveness, readiness, and metrics answer (the proxy hides them publicly)', async ({
    request,
  }) => {
    const live = await request.get('/api/internal/health/live');
    expect(live.status()).toBe(200);
    expect(live.headers()['cache-control']).toBe('no-store');
    const ready = await request.get('/api/internal/health/ready');
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ok', retailingApi: 'ready' });
    await request.get('/api/flights?from=MNL&to=SIN&departureDate=2026-12-15&adults=1');
    const metrics = await request.get('/api/internal/metrics');
    expect(metrics.headers()['content-type']).toContain('text/plain');
    const text = await metrics.text();
    expect(text).toMatch(
      /velasia_web_upstream_requests_total\{operation="\/v1\/flights",method="GET",outcome="ok"\} \d+/,
    );
    expect(text).toMatch(/process_resident_memory_bytes\{service="web"\}/);
    expect(text).not.toMatch(/ord_|ses_|VEL-/);
  });
});

test('requests that try to reach files or internals get nothing', async ({ request }) => {
  for (const path of [
    '/.env',
    '/.env.production',
    '/velasia.db',
    '/data/velasia.db',
    '/_next/static/..%2f..%2f..%2fpackage.json',
    '/_next/static/../../../.env',
    '/api/offers/..%2F..%2Fv1%2Forders',
    '/api/flights/..%2F..%2F..%2Fetc%2Fpasswd',
    '/public/../package.json',
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const body = await response.text();
    expect([400, 404, 308], path).toContain(response.status());
    expect(body, path).not.toMatch(/"dependencies"|root:x:0:0|TALADB_PATH|SQLite|redb/);
  }
  const bad = await request.get('/api/flights?from=../../etc&to=SIN&departureDate=x');
  expect(bad.status()).toBe(400);
  expect(await bad.text()).not.toMatch(/at .*\.js:\d+|127\.0\.0\.1|4210/);
});
