import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { APP_ID, COLLECTIONS, SCHEMA_VERSION } from '../../src/core/model';

/** browser-mode = static hosting without server.js: the app keeps its data in IndexedDB. */
export const isBrowserMode = (info: TestInfo) => info.project.name === 'browser-mode';

/** A valid GSTIN for Maharashtra (state 27); the check digit is correct. */
export const BUSINESS_GSTIN = '27AAPFS1234K1ZW';

/** Walk through the first-run wizard as a wholesale business in Mumbai. */
export async function setupBusiness(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: 'Where do you do business?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Wholesale \/ Trader/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Business name').fill(name);
  await page.getByLabel('GSTIN', { exact: true }).fill(BUSINESS_GSTIN);
  await page.getByLabel('City').fill('Mumbai');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start billing' }).click();
  await expect(page.getByRole('heading', { name: `Namaste, ${name}` })).toBeVisible();
}

/** The current month as the GSTR period pickers expect it (yyyy-mm). */
export function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Every test starts from an empty install. Browser storage is already fresh per test,
 * but the server's data folder is shared by the whole run, so it is emptied through the API.
 */
export async function startFresh(page: Page, info: TestInfo) {
  if (isBrowserMode(info)) return;
  const collections = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  const res = await page.request.post('/api/restore', {
    headers: { 'X-GST-Client': '1' },
    data: { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), collections },
  });
  expect(res.status(), await res.text()).toBe(204);
}

/** Collects page errors and console errors; `where` labels each one with the current step. */
export function watchErrors(page: Page, info: TestInfo, where: () => string = () => '') {
  const errors: string[] = [];
  const browserMode = isBrowserMode(info);
  page.on('pageerror', (e) => errors.push(`${where()} pageerror: ${e.message}`.trim()));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Without server.js the app probes /api/health once and falls back to browser storage.
    if (browserMode && m.location().url.includes('/api/health')) return;
    errors.push(`${where()} console: ${m.text()}`.trim());
  });
  return errors;
}

/** Serious and critical WCAG 2 A/AA problems. The invoice preview is a printed document, not app UI. */
export async function seriousA11yViolations(page: Page) {
  const result = await new AxeBuilder({ page }).exclude('.print-sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}
