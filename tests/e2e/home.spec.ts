import AxeBuilder from '@axe-core/playwright';
import { expectNoBrokenImages, trackPageErrors, expect, test } from './helpers';

test.describe('homepage', () => {
  test('loads without errors, broken images, or hydration warnings', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto('/');
    await expect(page).toHaveTitle(/AeroNova/);
    await expect(
      page.getByRole('heading', { level: 1, name: /Your journey\.\s*Your way\./ }),
    ).toBeVisible();
    await expect(page.getByRole('search', { name: 'Search flights' })).toBeVisible();

    for (const name of [
      'Where will you go next?',
      'Fares worth packing for',
      'Travel your way',
      'Ideas for your next escape',
      'Helpful booking information',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await expect(page.getByText('Illustrative fare · not a live offer').first()).toBeVisible();
    await expect(page.getByText(/fictional airline/).first()).toBeVisible();

    await expectNoBrokenImages(page);
    expect(errors).toEqual([]);
  });

  test('has no serious accessibility violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
  });

  test('offers a working skip link for keyboard users', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('respects reduced-motion preferences', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const heading = page.getByRole('heading', { level: 1 });
    const duration = await heading.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
    const behavior = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    );
    expect(behavior).toBe('auto');
  });

  test('animates the hero when motion is allowed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const duration = await page
      .getByRole('heading', { level: 1 })
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeGreaterThan(0.1);
  });
});
