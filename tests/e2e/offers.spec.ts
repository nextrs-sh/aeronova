import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import {
  chooseAirport,
  chooseFare,
  expect,
  manilaDate,
  selectFamily,
  simulateApiFault,
  simulateScenario,
  test,
  trackPageErrors,
} from './helpers';

/*
 * Milestone 3: offers, fare families, and the shopping session. Dates are relative to the
 * pinned E2E "today" (2026-12-01). Offer expiry, price changes, and sell-outs use the
 * test-only `velasia-scenario` cookie, so they never depend on waiting or randomness.
 */

const ONE_WAY_SIN =
  '/flights?trip=one-way&from=MNL&to=SIN&depart=2026-12-15&adults=1&cabin=economy';
const ROUND_SIN =
  '/flights?trip=round-trip&from=MNL&to=SIN&depart=2026-12-15&return=2026-12-20&adults=1&cabin=economy';
const ECONOMY_ONLY =
  '/flights?trip=one-way&from=MNL&to=CEB&depart=2026-12-15&adults=1&cabin=economy';

const cards = (page: Page) => page.getByTestId('flight-card');
const fareCard = (page: Page, family: string) =>
  page.locator(`[data-testid="fare-card"][data-family="${family}"]`);
const amount = async (locator: Locator) =>
  Number((await locator.first().textContent())!.replace(/[^\d]/g, ''));

async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

/** Choose a one-way Manila → Singapore fare and land on the trip summary. */
async function oneWayWith(page: Page, family: 'Light' | 'Classic' | 'Flex' | 'Business') {
  await page.goto(ONE_WAY_SIN);
  await chooseFare(page, cards(page).first(), family);
  await expect(page.getByTestId('trip-summary')).toBeVisible();
}

test.describe('fare families and offers', () => {
  test('compares fares, selects Classic, then changes to Flex', async ({ page }) => {
    const errors = trackPageErrors(page);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    // 1–2. Search Manila to Singapore and open an itinerary's fares.
    await page.goto('/');
    await chooseAirport(page, 'From', 'Manila', /Manila/);
    await chooseAirport(page, 'To', 'Singapore', /Singapore/);
    await page.getByText('One-way', { exact: true }).click();
    await page.getByLabel('Depart', { exact: true }).fill(manilaDate(14));
    await page.getByRole('button', { name: 'Search flights' }).click();
    const first = cards(page).first();
    await expect(first).toContainText('VEL 501');
    const fromPrice = await amount(
      first.locator('p:has-text("per adult") >> xpath=preceding-sibling::p[1]'),
    );
    await first.getByRole('link', { name: /View fares/ }).click();
    await expect(page).toHaveURL(/fares=NV501-20261215/);

    // 3–4. Compare Light, Classic, and Flex.
    await expect(page.getByRole('heading', { name: 'Choose your fare' })).toBeVisible();
    await expect(page.getByTestId('fare-itinerary')).toContainText('Airbus A321neo');
    const [light, classic, flex] = await Promise.all(
      ['LIGHT', 'CLASSIC', 'FLEX'].map((family) =>
        amount(fareCard(page, family).getByTestId('fare-total')),
      ),
    );
    expect(light).toBe(fromPrice); // the results' "from" price is the Light offer
    expect(light).toBeLessThan(classic!);
    expect(classic).toBeLessThan(flex!);
    await expect(fareCard(page, 'LIGHT')).toContainText('Not included');
    await expect(fareCard(page, 'CLASSIC')).toContainText('1 × 20 kg');
    await expect(fareCard(page, 'FLEX')).toContainText('No change fee');
    await expect(fareCard(page, 'BUSINESS')).toContainText('Business');

    await page.getByRole('button', { name: 'Compare all features' }).click();
    const matrix = page.getByRole('table');
    await expect(matrix).toBeVisible();
    await expect(matrix.getByRole('row', { name: /Checked baggage/ })).toContainText(
      'Not included',
    );
    await expect(matrix.getByRole('row', { name: /Refunds/ })).toContainText('₱3,000 fee');
    await expect(page.getByRole('button', { name: 'Hide comparison' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    // 5–6. Select Classic and check the price breakdown.
    await selectFamily(page, 'Classic');
    await expect(page).toHaveURL(/out=NV501-20261215/);
    await expect(page.getByTestId('family-outbound')).toHaveText('Velasia Classic');
    await expect(page.getByTestId('status-outbound')).toHaveText('Selected');
    expect(await amount(page.getByTestId('trip-total'))).toBe(classic);
    const panel = page.locator('#trip-summary-panel');
    const parts = await Promise.all(
      ['Base fares', 'Fare benefits', 'Taxes and fees'].map((label) =>
        amount(panel.locator(`dt:text-is("${label}") + dd`)),
      ),
    );
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(classic);
    await page.getByTestId('selection-outbound').getByText('Price breakdown').click();
    await expect(page.getByTestId('selection-outbound')).toContainText('Classic fare benefits');
    await expect(page.getByTestId('offer-validity')).toContainText('Prices held until');

    // 7–8. Change the fare family to Flex and see the new authoritative total.
    await page.getByRole('link', { name: 'Change fare for the departing flight' }).click();
    await expect(fareCard(page, 'CLASSIC')).toContainText('Your choice');
    await expect(fareCard(page, 'FLEX').getByTestId('fare-difference')).toContainText(
      `compared with Velasia Classic`,
    );
    await selectFamily(page, 'Flex');
    await expect(page.getByTestId('family-outbound')).toHaveText('Velasia Flex');
    expect(await amount(page.getByTestId('trip-total'))).toBe(flex);
    await expect(page.getByTestId('changed-outbound')).toContainText(
      'Changed from Velasia Classic',
    );

    // 20. Nothing was booked or paid for.
    await page.getByRole('button', { name: 'Continue to traveller details' }).click();
    // M4: the next step collects traveller details; the trip total carries over unchanged.
    await expect(page.getByTestId('traveller-form')).toBeVisible();
    expect(await amount(page.getByTestId('booking-total').filter({ visible: true }))).toBe(flex);
    expect(requests.filter((url) => /order|payment|checkout/i.test(url))).toEqual([]);

    // 19. No hydration or runtime errors along the way.
    expect(errors).toEqual([]);
  });

  test('round trip with different families, a combined total, and refresh', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(ROUND_SIN);
    await expect(page.getByRole('heading', { name: 'Choose your departing flight' })).toBeVisible();
    await cards(page)
      .first()
      .getByRole('link', { name: /View fares/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Choose your departing fare' })).toBeVisible();
    const outClassic = await amount(fareCard(page, 'CLASSIC').getByTestId('fare-total'));
    await selectFamily(page, 'Classic');

    await expect(page.getByTestId('selected-outbound')).toContainText('Velasia Classic');
    await expect(page.getByRole('heading', { name: 'Choose your return flight' })).toBeVisible();
    await cards(page)
      .first()
      .getByRole('link', { name: /View fares/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Choose your return fare' })).toBeVisible();
    const backFlex = await amount(fareCard(page, 'FLEX').getByTestId('fare-total'));
    await selectFamily(page, 'Flex');

    await expect(page.getByTestId('family-outbound')).toHaveText('Velasia Classic');
    await expect(page.getByTestId('family-inbound')).toHaveText('Velasia Flex');
    expect(await amount(page.getByTestId('leg-total-outbound'))).toBe(outClassic);
    expect(await amount(page.getByTestId('leg-total-inbound'))).toBe(backFlex);
    expect(await amount(page.getByTestId('trip-total'))).toBe(outClassic + backFlex);

    // Editing the return fare keeps the departing selection.
    await page.getByRole('link', { name: 'Change fare for the return flight' }).click();
    await selectFamily(page, 'Light');
    await expect(page.getByTestId('family-outbound')).toHaveText('Velasia Classic');
    await expect(page.getByTestId('family-inbound')).toHaveText('Velasia Light');
    const total = await amount(page.getByTestId('trip-total'));

    // 12. Refresh restores the session-backed selection.
    await page.reload();
    await expect(page.getByTestId('family-inbound')).toHaveText('Velasia Light');
    expect(await amount(page.getByTestId('trip-total'))).toBe(total);
    expect(errors).toEqual([]);
  });

  test('explains families that are not offered on a flight', async ({ page }) => {
    await page.goto(ECONOMY_ONLY);
    // VEL 103 is an Airbus A320neo, with no Business cabin.
    await cards(page)
      .filter({ hasText: 'VEL 103' })
      .getByRole('link', { name: /View fares/ })
      .click();
    await expect(fareCard(page, 'BUSINESS').getByTestId('fare-unavailable')).toContainText(
      'A320neo has no Business cabin',
    );
    await expect(fareCard(page, 'BUSINESS').getByRole('button')).toHaveCount(0);
    await expect(
      fareCard(page, 'LIGHT').getByRole('button', { name: /Select Light/ }),
    ).toBeVisible();
  });
});

test.describe('offer lifecycle', () => {
  test('recovers from an expired offer at the same price', async ({ page }) => {
    await oneWayWith(page, 'Classic');
    const total = await amount(page.getByTestId('trip-total'));

    // 13. Sixteen minutes later (simulated), the 15-minute price hold has ended.
    await simulateScenario(page, 'offer-expired');
    await page.reload();
    await expect(page.getByTestId('status-outbound')).toHaveText('Price hold ended');
    await expect(page.getByTestId('expired-outbound')).toBeVisible();

    // 14. Continuing asks the API for a fresh offer and says so, instead of going ahead silently.
    await page.getByRole('button', { name: 'Continue to traveller details' }).click();
    await expect(page.getByTestId('refreshed-outbound')).toContainText('The price is unchanged');
    await expect(page.getByTestId('status-outbound')).toHaveText('Price confirmed');
    expect(await amount(page.getByTestId('trip-total'))).toBe(total);
    await expect(page.getByTestId('trip-action-status')).toContainText('Something changed');

    await page.getByRole('button', { name: 'Continue to traveller details' }).click();
    await expect(page).toHaveURL(/\/booking\/travellers$/);
  });

  test('requires explicit acceptance of a changed price', async ({ page }) => {
    await oneWayWith(page, 'Classic');
    const before = await amount(page.getByTestId('trip-total'));

    await simulateScenario(page, 'price-increase');
    await page.getByRole('button', { name: 'Check latest price' }).click();
    const notice = page.getByTestId('price-changed-outbound');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('role', 'alert');
    const after = await amount(page.getByTestId('new-price-outbound'));
    expect(after).toBeGreaterThan(before);
    // Not applied yet: the total is still the accepted price, and continuing is blocked.
    expect(await amount(page.getByTestId('trip-total'))).toBe(before);
    await expect(page.getByTestId('continue-blocked')).toContainText('Accept the new price');

    await notice.getByRole('button', { name: /^Accept/ }).click();
    await expect(page.getByTestId('status-outbound')).toHaveText('Price confirmed');
    expect(await amount(page.getByTestId('trip-total'))).toBe(after);
    await expect(page.getByTestId('changed-outbound')).toContainText('You accepted a new price');
  });

  test('marks a sold-out flight and keeps the other leg', async ({ page }) => {
    await page.goto(ROUND_SIN);
    await chooseFare(page, cards(page).first(), 'Light');
    await chooseFare(page, cards(page).first(), 'Light');
    await expect(page.getByTestId('trip-summary')).toBeVisible();

    await simulateScenario(page, 'sold-out');
    await page.getByRole('button', { name: 'Check latest price' }).click();
    await expect(page.getByTestId('unavailable-outbound')).toContainText(
      'can no longer be sold for your party',
    );
    await expect(page.getByTestId('family-inbound')).toHaveText('Velasia Light');
    await expect(page.getByTestId('continue-blocked')).toBeVisible();
    await simulateScenario(page, null);
    await page
      .getByTestId('unavailable-outbound')
      .getByRole('link', { name: 'Choose another flight' })
      .click();
    await expect(page.getByRole('heading', { name: 'Choose your departing flight' })).toBeVisible();
  });

  test('offers a way back when the shopping session has expired', async ({ page }) => {
    await oneWayWith(page, 'Light');
    await simulateScenario(page, 'session-expired');
    await page.reload();
    const recovery = page.getByTestId('trip-recovery');
    await expect(recovery).toContainText('Your trip selection has expired');
    await simulateScenario(page, null);
    await recovery.getByRole('link', { name: 'Choose a fare for your departing flight' }).click();
    await expect(page.getByTestId('fare-cards')).toBeVisible();
    await selectFamily(page, 'Flex');
    await expect(page.getByTestId('family-outbound')).toHaveText('Velasia Flex');
  });

  test('keeps each guest’s selection private', async ({ page, browser }) => {
    await oneWayWith(page, 'Classic');
    const url = page.url();
    const other = await browser.newContext({ timezoneId: 'Asia/Manila', locale: 'en-PH' });
    const stranger = await other.newPage();
    await stranger.goto(url);
    await expect(stranger.getByTestId('trip-recovery')).toContainText('Choose your fares');
    await expect(stranger.getByText('Velasia Classic')).toHaveCount(0);
    await other.close();
  });
});

test.describe('failures and accessibility', () => {
  test('explains an unavailable offer service and recovers on retry', async ({ page }) => {
    await page.goto(ONE_WAY_SIN);
    await expect(cards(page).first()).toBeVisible();
    // 15–16. The API fails while loading fares: an accessible alert with a retry.
    await simulateApiFault(page, 'unavailable');
    await cards(page)
      .first()
      .getByRole('link', { name: /View fares/ })
      .click();
    const error = page.getByTestId('results-error');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error).toContainText('We can’t load flights right now');
    expect(await axe(page)).toEqual([]);
    await simulateApiFault(page, null);
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('fare-cards')).toBeVisible();
  });

  test('reports a failed selection without losing the page', async ({ page }) => {
    await page.goto(`${ONE_WAY_SIN}&fares=NV501-20261215`);
    await expect(page.getByTestId('fare-cards')).toBeVisible();
    await simulateApiFault(page, 'unavailable');
    await selectFamily(page, 'Classic');
    const alert = fareCard(page, 'CLASSIC').getByTestId('fare-error');
    await expect(alert).toHaveAttribute('role', 'alert');
    await expect(alert).toContainText('nothing has changed');
    await expect(page).toHaveURL(/fares=NV501-20261215/);
  });

  test('times out gracefully', async ({ page }) => {
    await page.goto(ONE_WAY_SIN);
    await simulateApiFault(page, 'timeout');
    await cards(page)
      .first()
      .getByRole('link', { name: /View fares/ })
      .click();
    await expect(page.getByTestId('results-error')).toContainText('taking too long', {
      timeout: 10_000,
    });
  });

  test('fare pages and the trip summary have no serious axe violations', async ({ page }) => {
    await page.goto(`${ONE_WAY_SIN}&fares=NV501-20261215`);
    await expect(page.getByTestId('fare-cards')).toBeVisible();
    await page.getByRole('button', { name: 'Compare all features' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await selectFamily(page, 'Classic');
    await expect(page.getByTestId('trip-summary')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Continue to traveller details' }).click();
    await expect(page).toHaveURL(/\/booking\/travellers$/);
    // After a client navigation the title is applied once the new page's metadata arrives.
    await expect(page).toHaveTitle(/Traveller details/);
    expect(await axe(page)).toEqual([]);
  });

  test('compares and chooses fares with the keyboard alone', async ({ page }) => {
    await page.goto(`${ONE_WAY_SIN}&fares=NV501-20261215`);
    await expect(page.getByTestId('fare-cards')).toBeVisible();
    // 18. Open the comparison and choose a fare without a pointer.
    const compare = page.getByRole('button', { name: 'Compare all features' });
    await compare.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide comparison' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const breakdown = fareCard(page, 'CLASSIC').getByText('Price breakdown');
    await breakdown.focus();
    await page.keyboard.press('Enter');
    await expect(fareCard(page, 'CLASSIC')).toContainText('Total, all travellers');
    const select = fareCard(page, 'CLASSIC').getByRole('button', { name: /Select Classic/ });
    await select.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('trip-summary')).toBeVisible();
    const proceed = page.getByRole('button', { name: 'Continue to traveller details' });
    await proceed.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/booking\/travellers$/);
  });
});

test.describe('mobile', () => {
  test('compares and selects fares on a phone @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    const errors = trackPageErrors(page);
    await page.goto(ONE_WAY_SIN);
    await cards(page)
      .first()
      .getByRole('link', { name: /View fares/ })
      .click();
    await expect(page.getByTestId('fare-cards')).toBeVisible();
    await page.getByRole('button', { name: 'Compare all features' }).click();
    // Phones get one list per feature instead of a wide table.
    await expect(page.getByRole('table')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Checked baggage' })).toBeVisible();
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);

    await selectFamily(page, 'Flex');
    await expect(page.getByTestId('trip-summary')).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole('link', { name: 'Review and continue' }).click();
    await expect(
      page.getByRole('button', { name: 'Continue to traveller details' }),
    ).toBeInViewport();
    expect(errors).toEqual([]);
  });
});
