import type { Page } from '@playwright/test';
import { axe, nextSeatIndex, seat, shown, toReview } from './booking-flow';
import { API, apiOrder, expectConfirmed, pay, toCheckout } from './checkout-flow';
import { expect, test, trackPageErrors } from './helpers';

/*
 * Milestone 6: Manage Booking, servicing, and demo accounts, end to end against the production
 * build, a real retailing API, and its own TalaDB file. Every traveller and account is synthetic;
 * every payment and refund is simulated with the test-only outcome control.
 */

const MANAGE_URL = /\/manage-booking\/(ord_[A-Za-z0-9_-]{22})(\?.*)?$/;
const PASSWORD = 'e2e-demo-passphrase';

async function confirmedBooking(page: Page) {
  await toReview(page, 'Classic');
  await toCheckout(page);
  await pay(page, 'Demo Card', 'Approve');
  return expectConfirmed(page);
}

async function confirmServicing(
  page: Page,
  method?: 'Demo Card' | 'Demo Wallet',
  outcome = 'Approve',
) {
  const form = page
    .locator('[data-testid="servicing-confirm"][data-ready="true"]')
    .filter({ visible: true });
  await expect(form).toBeVisible();
  if (method) {
    await form.getByRole('radio', { name: method }).check();
    await form.getByRole('radio', { name: outcome, exact: true }).first().check();
  }
  await form.getByTestId('confirm-servicing').click();
}

async function expectUpdated(page: Page, orderId: string, what: string) {
  await expect(page).toHaveURL(new RegExp(`/manage-booking/${orderId}\\?updated=${what}$`), {
    timeout: 20_000,
  });
  await expect(shown(page, 'manage-updated')).toBeVisible();
}

async function expectNotice(page: Page, orderId: string, what: string) {
  await expect(page).toHaveURL(new RegExp(`/manage-booking/${orderId}\\?updated=${what}$`), {
    timeout: 20_000,
  });
  await expect(shown(page, 'manage-notice')).toBeVisible();
}

async function register(page: Page, email: string) {
  await page.goto('/account/register');
  const form = page.locator('[data-testid="register-form"][data-ready="true"]');
  await form.getByLabel('Given names').fill('Amihan');
  await form.getByLabel('Family name').fill('Testcase');
  await form.getByLabel('Email', { exact: true }).fill(email);
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await form.getByLabel('Confirm password').fill(PASSWORD);
  await form.getByTestId('register-demo').check();
  await form.getByTestId('register-submit').click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 20_000 });
}

async function signIn(page: Page, email: string) {
  const form = page.locator('[data-testid="sign-in-form"][data-ready="true"]');
  await form.getByLabel('Email', { exact: true }).fill(email);
  await form.getByLabel('Password').fill(PASSWORD);
  await form.getByTestId('sign-in-submit').click();
}

test.describe('manage booking and accounts', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the whole post-booking journey: change, seat, bag, account, link, sign out and in, cancel', async ({
    page,
    request,
  }) => {
    const errors = trackPageErrors(page);
    const orderId = await confirmedBooking(page);

    // Manage Booking finds the booking this browser made.
    await page.goto('/manage-booking');
    const card = page.locator(`[data-testid="trip-card"][data-order="${orderId}"]`);
    await expect(card).toBeVisible();
    await card.getByRole('link', { name: /Manage booking/ }).click();
    await expect(page).toHaveURL(MANAGE_URL);
    await expect(shown(page, 'manage-booking')).toHaveAttribute('data-order-status', 'CONFIRMED');
    expect(await axe(page)).toEqual([]);

    // 7–10. Change to the afternoon flight; the price is the API's; pay; the itinerary updates.
    await shown(page, 'action-change-outbound').click();
    await expect(shown(page, 'change-alternatives')).toBeVisible();
    const alternative = page.locator(
      '[data-testid="change-alternative"][data-itinerary="NV503-20261215"]',
    );
    await alternative.getByRole('link', { name: /Review/ }).click();
    const review = shown(page, 'change-review');
    await expect(review).toBeVisible();
    await expect(review.getByTestId('current-journey')).toContainText('VEL 501');
    await expect(review.getByTestId('new-journey')).toContainText('VEL 503');
    await expect(review.getByTestId('servicing-quote')).toHaveAttribute(
      'data-adjustment',
      'CHARGE',
    );
    await expect(review.getByTestId('quote-line-CHANGE_FEE')).toContainText('₱1,200');
    await confirmServicing(page, 'Demo Wallet');
    await expectUpdated(page, orderId, 'flight');
    await expect(shown(page, 'order-leg-outbound')).toContainText('VEL 503');

    // 11. A seat on the new flight (the old flight's seat was released).
    await shown(page, 'action-seats').click();
    await expect(page.locator('[data-testid="seat-selector"][data-ready="true"]')).toBeVisible();
    await seat(page, 'available', nextSeatIndex()).click();
    await shown(page, 'choose-seat').click();
    const seatQuote = shown(page, 'seat-change-panel').getByTestId('servicing-quote');
    await expect(seatQuote).toBeVisible();
    const seatAdjustment = await seatQuote.getAttribute('data-adjustment');
    await confirmServicing(page, seatAdjustment === 'CHARGE' ? 'Demo Card' : undefined);
    await expectUpdated(page, orderId, 'seats');

    // 12. Extra baggage after booking.
    await shown(page, 'action-extras').click();
    await shown(page, 'extra-BAG_10-ADT1-outbound').click();
    await expect(shown(page, 'extras-panel').getByTestId('servicing-quote')).toHaveAttribute(
      'data-adjustment',
      'CHARGE',
    );
    await confirmServicing(page, 'Demo Card');
    await expectUpdated(page, orderId, 'extras');

    // 13. The total and the history reflect three completed changes; the original is kept.
    await expect(
      page.locator('[data-testid="servicing-record"][data-status="COMPLETED"]'),
    ).toHaveCount(3);
    const order = await apiOrder(page, request, orderId);
    expect(order.currentVersion).toBe(4);
    expect(order.original.journeys[0].itinerary.id).toBe('NV501-20261215');
    expect(order.currentTotalMinor).toBeGreaterThan(order.totalMinor);
    expect(order.financial.paidMinor).toBe(order.currentTotalMinor);

    // 14–16. A demo account; the guest booking is linked only on explicit confirmation.
    const email = `e2e.${Date.now()}.${test.info().parallelIndex}@example.com`;
    await register(page, email);
    await page.goto('/account/trips');
    const link = shown(page, 'link-bookings');
    await expect(link).toContainText(order.reference);
    await link.getByTestId('link-submit').click();
    await expect(link.getByTestId('action-error')).toBeVisible(); // the confirmation box is required
    await link.getByTestId('link-confirm').check();
    await link.getByTestId('link-submit').click();
    await expect(page.locator(`[data-testid="trip-card"][data-order="${orderId}"]`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(shown(page, 'link-bookings')).toHaveCount(0);

    // 17. A saved traveller.
    await page.goto('/account/travellers');
    const profile = page.locator('[data-testid="traveller-profile-form"][data-ready="true"]');
    await profile.getByLabel('Given names').fill('Malaya');
    await profile.getByLabel('Family name').fill('Testcase');
    await profile.getByLabel('Date of birth').fill('1993-06-21');
    await profile.getByLabel('Nationality').selectOption('PH');
    await profile.getByTestId('traveller-profile-submit').click();
    await expect(shown(page, 'saved-traveller')).toContainText('Malaya Testcase');

    // 18. Sign out: protected pages and the linked booking are closed to this browser.
    const document = await page.goto('/account/trips');
    expect(document!.headers()['cache-control']).toMatch(/no-store/);
    await shown(page, 'sign-out').click();
    await expect(page).toHaveURL(/\/account\/sign-in\?signedOut=1$/);
    for (const path of ['/account', '/account/trips', '/account/travellers', '/account/settings']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/account\/sign-in\?next=/);
    }
    await page.goto(`/manage-booking/${orderId}`);
    await expect(shown(page, 'manage-unavailable')).toBeVisible();

    // 19. Sign in again and open it from My Trips.
    await page.goto(`/account/sign-in?next=/manage-booking/${orderId}`);
    await signIn(page, email);
    await expect(page).toHaveURL(MANAGE_URL, { timeout: 20_000 });

    // 20–21. Cancel: the outcome first, an explicit tick, then a pending simulated refund.
    await shown(page, 'action-cancel').click();
    await expect(shown(page, 'cancel-summary')).toBeVisible();
    const cancel = page.locator('[data-testid="cancel-form"][data-ready="true"]');
    await cancel.getByTestId('confirm-cancellation').click();
    await expect(cancel.getByTestId('action-error')).toBeVisible();
    await cancel.getByTestId('cancel-confirm-checkbox').check();
    await cancel.getByRole('radio', { name: 'Pending', exact: true }).check();
    await cancel.getByTestId('confirm-cancellation').click();
    await expectUpdated(page, orderId, 'cancelled');
    await expect(shown(page, 'manage-booking')).toHaveAttribute(
      'data-order-status',
      'BOOKING_CANCELLED',
    );
    await expect(shown(page, 'refund-status')).toHaveAttribute('data-state', 'pending');
    await page.waitForTimeout(1_800); // the simulated provider decides on its own clock
    await shown(page, 'check-refund-status').click();
    await expect(shown(page, 'refund-status')).toHaveCount(0, { timeout: 20_000 });
    await expect(shown(page, 'money-summary')).toContainText('Refunded');
    await expect(shown(page, 'action-change-outbound')).toHaveAttribute('data-disabled', 'true');

    // 22. Still retrievable from durable state (process restarts: see the API crash suites).
    await page.reload();
    await expect(shown(page, 'manage-booking')).toHaveAttribute(
      'data-order-status',
      'BOOKING_CANCELLED',
    );

    // 25. No hydration or runtime errors; every request stayed local.
    expect(errors.filter((e) => !e.includes('http 404'))).toEqual([]);
  });

  test('a booking can’t be opened or found from another browser, by id or by reference', async ({
    page,
    browser,
  }) => {
    const orderId = await confirmedBooking(page);
    const reference = (await shown(page, 'booking-reference').textContent())!;
    const other = await browser.newContext();
    const stranger = await other.newPage();
    await stranger.goto(`/manage-booking/${orderId}`);
    await expect(shown(stranger, 'manage-unavailable')).toBeVisible();
    await expect(stranger.locator('body')).not.toContainText(reference);
    await stranger.goto('/manage-booking');
    await stranger.getByRole('textbox', { name: 'Booking reference' }).fill(reference);
    await shown(stranger, 'lookup-submit').click();
    await expect(shown(stranger, 'action-error')).toContainText('couldn’t open a booking');
    // The same answer for a reference that doesn't exist.
    await stranger.getByRole('textbox', { name: 'Booking reference' }).fill('VEL-ZZZZZZ');
    await shown(stranger, 'lookup-submit').click();
    await expect(shown(stranger, 'action-error')).toContainText('couldn’t open a booking');
    for (const path of ['change-flight', 'seats', 'extras', 'cancel']) {
      await stranger.goto(`/manage-booking/${orderId}/${path}`);
      await expect(shown(stranger, 'manage-unavailable')).toBeVisible();
    }
    // The API refuses it too, without credentials.
    const response = await stranger.request.get(`${API}/v1/orders/${orderId}`);
    expect(response.status()).toBe(404);
    await other.close();
    // The owner finds it by reference.
    await page.goto('/manage-booking');
    await page.getByRole('textbox', { name: 'Booking reference' }).fill(reference);
    await shown(page, 'lookup-submit').click();
    await expect(page).toHaveURL(MANAGE_URL);
  });

  test('a declined change payment leaves the booking unchanged and can be discarded', async ({
    page,
  }) => {
    const orderId = await confirmedBooking(page);
    await page.goto(
      `/manage-booking/${orderId}/change-flight?direction=outbound&date=2026-12-15&itinerary=NV503-20261215`,
    );
    await confirmServicing(page, 'Demo Card', 'Decline');
    await expectNotice(page, orderId, 'declined');
    await expect(shown(page, 'pending-change')).toBeVisible();
    await expect(shown(page, 'order-leg-outbound')).toContainText('VEL 501');
    await shown(page, 'discard-change').click();
    await expectUpdated(page, orderId, 'discarded');
    await expect(shown(page, 'pending-change')).toHaveCount(0);
  });

  test('Manage Booking works with the keyboard alone', async ({ page }) => {
    const orderId = await confirmedBooking(page);
    await page.goto(`/manage-booking/${orderId}`);
    const action = shown(page, 'action-extras');
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/extras$/);
    const option = shown(page, 'extra-BAG_10-ADT1-outbound');
    await option.focus();
    await page.keyboard.press('Enter');
    const form = page.locator('[data-testid="servicing-confirm"][data-ready="true"]');
    await expect(form).toBeVisible();
    await form.getByRole('radio', { name: 'Demo Card' }).focus();
    await page.keyboard.press('Space');
    await form.getByTestId('confirm-servicing').focus();
    await page.keyboard.press('Enter');
    await expectUpdated(page, orderId, 'extras');
  });
});

test.describe('manage booking on phones @mobile', () => {
  test.describe.configure({ timeout: 120_000 });

  test('overview, change search, and cancellation fit the screen @mobile', async ({ page }) => {
    const errors = trackPageErrors(page);
    const orderId = await confirmedBooking(page);
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    for (const path of [
      '',
      '/change-flight?direction=outbound&date=2026-12-16',
      '/cancel',
      '/extras',
    ]) {
      await page.goto(`/manage-booking/${orderId}${path}`);
      await expect(shown(page, 'manage-header')).toBeVisible();
      expect(await overflow(), path).toBeLessThanOrEqual(0);
      expect(await axe(page), path).toEqual([]);
    }
    await page.goto('/account/sign-in');
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors.filter((e) => !e.includes('http 404'))).toEqual([]);
  });
});
