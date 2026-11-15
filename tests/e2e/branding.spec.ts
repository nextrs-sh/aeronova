import { manilaDate, simulateApiFault, test, expect } from './helpers';

const LEGACY_BRAND = /aero\s*-?\s*nova/i;

const ROUTES = [
  '/',
  '/destinations',
  '/destinations/cebu',
  '/flights',
  `/flights?trip=one-way&from=MNL&to=SIN&depart=${manilaDate(14)}&adults=1&cabin=economy`,
  '/help',
  '/manage-booking',
  '/about',
  '/credits',
];

test.describe('Velasia Airways branding', () => {
  test('shows the Velasia logo in the header and footer', async ({ page }) => {
    await page.goto('/');
    const home = page.getByRole('link', { name: 'Velasia Airways home' });
    await expect(home).toHaveCount(2);
    const headerLogo = page.getByRole('banner').locator('svg[data-brand-logo="default"]');
    await expect(headerLogo).toBeVisible();
    const box = await headerLogo.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(30);
    await expect(
      page.getByRole('contentinfo').locator('svg[data-brand-logo="inverse"]'),
    ).toBeVisible();
    await expect(page.getByRole('contentinfo')).toContainText(/© \d{4} Velasia Airways\./);
  });

  test('shows the Velasia logo and menu on mobile @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto('/');
    await expect(page.getByRole('banner').locator('svg[data-brand-logo="default"]')).toBeVisible();
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toContainText('Beyond every horizon.');
    await expect(menu).toContainText('Velasia Airways is a fictional airline');
  });

  test('publishes Velasia metadata, icons, manifest, and a valid social card', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Velasia Airways | Beyond Every Horizon');
    const meta = (selector: string) => page.locator(selector).first().getAttribute('content');
    expect(await meta('meta[name="description"]')).toContain('Velasia Airways');
    expect(await meta('meta[property="og:site_name"]')).toBe('Velasia Airways');
    expect(await meta('meta[name="theme-color"]')).toBe('#101E38');
    expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');

    const ogImage = await meta('meta[property="og:image"]');
    expect(ogImage).toMatch(/\/brand\/velasia-social-preview\.png$/);
    const card = await request.get(new URL(ogImage!).pathname);
    expect(card.status()).toBe(200);
    expect(card.headers()['content-type']).toBe('image/png');
    const png = await card.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);

    const icon = page.locator('link[rel="icon"]');
    await expect(icon).toHaveAttribute('href', '/brand/velasia-favicon.svg');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/brand/velasia-apple-touch-icon.png',
    );
    for (const asset of [
      '/brand/velasia-favicon.svg',
      '/brand/velasia-apple-touch-icon.png',
      '/brand/velasia-logo.svg',
      '/brand/velasia-logo-dark.svg',
    ]) {
      expect((await request.get(asset)).status(), asset).toBe(200);
    }

    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({
      name: 'Velasia Airways',
      short_name: 'Velasia',
      theme_color: '#101E38',
    });
  });

  test('keeps page-specific social titles', async ({ page }) => {
    await page.goto('/destinations/cebu');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      /Cebu with Velasia Airways/,
    );
    await page.goto('/help');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Help centre | Velasia Airways',
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /velasia-social-preview\.png$/,
    );
  });

  test('never shows the retired brand on any page, in metadata, or in error states', async ({
    page,
  }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();
      const html = await page.content();
      expect(html, route).not.toMatch(LEGACY_BRAND);
    }

    await page.goto('/this-page-does-not-exist');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.content()).not.toMatch(LEGACY_BRAND);

    await simulateApiFault(page, 'unavailable');
    await page.goto(ROUTES[4]!);
    await expect(page.getByRole('main')).toBeVisible();
    expect(await page.content()).not.toMatch(LEGACY_BRAND);
    await simulateApiFault(page, null);
  });

  test('labels flights with the Velasia display flight numbers', async ({ page }) => {
    await page.goto(ROUTES[4]!);
    const first = page.getByTestId('flight-card').first();
    await expect(first).toContainText('Velasia');
    await expect(first).toContainText(/VEL \d{1,4}/);
  });
});
