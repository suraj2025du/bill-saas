import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { makeGstin } from '../../src/core/gst/gstin';
import { seriousA11yViolations, setupBusiness, startFresh, thisMonth, watchErrors } from './helpers';

// A made-up e-commerce operator registered in Karnataka; the check digit is valid.
const OPERATOR = makeGstin('29', 'AAICE1234B');

test('custom unit from an invoice line, e-commerce sale in GSTR-1 Table 14, CSV exports', async ({ page }, testInfo) => {
  await startFresh(page, testInfo);
  const errors = watchErrors(page, testInfo);
  await page.goto('/');
  await setupBusiness(page, 'Mehta Electricals');

  // New invoice; the unit "Bundle" is created from the line's unit list.
  await page.getByRole('button', { name: 'New invoice' }).first().click();
  await page.getByRole('combobox', { name: 'Customer', exact: true }).fill('Asha Verma');
  await page.getByRole('option', { name: /Bill to "Asha Verma"/ }).click();
  await page.getByRole('combobox', { name: 'Item 1' }).fill('Electric wire 90m');
  await page.getByRole('option', { name: /Add item "Electric wire 90m"/ }).click();
  await page.getByLabel('HSN/SAC').fill('854449');
  await page.getByLabel('Rate', { exact: true }).fill('10000');
  const unit = page.getByLabel('Unit', { exact: true });
  await unit.selectOption({ label: '+ Add custom unit...' });
  const dialog = page.getByRole('dialog', { name: 'Add a custom unit' });
  await dialog.getByLabel('Unit name').fill('Bundle');
  await dialog.getByLabel('Short code').fill('bndl');
  await dialog.getByLabel('GST UQC (GSTR-1 HSN summary)').selectOption('BDL');
  expect(await seriousA11yViolations(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Add unit' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(unit).toHaveValue('BNDL');

  // Sold through an e-commerce operator, then finalized.
  await page.getByLabel('Sold through an e-commerce operator').fill(OPERATOR.toLowerCase());
  await page.getByRole('button', { name: 'Finalize' }).click();
  await expect(page.getByRole('heading', { name: /Tax Invoice INV\// })).toBeVisible();

  // GSTR-1 Table 14: net value Rs 10,000 and TCS at 0.5% = Rs 50.
  await page.getByRole('link', { name: 'GSTR-1' }).click();
  await page.getByLabel('Month').fill(thisMonth());
  await page.getByRole('tab', { name: /14 E-commerce/ }).click();
  const row = page.getByRole('row', { name: new RegExp(OPERATOR) });
  await expect(row).toContainText('₹10,000.00');
  await expect(row).toContainText('₹50.00');
  expect(await seriousA11yViolations(page)).toEqual([]);

  // GSTR-1 CSV files in a ZIP.
  const zipDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV (ZIP)' }).click();
  const zipFile = await zipDownload;
  expect(zipFile.suggestedFilename()).toMatch(/CSV\.zip$/);
  const zip = await JSZip.loadAsync(await readFile(await zipFile.path()));
  expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['b2cs.csv', 'eco.csv', 'hsn(b2c).csv', 'docs.csv']));
  expect(await zip.file('eco.csv')?.async('string')).toContain(`Liable to collect tax u/s 52(TCS),${OPERATOR},10000,0,900,900,0`);
  expect(await zip.file('hsn(b2c).csv')?.async('string')).toContain('854449,Electric wire 90m,BDL,1,11800,18,10000,0,900,900,0');

  // GSTR-3B CSV.
  await page.getByRole('link', { name: 'GSTR-3B' }).click();
  await page.getByLabel('Month').fill(thisMonth());
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const csvFile = await csvDownload;
  expect(csvFile.suggestedFilename()).toMatch(/^GSTR-3B .*\.csv$/);
  const csv = await readFile(await csvFile.path(), 'utf8');
  expect(csv).toContain('3.1 Outward');
  expect(csv).toContain('(a) Outward taxable supplies,10000,0,900,900,0');

  // The unit is in Settings > Units, and the same code cannot be added twice.
  await page.evaluate(() => {
    window.location.hash = '/settings/units';
  });
  await expect(page.getByRole('cell', { name: 'BNDL', exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Bundle again');
  await page.getByLabel('Code', { exact: true }).fill('b-ndl');
  await page.getByRole('button', { name: 'Add unit' }).click();
  await expect(page.getByText('Unit code BNDL already exists.')).toBeVisible();

  // Diagnostics: the data check passes and no unexpected errors were recorded.
  await page.evaluate(() => {
    window.location.hash = '/settings/diagnostics';
  });
  await page.getByRole('button', { name: 'Check my data' }).click();
  await expect(page.getByText(/^All \d+ records passed the integrity check\.$/)).toBeVisible();
  await expect(page.getByText('No problems recorded')).toBeVisible();
  expect(await seriousA11yViolations(page)).toEqual([]);

  expect(errors).toEqual([]);
});

test('an unexpected error reaches the bell and Settings > Diagnostics', async ({ page }, testInfo) => {
  await startFresh(page, testInfo);
  await page.goto('/');
  await setupBusiness(page, 'Mehta Electricals');

  // Something the app did not handle (here: an error thrown from a timer).
  await page.evaluate(() => {
    window.setTimeout(() => {
      throw new Error('Simulated problem for the test');
    }, 0);
  });

  await page.getByRole('button', { name: /^Notifications/ }).click();
  const notice = page.getByRole('button', { name: /1 app problem recorded/ });
  await expect(notice).toContainText('Simulated problem for the test');
  await notice.click();
  await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
  const row = page.getByRole('row', { name: /Simulated problem for the test/ });
  await expect(row).toContainText('Program error');
  await expect(row).toContainText('/');

  // Opening Diagnostics marks the problem as seen, so the bell no longer counts it.
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByRole('button', { name: /app problem/ })).toHaveCount(0);
});
