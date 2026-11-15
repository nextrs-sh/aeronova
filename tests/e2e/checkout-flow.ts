import type { APIRequestContext, Page } from '@playwright/test';
import { reviewReady } from './booking-flow';
import { API_PORT } from './constants';
import { expect } from './helpers';

/* From the review to a confirmed booking (Milestone 5), shared by the checkout and manage specs. */

export const API = `http://127.0.0.1:${API_PORT}`;
export const ORDER_URL = /\/booking\/confirmation\/(ord_[A-Za-z0-9_-]{22})$/;

export const peso = (value: number) => `₱${value.toLocaleString('en-PH')}`;

/** From the review to checkout: the API re-validates and holds the seats. */
export async function toCheckout(page: Page) {
  await reviewReady(page);
  await page.getByTestId('continue-checkout').click();
  // Validation, the hold, and the checkout render: allow for a fully parallel run on a laptop.
  await expect(page).toHaveURL(/\/booking\/checkout$/, { timeout: 20_000 });
  await expect(page.getByTestId('checkout')).toHaveAttribute(
    'data-order-status',
    'PENDING_PAYMENT',
  );
  await expect(page.locator('[data-testid="payment-form"][data-ready="true"]')).toBeVisible();
}

export const paymentForm = (page: Page) =>
  page.locator('[data-testid="payment-form"][data-ready="true"]');

export async function choosePayment(
  page: Page,
  method: 'Demo Card' | 'Demo Wallet' | 'Demo Bank Transfer',
  outcome: 'Approve' | 'Decline' | 'Time out' | 'Pending',
) {
  const form = paymentForm(page);
  await form.getByRole('radio', { name: new RegExp(`^${method}`) }).check();
  await form.getByRole('radio', { name: new RegExp(`^${outcome}`) }).check();
}

export async function pay(
  page: Page,
  method: Parameters<typeof choosePayment>[1],
  outcome: Parameters<typeof choosePayment>[2],
) {
  await choosePayment(page, method, outcome);
  await paymentForm(page).getByTestId('pay-button').click();
}

export async function expectConfirmed(page: Page) {
  // A payment is a Server Action, an API round trip, and a redirect render: allow for a fully
  // parallel run on a laptop.
  await expect(page).toHaveURL(ORDER_URL, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
  await expect(page.getByTestId('booking-reference')).toHaveText(/^VEL-[A-HJKMNP-Z2-9]{6}$/);
  return ORDER_URL.exec(page.url())![1]!;
}

/** Read the order straight from the retailing API with this browser's guest token. */
export async function apiOrder(page: Page, request: APIRequestContext, orderId: string) {
  const guest = (await page.context().cookies()).find((c) => c.name === 'velasia-guest')!.value;
  const response = await request.get(`${API}/v1/orders/${orderId}`, {
    headers: { authorization: `Bearer ${guest}` },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
