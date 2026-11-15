import AxeBuilder from '@axe-core/playwright';
import { expectNoBrokenImages, trackPageErrors, waitForSearch, expect, test } from './helpers';

test.describe('destinations', () => {
  test('lists, searches, and filters destinations', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto('/destinations');
    const grid = page.getByTestId('destination-grid');
    await expect(grid.getByRole('listitem')).toHaveCount(12);
    await expect(
      page.getByRole('status').filter({ hasText: 'Showing all 12 destinations' }),
    ).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search destinations' }).fill('japan');
    await expect(grid.getByRole('listitem')).toHaveCount(2);
    await expect(grid).toContainText('Tokyo');
    await expect(grid).toContainText('Osaka');

    await page.getByRole('searchbox', { name: 'Search destinations' }).fill('');
    await page.getByRole('button', { name: 'Philippines' }).click();
    await expect(page.getByRole('button', { name: 'Philippines' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(grid.getByRole('listitem')).toHaveCount(3);

    await page.getByRole('searchbox', { name: 'Search destinations' }).fill('atlantis');
    await expect(page.getByText('No destinations match your search')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(grid.getByRole('listitem')).toHaveCount(12);

    await expectNoBrokenImages(page);
    expect(errors).toEqual([]);
  });

  test('a destination page shows guide content and a preset search', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto('/destinations');
    await page.getByRole('link', { name: /Tokyo/ }).first().click();

    await expect(page).toHaveURL(/\/destinations\/tokyo$/);
    await expect(page).toHaveTitle(/Tokyo, Japan/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tokyo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Highlights' })).toBeVisible();
    await expect(page.getByText('Planned routes in AeroNova’s fictional network.')).toBeVisible();
    await expect(page.getByText('Illustrative fare · not a live offer')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Find flights to Tokyo' })).toBeVisible();
    await waitForSearch(page);
    await expect(page.getByRole('combobox', { name: 'To' })).toHaveValue('Tokyo (NRT)');

    await expectNoBrokenImages(page);
    expect(errors).toEqual([]);
  });

  test('unknown destinations return a real 404', async ({ page }) => {
    const response = await page.goto('/destinations/atlantis');
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: 'This page has flown off course' }),
    ).toBeVisible();
  });

  test('destination pages have no serious accessibility violations', async ({ page }) => {
    test.setTimeout(60_000);
    for (const path of ['/destinations', '/destinations/cebu', '/flights']) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(
        serious.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
      ).toEqual([]);
    }
  });
});
