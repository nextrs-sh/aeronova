import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  chooseAirport,
  expect,
  manilaDate,
  simulateApiFault,
  test,
  trackPageErrors,
  waitForSearch,
} from './helpers';

/*
 * Milestone 2: flight results from the retailing API. All dates are relative
 * to the pinned E2E "today" (2026-12-01), so results are deterministic.
 */

const ONE_WAY_SIN =
  '/flights?trip=one-way&from=MNL&to=SIN&depart=2026-12-15&adults=1&cabin=economy';
const CEB_SIN = '/flights?trip=one-way&from=CEB&to=SIN&depart=2026-12-16&adults=1&cabin=economy';
const ROUND_HKG =
  '/flights?trip=round-trip&from=MNL&to=HKG&depart=2026-12-10&return=2026-12-14&adults=2&cabin=economy';

const cards = (page: Page) => page.getByTestId('flight-card');

async function prices(page: Page): Promise<number[]> {
  const texts = await cards(page)
    .locator('p:has-text("per adult")')
    .evaluateAll((nodes) => nodes.map((node) => node.previousElementSibling?.textContent ?? ''));
  return texts.map((text) => Number(text.replace(/[^\d.]/g, '')));
}

/** Wait for a URL change made by a filter, then for the refreshed results. */
async function settled(page: Page) {
  await expect(page.locator('[data-pending]')).toHaveCount(0);
}

test.describe('flight results', () => {
  test('searches Manila to Singapore and shows real results', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto('/');
    await chooseAirport(page, 'From', 'Manila', /Manila/);
    await chooseAirport(page, 'To', 'Singapore', /Singapore/);
    await page.getByText('One-way', { exact: true }).click();
    await page.getByLabel('Depart', { exact: true }).fill(manilaDate(14));
    await page.getByRole('button', { name: 'Search flights' }).click();

    await expect(page).toHaveURL(/\/flights\?trip=one-way&from=MNL&to=SIN&depart=2026-12-15/);
    const summary = page.getByTestId('search-summary');
    await expect(summary).toContainText('Ninoy Aquino International Airport');
    await expect(summary).toContainText('Singapore Changi Airport');
    await expect(summary).toContainText('One-way');
    await expect(summary).toContainText('1 Adult');

    await expect(cards(page).first()).toBeVisible();
    const first = cards(page).first();
    await expect(first).toContainText('AeroNova');
    await expect(first).toContainText('NV 501');
    await expect(first).toContainText('08:15');
    await expect(first).toContainText('12:00');
    await expect(first).toContainText('Direct');
    await expect(first).toContainText('Airbus A321neo');
    await expect(first).toContainText(/From₱[\d,]+per adult · indicative/);
    expect(errors).toEqual([]);
  });

  test('changes the departure date from the date strip', async ({ page }) => {
    await page.goto(ONE_WAY_SIN);
    const strip = page.getByRole('navigation', { name: 'Nearby dates' });
    await expect(strip.locator('[aria-current="date"]')).toContainText('Tue Dec 15');
    await strip.getByRole('link', { name: /^Wed Dec 16 from ₱[\d,]+ per adult/ }).click();
    await expect(page).toHaveURL(/depart=2026-12-16/);
    await expect(strip.locator('[aria-current="date"]')).toContainText('Wed Dec 16');
    await expect(page.getByTestId('search-summary')).toContainText('Wed, Dec 16, 2026');
    await expect(cards(page).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose your flight' })).toBeVisible();
  });

  test('filters to direct flights and sorts by lowest price', async ({ page }) => {
    await page.goto(CEB_SIN);
    await expect(cards(page)).toHaveCount(4);
    await expect(cards(page).filter({ hasText: '1 stop · MNL' })).toHaveCount(3);

    await page.getByRole('radio', { name: /Direct flights only/ }).check();
    await expect(page).toHaveURL(/stops=0/);
    await settled(page);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Direct');
    await expect(page.getByText('1 of 4 flights')).toBeVisible();

    await page.getByRole('radio', { name: /Any number of stops/ }).check();
    await expect(page).not.toHaveURL(/stops=/);
    await expect(cards(page)).toHaveCount(4);

    await page.getByLabel('Sort by').selectOption('price_asc');
    await expect(page).toHaveURL(/sort=price_asc/);
    await settled(page);
    const sorted = await prices(page);
    expect(sorted.length).toBe(4);
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
  });

  test('opens flight details with itinerary and cabin availability', async ({ page }) => {
    await page.goto(CEB_SIN);
    const connecting = cards(page).filter({ hasText: '1 stop · MNL' }).first();
    await connecting.getByRole('button', { name: /Details/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Flight details' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Cebu to Singapore');
    await expect(dialog).toContainText('Mactan–Cebu International Airport');
    await expect(dialog).toContainText(/connection in Manila \(MNL\)/);
    await expect(dialog).toContainText('All times are local to each airport.');
    await expect(dialog.getByText('Your cabin').first()).toBeVisible(); // loaded via /api/flights/[id]
    await expect(dialog).toContainText('Passenger service charge');
    await expect(dialog.getByRole('link', { name: /^Select/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('round trips', () => {
  test('selects outbound and return flights, then reviews the total', async ({ page }) => {
    await page.goto('/');
    await chooseAirport(page, 'From', 'MNL', /Manila/);
    await chooseAirport(page, 'To', 'Hong Kong', /Hong Kong/);
    await page.getByLabel('Depart', { exact: true }).fill('2026-12-10');
    await page.getByLabel('Return', { exact: true }).fill('2026-12-14');
    await page.getByRole('button', { name: /Passengers/ }).click();
    await page.getByRole('button', { name: 'Add one adult' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Search flights' }).click();
    await expect(page).toHaveURL(ROUND_HKG);

    await expect(page.getByRole('heading', { name: 'Choose your departing flight' })).toBeVisible();
    const outbound = cards(page).filter({ hasText: '13:10' });
    await expect(outbound).toContainText(/total for 2 adults/);
    await outbound.getByRole('link', { name: /Select departure/ }).click();
    await expect(page).toHaveURL(/out=NV533-20261210/);

    await expect(page.getByTestId('selected-outbound')).toContainText('13:10');
    await expect(page.getByRole('heading', { name: 'Choose your return flight' })).toBeVisible();
    await expect(cards(page).first()).toContainText('HKG');
    await cards(page)
      .filter({ hasText: '16:35' })
      .getByRole('link', { name: /Select return/ })
      .click();
    await expect(page).toHaveURL(/out=NV533-20261210&ret=NV534-20261214/);

    const review = page.getByTestId('trip-review');
    await expect(review).toContainText('Departing');
    await expect(review).toContainText('Returning');
    const legTotals = await review
      .locator('article p:has-text("indicative, all passengers")')
      .allTextContents();
    const sum = legTotals
      .map((t) => Number(t.replace(/indicative.*/, '').replace(/[^\d]/g, '')))
      .reduce((a, b) => a + b, 0);
    const total = Number(
      (await page.getByTestId('trip-total').textContent())!.replace(/[^\d]/g, ''),
    );
    expect(total).toBe(sum);

    await page.getByRole('link', { name: /Continue to fare options/ }).click();
    await expect(page).toHaveURL(/\/flights\/fares\?/);
    await expect(page.getByText('Preview · coming in the next release')).toBeVisible();
    await expect(page.getByText(/Nothing has been reserved/)).toBeVisible();
  });

  test('browser back and forward keep the search and selections', async ({ page }) => {
    await page.goto(ROUND_HKG);
    await page.getByLabel('Sort by').selectOption('price_asc');
    await expect(page).toHaveURL(/sort=price_asc/);
    await cards(page)
      .first()
      .getByRole('link', { name: /Select departure/ })
      .click();
    await expect(page.getByTestId('selected-outbound')).toBeVisible();
    await cards(page)
      .first()
      .getByRole('link', { name: /Select return/ })
      .click();
    await expect(page.getByTestId('trip-review')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('selected-outbound')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose your return flight' })).toBeVisible();
    await expect(page).toHaveURL(/sort=price_asc/);

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Choose your departing flight' })).toBeVisible();
    await expect(page.getByLabel('Sort by')).toHaveValue('price_asc');
    await expect(page.getByTestId('search-summary')).toContainText('2 Adults');

    await page.goForward();
    await expect(page.getByTestId('selected-outbound')).toBeVisible();
  });
});

test.describe('invalid searches and empty results', () => {
  test('explains invalid search links without calling for results', async ({ page }) => {
    await page.goto('/flights?trip=one-way&from=MNL&to=SIN&depart=2026-11-20&adults=1&infants=3');
    await waitForSearch(page);
    const alert = page.getByRole('alert').filter({ hasText: 'We couldn’t run this search' });
    await expect(alert).toContainText('Choose a date from today onwards.');
    await expect(alert).toContainText('Each infant must travel on the lap of their own adult.');
    await expect(cards(page)).toHaveCount(0);
  });

  test('resets unknown filter values and says so', async ({ page }) => {
    await page.goto(`${ONE_WAY_SIN}&sort=cheapest&stops=9`);
    await expect(
      page.getByText('Some options in this link weren’t recognised and were reset.'),
    ).toBeVisible();
    await expect(cards(page).first()).toBeVisible();
  });

  test('explains a route AeroNova does not fly, with alternatives', async ({ page }) => {
    await page.goto(
      '/flights?trip=one-way&from=DPS&to=CGK&depart=2026-12-16&adults=1&cabin=economy',
    );
    const empty = page.getByTestId('empty-no-route');
    await expect(empty).toContainText('AeroNova doesn’t fly from Bali (Denpasar) to Jakarta');
    await expect(cards(page)).toHaveCount(0);
    await empty.getByRole('link', { name: 'Manila' }).click();
    await expect(page).toHaveURL(/from=DPS&to=MNL/);
    // Bali–Manila doesn't operate on Wednesdays; the page says so and offers nearby dates.
    await expect(page.getByTestId('empty-no-flights-on-date')).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Nearby dates' })
      .getByRole('link', { name: /Thu Dec 17 from/ })
      .click();
    await expect(cards(page).first()).toBeVisible();
  });

  test('explains sold-out flights, missing cabins, and unpublished dates', async ({ page }) => {
    await page.goto(
      '/flights?trip=one-way&from=MNL&to=CEB&depart=2026-12-04&adults=9&cabin=premium-economy&stops=0',
    );
    await expect(page.getByTestId('empty-insufficient-seats')).toContainText(
      'Not enough seats for 9 travellers',
    );

    await page.goto(
      '/flights?trip=one-way&from=MNL&to=ILO&depart=2026-12-16&adults=1&cabin=business',
    );
    await expect(page.getByTestId('empty-cabin-not-offered')).toBeVisible();
    await page.getByRole('link', { name: 'Show Economy flights' }).click();
    await expect(cards(page).first()).toBeVisible();

    await page.goto(
      `/flights?trip=one-way&from=MNL&to=CEB&depart=${manilaDate(200)}&adults=1&cabin=economy`,
    );
    await expect(page.getByTestId('empty-beyond-schedule')).toContainText(
      'Schedules aren’t published',
    );
  });

  test('clears filters that match nothing', async ({ page }) => {
    await page.goto(`${ONE_WAY_SIN}&times=early-morning`);
    await expect(page.getByTestId('empty-filtered-out')).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/times=/);
    await expect(cards(page).first()).toBeVisible();
  });
});

test.describe('retailing API failures', () => {
  test('shows a recoverable error and never invents flights', async ({ page }) => {
    await page.goto('/');
    await simulateApiFault(page, 'unavailable');
    await page.goto(ONE_WAY_SIN);
    const error = page.getByTestId('results-error');
    await expect(error).toContainText('We can’t load flights right now');
    await expect(cards(page)).toHaveCount(0);
    // The rest of the page still works.
    await expect(page.getByTestId('search-summary')).toBeVisible();
    await expect(
      page.getByText('Prices for nearby dates aren’t available right now.'),
    ).toBeVisible();

    await simulateApiFault(page, null);
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(cards(page).first()).toBeVisible();
    await expect(error).toBeHidden();
  });

  test('times out slow responses and rejects malformed ones', async ({ page }) => {
    await page.goto('/');
    await simulateApiFault(page, 'timeout');
    await page.goto(ONE_WAY_SIN);
    await expect(page.getByTestId('results-error')).toContainText('taking too long', {
      timeout: 15_000,
    });

    await simulateApiFault(page, 'malformed');
    await page.reload();
    await expect(page.getByTestId('results-error')).toContainText(
      'Something went wrong loading flights',
    );
    await expect(cards(page)).toHaveCount(0);
  });

  test('shows a loading skeleton while results stream', async ({ page }) => {
    await page.goto('/');
    await page
      .context()
      .addCookies([{ name: 'aeronova-fault', value: 'delay=1500', url: 'http://127.0.0.1:3200' }]);
    await page.goto(ONE_WAY_SIN, { waitUntil: 'commit' });
    await expect(page.getByTestId('search-summary')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Searching flights…' })).toBeAttached();
    await expect(cards(page).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('accessibility', () => {
  test('core interactions work with the keyboard', async ({ page }) => {
    await page.goto(CEB_SIN);
    await expect(cards(page).first()).toBeVisible();

    const nextDay = page
      .getByRole('navigation', { name: 'Nearby dates' })
      .getByRole('link', { name: /^Thu Dec 17/ });
    await nextDay.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/depart=2026-12-17/);
    await page.goBack();
    await expect(page).toHaveURL(/depart=2026-12-16/);
    await expect(cards(page)).toHaveCount(4);

    const direct = page.getByRole('radio', { name: /Direct flights only/ });
    await direct.focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/stops=0/);
    await settled(page);

    const details = cards(page)
      .first()
      .getByRole('button', { name: /Details/ });
    await details.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Flight details' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close flight details' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(details).toBeFocused();

    const select = cards(page)
      .first()
      .getByRole('link', { name: /^Select/ });
    await select.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('trip-review')).toBeVisible();
  });

  test('results, details, and review have no serious axe violations', async ({ page }) => {
    const scan = async () => {
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      return violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
    };
    await page.goto(ROUND_HKG);
    await expect(cards(page).first()).toBeVisible();
    expect(await scan()).toEqual([]);
    await cards(page)
      .first()
      .getByRole('button', { name: /Details/ })
      .click();
    await expect(page.getByText('Your cabin').first()).toBeVisible();
    expect(await scan()).toEqual([]);
    await page.keyboard.press('Escape');
    await page.goto(`${ROUND_HKG}&out=NV533-20261210&ret=NV534-20261214`);
    await expect(page.getByTestId('trip-review')).toBeVisible();
    expect(await scan()).toEqual([]);
  });
});

test.describe('mobile', () => {
  test('filters and sorts in a bottom sheet @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto(CEB_SIN);
    await expect(cards(page)).toHaveCount(4);
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filter and sort' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('radio', { name: /Direct flights only/ }).check();
    await expect(page).toHaveURL(/stops=0/);
    await sheet.getByLabel('Sort by').selectOption('price_asc');
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(sheet.getByRole('button', { name: 'Show 1 flight' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Show 1 flight' }).click();
    await expect(sheet).toBeHidden();
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
  });

  test('edits the search and opens details on a phone @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto(ONE_WAY_SIN);
    await page.getByRole('button', { name: 'Edit search' }).click();
    const sheet = page.getByRole('dialog', { name: 'Change your search' });
    await expect(sheet.getByRole('combobox', { name: 'From' })).toHaveValue('Manila (MNL)');
    await sheet.getByLabel('Depart', { exact: true }).fill('2026-12-17');
    await sheet.getByRole('button', { name: 'Search flights' }).click();
    await expect(page).toHaveURL(/depart=2026-12-17/);
    await expect(sheet).toBeHidden();

    await cards(page)
      .first()
      .getByRole('button', { name: /Details/ })
      .click();
    await expect(page.getByRole('dialog', { name: 'Flight details' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('results pages do not overflow horizontally @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    for (const path of [
      ONE_WAY_SIN,
      CEB_SIN,
      `${ROUND_HKG}&out=NV533-20261210&ret=NV534-20261214`,
    ]) {
      await page.goto(path);
      await expect(
        page.getByTestId('flight-card').or(page.getByTestId('trip-review')).first(),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
