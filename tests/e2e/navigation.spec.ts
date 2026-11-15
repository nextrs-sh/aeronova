import { expect, test } from './helpers';
test.describe('site navigation', () => {
  test('primary navigation reaches every section', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });

    const destinations: [string, RegExp, string][] = [
      ['Explore destinations', /\/destinations$/, 'Destinations across Asia'],
      ['Book flights', /\/flights$/, 'Where would you like to go?'],
      ['Manage booking', /\/manage-booking$/, 'Your trip, in your hands'],
      ['Help', /\/help$/, 'How can we help?'],
    ];
    for (const [link, url, heading] of destinations) {
      await nav.getByRole('link', { name: link }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(nav.getByRole('link', { name: link })).toHaveAttribute('aria-current', 'page');
    }

    await page.getByRole('link', { name: 'Velasia Airways home' }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('footer links resolve without dead ends', async ({ page, request }) => {
    await page.goto('/');
    const hrefs = await page
      .getByRole('contentinfo')
      .getByRole('link')
      .evaluateAll((links) => [
        ...new Set(links.map((link) => (link as HTMLAnchorElement).pathname)),
      ]);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      const response = await request.get(href);
      expect(response.status(), href).toBe(200);
    }
  });

  test('unknown pages return a real 404 with a friendly page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: 'This page has flown off course' }),
    ).toBeVisible();
  });

  test('mobile navigation opens, navigates, and closes @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();

    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await menu.getByRole('link', { name: 'Explore destinations' }).click();

    await expect(page).toHaveURL(/\/destinations$/);
    await expect(menu).toBeHidden();

    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });
});
