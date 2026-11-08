import { expect, test } from '@playwright/test';
import { seriousA11yViolations, setupBusiness, startFresh, thisMonth, watchErrors } from './helpers';

test('first run, invoice, payment, PDF and GSTR-1', async ({ page }, testInfo) => {
  await startFresh(page, testInfo);
  const errors = watchErrors(page, testInfo);

  await page.goto('/');
  await setupBusiness(page, 'Sharma Traders');
  expect(await seriousA11yViolations(page)).toEqual([]);

  // New tax invoice for a walk-in customer
  await page.getByRole('button', { name: 'New invoice' }).first().click();
  await expect(page.getByRole('heading', { name: /New Tax Invoice/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Customer', exact: true }).fill('Ravi Kumar');
  await page.getByRole('option', { name: /Bill to "Ravi Kumar"/ }).click();
  await page.getByRole('combobox', { name: 'Item 1' }).fill('Steel bottle 1L');
  await page.getByRole('option', { name: /Add item "Steel bottle 1L"/ }).click();
  await page.getByLabel('HSN/SAC').fill('732393');
  await page.getByLabel('Quantity').fill('2');
  await page.getByLabel('Rate', { exact: true }).fill('250');
  expect(await seriousA11yViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Finalize' }).click();

  // Document view
  await expect(page.getByRole('heading', { name: /Tax Invoice INV\/\d{2}-\d{2}\/0001/ })).toBeVisible();
  await expect(page.getByText(/Ravi Kumar \| .* \| ₹590\.00/)).toBeVisible();
  await expect(page.getByText('Unpaid', { exact: true })).toBeVisible();

  // Payment (without printing the receipt)
  await page.getByRole('button', { name: 'Record payment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Balance due:')).toBeVisible();
  await dialog.getByLabel('Print the receipt after saving').uncheck();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();

  // PDF download
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  // GSTR-1 for the current month: one B2C (Others) row of Rs 500 taxable
  await page.getByRole('link', { name: 'GSTR-1' }).click();
  await page.getByLabel('Month').fill(thisMonth());
  const row = page.getByRole('row', { name: /7 - B2C \(Others\)/ });
  await expect(row).toContainText('₹500.00');
  await expect(row).toContainText('₹45.00');

  // Reports open and balance
  await page.getByRole('link', { name: 'Trial balance' }).click();
  await expect(page.getByRole('heading', { name: 'Trial balance' })).toBeVisible();
  await expect(page.getByText('Debits and credits differ')).toHaveCount(0);
  await page.getByRole('link', { name: 'Balance sheet' }).click();
  await expect(page.getByText('Assets and liabilities differ')).toHaveCount(0);

  expect(errors).toEqual([]);
});
