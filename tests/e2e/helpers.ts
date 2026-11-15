import { expect, type Page } from '@playwright/test';

/** `YYYY-MM-DD` for today + `days`, in the airline's time zone (Asia/Manila). */
export function manilaDate(days = 0): string {
  const now = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
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
