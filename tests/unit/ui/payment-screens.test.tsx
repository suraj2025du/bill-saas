// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CollectionData } from '../../../src/core/model';
import { makeSnapshot } from '../../../src/core/schema';
import { IndexedDbAdapter } from '../../../src/data/indexeddb';
import { buildSampleData } from '../../../src/data/seed';
import { Dashboard } from '../../../src/features/dashboard/Dashboard';
import { DocView } from '../../../src/features/sales/DocView';
import { PaymentsPage } from '../../../src/features/sales/PaymentsPage';
import { SalesList } from '../../../src/features/sales/SalesList';
import { useStore } from '../../../src/store/store';

// The screens that show money received, rendered with the sample business (design critique F06, F07)
// and the payment dialog for a dollar invoice (code review R1).

beforeAll(() => {
  // jsdom has no layout engine; the invoice preview only needs the observer to exist.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

let data: CollectionData;

beforeEach(() => {
  data = buildSampleData();
  useStore.setState({ data, adapter: null, boot: 'ready', unlocked: true });
});

afterEach(cleanup);

function show(path: string, route: string, element: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The sample receipt voucher: Rs 25,000 from Bharat Electricals against one invoice. */
function receiptVoucher() {
  const voucher = data.vouchers.find((v) => v.type === 'RECEIPT')!;
  const line = voucher.lines.find((l) => l.docId)!;
  const invoice = data.invoices.find((d) => d.id === line.docId)!;
  return { voucher, invoice };
}

const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

describe('money received through a receipt voucher (design F06)', () => {
  it('is listed on the Payments page with a voucher tag', () => {
    const { voucher, invoice } = receiptVoucher();
    show('/payments', '/payments', <PaymentsPage />);
    const row = rowOf(voucher.number);
    expect(row.textContent).toContain('Bharat Electricals Pvt Ltd');
    expect(row.textContent).toContain(invoice.number);
    expect(row.textContent).toContain('Voucher');
    expect(row.textContent).toContain('₹25,000.00');
  });

  it("is listed in the invoice's Payments card, which adds up to the amount received", () => {
    const { voucher, invoice } = receiptVoucher();
    show(`/sales/${invoice.id}`, '/sales/:id', <DocView />);
    const card = screen.getByRole('heading', { name: 'Payments' }).closest('section')!;
    expect(within(card).getByText('Received').nextElementSibling?.textContent).toBe('₹75,000.00');
    const link = within(card).getByRole('link', { name: new RegExp(voucher.number) });
    expect(link.getAttribute('href')).toBe(`/accounts/vouchers/${voucher.id}`);
    expect(link.closest('li')!.textContent).toContain('₹25,000.00');
  });

  it("is counted in the dashboard's Received this month", () => {
    show('/', '/', <Dashboard />);
    // This month's sample receipts: Rs 1,172 from the walk-in invoice and the Rs 25,000 voucher.
    expect(screen.getByText('Received this month').parentElement!.textContent).toContain('₹26,172.00');
  });
});

describe('a dollar invoice in the invoice list (design F07)', () => {
  it('shows its amount and balance in dollars', () => {
    const usd = data.invoices.find((d) => d.currency === 'USD')!;
    show('/sales', '/sales', <SalesList />);
    const cells = [...rowOf(usd.number).querySelectorAll('td.num')].map((td) => td.textContent);
    expect(cells).toEqual(['$3,900.00', '$3,900.00']);
  });
});

describe('the payment dialog for a dollar invoice (review R1)', () => {
  it('asks for the exchange rate on the payment date and saves it with the payment', async () => {
    const db = await IndexedDbAdapter.open(`screens-${Math.random().toString(36).slice(2)}`);
    await db.replaceAll(makeSnapshot(data));
    useStore.setState({ adapter: db, data: await db.loadAll() });
    const usd = data.invoices.find((d) => d.currency === 'USD')!;
    show(`/sales/${usd.id}`, '/sales/:id', <DocView />);

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Amount (USD)')).toBeTruthy();
    const rate = within(dialog).getByLabelText('Exchange rate on the payment date (1 USD = ? INR)') as HTMLInputElement;
    expect(rate.value).toBe('84.25');
    fireEvent.change(rate, { target: { value: '85' } });
    expect(dialog.textContent).toContain('In your books: ₹3,31,500.00, exchange gain ₹2,925.00');
    fireEvent.click(within(dialog).getByLabelText('Print the receipt after saving'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const saved = (await db.loadAll()).receipts.filter((r) => r.docId === usd.id);
    expect(saved).toMatchObject([{ amount: 3900, currency: 'USD', exchangeRate: 85 }]);
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    db.close();
  });
});
