import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupBusiness, startFresh, watchErrors } from './helpers';

/** Bill one item to a walk-in customer and press Finalize. */
async function finalizeInvoice(page: Page, customer: string) {
  await page.getByRole('button', { name: 'New invoice' }).first().click();
  await expect(page.getByRole('heading', { name: /New Tax Invoice/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Customer', exact: true }).fill(customer);
  await page.getByRole('option', { name: `Bill to "${customer}"` }).click();
  await page.getByRole('combobox', { name: 'Item 1' }).fill('Steel bottle 1L');
  await page.getByRole('option', { name: /Add item "Steel bottle 1L"/ }).click();
  await page.getByLabel('HSN/SAC').fill('732393');
  await page.getByLabel('Rate', { exact: true }).fill('250');
  await page.getByRole('button', { name: 'Finalize' }).click();
}

// Review R2: the app left open in one tab and started again in another must not issue an invoice number twice.
test('a tab left open cannot reuse an invoice number issued in a newer tab', async ({ page, context }, testInfo) => {
  await startFresh(page, testInfo);
  const errors = watchErrors(page, testInfo);
  await page.goto('/');
  await setupBusiness(page, 'Two Tab Traders');

  // The app is started again in a second tab, which issues the first invoice.
  const later = await context.newPage();
  const laterErrors = watchErrors(later, testInfo);
  await later.goto('/');
  await finalizeInvoice(later, 'Ravi Kumar');
  await expect(later.getByRole('heading', { name: /Tax Invoice INV\/\d{2}-\d{2}\/0001/ })).toBeVisible();

  // The first tab still has the data it loaded. Its save is refused and it loads the latest data;
  // saving again takes the next number.
  await finalizeInvoice(page, 'Asha Verma');
  await expect(page.getByText('Another tab or window saved changes first')).toBeVisible();
  await page.getByRole('button', { name: 'Finalize' }).click();
  await expect(page.getByRole('heading', { name: /Tax Invoice INV\/\d{2}-\d{2}\/0002/ })).toBeVisible();

  // The browser logs the refused request (HTTP 409) on its own; nothing else may be logged.
  expect([...errors, ...laterErrors].filter((e) => !e.includes('status of 409'))).toEqual([]);
});
