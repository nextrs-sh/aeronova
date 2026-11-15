import { chooseAirport, manilaDate, trackPageErrors, waitForSearch, expect, test } from './helpers';

test.describe('flight search', () => {
  test('airport autocomplete filters and supports the keyboard', async ({ page }) => {
    await page.goto('/');
    await waitForSearch(page);
    const from = page.getByRole('combobox', { name: 'From' });
    const options = page.getByRole('listbox', { name: 'From airports' }).getByRole('option');
    await from.click();
    await expect(options.first()).toBeVisible();
    await expect(options.first()).toContainText('Cebu'); // hubs first

    await from.fill('osa');
    await expect(options).toHaveCount(1);
    await expect(options).toContainText('Kansai International Airport');

    await from.fill('tokyo');
    await expect(options).toHaveCount(2);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(from).toHaveValue('Tokyo (NRT)');
    // Focus moves on to the arrival airport.
    await expect(page.getByRole('combobox', { name: 'To' })).toBeFocused();
  });

  test('rejects an incomplete search with accessible messages', async ({ page }) => {
    await page.goto('/');
    await waitForSearch(page);
    await page.getByRole('button', { name: 'Search flights' }).click();

    await expect(page.getByText('Choose where you are flying from.')).toBeVisible();
    await expect(page.getByText('Choose where you are flying to.')).toBeVisible();
    await expect(page.getByText('Choose a departure date.')).toBeVisible();
    await expect(page.getByText('Choose a return date.')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'From' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByRole('combobox', { name: 'From' })).toBeFocused();
    // Focusing the field must not open suggestions over its error message.
    await expect(page.getByRole('listbox', { name: 'From airports' })).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });

  test('rejects returning before departing', async ({ page }) => {
    await page.goto('/');
    await chooseAirport(page, 'From', 'MNL', /Manila/);
    await chooseAirport(page, 'To', 'CEB', /Cebu/);
    await page.getByLabel('Depart', { exact: true }).fill(manilaDate(20));
    await page.getByLabel('Return', { exact: true }).fill(manilaDate(10));
    await page.getByRole('button', { name: 'Search flights' }).click();
    await expect(
      page.getByText('Return date must be on or after the departure date.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a valid search navigates to /flights with serialized parameters', async ({ page }) => {
    const errors = trackPageErrors(page);
    const depart = manilaDate(21);
    const back = manilaDate(28);
    await page.goto('/');
    await waitForSearch(page);

    await chooseAirport(page, 'From', 'manila', /Manila/);
    await chooseAirport(page, 'To', 'seoul', /Seoul/);
    await page.getByLabel('Depart', { exact: true }).fill(depart);
    await page.getByLabel('Return', { exact: true }).fill(back);

    await page.getByRole('button', { name: /Passengers/ }).click();
    await page.getByRole('button', { name: 'Add one adult' }).click();
    await page.getByRole('button', { name: 'Add one infant' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByLabel('Cabin', { exact: true }).selectOption('premium-economy');

    await page.getByRole('button', { name: 'Search flights' }).click();
    await expect(page).toHaveURL(
      `/flights?trip=round-trip&from=MNL&to=ICN&depart=${depart}&return=${back}&adults=2&infants=1&cabin=premium-economy`,
    );

    const summary = page.getByTestId('search-summary');
    await expect(summary).toContainText('MNL');
    await expect(summary).toContainText('Seoul');
    await expect(summary).toContainText('2 Adults, 1 Infant');
    await expect(summary).toContainText('Premium Economy');
    await expect(page.getByTestId('flight-card').first()).toBeVisible();

    // The editable search keeps the submitted values.
    await page.getByRole('button', { name: 'Edit search' }).click();
    await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('Manila (MNL)');
    await expect(page.getByRole('combobox', { name: 'To' })).toHaveValue('Seoul (ICN)');
    await expect(page.getByLabel('Depart', { exact: true })).toHaveValue(depart);
    expect(errors).toEqual([]);
  });

  test('one-way trips hide the return date and swap works', async ({ page }) => {
    await page.goto('/');
    await waitForSearch(page);
    await page.getByText('One-way', { exact: true }).click();
    await expect(page.getByLabel('Return', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Add a return flight/ })).toBeVisible();

    await chooseAirport(page, 'From', 'CEB', /Cebu/);
    await chooseAirport(page, 'To', 'Taipei', /Taipei/);
    await page.getByRole('button', { name: 'Swap departure and arrival airports' }).click();
    await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('Taipei (TPE)');
    await expect(page.getByRole('combobox', { name: 'To' })).toHaveValue('Cebu (CEB)');

    await page.getByLabel('Depart', { exact: true }).fill(manilaDate(5));
    await page.getByRole('button', { name: 'Search flights' }).click();
    await expect(page).toHaveURL(
      /\/flights\?trip=one-way&from=TPE&to=CEB&depart=\d{4}-\d{2}-\d{2}&adults=1&cabin=economy$/,
    );
  });

  test('selections are preserved while navigating', async ({ page }) => {
    await page.goto('/');
    await chooseAirport(page, 'From', 'Davao', /Davao/);
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Explore destinations' })
      .click();
    await expect(page).toHaveURL(/\/destinations$/);
    await page.getByRole('link', { name: 'Velasia Airways home' }).first().click();
    await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('Davao (DVO)');
  });

  test('invalid URL parameters are validated and explained', async ({ page }) => {
    await page.goto('/flights?trip=round-trip&from=MNL&to=MNL&depart=2001-01-01&adults=0');
    await waitForSearch(page);
    const alert = page.getByRole('alert').filter({ hasText: 'We couldn’t run this search' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Departure and arrival airports must be different.');
    await expect(alert).toContainText('Choose a date from today onwards.');
    await expect(alert).toContainText('At least one adult must travel on every booking.');
    await expect(page.getByTestId('flight-card')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('Manila (MNL)');
  });

  test('date inputs restrict the bookable window', async ({ page }) => {
    await page.goto('/');
    await waitForSearch(page);
    const depart = page.getByLabel('Depart', { exact: true });
    await expect(depart).toHaveAttribute('min', manilaDate(0));
    await expect(depart).toHaveAttribute('max', /\d{4}-\d{2}-\d{2}/);
    await depart.fill(manilaDate(30));
    await expect(page.getByLabel('Return', { exact: true })).toHaveAttribute('min', manilaDate(30));
  });

  test('works on a phone @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto('/');
    await chooseAirport(page, 'From', 'MNL', /Manila/);
    await chooseAirport(page, 'To', 'BKK', /Bangkok/);
    await page.getByText('One-way', { exact: true }).click();
    await page.getByLabel('Depart', { exact: true }).fill(manilaDate(9));
    await page.getByRole('button', { name: 'Search flights' }).click();
    await expect(page).toHaveURL(/\/flights\?trip=one-way&from=MNL&to=BKK/);
  });
});

test.describe('mobile layout', () => {
  test('no page overflows horizontally @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    for (const path of [
      '/',
      '/destinations',
      '/destinations/ho-chi-minh-city',
      '/flights',
      '/help',
    ]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
