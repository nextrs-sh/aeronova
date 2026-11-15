import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import {
  expect,
  selectFamily,
  simulateApiFault,
  simulateScenario,
  test,
  trackPageErrors,
} from './helpers';

/*
 * Milestone 4: traveller details, seat maps, extras, and the booking review, on top of the M3
 * shopping session. All travellers are synthetic. Failures and races use the test-only
 * `velasia-scenario` / `velasia-fault` cookies, so nothing depends on timing or randomness.
 */

const TWO_ADULTS = '/flights?trip=one-way&from=MNL&to=SIN&depart=2026-12-15&adults=2&cabin=economy';
const ONE_ADULT = '/flights?trip=one-way&from=MNL&to=SIN&depart=2026-12-15&adults=1&cabin=economy';
const FLIGHT = 'NV501-20261215';

/**
 * Next.js keeps recently visited routes mounted but hidden (React Activity), so a test id can
 * exist on an earlier step too: always look at the visible one.
 */
const shown = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

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

const TRAVELLERS = [
  { id: 'ADT1', given: 'Amihan', family: 'Dela Cruz', dob: '1990-04-12' },
  { id: 'ADT2', given: 'Bayani', family: 'Reyes', dob: '1987-09-30' },
];

/** Search, open the fares of the first result, choose a family, and continue to travellers. */
async function startBooking(page: Page, search: string, family: 'Light' | 'Classic' | 'Flex') {
  await page.goto(`${search}&fares=${FLIGHT}`);
  await expect(page.getByTestId('fare-cards')).toBeVisible();
  await selectFamily(page, family);
  await expect(page.getByTestId('trip-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to traveller details' }).click();
  await expect(page).toHaveURL(/\/booking\/travellers$/);
  await expect(page.getByTestId('traveller-form')).toBeVisible();
}

async function fillTravellers(page: Page, count: number) {
  for (const traveller of TRAVELLERS.slice(0, count)) {
    const card = page.getByTestId(`traveller-${traveller.id}`);
    await card.getByLabel('Given names').fill(traveller.given);
    await card.getByLabel('Family name').fill(traveller.family);
    await card.getByLabel('Date of birth').fill(traveller.dob);
    await card.getByLabel('Nationality').selectOption('PH');
  }
  await page.getByLabel('Email').fill('amihan.delacruz@example.com');
  await page.getByLabel('Mobile phone').fill('+63 917 555 0123');
}

async function saveTravellers(page: Page) {
  await page.getByTestId('save-travellers').click();
  await expect(page).toHaveURL(/\/booking\/seats/);
  await expect(page.locator('[data-testid="seat-selector"][data-ready="true"]')).toBeVisible();
}

const seat = (page: Page, look: string, nth = 0) =>
  page.locator(`[data-testid="seat-map"] [data-look="${look}"]`).nth(nth);

/** Choose the seat under the cursor for the active traveller; returns the seat id. */
async function chooseSeat(page: Page, target: Locator) {
  const id = (await target.getAttribute('data-seat'))!;
  await target.click();
  await page.getByTestId('choose-seat').click();
  await expect(page.getByTestId('seat-saved')).toBeVisible();
  return id;
}

async function extrasReady(page: Page) {
  await expect(page.locator('[data-testid^="baggage-"][data-ready="true"]').first()).toBeVisible();
}

/** Wait until the review's client actions are interactive. */
async function reviewReady(page: Page) {
  await expect(shown(page, 'review-ready')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Travellers saved, seats skipped, extras skipped: the review for a one-adult trip. */
async function toReview(page: Page, family: 'Light' | 'Classic' | 'Flex' = 'Classic') {
  await startBooking(page, ONE_ADULT, family);
  await fillTravellers(page, 1);
  await saveTravellers(page);
  const id = await chooseSeat(page, seat(page, 'available', 5));
  await page.getByTestId('continue-seats').click();
  await expect(page).toHaveURL(/\/booking\/extras$/);
  await extrasReady(page);
  await page.getByTestId('continue-extras').click();
  await expect(page).toHaveURL(/\/booking\/review$/);
  await expect(page.getByTestId('review-ready')).toBeVisible();
  return id;
}

test.describe('booking: travellers, seats, extras, review', () => {
  // Several Server Action round trips per test; generous under a fully parallel run.
  test.describe.configure({ timeout: 60_000 });

  test('books two travellers from search to a validated review, with nothing ordered', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = trackPageErrors(page);
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') mutations.push(request.url());
    });

    // 1–3. Search, select an offer, and continue to traveller details.
    await page.goto(TWO_ADULTS);
    await page
      .getByTestId('flight-card')
      .first()
      .getByRole('link', { name: /View fares/ })
      .click();
    await expect(page.getByTestId('fare-cards')).toBeVisible();
    await selectFamily(page, 'Light');
    await page.getByRole('button', { name: 'Continue to traveller details' }).click();
    await expect(page.getByTestId('traveller-form')).toBeVisible();
    await expect(page).toHaveTitle(/Traveller details/);

    // 5. Required fields are validated inline, before anything is sent.
    await page.getByTestId('save-travellers').click();
    await expect(page.getByTestId('traveller-form-status')).toContainText('check the highlighted');
    const given = page.getByTestId('traveller-ADT1').getByLabel('Given names');
    await expect(given).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Enter the given name.').first()).toBeVisible();
    await page.getByTestId('traveller-ADT1').getByLabel('Date of birth').fill('2020-01-01');
    await page.getByTestId('traveller-ADT1').getByLabel('Given names').focus();
    await expect(page.getByText(/Adults must be 12 or older/)).toBeVisible();

    // 4, 6. Two demo travellers, saved through a Server Action.
    await fillTravellers(page, 2);
    await saveTravellers(page);
    expect(page.url()).not.toMatch(/Amihan|Reyes|example/);

    // 7–11. The A321neo seat map: seats for both, a change, occupied seats refused, prices.
    const flightsTotal = await amount(shown(page, 'panel-flights'));
    await expect(page.getByTestId('seat-legend')).toContainText('Standard · ₱300');
    const occupied = seat(page, 'occupied');
    // Occupied seats are announced and reachable, but aria-disabled: open one by keyboard.
    await occupied.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('seat-details')).toContainText('already taken');
    await expect(page.getByTestId('choose-seat')).toHaveCount(0);
    await expect(occupied).toHaveAttribute('aria-disabled', 'true');
    await expect(occupied).toHaveAttribute('aria-label', /occupied/);

    const standard = page.locator(
      '[data-testid="seat-map"] [data-look="available"]:not(:has(svg))',
    );
    const first = await chooseSeat(page, standard.nth(3));
    await expect(page.getByTestId('assigned-seat-ADT1')).toHaveText(`Seat ${first}`);
    // The next traveller is selected automatically.
    await expect(page.getByTestId('seat-traveller-ADT2')).toHaveAttribute('aria-pressed', 'true');
    const second = await chooseSeat(page, standard.nth(6));
    await expect(page.getByTestId('assigned-seat-ADT2')).toHaveText(`Seat ${second}`);
    await expect(shown(page, 'booking-total').first()).toHaveText(
      `₱${(flightsTotal + 600).toLocaleString('en-PH')}`,
    );
    // Change Adult 1 to an extra-legroom seat: its charge replaces the old one.
    await page.getByTestId('seat-traveller-ADT1').click();
    const legroom = page
      .locator('[data-testid="seat-map"] [data-look="available"]')
      .filter({ has: page.locator('.lucide-move-vertical') })
      .first();
    await legroom.click();
    await expect(page.getByTestId('seat-price')).toHaveText('₱1,000 per flight');
    await page.getByTestId('choose-seat').click();
    await expect(page.getByTestId('seat-saved')).toBeVisible();
    await expect(page.getByTestId('assigned-seat-ADT1')).not.toHaveText(`Seat ${first}`);
    await expect(shown(page, 'panel-seats').first()).toHaveText('₱1,300');
    expect(await axe(page)).toEqual([]);
    await page.getByTestId('continue-seats').click();
    await expect(page).toHaveURL(/\/booking\/extras$/);
    await extrasReady(page);

    // 12–15. Baggage, a meal, a priority service (then removed), and what Light includes.
    await expect(page.getByTestId('baggage-ADT1-outbound')).toContainText('no checked bag');
    await page.getByTestId('baggage-ADT1-outbound').getByText('Extra 15 kg').click();
    await expect(page.getByTestId('baggage-total-ADT1-outbound')).toContainText('15 kg');
    await expect(
      page.getByTestId('baggage-ADT1-outbound').getByTestId('extra-saved'),
    ).toBeVisible();
    await page.getByTestId(`meal-ADT2-${FLIGHT}`).getByText('Vegetarian meal').click();
    await expect(page.getByTestId(`meal-ADT2-${FLIGHT}`).getByTestId('extra-saved')).toBeVisible();
    const priority = page.getByTestId('priority-ADT1-outbound').getByRole('checkbox', {
      name: /Priority boarding/,
    });
    await priority.check();
    await expect(
      page.getByTestId('priority-ADT1-outbound').getByTestId('extra-saved'),
    ).toBeVisible();
    await expect(shown(page, 'panel-priority').first()).toHaveText('₱350');
    await priority.uncheck();
    await expect(shown(page, 'panel-priority').first()).toHaveText('None added');
    await expect(shown(page, 'panel-baggage').first()).toHaveText('₱1,450');
    await expect(shown(page, 'panel-meals').first()).toHaveText('₱350');
    expect(await axe(page)).toEqual([]);

    // 16–17. The review: the itinerary, every line, and a total that reconciles.
    await page.getByTestId('continue-extras').click();
    await expect(page).toHaveURL(/\/booking\/review$/);
    await expect(page.getByTestId('review-ready')).toBeVisible();
    await expect(page.getByTestId('review-flights')).toContainText('VEL 501');
    await expect(page.getByTestId('review-travellers')).toContainText('Amihan Dela Cruz');
    await expect(page.getByTestId('review-seats')).toContainText(second);
    const total = flightsTotal + 1300 + 1450 + 350;
    await expect(page.getByTestId('quote-total')).toHaveText(`₱${total.toLocaleString('en-PH')}`);
    await expect(shown(page, 'booking-total').first()).toHaveText(
      `₱${total.toLocaleString('en-PH')}`,
    );
    const parts = await Promise.all(
      [
        'quote-base',
        'quote-family',
        'quote-taxes',
        'quote-seats',
        'quote-baggage',
        'quote-meals',
        'quote-priority',
      ].map((id) => amount(page.getByTestId(id))),
    );
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
    await expect(page.getByTestId('continue-checkout')).toBeVisible();
    expect(await axe(page)).toEqual([]);

    // 18. Back to seats and change: the review must be checked again.
    await page.getByRole('link', { name: 'Change seats' }).click();
    await expect(page).toHaveURL(/\/booking\/seats/);
    await page.getByTestId('remove-seat-ADT2').click();
    await expect(page.getByTestId('assigned-seat-ADT2')).toHaveText('No seat yet');
    await page.getByTestId('continue-seats').click();
    await page.getByTestId('continue-extras').click();
    await expect(page.getByTestId('review-ready')).toBeVisible();
    await expect(page.getByTestId('review-seats')).toContainText('Assigned at check-in');

    // 19. A refresh restores everything from the session.
    await page.reload();
    await expect(page.getByTestId('review-ready')).toBeVisible();
    await expect(page.getByTestId('quote-total')).toHaveText(
      `₱${(total - 300).toLocaleString('en-PH')}`,
    );

    // 27. The checkout boundary creates nothing.
    await page.getByTestId('continue-checkout').click();
    await expect(page.getByTestId('checkout-preview')).toBeVisible();
    await expect(page.getByTestId('no-order-notice')).toContainText('No order has been created');
    expect(mutations.filter((url) => /order|payment|ticket/i.test(url))).toEqual([]);

    // 26. No hydration or runtime errors anywhere in the flow.
    expect(errors).toEqual([]);
  });

  test('shows fare-family benefits as included and never charges for them', async ({ page }) => {
    await startBooking(page, ONE_ADULT, 'Flex');
    await fillTravellers(page, 1);
    await saveTravellers(page);
    await expect(page.getByTestId('legend-STANDARD')).toContainText('Included with your fare');
    await expect(page.getByTestId('legend-PREFERRED')).toContainText('Included with your fare');
    await expect(page.getByTestId('legend-EXTRA_LEGROOM')).toContainText('₱1,000');
    const preferred = page
      .locator('[data-testid="seat-map"] [data-look="available"]')
      .filter({ has: page.locator('.lucide-star') })
      .first();
    await expect(preferred).toHaveAttribute('aria-label', /Preferred.*no additional charge/);
    await chooseSeat(page, preferred);
    await expect(shown(page, 'panel-seats').first()).toHaveText('None added');
    await page.getByTestId('continue-seats').click();
    await expect(page.getByTestId('priority-included-outbound')).toContainText('Velasia Flex');
    await expect(page.getByTestId('baggage-ADT1-outbound')).toContainText('1 × 30 kg (30 kg)');
  });

  test('refreshes an expired offer at the same price and stays ready', async ({ page }) => {
    await toReview(page);
    await reviewReady(page);
    await simulateScenario(page, 'offer-expired');
    await page.getByTestId('review-check').click();
    await expect(shown(page, 'booking-notices')).toContainText('the price is the same');
    await expect(shown(page, 'review-ready')).toBeVisible();
    await simulateScenario(page, null);
  });

  test('asks before accepting a higher price, then keeps seats and extras', async ({ page }) => {
    const id = await toReview(page);
    await reviewReady(page);
    const before = await amount(page.getByTestId('quote-total'));
    await simulateScenario(page, 'price-increase');
    await page.getByTestId('review-check').click();
    await expect(page.getByTestId('review-action-required')).toBeVisible();
    await expect(page.locator('[data-code="PRICE_CHANGED"]')).toBeVisible();
    await expect(page.getByTestId('continue-checkout')).toHaveCount(0);
    // The accepted total stays until the traveller accepts.
    expect(await amount(page.getByTestId('quote-total'))).toBe(before);
    await page.getByTestId('accept-price-outbound').click();
    await expect(shown(page, 'review-ready')).toBeVisible();
    expect(await amount(page.getByTestId('quote-total'))).toBeGreaterThan(before);
    await expect(page.getByTestId('review-seats')).toContainText(id);
    await simulateScenario(page, null);
  });

  test('sends the traveller back when their seat was taken meanwhile', async ({ page }) => {
    const id = await toReview(page);
    await reviewReady(page);
    await simulateScenario(page, 'seat-taken');
    await page.getByTestId('review-check').click();
    const issue = page.locator('[data-code="SEAT_UNAVAILABLE"]');
    await expect(issue).toContainText(`Seat ${id}`);
    await expect(page.getByTestId('continue-checkout')).toHaveCount(0);
    await issue.getByRole('link', { name: 'Choose seats' }).click();
    await expect(page).toHaveURL(new RegExp(`/booking/seats\\?flight=${FLIGHT}`));
    await expect(page.getByTestId('assigned-seat-ADT1')).toHaveText('No seat yet');
    await simulateScenario(page, null);
  });

  test('never resends a change whose answer timed out, and shows what was saved', async ({
    page,
  }) => {
    await startBooking(page, ONE_ADULT, 'Classic');
    await fillTravellers(page, 1);
    await saveTravellers(page);
    const target = seat(page, 'available', 4);
    const id = (await target.getAttribute('data-seat'))!;
    await target.click();
    await simulateApiFault(page, 'slow-commit');
    await page.getByTestId('choose-seat').click();
    await expect(page.getByTestId('seat-error')).toContainText('can’t tell whether');
    await simulateApiFault(page, null);
    await page.reload();
    // The API applied the change before its answer was lost.
    await expect(page.getByTestId('assigned-seat-ADT1')).toHaveText(`Seat ${id}`);
  });

  test('works with the keyboard alone on the seat map', async ({ page }) => {
    await startBooking(page, ONE_ADULT, 'Classic');
    await fillTravellers(page, 1);
    await saveTravellers(page);
    const stop = page.locator('[data-testid="seat-map"] button[tabindex="0"]');
    await expect(stop).toHaveCount(1);
    await stop.focus();
    const start = await page.evaluate(() => document.activeElement?.getAttribute('data-seat'));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const moved = await page.evaluate(() => document.activeElement?.getAttribute('data-seat'));
    expect(moved).not.toBe(start);
    // Find a seat this traveller can choose, by keyboard.
    for (let i = 0; i < 60; i += 1) {
      const look = await page.evaluate(() => document.activeElement?.getAttribute('data-look'));
      if (look === 'available') break;
      await page.keyboard.press(i % 6 === 5 ? 'ArrowDown' : 'ArrowRight');
    }
    const chosen = await page.evaluate(() => document.activeElement?.getAttribute('data-seat'));
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('seat-details')).toContainText(`Seat ${chosen}`);
    await page.getByTestId('choose-seat').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('assigned-seat-ADT1')).toHaveText(`Seat ${chosen}`);
  });

  test('shows a recovery path for deep links without a session or with steps missing', async ({
    page,
  }) => {
    for (const step of ['travellers', 'seats', 'extras', 'review', 'checkout']) {
      await page.goto(`/booking/${step}`);
      await expect(shown(page, 'booking-recovery')).toHaveAttribute('data-reason', 'none');
    }
    await startBooking(page, ONE_ADULT, 'Classic');
    // Travellers aren't saved yet: later steps stay locked.
    await page.goto('/booking/extras');
    await expect(shown(page, 'booking-recovery')).toHaveAttribute('data-reason', 'locked');
    await page.getByRole('link', { name: 'Continue with traveller details' }).click();
    await expect(page.getByTestId('traveller-form')).toBeVisible();
    // An expired session.
    await simulateScenario(page, 'session-expired');
    await page.goto('/booking/travellers');
    await expect(shown(page, 'booking-recovery')).toHaveAttribute('data-reason', 'expired');
    await simulateScenario(page, null);
  });

  test('redirects the US spelling of the first step', async ({ page }) => {
    await page.goto('/booking/travelers');
    await expect(page).toHaveURL(/\/booking\/travellers$/);
  });
});

test.describe('booking on phones @mobile', () => {
  test('fills traveller details and chooses seats without page overflow @mobile', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'mobile only');
    const errors = trackPageErrors(page);
    await startBooking(page, TWO_ADULTS, 'Classic');
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await expect(shown(page, 'trip-panel-compact')).toBeVisible();
    await fillTravellers(page, 2);
    await saveTravellers(page);
    expect(await overflow()).toBeLessThanOrEqual(0);
    const standard = page.locator(
      '[data-testid="seat-map"] [data-look="available"]:not(:has(svg))',
    );
    await chooseSeat(page, standard.nth(2));
    await expect(page.getByTestId('seat-details')).toBeInViewport();
    await chooseSeat(page, standard.nth(8));
    await shown(page, 'trip-panel-compact').locator('summary').click();
    await expect(shown(page, 'trip-panel-compact').getByTestId('panel-seats')).toHaveText(
      'None added',
    );
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
