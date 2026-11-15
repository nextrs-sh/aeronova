import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import {
  FLIGHT,
  ONE_ADULT,
  chooseSeat,
  extrasReady,
  fillTravellers,
  nextSeatIndex,
  reviewReady,
  saveTravellers,
  seat,
  shown,
  startBooking,
} from '../e2e/booking-flow';
import { expectConfirmed, paymentForm } from '../e2e/checkout-flow';
import { expect, test, trackPageErrors } from '../e2e/helpers';

/*
 * Milestone 7: the required journey on a fresh Docker deployment (compose.yaml +
 * compose.e2e.yaml), through the nginx proxy, with production defaults: no payment outcome
 * controls, no fault injection. Synthetic travellers and a synthetic demo account only.
 */

const compose = (...args: string[]) =>
  execFileSync('sh', ['scripts/docker/compose.sh', ...args], { encoding: 'utf8' }).trim();
const MANAGE_URL = /\/manage-booking\/(ord_[A-Za-z0-9_-]{22})(\?.*)?$/;
const PASSWORD = 'docker-e2e-passphrase';

async function confirmServicing(page: Page, method?: 'Demo Card' | 'Demo Wallet') {
  const form = page
    .locator('[data-testid="servicing-confirm"][data-ready="true"]')
    .filter({ visible: true });
  await expect(form).toBeVisible();
  if (method) await form.getByRole('radio', { name: method }).check();
  await form.getByTestId('confirm-servicing').click();
}

function activeHolds(): number {
  const metrics = compose(
    'exec',
    '-T',
    'velasia-api',
    'node',
    '-e',
    "fetch('http://127.0.0.1:4010/metrics').then(r=>r.text()).then(t=>console.log(/velasia_inventory_active_holds (\\d+)/.exec(t)[1]))",
  );
  return Number(metrics);
}

test('the full booking and servicing journey on a fresh Docker deployment, across an API restart', async ({
  page,
  browser,
}) => {
  const errors = trackPageErrors(page);

  // 1. Homepage, with the disclaimers.
  await page.goto('/');
  await expect(page.getByText(/fictional airline/).first()).toBeVisible();
  await expect(page.locator('footer')).toContainText('no real reservations, tickets, payments');

  // 2–3. Search flights and select an offer (Classic).
  await page.goto(ONE_ADULT);
  await expect(page.getByTestId('flight-card').first()).toBeVisible();
  await startBooking(page, ONE_ADULT, 'Classic');

  // 4. Travellers.
  await fillTravellers(page, 1);
  await saveTravellers(page);

  // 5. A seat.
  await chooseSeat(page, seat(page, 'available', nextSeatIndex()));
  await page.getByTestId('continue-seats').click();
  await expect(page).toHaveURL(/\/booking\/extras$/);

  // 6. Baggage and a meal.
  await extrasReady(page);
  await page.getByTestId('baggage-ADT1-outbound').getByText('Extra 15 kg').click();
  await expect(page.getByTestId('baggage-ADT1-outbound').getByTestId('extra-saved')).toBeVisible();
  const meal = page.getByTestId(`meal-ADT1-${FLIGHT}`);
  if (await meal.getByText('Vegetarian meal').count()) {
    await meal.getByText('Vegetarian meal').click();
    await expect(meal.getByTestId('extra-saved')).toBeVisible();
  }
  await page.getByTestId('continue-extras').click();
  await expect(page).toHaveURL(/\/booking\/review$/);

  // 7. Review the server-priced total.
  await reviewReady(page);
  await expect(page.getByTestId('review-ready')).toBeVisible();

  // 8–9. Simulated checkout (production default: approved) and the confirmation.
  await page.getByTestId('continue-checkout').click();
  await expect(page).toHaveURL(/\/booking\/checkout$/, { timeout: 30_000 });
  const form = paymentForm(page);
  await expect(form).toBeVisible();
  // No outcome controls in production mode: only the method is chosen.
  await expect(form.getByRole('radio', { name: /^Decline/ })).toHaveCount(0);
  await form.getByRole('radio', { name: /^Demo Card/ }).check();
  await form.getByTestId('pay-button').click();
  const orderId = await expectConfirmed(page);
  const reference = (await shown(page, 'booking-reference').textContent())!;

  // 10–12. A demo account (registration enabled for this environment), link, My Trips.
  const email = `docker.${Date.now()}@example.com`;
  await page.goto('/account/register');
  const register = page.locator('[data-testid="register-form"][data-ready="true"]');
  await register.getByLabel('Given names').fill('Amihan');
  await register.getByLabel('Family name').fill('Testcase');
  await register.getByLabel('Email', { exact: true }).fill(email);
  await register.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await register.getByLabel('Confirm password').fill(PASSWORD);
  await register.getByTestId('register-demo').check();
  await register.getByTestId('register-submit').click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });
  await page.goto('/account/trips');
  const link = shown(page, 'link-bookings');
  await expect(link).toContainText(reference);
  await link.getByTestId('link-confirm').check();
  await link.getByTestId('link-submit').click();
  const card = page.locator(`[data-testid="trip-card"][data-order="${orderId}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });

  // 13. Manage the booking.
  await card.getByRole('link', { name: /Manage booking/ }).click();
  await expect(page).toHaveURL(MANAGE_URL);
  await expect(shown(page, 'manage-booking')).toHaveAttribute('data-order-status', 'CONFIRMED');

  // 14–15. Change to an eligible flight and pay the simulated difference.
  await shown(page, 'action-change-outbound').click();
  await expect(shown(page, 'change-alternatives')).toBeVisible();
  await page
    .locator('[data-testid="change-alternative"][data-itinerary="NV503-20261215"]')
    .getByRole('link', { name: /Review/ })
    .click();
  const review = shown(page, 'change-review');
  await expect(review.getByTestId('servicing-quote')).toHaveAttribute('data-adjustment', 'CHARGE');
  await confirmServicing(page, 'Demo Wallet');
  await expect(page).toHaveURL(new RegExp(`/manage-booking/${orderId}\\?updated=flight$`), {
    timeout: 30_000,
  });

  // 16. The order state.
  await expect(shown(page, 'order-leg-outbound')).toContainText('VEL 503');
  await expect(
    page.locator('[data-testid="servicing-record"][data-status="COMPLETED"]'),
  ).toHaveCount(1);
  const holdsBefore = activeHolds();
  expect(holdsBefore).toBeGreaterThanOrEqual(1);

  // 17. Restart the API container (graceful stop, then start on the same volume).
  compose('restart', 'velasia-api');
  compose('up', '-d', '--wait', 'velasia-api');

  // 18. The order persisted.
  await page.goto(`/manage-booking/${orderId}`);
  await expect(shown(page, 'manage-booking')).toHaveAttribute('data-order-status', 'CONFIRMED');
  await expect(shown(page, 'order-leg-outbound')).toContainText('VEL 503');
  await page.goto('/account/trips');
  await expect(card).toBeVisible();

  // 19. Allocations: the ledger rebuilt from TalaDB holds exactly what it held before.
  expect(activeHolds()).toBe(holdsBefore);

  // 20. Private data stays private: another browser sees nothing.
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(`/manage-booking/${orderId}`);
  await expect(shown(stranger, 'manage-unavailable')).toBeVisible();
  await expect(stranger.locator('body')).not.toContainText(reference);
  await stranger.goto('/account/trips');
  await expect(stranger).toHaveURL(/\/account\/sign-in\?next=/);
  await stranger.close();

  expect(errors.filter((error) => !error.includes('http 404'))).toEqual([]);
});

test('the deployment fits a phone screen @mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/fictional airline/).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.goto(ONE_ADULT);
  await expect(page.getByTestId('flight-card').first()).toBeVisible();
});
