import { CalendarClock, FilePlus2, Package, Receipt, ShoppingCart } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { balancesOn } from '../../core/accounting/reports';
import { addMonths, fyOf, listMonths, monthKey, monthLabel, startOfMonth } from '../../core/dates';
import { DOC_TYPES } from '../../core/docs/docTypes';
import { partyPayments, salesPaymentSummary } from '../../core/docs/payments';
import { gstDeadlines } from '../../core/gst/dueDates';
import { lowStockProducts } from '../../core/inventory/stock';
import { bankLedgerId } from '../../core/ledgers';
import { useBooks, useBusiness, useMine, usePaymentIndex, useStock, useToday } from '../../store/hooks';
import { Button, Card, EmptyState, Stat } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { BulkPdfButton, StatusBadge } from '../sales/common';

export function Dashboard() {
  const biz = useBusiness();
  const invoices = useMine('invoices');
  const purchases = useMine('purchases');
  const expenses = useMine('expenses');
  const receipts = useMine('receipts');
  const vouchers = useMine('vouchers');
  const products = useMine('products');
  const stock = useStock();
  const index = usePaymentIndex();
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const month = monthKey(today);
  const fy = fyOf(today, biz.fyStartMonth);
  const fx = (currency: string, rate: number) => (currency === biz.currency ? 1 : rate || 1);

  const stats = useMemo(() => {
    let sales = 0;
    let gstOut = 0;
    let receivable = 0;
    let overdue = 0;
    for (const d of invoices) {
      if (d.status !== 'FINAL') continue;
      const f = fx(d.currency, d.exchangeRate);
      const meta = DOC_TYPES[d.docType];
      if (meta.postsToAccounts && monthKey(d.date) === month) {
        const sign = d.docType === 'CREDIT_NOTE' ? -1 : 1;
        sales += sign * d.totals.taxable * f;
        gstOut += sign * d.totals.tax * f;
      }
      const s = salesPaymentSummary(d, index, today);
      receivable += s.balance * f;
      if (s.overdueDays > 0) overdue += s.balance * f;
    }
    const gstIn =
      purchases.filter((b) => b.status === 'FINAL' && monthKey(b.billDate) === month && b.itcCategory !== 'INELIGIBLE').reduce((s, b) => s + b.totals.tax * fx(b.currency, b.exchangeRate), 0) +
      expenses.filter((e) => monthKey(e.date) === month && e.itcEligible).reduce((s, e) => s + e.cgst + e.sgst + e.igst, 0);
    const bought = purchases.filter((b) => b.status === 'FINAL' && monthKey(b.billDate) === month).reduce((s, b) => s + b.totals.taxable * fx(b.currency, b.exchangeRate), 0);
    const spent = expenses.filter((e) => monthKey(e.date) === month).reduce((s, e) => s + e.taxable, 0);
    // Payments and receipt vouchers, in the book currency (review R1, design F06).
    const received = partyPayments(receipts, vouchers, invoices, purchases, biz)
      .filter((r) => r.direction === 'IN' && monthKey(r.date) === month)
      .reduce((s, r) => s + r.bookAmount, 0);
    let cashBank = 0;
    if (books) {
      const bal = balancesOn(books, today);
      cashBank = (bal.get('sys:cash') ?? 0) + biz.bankAccounts.reduce((s, b) => s + (bal.get(bankLedgerId(b.id)) ?? 0), 0);
    }
    return { sales, gstOut, gstIn, receivable, overdue, bought, spent, received, cashBank };
    // fx only reads biz.currency, listed through biz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, purchases, expenses, receipts, vouchers, index, today, month, books, biz]);

  const trend = useMemo(() => {
    const months = listMonths(addMonths(startOfMonth(today), -11), today);
    const map = new Map(months.map((m) => [m, 0]));
    for (const d of invoices) {
      if (d.status !== 'FINAL' || !DOC_TYPES[d.docType].postsToAccounts) continue;
      const m = monthKey(d.date);
      if (!map.has(m)) continue;
      map.set(m, (map.get(m) ?? 0) + (d.docType === 'CREDIT_NOTE' ? -1 : 1) * d.totals.taxable * fx(d.currency, d.exchangeRate));
    }
    return months.map((m) => ({ m, v: map.get(m) ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, today, biz.currency]);
  const peak = Math.max(1, ...trend.map((t) => t.v));

  const recent = useMemo(() => [...invoices].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 10), [invoices]);
  const deadlines = biz.countryCode === 'IN' && biz.gstRegistration === 'REGULAR' ? gstDeadlines(today, biz.gstFiling, biz.stateCode, 31) : [];
  const low = biz.features.inventory ? lowStockProducts(products, stock).slice(0, 6) : [];
  const chosen = recent.filter((d) => selected.has(d.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Namaste, {biz.name}</h1>
          <p className="text-sm text-slate-500">
            {monthLabel(month)} | FY {fy.label}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => navigate('/sales/new?type=TAX_INVOICE')}>
            New invoice
          </Button>
          <Button icon={<ShoppingCart className="h-4 w-4" />} onClick={() => navigate('/purchases/new')}>
            Purchase bill
          </Button>
          <Button icon={<Receipt className="h-4 w-4" />} onClick={() => navigate('/payments')}>
            Payments
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales this month" value={money(stats.sales)} sub={`${biz.countryCode === 'IN' ? 'GST' : 'Tax'} ${money(stats.gstOut)}`} tone="brand" />
        <Stat label="Received this month" value={money(stats.received)} tone="green" />
        <Stat label="To receive" value={money(stats.receivable)} sub={stats.overdue > 0 ? `${money(stats.overdue)} overdue` : 'Nothing overdue'} tone={stats.overdue > 0 ? 'red' : 'amber'} />
        <Stat label="Cash & bank" value={money(stats.cashBank)} tone="blue" />
        <Stat label="Purchases this month" value={money(stats.bought)} />
        <Stat label="Expenses this month" value={money(stats.spent)} />
        {biz.countryCode === 'IN' && <Stat label="GST payable (est.)" value={money(Math.max(0, stats.gstOut - stats.gstIn))} sub={`ITC this month ${money(stats.gstIn)}`} tone="amber" />}
        {biz.features.inventory && <Stat label="Low-stock items" value={low.length} tone={low.length ? 'red' : 'gray'} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Sales, last 12 months (taxable value)">
          <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Monthly sales chart">
            {trend.map((t) => (
              <div key={t.m} className="flex flex-1 flex-col items-center gap-1" title={`${monthLabel(t.m)}: ${money(t.v)}`}>
                <div className="w-full rounded-t bg-brand-500" style={{ height: `${Math.max(2, (Math.max(0, t.v) / peak) * 100)}%` }} />
                <span className="text-[10px] text-slate-500">{monthLabel(t.m).slice(0, 3)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Coming up">
          {deadlines.length === 0 && low.length === 0 ? (
            <p className="text-sm text-slate-500">No GST due dates in the next month and no low stock.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {deadlines.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <CalendarClock className={`h-4 w-4 ${d.daysLeft <= 2 ? 'text-red-600' : 'text-slate-400'}`} />
                  <Link className="flex-1 hover:underline" to={d.form === 'GSTR-1' ? '/gst/gstr1' : '/gst/gstr3b'}>
                    {d.form} for {d.period}
                  </Link>
                  <span className={d.daysLeft < 0 ? 'text-red-600' : 'text-slate-500'}>{d.daysLeft < 0 ? `${-d.daysLeft}d late` : d.daysLeft === 0 ? 'today' : `${fdate(d.due)}`}</span>
                </li>
              ))}
              {low.map(({ product, qty }) => (
                <li key={product.id} className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-amber-500" />
                  <Link className="flex-1 hover:underline" to={`/inventory/products/${product.id}`}>
                    {product.name}
                  </Link>
                  <span className={qty <= 0 ? 'text-red-600' : 'text-amber-700'}>
                    {qty} {product.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card
        title="Recent documents"
        actions={
          <>
            <BulkPdfButton docs={chosen} business={biz} index={index} />
            <Link className="text-sm text-brand-700 hover:underline" to="/sales">
              All documents
            </Link>
          </>
        }
        bodyClassName="overflow-x-auto p-0"
      >
        {recent.length === 0 ? (
          <EmptyState title="No documents yet" text="Create your first invoice to see it here." action={<Button variant="primary" onClick={() => navigate('/sales/new?type=TAX_INVOICE')}>New invoice</Button>} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" aria-label="Select all" checked={recent.every((d) => selected.has(d.id))} onChange={() => setSelected((s) => (recent.every((d) => s.has(d.id)) ? new Set() : new Set(recent.map((d) => d.id))))} />
                </th>
                <th>Number</th>
                <th>Date</th>
                <th>Customer</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${d.number}`}
                      checked={selected.has(d.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(d.id)) next.delete(d.id);
                          else next.add(d.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>
                    <Link className="font-medium text-brand-700 hover:underline" to={`/sales/${d.id}`}>
                      {d.number || 'Draft'}
                    </Link>
                    <div className="text-xs text-slate-500">{DOC_TYPES[d.docType].shortLabel}</div>
                  </td>
                  <td>{fdate(d.date)}</td>
                  <td>{d.party.name || '-'}</td>
                  <td className="num">{money(d.totals.total, d.currency)}</td>
                  <td>
                    <StatusBadge doc={d} index={index} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
