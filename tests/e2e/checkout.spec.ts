import type { APIRequestContext, Page } from '@playwright/test';
import {
  FLIGHT,
  ONE_ADULT,
  amount,
  axe,
  chooseSeat,
  extrasReady,
  fillTravellers,
  nextSeatIndex,
  reviewReady,
  saveTravellers,
  seat,
  shown,
  startBooking,
  toReview,
} from './booking-flow';
import {
  API,
  ORDER_URL,
  apiOrder,
  choosePayment,
  expectConfirmed,
  pay,
  paymentForm,
  peso,
  toCheckout,
} from './checkout-flow';
import { expect, simulateApiFault, simulateScenario, test, trackPageErrors } from './helpers';

/*
 * Milestone 5: checkout, simulated payments, and durable orders. All travellers are synthetic,
 * every payment is simulated, and the outcomes use the test-only "simulated outcome" control.
 * Failures and expiry use the `velasia-scenario` / `velasia-fault` cookies, so nothing depends on
 * waiting for real time to pass.
 */

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('checkout and payment', () => {
  test.describe.configure({ timeout: 90_000 });

  test('books a trip end to end: checkout, demo payment, durable confirmation', async ({
    page,
    request,
  }) => {
    const errors = trackPageErrors(page);
    const hosts = new Set<string>();
    page.on('request', (r) => hosts.add(new URL(r.url()).host));

    // 1–7. Search, fare, traveller, a seat, extra baggage and a meal, then the review.
    await startBooking(page, ONE_ADULT, 'Classic');
    await fillTravellers(page, 1);
    await saveTravellers(page);
    const seatId = await chooseSeat(page, seat(page, 'available', nextSeatIndex()));
    await page.getByTestId('continue-seats').click();
    await extrasReady(page);
    await page.getByTestId('baggage-ADT1-outbound').getByText('Extra 15 kg').click();
    await expect(
      page.getByTestId('baggage-ADT1-outbound').getByTestId('extra-saved'),
    ).toBeVisible();
    await page.getByTestId(`meal-ADT1-${FLIGHT}`).getByText('Vegetarian meal').click();
    await expect(page.getByTestId(`meal-ADT1-${FLIGHT}`).getByTestId('extra-saved')).toBeVisible();
    await page.getByTestId('continue-extras').click();
    await expect(page).toHaveURL(/\/booking\/review$/);
    const total = await amount(page.getByTestId('quote-total'));

    // 8–9. Checkout shows exactly what is being bought, and the same total.
    await toCheckout(page);
    await expect(page).toHaveTitle(/Checkout/);
    await expect(page.getByTestId('order-total').first()).toHaveText(peso(total));
    await expect(page.getByTestId('hold-timer')).toContainText('Your seats are held');
    await expect(page.getByTestId('order-travellers')).toContainText('Amihan Dela Cruz');
    await expect(page.getByTestId('order-flights')).toContainText('VEL 501');
    await expect(page.getByTestId('order-seats')).toContainText(`Seat ${seatId}`);
    await expect(page.getByTestId('order-extras-list')).toContainText('Extra 15 kg');
    await expect(page.getByTestId('order-extras-list')).toContainText('Vegetarian meal');
    await expect(page.getByTestId('order-baggage')).toContainText('35 kg');
    await expect(page.getByTestId('pay-button')).toHaveText(`Pay ${peso(total)} (demo)`);
    // 28. Nothing here can take a real payment: no card, bank, or wallet fields at all.
    await expect(
      page.locator('input[autocomplete^="cc-"], input[name*="card" i], input[name*="cvv" i]'),
    ).toHaveCount(0);
    expect(await axe(page)).toEqual([]);

    // 10–12. A demo method, a simulated approval, and the confirmation.
    await pay(page, 'Demo Wallet', 'Approve');
    const orderId = await expectConfirmed(page);
    await expect(page.getByText(/confirmed in this demo/)).toBeVisible();
    await expect(page.getByTestId('confirmation-total')).toHaveText(peso(total));
    await expect(page.getByTestId('confirmation-payment')).toContainText('Demo Wallet · DEMO-');
    // (Next keeps the checkout mounted but hidden: look at the visible copy only.)
    await expect(shown(page, 'order-seats')).toContainText(`Seat ${seatId}`);
    expect(page.url()).not.toMatch(/Amihan|example|token/i);
    expect(await axe(page)).toEqual([]);

    // 13–14. A refresh reads the same durable order.
    const reference = await page.getByTestId('booking-reference').textContent();
    const document = await page.reload();
    expect(document!.headers()['cache-control']).toMatch(/no-store/);
    await expect(page.getByTestId('booking-reference')).toHaveText(reference!);
    const order = await apiOrder(page, request, orderId);
    expect(order).toMatchObject({ status: 'CONFIRMED', totalMinor: total * 100 });
    expect(order.payment.attempts).toHaveLength(1);

    // Print view: the booking without the site navigation.
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('body > header')).toBeHidden();
    await expect(page.getByTestId('booking-reference')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });

    // 27–28. No hydration or runtime errors, and nothing left this machine.
    expect(errors).toEqual([]);
    expect([...hosts].every((host) => host.startsWith('127.0.0.1'))).toBe(true);
  });

  test('a declined payment keeps the seats held and can be retried', async ({ page }) => {
    const errors = trackPageErrors(page);
    await toReview(page);
    await toCheckout(page);
    // 15. Declined.
    await pay(page, 'Demo Card', 'Decline');
    await expect(page.getByTestId('payment-declined')).toContainText('Payment unsuccessful');
    await expect(page.getByTestId('payment-declined')).toBeFocused();
    await expect(page).toHaveURL(/\/booking\/checkout$/);
    // After a refresh the page still says so, and the seats are still held.
    await page.reload();
    await expect(page.getByTestId('payment-last-failed')).toContainText('Payment unsuccessful');
    await expect(page.getByTestId('hold-timer')).toBeVisible();
    // 16. Retry and succeed.
    await expect(page.getByTestId('pay-button')).toHaveText(/^Try again · pay ₱/);
    await pay(page, 'Demo Card', 'Approve');
    await expectConfirmed(page);
    expect(errors).toEqual([]);
  });

  test('a timed-out payment is recovered by checking the status, never paid twice', async ({
    page,
    request,
  }) => {
    await toReview(page);
    await toCheckout(page);
    // 17. Timeout: the result is unknown.
    await pay(page, 'Demo Bank Transfer', 'Time out');
    // The page now shows the undecided payment in place of the form: no way to pay again
    // until the outcome is known, and the one action left has the focus.
    await expect(page.getByTestId('payment-awaiting')).toContainText('Confirming your payment');
    await expect(page.getByTestId('payment-awaiting')).toContainText('Don’t pay again');
    await expect(page.getByTestId('check-payment-status')).toBeFocused();
    await expect(page.getByTestId('pay-button')).toHaveCount(0);
    // 18. The status lookup finds the payment went through.
    await page.getByTestId('check-payment-status').click();
    const orderId = await expectConfirmed(page);
    expect((await apiOrder(page, request, orderId)).payment.attempts).toHaveLength(1);
  });

  test('a pending payment is shown as pending until the provider decides', async ({ page }) => {
    await toReview(page);
    await toCheckout(page);
    await pay(page, 'Demo Card', 'Pending');
    await expect(page.getByTestId('payment-awaiting')).toContainText('Payment pending');
    await expect(page.getByTestId('payment-awaiting')).toContainText('isn’t confirmed yet');
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toHaveCount(0);
    // The demo provider decides after a moment; checking until then is safe.
    await expect(async () => {
      await page.getByTestId('check-payment-status').click();
      await expect(page).toHaveURL(ORDER_URL, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expectConfirmed(page);
  });

  test('a double submission pays once', async ({ page, request }) => {
    await toReview(page);
    await toCheckout(page);
    await choosePayment(page, 'Demo Card', 'Approve');
    // 19. Two clicks before React can re-render (the button is also disabled while pending).
    await page.getByTestId('pay-button').evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    const orderId = await expectConfirmed(page);
    expect((await apiOrder(page, request, orderId)).payment.attempts).toHaveLength(1);
  });

  test('an answer lost after the order was confirmed: the page finds the confirmed order', async ({
    page,
    request,
  }) => {
    await toReview(page);
    await toCheckout(page);
    // The API confirms the order, but its answer never reaches the storefront in time.
    await simulateApiFault(page, 'slow-commit');
    await pay(page, 'Demo Card', 'Approve');
    // The storefront doesn't guess and doesn't pay again: it re-reads the durable order.
    const orderId = await expectConfirmed(page);
    await simulateApiFault(page, null);
    expect((await apiOrder(page, request, orderId)).payment.attempts).toHaveLength(1);
  });

  test('an expired hold releases the seats and can be held again', async ({ page }) => {
    await toReview(page);
    await toCheckout(page);
    // 20. The hold ends (the scenario moves the API's clock past it).
    await simulateScenario(page, 'hold-expired');
    await page.reload();
    await expect(page.getByTestId('checkout-recovery')).toHaveAttribute('data-reason', 'expired');
    await expect(page.getByRole('heading', { name: 'Your seat hold has ended' })).toBeVisible();
    await simulateScenario(page, null);
    await page.getByTestId('continue-checkout').click();
    await expect(page.getByTestId('checkout')).toHaveAttribute(
      'data-order-status',
      'PENDING_PAYMENT',
    );
    await pay(page, 'Demo Card', 'Approve');
    await expectConfirmed(page);
  });

  test('an expired offer is refreshed at the same price at checkout', async ({ page }) => {
    await toReview(page);
    const total = await amount(page.getByTestId('quote-total'));
    // 21.
    await simulateScenario(page, 'offer-expired');
    await toCheckout(page);
    await expect(page.getByTestId('order-total').first()).toHaveText(peso(total));
    await simulateScenario(page, null);
  });

  test('a higher price stops checkout until the traveller accepts it', async ({ page }) => {
    await toReview(page);
    const before = await amount(page.getByTestId('quote-total'));
    // 22.
    await simulateScenario(page, 'price-increase');
    await page.getByTestId('continue-checkout').click();
    // Checkout is refused; the review explains the new price and asks for acceptance.
    await expect(page.getByTestId('review-action-required')).toBeVisible();
    await expect(page.getByTestId('continue-checkout')).toHaveCount(0);
    await expect(page).toHaveURL(/\/booking\/review$/);
    const accept = page.getByTestId('accept-price-outbound');
    await expect(accept).toBeVisible();
    await accept.click();
    await reviewReady(page);
    const after = await amount(page.getByTestId('quote-total'));
    expect(after).toBeGreaterThan(before);
    await toCheckout(page);
    await expect(page.getByTestId('order-total').first()).toHaveText(peso(after));
    await simulateScenario(page, null);
  });

  test('a booking is private to the browser that made it', async ({ page, browser }) => {
    await toReview(page);
    await toCheckout(page);
    await pay(page, 'Demo Card', 'Approve');
    await expectConfirmed(page);
    const url = page.url();
    // 23. Another browser (no cookies) can't open it, or its checkout.
    const stranger = await browser.newContext();
    const other = await stranger.newPage();
    await other.goto(url);
    await expect(other.getByTestId('confirmation-unavailable')).toBeVisible();
    await expect(other.getByTestId('booking-reference')).toHaveCount(0);
    await expect(other.locator('body')).not.toContainText('Amihan');
    await other.goto('/booking/checkout');
    await expect(other.getByTestId('checkout-recovery')).toHaveAttribute('data-reason', 'none');
    await stranger.close();
  });

  test('checkout works with the keyboard alone', async ({ page }) => {
    await toReview(page);
    await toCheckout(page);
    // 26. Arrow keys move through the payment methods; Enter pays.
    const card = paymentForm(page).getByRole('radio', { name: /^Demo Card/ });
    await card.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(
      paymentForm(page).getByRole('radio', { name: /^Demo Bank Transfer/ }),
    ).toBeChecked();
    await page.keyboard.press('Tab'); // into the simulated outcomes (Approve is selected)
    await expect(paymentForm(page).getByRole('radio', { name: /^Approve/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('pay-button')).toBeFocused();
    await page.keyboard.press('Enter');
    await expectConfirmed(page);
  });

  test('the short /checkout URL goes to checkout', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page).toHaveURL(/\/booking\/checkout$/);
    await expect(page.getByTestId('checkout-recovery')).toHaveAttribute('data-reason', 'none');
  });
});

test.describe('checkout on phones @mobile', () => {
  test.describe.configure({ timeout: 90_000 });

  test('pays and shows the confirmation without page overflow @mobile', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'mobile only');
    const errors = trackPageErrors(page);
    await toReview(page);
    // 24. Mobile checkout: a folded trip summary with the total always visible.
    await toCheckout(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const summary = page.getByTestId('checkout-summary-mobile');
    await expect(summary).toBeVisible();
    const total = await amount(summary.locator('summary'));
    await summary.locator('summary').click();
    await expect(summary.getByTestId('order-total')).toHaveText(peso(total));
    await expect(page.getByTestId('pay-button')).toHaveText(`Pay ${peso(total)} (demo)`);
    expect(await axe(page)).toEqual([]);
    await pay(page, 'Demo Card', 'Approve');
    // 25. Mobile confirmation.
    await expectConfirmed(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expect(shown(page, 'booking-reference')).toBeInViewport();
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
