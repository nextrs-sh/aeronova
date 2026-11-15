import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { BASE_URL, E2E_TODAY } from './constants';

/**
 * Every spec uses this `test`: the browser clock is pinned to the same
 * "today" as the API and the Next.js server (see playwright.config.ts).
 * Timers keep running, so the app behaves normally.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(new Date(`${E2E_TODAY}T10:00:00+08:00`));
    await use(page);
  },
});
export { expect };

/** `YYYY-MM-DD` for the pinned "today" + `days`. */
export function manilaDate(days = 0): string {
  return new Date(Date.parse(`${E2E_TODAY}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Open the fare comparison from a result card, then choose a fare family. */
export async function chooseFare(
  page: Page,
  card: Locator,
  family: 'Light' | 'Classic' | 'Flex' | 'Business',
) {
  await card.getByRole('link', { name: /View fares/ }).click();
  await expect(page.getByTestId('fare-cards')).toBeVisible();
  await selectFamily(page, family);
}

/** Choose a fare family on the fare comparison that is already open. */
export async function selectFamily(page: Page, family: 'Light' | 'Classic' | 'Flex' | 'Business') {
  const card = page.locator(`[data-testid="fare-card"][data-family="${family.toUpperCase()}"]`);
  await card.getByRole('button', { name: new RegExp(`^(Select|Continue with) ${family}`) }).click();
}

/** Run a deterministic retailing scenario for this browser context (test-only). */
export async function simulateScenario(
  page: Page,
  scenario:
    | 'offer-expired'
    | 'price-increase'
    | 'sold-out'
    | 'session-expired'
    | 'seat-taken'
    | 'hold-expired'
    | null,
) {
  const context = page.context();
  if (scenario === null) await context.clearCookies({ name: 'velasia-scenario' });
  else await context.addCookies([{ name: 'velasia-scenario', value: scenario, url: BASE_URL }]);
}

/** Simulate a retailing API failure for this browser context (test-only fault injection). */
export async function simulateApiFault(
  page: Page,
  fault: 'unavailable' | 'timeout' | 'empty' | 'malformed' | 'slow-commit' | null,
) {
  const context = page.context();
  if (fault === null) await context.clearCookies({ name: 'velasia-fault' });
  else await context.addCookies([{ name: 'velasia-fault', value: fault, url: BASE_URL }]);
}

/** Collect uncaught errors, console errors (incl. hydration), and failed requests. */
export function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('favicon')) {
      errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  return errors;
}

/** Scroll through the page so lazy images load, wait for them, then assert none are broken. */
export async function expectNoBrokenImages(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  const broken = await page.evaluate(async () => {
    const images = [...document.images];
    // Lazy images scrolled past quickly may never start; force them so every image is checked.
    for (const img of images) img.loading = 'eager';
    const settled = (img: HTMLImageElement) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          });
    await Promise.race([
      Promise.all(images.map(settled)),
      new Promise((r) => setTimeout(r, 20_000)),
    ]);
    return images
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.currentSrc || img.src);
  });
  expect(broken).toEqual([]);
}

export async function chooseAirport(
  page: Page,
  label: 'From' | 'To',
  query: string,
  optionName: RegExp,
) {
  await waitForSearch(page);
  const input = page.getByRole('combobox', { name: label });
  await input.click();
  await input.fill(query);
  await page
    .getByRole('listbox', { name: `${label} airports` })
    .getByRole('option', { name: optionName })
    .click();
}

/** Wait until the search widget has hydrated and restored any saved selections. */
export async function waitForSearch(page: Page) {
  await expect(
    page.locator('[data-testid="flight-search"][data-ready="true"]').first(),
  ).toBeAttached();
}
