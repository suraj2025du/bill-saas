// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { formatMoney } from '../../../src/core/currency/format';
import { DOC_TYPES } from '../../../src/core/docs/docTypes';
import { newGodown } from '../../../src/core/factories';
import type { CollectionData, SalesDocument } from '../../../src/core/model';
import type { Batch } from '../../../src/data/adapter';
import { applyBatch } from '../../../src/data/apply';
import { buildSampleData } from '../../../src/data/seed';
import { SalesList } from '../../../src/features/sales/SalesList';
import { selectSettings, useBooks } from '../../../src/store/hooks';
import { useStore } from '../../../src/store/store';
import { largeCollections } from '../../fixtures/large';

// The invoice list and the books hook with the data set of the code review (2,000 parties, 10,000
// invoices, 10,000 receipts) and with the sample business (review R4, Y13). Budgets are the slowest
// times allowed on this PC, in milliseconds, in jsdom (slower than a real browser): about five times
// the time measured after the fix under coverage (opening 396, a keystroke 180) and far below the old
// list (opening 7,037, a keystroke 2,739; see docs/reviews/fixes/2026-11-07-03-speed.md).
const BUDGET_MS = { open: 2_000, keystroke: 750 };

let large: CollectionData;

function load(data: CollectionData) {
  useStore.setState({ data, adapter: null, boot: 'ready', unlocked: true });
}

function showList(path = '/sales') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sales" element={<SalesList />} />
      </Routes>
    </MemoryRouter>,
  );
}

function elapsed(run: () => unknown): number {
  const start = performance.now();
  run();
  return Math.round(performance.now() - start);
}

const listedRows = () => document.querySelectorAll('tbody tr').length;
const subtitle = () => screen.getByText(/balance due/).textContent ?? '';

beforeAll(() => {
  large = largeCollections();
  // Warm up React and the list's code on the small sample business, so the timings measure the list itself.
  load(buildSampleData());
  showList();
  cleanup();
});

afterEach(cleanup);

// The long timeout lets a slow list fail on its budget, with the time it took, instead of on the 5 s test timeout.
describe('the invoice list with 10,800 documents (review Y13)', { timeout: 120_000 }, () => {
  it('opens within the budget, with the newest 200 documents and a button for 200 more', () => {
    load(large);
    // Fastest of three openings, so one garbage-collection pause or a busy moment on the PC does not decide the result.
    let fastest = Infinity;
    for (let i = 0; i < 3; i++) {
      cleanup();
      fastest = Math.min(fastest, elapsed(() => showList()));
    }
    expect(fastest).toBeLessThan(BUDGET_MS.open);
    expect(listedRows()).toBe(200);
    expect(screen.getByText('Showing 200 of 10800')).toBeTruthy();
    expect(subtitle()).toMatch(/^10800 documents \| sales /);
    fireEvent.click(screen.getByText('Show 200 more'));
    expect(listedRows()).toBe(400);
    expect(screen.getByText('Showing 400 of 10800')).toBeTruthy();
  });

  it('keeps up with typing in the search box', () => {
    load(large);
    showList();
    const search = screen.getByLabelText('Search');
    const typed = 'Party 0042';
    const ms = elapsed(() => {
      for (let n = 1; n <= typed.length; n++) fireEvent.change(search, { target: { value: typed.slice(0, n) } });
    });
    expect(ms / typed.length).toBeLessThan(BUDGET_MS.keystroke);
    expect(listedRows()).toBeGreaterThan(0);
    expect(listedRows()).toBeLessThan(200);
    expect(screen.getAllByText('Party 0042').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });
});

describe('the sales figure in the header of the invoice list (review Y13)', () => {
  it('adds invoices, bills of supply and debit notes less credit notes, but no quotations, proformas or challans', () => {
    const data = buildSampleData();
    load(data);
    const biz = data.businesses[0];
    const inBooks = (d: SalesDocument) => d.totals.total * (d.currency === biz.currency ? 1 : d.exchangeRate || 1);
    const final = data.invoices.filter((d) => d.businessId === biz.id && d.status === 'FINAL');
    const sales = final.filter((d) => DOC_TYPES[d.docType].postsToAccounts).reduce((s, d) => s + (d.docType === 'CREDIT_NOTE' ? -1 : 1) * inBooks(d), 0);
    const quotations = final.filter((d) => d.docType === 'QUOTATION').reduce((s, d) => s + inBooks(d), 0);
    // The sample business has a final quotation and a delivery challan, which the header used to add to its value.
    expect(quotations).toBeGreaterThan(0);
    expect(final.some((d) => d.docType === 'DELIVERY_CHALLAN')).toBe(true);

    showList();
    expect(subtitle()).toContain(`| sales ${formatMoney(sales, biz.currency)} |`);
    cleanup();
    // A tab of one document type still shows the value of those documents.
    showList('/sales?type=QUOTATION');
    expect(subtitle()).toContain(`| value ${formatMoney(quotations, biz.currency)} |`);
  });
});

describe('the books of the active business (review R4, Y13)', () => {
  it('are rebuilt when a record they are built from changes, not when a setting or a godown is saved', () => {
    const data = buildSampleData();
    load(data);
    const { result } = renderHook(() => useBooks());
    const first = result.current;
    expect(first).not.toBeNull();
    const save = (batch: Batch) => act(() => useStore.setState((s) => ({ data: applyBatch(s.data, batch) })));

    // Dismissing a notification saves the settings record; adding a godown saves a godown.
    save({ puts: [{ collection: 'settings', record: { ...selectSettings(data), dismissedNotifications: ['gst-due'] } }], removes: [] });
    expect(result.current).toBe(first);
    save({ puts: [{ collection: 'godowns', record: newGodown(data.businesses[0].id, 'Back room') }], removes: [] });
    expect(result.current).toBe(first);

    const invoice = data.invoices[0];
    save({ puts: [{ collection: 'invoices', record: { ...invoice, notes: 'Changed' } }], removes: [] });
    expect(result.current).not.toBe(first);
    expect(result.current?.input.invoices.find((d) => d.id === invoice.id)?.notes).toBe('Changed');
  });
});
