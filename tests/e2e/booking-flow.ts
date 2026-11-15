import AxeBuilder from '@axe-core/playwright';
import { test, type Locator, type Page } from '@playwright/test';
import { expect, selectFamily } from './helpers';

/*
 * The booking journey up to the review (Milestones 3–4), shared by the booking and checkout
 * specs. All travellers are synthetic.
 */

export const TWO_ADULTS =
  '/flights?trip=one-way&from=MNL&to=SIN&depart=2026-12-15&adults=2&cabin=economy';
export const ONE_ADULT =
  '/flights?trip=one-way&from=MNL&to=SIN&depart=2026-12-15&adults=1&cabin=economy';
export const FLIGHT = 'NV501-20261215';

/**
 * Next.js keeps recently visited routes mounted but hidden (React Activity), so a test id can
 * exist on an earlier step too: always look at the visible one.
 */
export const shown = (page: Page, testId: string) =>
  page.getByTestId(testId).filter({ visible: true });

export const amount = async (locator: Locator) =>
  Number((await locator.first().textContent())!.replace(/[^\d]/g, ''));

export async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

export const TRAVELLERS = [
  { id: 'ADT1', given: 'Amihan', family: 'Dela Cruz', dob: '1990-04-12' },
  { id: 'ADT2', given: 'Bayani', family: 'Reyes', dob: '1987-09-30' },
];

/** Search, open the fares of the first result, choose a family, and continue to travellers. */
export async function startBooking(
  page: Page,
  search: string,
  family: 'Light' | 'Classic' | 'Flex',
) {
  await page.goto(`${search}&fares=${FLIGHT}`);
  await expect(page.getByTestId('fare-cards')).toBeVisible();
  await selectFamily(page, family);
  await expect(page.getByTestId('trip-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to traveller details' }).click();
  await expect(page).toHaveURL(/\/booking\/travellers$/);
  await expect(page.getByTestId('traveller-form')).toBeVisible();
}

export async function fillTravellers(page: Page, count: number) {
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

export async function saveTravellers(page: Page) {
  await page.getByTestId('save-travellers').click();
  await expect(page).toHaveURL(/\/booking\/seats/);
  await expect(page.locator('[data-testid="seat-selector"][data-ready="true"]')).toBeVisible();
}

export const seat = (page: Page, look: string, nth = 0) =>
  page.locator(`[data-testid="seat-map"] [data-look="${look}"]`).nth(nth);

/** Choose the seat under the cursor for the active traveller; returns the seat id. */
export async function chooseSeat(page: Page, target: Locator) {
  const id = (await target.getAttribute('data-seat'))!;
  await target.click();
  await page.getByTestId('choose-seat').click();
  await expect(page.getByTestId('seat-saved')).toBeVisible();
  return id;
}

export async function extrasReady(page: Page) {
  await expect(page.locator('[data-testid^="baggage-"][data-ready="true"]').first()).toBeVisible();
}

/** Wait until the review's client actions are interactive. */
export async function reviewReady(page: Page) {
  await expect(shown(page, 'review-ready')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Travellers saved, seats skipped, extras skipped: the review for a one-adult trip. */
let seatsChosen = 0;
/**
 * Which available seat a booking picks. Since Milestone 5, checkout really holds seats, so tests
 * running at the same time on the same flight must not pick the same one: each parallel worker
 * gets its own band of five positions in the list of free seats (40 of the flight's ~74).
 */
export function nextSeatIndex(): number {
  seatsChosen += 1;
  return (test.info().parallelIndex % 8) * 5 + (seatsChosen % 5);
}

export async function toReview(page: Page, family: 'Light' | 'Classic' | 'Flex' = 'Classic') {
  await startBooking(page, ONE_ADULT, family);
  await fillTravellers(page, 1);
  await saveTravellers(page);
  const id = await chooseSeat(page, seat(page, 'available', nextSeatIndex()));
  await page.getByTestId('continue-seats').click();
  await expect(page).toHaveURL(/\/booking\/extras$/);
  await extrasReady(page);
  await page.getByTestId('continue-extras').click();
  await expect(page).toHaveURL(/\/booking\/review$/);
  await expect(page.getByTestId('review-ready')).toBeVisible();
  return id;
}
