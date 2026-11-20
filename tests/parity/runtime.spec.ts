import { expect, test, type Page } from '@playwright/test';
import {
  ACCOUNTS_OPEN,
  API_FLIGHTS,
  DEPART,
  SEARCH,
  addDays,
  pinClock,
  shown,
  waitForSearchWidget,
  watch,
  type Problems,
} from './support';

/*
 * Milestone 8: the same behaviour checks against each storefront runtime. Playwright runs this
 * file once per project (`node`, `nextrs`; see playwright.parity.config.ts); a runtime passes
 * only what it actually serves. Routes and selectors are Velasia's own (apps/web/src/app,
 * tests/e2e). Every browser test fails on any uncaught page error, console error (hydration
 * errors included) or unexpected failed/>=400 request.
 */

test.beforeEach(async ({ page }) => pinClock(page));

// ---------------------------------------------------------------------------------------------
test.describe('static and prerendered routes', () => {
  // Prerendered at build time (Cache Components static shells / generateStaticParams).
  for (const [path, heading] of [
    ['/', /Beyond every\s*horizon\./],
    ['/destinations', /Destinations across Asia/],
    ['/help', /How can we help\?/],
    ['/about', /./],
    ['/credits', /./],
  ] as const) {
    test(`${path} is served from the build output`, async ({ request }) => {
      const r = await request.get(path);
      expect(r.status()).toBe(200);
      expect(r.headers()['content-type']).toContain('text/html');
      expect(r.headers()['cache-control'] ?? '').toMatch(/s-maxage=\d+/);
      const html = await r.text();
      expect(html).toMatch(new RegExp(`<h1[^>]*>[\\s\\S]*?${heading.source}`));
      test.info().annotations.push({
        type: 'cache',
        description: `x-nextjs-cache=${r.headers()['x-nextjs-cache'] ?? '-'} x-nextjs-prerender=${r.headers()['x-nextjs-prerender'] ?? '-'}`,
      });
    });
  }

  test('a generateStaticParams destination, then client navigation to it', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/destinations');
    const link = page.locator('main a[href^="/destinations/"]').first();
    const href = (await link.getAttribute('href'))!;
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    const title = await page.getByRole('heading', { level: 1 }).textContent();
    const reload = await page.reload();
    expect(reload!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title!);
    expect(problems.errors).toEqual([]);
  });

  test('metadata routes: robots.txt, sitemap.xml, manifest', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('<urlset');
    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.status()).toBe(200);
    expect((await manifest.json()).name).toMatch(/Velasia/);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('dynamic rendering (request time)', () => {
  test('flight results: PPR static shell plus streamed results, never cached', async ({
    request,
  }) => {
    const r = await request.get(SEARCH);
    expect(r.status()).toBe(200);
    const cc = r.headers()['cache-control'] ?? '';
    expect(cc).toMatch(/private/);
    expect(cc).toMatch(/no-store/);
    const html = await r.text();
    // The streamed part: flight cards resolved into the document plus the RSC payload pushes.
    expect(html).toContain('data-testid="flight-card"');
    expect(html).toContain('self.__next_f.push');
  });

  test('personal pages are private and uncached', async ({ request }) => {
    for (const path of ['/booking/travellers', '/manage-booking', '/account/sign-in']) {
      const r = await request.get(path);
      expect(r.status(), path).toBeLessThan(500);
      const cc = r.headers()['cache-control'] ?? '';
      expect(cc, path).toMatch(/private/);
      expect(cc, path).toMatch(/no-store/);
    }
  });

  test('RSC payload request answers in the Flight format', async ({ request }) => {
    const r = await request.get('/destinations', { headers: { RSC: '1' } });
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('text/x-component');
    expect((await r.body()).length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('delivery', () => {
  test('CSS and JavaScript are delivered immutable and applied; page hydrates', async ({
    page,
  }) => {
    const problems = watch(page);
    const assets: { url: string; status: number; cache: string }[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/_next/static/'))
        assets.push({
          url: r.url(),
          status: r.status(),
          cache: r.headers()['cache-control'] ?? '',
        });
    });
    await page.goto('/');
    await expect(page.getByRole('search', { name: 'Search flights' })).toBeVisible();
    // data-ready is set by a client effect: present only after React hydrated the widget.
    await waitForSearchWidget(page);
    await page.waitForLoadState('networkidle');
    expect(assets.filter((a) => /\.css/.test(a.url)).length).toBeGreaterThan(0);
    expect(assets.filter((a) => /\.js/.test(a.url)).length).toBeGreaterThan(0);
    for (const a of assets) {
      expect(a.status, a.url).toBe(200);
      expect(a.cache, a.url).toContain('immutable');
    }
    const rules = await page.evaluate(() =>
      [...document.styleSheets].reduce((n, s) => n + (s.cssRules?.length ?? 0), 0),
    );
    expect(rules).toBeGreaterThan(50);
    expect(problems.errors).toEqual([]);
  });

  test('public images and next/image optimisation', async ({ page, request }) => {
    await page.goto('/');
    const src = await page
      .locator('img[src*="/_next/image"], img[srcset*="/_next/image"]')
      .first()
      .evaluate((img: HTMLImageElement) => img.currentSrc || img.src);
    const optimised = await request.get(src, { headers: { accept: 'image/avif,image/webp,*/*' } });
    expect(optimised.status(), src).toBe(200);
    expect(optimised.headers()['content-type']).toMatch(/^image\//);
    const original = new URL(src).searchParams.get('url')!;
    const raw = await request.get(original);
    expect(raw.status(), original).toBe(200);
    expect(raw.headers()['content-type']).toMatch(/^image\//);
  });

  test('security headers from next.config, no x-powered-by', async ({ request }) => {
    for (const path of ['/', SEARCH, API_FLIGHTS]) {
      const h = (await request.get(path, { maxRedirects: 0 })).headers();
      expect(h['content-security-policy'], path).toContain("default-src 'self'");
      expect(h['x-frame-options'], path).toBe('DENY');
      expect(h['x-content-type-options'], path).toBe('nosniff');
      expect(h['x-powered-by'], path).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('routing, redirects and errors', () => {
  test('client-side navigation uses RSC payloads, no document reloads', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/');
    await waitForSearchWidget(page);
    await page.evaluate(() => ((window as unknown as { __parity: number }).__parity = 42));
    const docs = problems.documents.length;
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const [link, url, heading] of [
      ['Explore destinations', /\/destinations$/, 'Destinations across Asia'],
      ['Book flights', /\/flights$/, 'Where would you like to go?'],
      ['Manage booking', /\/manage-booking$/, 'Your trip, in your hands'],
      ['Help', /\/help$/, 'How can we help?'],
    ] as const) {
      await nav.getByRole('link', { name: link }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    await page.goBack();
    await expect(page).toHaveURL(/\/manage-booking$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/help$/);
    expect(await page.evaluate(() => (window as unknown as { __parity?: number }).__parity)).toBe(
      42,
    );
    expect(problems.documents.length).toBe(docs);
    expect(problems.rsc.length).toBeGreaterThan(0);
    expect(problems.errors).toEqual([]);
  });

  test('unknown page: 404 status with the app not-found page', async ({ page }) => {
    const problems = watch(page, [
      /http 404: GET .*\/this-page-does-not-exist/,
      /console: Failed to load resource: the server responded with a status of 404/,
    ]);
    const r = await page.goto('/this-page-does-not-exist');
    expect(r!.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: 'This page has flown off course' }),
    ).toBeVisible();
    expect(problems.errors).toEqual([]);
  });

  test('redirects from next.config (308 permanent, 307 temporary)', async ({ request }) => {
    const a = await request.get('/booking/travelers', { maxRedirects: 0 });
    expect(a.status()).toBe(308);
    expect(a.headers()['location']).toMatch(/\/booking\/travellers$/);
    const b = await request.get('/checkout', { maxRedirects: 0 });
    expect(b.status()).toBe(307);
    expect(b.headers()['location']).toMatch(/\/booking\/checkout$/);
  });

  test('invalid search: route handler 4xx and the app error state', async ({ page, request }) => {
    const api = await request.get('/api/flights?from=MNL&to=MNL&departureDate=2001-01-01&adults=0');
    expect(api.status()).toBeGreaterThanOrEqual(400);
    expect(api.status()).toBeLessThan(500);
    const problems = watch(page);
    await page.goto('/flights?trip=round-trip&from=MNL&to=MNL&depart=2001-01-01&adults=0');
    await expect(
      page.getByRole('alert').filter({ hasText: 'We couldn’t run this search' }),
    ).toBeVisible();
    expect(problems.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('route handlers and health', () => {
  test('reference data from the shared API', async ({ request }) => {
    for (const path of [
      '/api/airports',
      '/api/destinations',
      '/api/fare-families',
      '/api/aircraft',
      '/api/routes',
      '/api/ancillaries',
    ]) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(200);
      expect(r.headers()['content-type'], path).toContain('application/json');
    }
  });

  test('live flight search JSON is private and has results', async ({ request }) => {
    const r = await request.get(API_FLIGHTS);
    expect(r.status()).toBe(200);
    expect(r.headers()['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(await r.json())).toMatch(/NV\d+/);
  });

  test('health: live and ready (the API is reachable from this runtime)', async ({ request }) => {
    const live = await request.get('/api/internal/health/live');
    expect(live.status()).toBe(200);
    expect(live.headers()['cache-control']).toBe('no-store');
    const ready = await request.get('/api/internal/health/ready');
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ok', retailingApi: 'ready' });
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('flight search and details', () => {
  test('homepage search form shows results from the API', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/');
    await waitForSearchWidget(page);
    for (const [label, query, option] of [
      ['From', 'Manila', /Manila/],
      ['To', 'Singapore', /Singapore/],
    ] as const) {
      const input = page.getByRole('combobox', { name: label });
      await input.click();
      await input.fill(query);
      await page
        .getByRole('listbox', { name: `${label} airports` })
        .getByRole('option', { name: option })
        .first()
        .click();
    }
    await page.getByLabel('Depart', { exact: true }).fill(DEPART);
    await page.getByLabel('Return', { exact: true }).fill(addDays(28));
    await page.getByRole('button', { name: 'Search flights' }).click();
    await expect(page).toHaveURL(/\/flights\?.*from=MNL.*to=SIN/);
    await expect(page.getByTestId('flight-card').first()).toBeVisible();
    expect(problems.errors).toEqual([]);
  });

  test('flight details dialog and the stops filter', async ({ page }) => {
    const problems = watch(page);
    await page.goto(
      `/flights?trip=one-way&from=CEB&to=SIN&depart=${addDays(22)}&adults=1&cabin=economy`,
    );
    const card = page.getByTestId('flight-card').first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /^Details/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Flight details' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/VEL \d+/);
    await dialog.getByRole('button', { name: 'Close flight details' }).click();
    await page.getByRole('radio', { name: /Direct flights only/ }).check();
    await expect(page.locator('[data-pending]')).toHaveCount(0);
    await expect(page).toHaveURL(/stops=/);
    expect(problems.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial('booking and checkout (Server Actions, cookies, API writes)', () => {
  let page: Page;
  let problems: Problems;
  let reference = '';
  let orderUrl = '';

  test.beforeAll(async ({ browser, baseURL }) => {
    page = await browser.newPage({ baseURL });
    await pinClock(page);
    problems = watch(page);
  });
  test.afterAll(async () => page.close());

  test('select a flight and fare', async () => {
    await page.goto(SEARCH);
    const card = page.getByTestId('flight-card').first();
    await card.getByRole('link', { name: /View fares/ }).click();
    await expect(page.getByTestId('fare-cards')).toBeVisible();
    await page
      .locator('[data-testid="fare-card"][data-family="CLASSIC"]')
      .getByRole('button', { name: /^(Select|Continue with) Classic/ })
      .click();
    await expect(page.getByTestId('trip-summary')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to traveller details' }).click();
    await expect(page).toHaveURL(/\/booking\/travellers$/);
  });

  test('travellers', async () => {
    const card = page.getByTestId('traveller-ADT1');
    await card.getByLabel('Given names').fill('Amihan');
    await card.getByLabel('Family name').fill('Dela Cruz');
    await card.getByLabel('Date of birth').fill('1990-04-12');
    await card.getByLabel('Nationality').selectOption('PH');
    await page.getByLabel('Email').fill('amihan.delacruz@example.com');
    await page.getByLabel('Mobile phone').fill('+63 917 555 0123');
    await page.getByTestId('save-travellers').click();
    await expect(page).toHaveURL(/\/booking\/seats/);
  });

  test('seat (held by the API), extras, review, review refresh', async () => {
    await expect(page.locator('[data-testid="seat-selector"][data-ready="true"]')).toBeVisible();
    const free = page.locator('[data-testid="seat-map"] [data-look="available"]');
    const n = await free.count();
    expect(n).toBeGreaterThan(0);
    await free.nth(Math.floor(Math.random() * Math.min(n, 30))).click();
    await page.getByTestId('choose-seat').click();
    await expect(page.getByTestId('seat-saved')).toBeVisible();
    await page.getByTestId('continue-seats').click();
    await expect(page).toHaveURL(/\/booking\/extras$/);
    await expect(
      page.locator('[data-testid^="baggage-"][data-ready="true"]').first(),
    ).toBeVisible();
    await page.getByTestId('continue-extras').click();
    await expect(page).toHaveURL(/\/booking\/review$/);
    await expect(shown(page, 'review-ready')).toBeVisible();
    expect((await page.reload())!.status()).toBe(200);
    await expect(shown(page, 'review-ready')).toBeVisible();
  });

  test('checkout and payment, then confirmation', async () => {
    await page.getByTestId('continue-checkout').click();
    await expect(page).toHaveURL(/\/booking\/checkout$/, { timeout: 30_000 });
    await expect(page.getByTestId('checkout')).toHaveAttribute(
      'data-order-status',
      'PENDING_PAYMENT',
    );
    const form = page.locator('[data-testid="payment-form"][data-ready="true"]');
    await form.getByRole('radio', { name: /^Demo Card/ }).check();
    const approve = form.getByRole('radio', { name: /^Approve/ });
    if (await approve.count()) await approve.check();
    await form.getByTestId('pay-button').click();
    await expect(page).toHaveURL(/\/booking\/confirmation\/ord_[A-Za-z0-9_-]{22}$/, {
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
    reference = (await page.getByTestId('booking-reference').textContent())!.trim();
    expect(reference).toMatch(/^VEL-[A-HJKMNP-Z2-9]{6}$/);
    orderUrl = page.url();
  });

  test('manage booking by reference; confirmation survives a hard refresh', async () => {
    test.skip(!reference, 'no confirmed booking from the previous step');
    await page.goto('/manage-booking');
    await page.getByRole('textbox', { name: 'Booking reference' }).fill(reference);
    await shown(page, 'lookup-submit').click();
    await expect(page).toHaveURL(/\/manage-booking\/ord_[A-Za-z0-9_-]{22}/, { timeout: 30_000 });
    await expect(page.getByText(reference).first()).toBeVisible();
    const r = await page.goto(orderUrl);
    expect(r!.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
  });

  test('no browser errors during the journey', async () => {
    expect(problems.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('Server Actions', () => {
  async function lookup(page: Page) {
    await page.goto('/manage-booking');
    const action = page.waitForRequest(
      (r) => r.method() === 'POST' && Boolean(r.headers()['next-action']),
    );
    await page.getByRole('textbox', { name: 'Booking reference' }).fill('VEL-ZZZZZZ');
    await shown(page, 'lookup-submit').click();
    return action;
  }

  test('unknown reference: the action runs and shows the app error', async ({ page }) => {
    const problems = watch(page);
    await lookup(page);
    await expect(shown(page, 'action-error')).toContainText('couldn’t open a booking');
    expect(problems.errors).toEqual([]);
  });

  test('cross-site action request is refused', async ({ page }) => {
    const captured = await lookup(page);
    const headers = { ...captured.headers() };
    delete headers['content-length'];
    const body = captured.postDataBuffer()!;
    expect((await page.request.post(captured.url(), { headers, data: body })).status()).toBe(200);
    const cross = await page.request.post(captured.url(), {
      headers: { ...headers, origin: 'https://evil.example' },
      data: body,
    });
    expect(cross.status()).toBeGreaterThanOrEqual(400);
    expect(await cross.text()).not.toContain('couldn’t open a booking');
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('accounts', () => {
  test('register, sign out, sign in', async ({ page }) => {
    test.skip(!ACCOUNTS_OPEN, 'demo registration is closed (set PARITY_ACCOUNTS=enabled)');
    const problems = watch(page);
    const email = `parity-${test.info().project.name}-${Date.now()}@example.com`;
    const password = 'parity-demo-passphrase';
    await page.goto('/account/register');
    const form = page.locator('[data-testid="register-form"][data-ready="true"]');
    await form.getByLabel('Given names').fill('Amihan');
    await form.getByLabel('Family name').fill('Paritytest');
    await form.getByLabel('Email', { exact: true }).fill(email);
    await form.getByLabel('Password', { exact: true }).fill(password);
    await form.getByLabel('Confirm password').fill(password);
    await form.getByTestId('register-demo').check();
    await form.getByTestId('register-submit').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });
    await page.context().clearCookies();
    await page.goto('/account/sign-in');
    const signIn = page.locator('[data-testid="sign-in-form"][data-ready="true"]');
    await signIn.getByLabel('Email', { exact: true }).fill(email);
    await signIn.getByLabel('Password').fill(password);
    await signIn.getByTestId('sign-in-submit').click();
    await expect(page).toHaveURL(/\/account\/trips(\?.*)?$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'My Trips' })).toBeVisible();
    expect(problems.errors).toEqual([]);
  });
});
