import { FileText, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { addMonths, fyOf, startOfMonth, endOfMonth } from '../../core/dates';
import { DOC_TYPES, DOC_TYPE_LIST } from '../../core/docs/docTypes';
import { salesPaymentSummary } from '../../core/docs/payments';
import { recordsToCsv } from '../../core/export/csv';
import type { DocType, SalesDocument } from '../../core/model';
import { useBusiness, useMine, usePaymentIndex, useToday } from '../../store/hooks';
import { downloadCsv } from '../../ui/files';
import { Button, EmptyState, Input, PageHeader, Select, Tabs } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { BulkPdfButton, StatusBadge, statusOf } from './common';

type Period = 'ALL' | 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_FY' | 'LAST_FY';
type StatusFilter = 'ALL' | 'DRAFT' | 'FINAL' | 'CANCELLED' | 'UNPAID' | 'OVERDUE' | 'PAID';

/** Rows drawn at a time; "Show more" adds as many again (review Y13: 10,000 rows made every keystroke lag). */
const PAGE = 200;

const newestFirst = (a: SalesDocument, b: SalesDocument) => (a.date === b.date ? b.number.localeCompare(a.number) : a.date < b.date ? 1 : -1);

export function SalesList() {
  const biz = useBusiness();
  const all = useMine('invoices');
  const index = usePaymentIndex();
  const money = useMoney();
  const today = useToday();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('type') as DocType | 'ALL') || 'ALL';
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  const range = useMemo((): [string, string] => {
    const fy = fyOf(today, biz.fyStartMonth);
    switch (period) {
      case 'THIS_MONTH':
        return [startOfMonth(today), endOfMonth(today)];
      case 'LAST_MONTH': {
        const m = addMonths(startOfMonth(today), -1);
        return [m, endOfMonth(m)];
      }
      case 'THIS_FY':
        return [fy.start, fy.end];
      case 'LAST_FY': {
        const prev = fyOf(addMonths(fy.start, -1), biz.fyStartMonth);
        return [prev.start, prev.end];
      }
      default:
        return ['0000-01-01', '9999-12-31'];
    }
  }, [period, today, biz.fyStartMonth]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: all.length };
    for (const d of all) c[d.docType] = (c[d.docType] ?? 0) + 1;
    return c;
  }, [all]);

  // Sorted once when the documents change, not again on every keystroke (review Y13).
  const sorted = useMemo(() => [...all].sort(newestFirst), [all]);

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sorted
      .filter((d) => tab === 'ALL' || d.docType === tab)
      .filter((d) => d.date >= range[0] && d.date <= range[1])
      .filter((d) => {
        if (status === 'ALL') return true;
        if (status === 'DRAFT' || status === 'FINAL' || status === 'CANCELLED') return d.status === status;
        const s = salesPaymentSummary(d, index, today);
        if (status === 'PAID') return s.status === 'PAID';
        if (status === 'OVERDUE') return s.overdueDays > 0;
        return s.status === 'UNPAID' || s.status === 'PARTIAL';
      })
      .filter((d) => words.every((w) => `${d.number} ${d.party.name} ${d.party.gstin} ${d.notes}`.toLowerCase().includes(w)));
  }, [sorted, tab, range, status, q, index, today]);
  const shown = rows.slice(0, limit);

  const chosen = rows.filter((d) => selected.has(d.id));
  const toggleAll = () => setSelected((s) => (rows.every((d) => s.has(d.id)) ? new Set() : new Set(rows.map((d) => d.id))));
  // On the All tab the header shows sales: documents in the books, credit notes subtracted, and no quotations,
  // proformas or challans (review Y13). A tab of one type shows the value of its documents, as before.
  const totals = useMemo(
    () =>
      rows
        .filter((d) => d.status === 'FINAL' && (tab !== 'ALL' || DOC_TYPES[d.docType].postsToAccounts))
        .reduce(
          (t, d) => {
            const sign = d.docType === 'CREDIT_NOTE' ? -1 : 1;
            const f = d.currency === biz.currency ? 1 : d.exchangeRate || 1;
            return { value: t.value + sign * d.totals.total * f, due: t.due + salesPaymentSummary(d, index, today).balance * f };
          },
          { value: 0, due: 0 },
        ),
    [rows, tab, biz.currency, index, today],
  );

  const exportCsv = () => {
    const csv = recordsToCsv(rows, [
      { header: 'Type', value: (d) => DOC_TYPES[d.docType].label },
      { header: 'Number', value: (d) => d.number },
      { header: 'Date', value: (d) => fdate(d.date) },
      { header: 'Customer', value: (d) => d.party.name },
      { header: 'GSTIN', value: (d) => d.party.gstin },
      { header: 'Place of supply', value: (d) => d.placeOfSupply },
      { header: 'Currency', value: (d) => d.currency },
      { header: 'Taxable', value: (d) => d.totals.taxable },
      { header: 'CGST', value: (d) => d.totals.cgst },
      { header: 'SGST/UTGST', value: (d) => d.totals.sgst + d.totals.utgst },
      { header: 'IGST', value: (d) => d.totals.igst },
      { header: 'Cess', value: (d) => d.totals.cess },
      { header: 'Total', value: (d) => d.totals.total },
      { header: 'Status', value: (d) => statusOf(d, salesPaymentSummary(d, index, today)).label },
      { header: 'Balance', value: (d) => salesPaymentSummary(d, index, today).balance },
    ]);
    downloadCsv(csv, `sales-${today}.csv`);
  };

  const tabs = [
    { value: 'ALL' as const, label: 'All', count: counts.ALL ?? 0 },
    ...DOC_TYPE_LIST.map((t) => ({ value: t, label: DOC_TYPES[t].shortLabel, count: counts[t] ?? 0 })),
  ];
  const newType: DocType = tab === 'ALL' ? 'TAX_INVOICE' : tab;
  return (
    <div>
      <PageHeader
        title="Invoices & documents"
        subtitle={`${rows.length} ${rows.length === 1 ? 'document' : 'documents'} | ${tab === 'ALL' ? 'sales' : 'value'} ${money(totals.value)} | balance due ${money(totals.due)}`}
        actions={
          <>
            <BulkPdfButton docs={chosen} business={biz} index={index} />
            <Button onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(`/sales/new?type=${newType}`)}>
              New {DOC_TYPES[newType].shortLabel}
            </Button>
          </>
        }
      />
      <Tabs
        tabs={tabs}
        value={tab}
        onValue={(v) => {
          setSelected(new Set());
          setLimit(PAGE);
          setParams(v === 'ALL' ? {} : { type: v });
        }}
      />
      <div className="my-3 flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search number, customer, GSTIN"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(PAGE);
          }}
          aria-label="Search"
        />
        <Select<Period>
          className="w-40"
          value={period}
          onValue={(v) => {
            setPeriod(v);
            setLimit(PAGE);
          }}
          aria-label="Period"
          options={[
            { value: 'ALL', label: 'All dates' },
            { value: 'THIS_MONTH', label: 'This month' },
            { value: 'LAST_MONTH', label: 'Last month' },
            { value: 'THIS_FY', label: 'This financial year' },
            { value: 'LAST_FY', label: 'Last financial year' },
          ]}
        />
        <Select<StatusFilter>
          className="w-40"
          value={status}
          onValue={(v) => {
            setStatus(v);
            setLimit(PAGE);
          }}
          aria-label="Status"
          options={[
            { value: 'ALL', label: 'Any status' },
            { value: 'DRAFT', label: 'Drafts' },
            { value: 'FINAL', label: 'Final' },
            { value: 'CANCELLED', label: 'Cancelled' },
            { value: 'UNPAID', label: 'Unpaid / partial' },
            { value: 'OVERDUE', label: 'Overdue' },
            { value: 'PAID', label: 'Paid' },
          ]}
        />
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No documents here yet"
            text="Create your first document, or change the filters above."
            action={
              <Button variant="primary" onClick={() => navigate(`/sales/new?type=${newType}`)}>
                New {DOC_TYPES[newType].label}
              </Button>
            }
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every((d) => selected.has(d.id))} onChange={toggleAll} />
                </th>
                <th>Number</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th className="num">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const s = salesPaymentSummary(d, index, today);
                return (
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
                    </td>
                    <td className="whitespace-nowrap">{fdate(d.date)}</td>
                    <td>
                      <div className="font-medium">{d.party.name || '-'}</div>
                      {d.party.gstin && <div className="text-xs text-slate-500">{d.party.gstin}</div>}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{DOC_TYPES[d.docType].shortLabel}</td>
                    <td className="num whitespace-nowrap">{money(d.totals.total, d.currency)}</td>
                    <td className="num whitespace-nowrap">{s.status === 'NOT_APPLICABLE' ? '-' : money(s.balance, d.currency)}</td>
                    <td>
                      <StatusBadge doc={d} index={index} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {rows.length > shown.length && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>{`Showing ${shown.length} of ${rows.length}`}</span>
            <Button onClick={() => setLimit((n) => n + PAGE)}>{`Show ${Math.min(PAGE, rows.length - shown.length)} more`}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
