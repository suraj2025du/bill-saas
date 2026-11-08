import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seriousA11yViolations, startFresh, watchErrors } from './helpers';

// Every screen, opened with the sample business loaded: each one must render without
// crashing, without console errors and without serious accessibility problems.
const ROUTES = [
  '/',
  '/sales',
  '/sales/new',
  '/sales/new?type=QUOTATION',
  '/sales/new?type=CREDIT_NOTE',
  '/payments',
  '/parties',
  '/parties/new',
  '/inventory/products',
  '/inventory/products/new',
  '/inventory/bulk',
  '/inventory/godowns',
  '/inventory/stock',
  '/purchases',
  '/purchases/new',
  '/expenses',
  '/accounts/vouchers',
  '/accounts/vouchers/new?type=CONTRA',
  '/accounts/vouchers/new?type=PAYMENT',
  '/accounts/vouchers/new?type=RECEIPT',
  '/accounts/vouchers/new?type=JOURNAL',
  '/accounts/ledgers',
  '/accounts/books',
  '/accounts/outstanding',
  '/accounts/trial-balance',
  '/accounts/pnl',
  '/accounts/balance-sheet',
  '/gst/gstr1',
  '/gst/gstr3b',
  '/gst/gstr2b',
  '/gst/tds',
  '/itr',
  '/settings',
  '/settings/business',
  '/settings/businesses',
  '/settings/print',
  '/settings/numbering',
  '/settings/units',
  '/settings/features',
  '/settings/security',
  '/settings/backup',
  '/settings/drive',
  '/settings/trash',
  '/settings/diagnostics',
];

// A list screen and the link prefix of the detail screens it opens.
const DETAILS: [list: string, prefix: string][] = [
  ['/sales', '#/sales/'],
  ['/parties', '#/parties/'],
  ['/inventory/products', '#/inventory/products/'],
  ['/purchases', '#/purchases/'],
  ['/accounts/vouchers', '#/accounts/vouchers/'],
  ['/accounts/ledgers', '#/accounts/ledger/'],
];

async function open(page: Page, route: string) {
  await page.evaluate((r) => {
    window.location.hash = r;
  }, route);
  const main = page.locator('main');
  await expect(main).toBeVisible();
  await expect(main.locator('h1, h2').first()).toBeVisible();
  await expect(page.getByText('This screen hit a problem')).toHaveCount(0);
  await expect(page.getByText('Page not found')).toHaveCount(0);
}

test('every screen opens cleanly with the sample business', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  await startFresh(page, testInfo);
  let route = 'start';
  const errors = watchErrors(page, testInfo, () => route);

  await page.goto('/');
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByRole('heading', { name: /^Namaste, / })).toBeVisible();

  const routes = [...ROUTES];
  for (const [list, prefix] of DETAILS) {
    await open(page, list);
    const hrefs = await page.locator(`main a[href^="${prefix}"]`).evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    const detail = hrefs.find((h) => !h.endsWith('/new') && !h.includes('?'));
    expect(detail, `a detail link on ${list}`).toBeTruthy();
    routes.push(detail!.slice(1));
  }

  const problems: string[] = [];
  for (const r of routes) {
    route = r;
    await open(page, r);
    for (const v of await seriousA11yViolations(page)) problems.push(`${r} -> ${v}`);
  }
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});
