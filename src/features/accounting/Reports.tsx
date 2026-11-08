import { FileDown, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AGEING_BUCKETS, balanceSheet, monthlyPnl, payablesAgeing, profitAndLoss, receivablesAgeing, trialBalance } from '../../core/accounting/reports';
import type { ReportSection } from '../../core/accounting/reports';
import { fyOf, monthLabel } from '../../core/dates';
import { recordsToCsv } from '../../core/export/csv';
import { GROUP_LABELS } from '../../core/ledgers';
import type { LedgerGroup } from '../../core/model';
import { ReportDocument } from '../../print/SimpleDocuments';
import type { ReportColumn } from '../../print/SimpleDocuments';
import { nodeToPdf, pageSpec, printNode } from '../../print/printing';
import { useBooks, useBusiness, useToday } from '../../store/hooks';
import { toast } from '../../ui/feedback';
import { downloadBlob, downloadCsv } from '../../ui/files';
import { Alert, Button, Card, EmptyState, Input, PageHeader, Tabs, cx } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { useVoucherKeys } from './Vouchers';

function ExportButtons({ title, columns, rows, footer, csvName }: { title: string; columns: ReportColumn[]; rows: (string | number)[][]; footer?: (string | number)[][]; csvName: string }) {
  const biz = useBusiness();
  const [busy, setBusy] = useState(false);
  const node = <ReportDocument business={biz} title={title} columns={columns} rows={rows} footer={footer} />;
  return (
    <>
      <Button
        onClick={() => {
          const all = [...rows, ...(footer ?? [])];
          downloadCsv(recordsToCsv(all, columns.map((c, i) => ({ header: c.header, value: (r: (string | number)[]) => r[i] }))), csvName);
        }}
      >
        CSV
      </Button>
      <Button icon={<Printer className="h-4 w-4" />} onClick={() => void printNode(node, pageSpec(biz.print, 'A4'))}>
        Print
      </Button>
      <Button
        icon={<FileDown className="h-4 w-4" />}
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            downloadBlob(await nodeToPdf(node, pageSpec(biz.print, 'A4')), `${title}.pdf`);
          } catch (e) {
            toast.fromError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        PDF
      </Button>
    </>
  );
}

const ledgerLink = (id: string, name: string) =>
  ['opening-stock', 'pnl-prior', 'opening-diff', 'closing-stock'].includes(id) ? (
    name
  ) : (
    <Link className="text-brand-700 hover:underline" to={`/accounts/ledger/${encodeURIComponent(id)}`}>
      {name}
    </Link>
  );

export function TrialBalancePage() {
  useVoucherKeys();
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const [asOf, setAsOf] = useState(today);
  const tb = useMemo(() => (books ? trialBalance(books, asOf) : null), [books, asOf]);
  if (!tb) return null;
  const label = (g: string) => (g in GROUP_LABELS ? GROUP_LABELS[g as LedgerGroup] : g === 'OPENING_STOCK' ? 'Stock-in-Hand' : g === 'PNL_PRIOR' ? 'Profit & Loss' : 'Opening balances');
  const balanced = Math.abs(tb.totalDr - tb.totalCr) < 0.01;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Trial balance"
        subtitle={`As on ${fdate(asOf)} | FY ${tb.fy.label}`}
        actions={
          <ExportButtons
            title={`Trial Balance ${asOf}`}
            csvName={`trial-balance-${asOf}.csv`}
            columns={[{ header: 'Ledger' }, { header: 'Group' }, { header: 'Debit', align: 'right' }, { header: 'Credit', align: 'right' }]}
            rows={tb.rows.map((r) => [r.name, label(r.group), r.dr || '', r.cr || ''])}
            footer={[['Total', '', tb.totalDr, tb.totalCr]]}
          />
        }
      />
      <Input type="date" className="mb-3 w-44" value={asOf} onChange={(e) => setAsOf(e.target.value || today)} aria-label="As on" />
      {!balanced && <Alert tone="red">Debits and credits differ by {money(Math.abs(tb.totalDr - tb.totalCr))}.</Alert>}
      {tb.rows.some((r) => r.id === 'opening-diff') && (
        <div className="mb-3">
          <Alert tone="blue" title="Difference in opening balances">
            Party, bank and stock opening balances do not net to zero. Enter your capital (and any loans) as ledgers with opening balances, or post an opening journal voucher.
          </Alert>
        </div>
      )}
      <Card bodyClassName="overflow-x-auto p-0">
        {tb.rows.length === 0 ? (
          <EmptyState title="No entries yet" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Ledger</th>
                <th>Group</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r) => (
                <tr key={r.id}>
                  <td>{ledgerLink(r.id, r.name)}</td>
                  <td className="text-slate-500">{label(r.group)}</td>
                  <td className="num">{r.dr ? money(r.dr) : ''}</td>
                  <td className="num">{r.cr ? money(r.cr) : ''}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={2}>Total</td>
                <td className="num">{money(tb.totalDr)}</td>
                <td className={cx('num', !balanced && 'text-red-700')}>{money(tb.totalCr)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function SectionRows({ s, money }: { s: ReportSection; money: (n: number) => string }) {
  if (!s.lines.length) return null;
  return (
    <>
      <tr className="bg-slate-50">
        <td className="font-medium">{s.label}</td>
        <td className="num font-medium">{money(s.total)}</td>
      </tr>
      {s.lines.map((l) => (
        <tr key={l.id}>
          <td className="pl-8">{ledgerLink(l.id, l.name)}</td>
          <td className="num text-slate-600">{money(l.amount)}</td>
        </tr>
      ))}
    </>
  );
}

function Side({ title, children, total, money }: { title: string; children: ReactNode; total: number; money: (n: number) => string }) {
  return (
    <Card title={title} bodyClassName="p-0">
      <table className="data-table">
        <tbody>
          {children}
          <tr className="font-semibold">
            <td>Total</td>
            <td className="num">{money(total)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

export function PnlPage() {
  useVoucherKeys();
  const biz = useBusiness();
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const fy = fyOf(today, biz.fyStartMonth);
  const [from, setFrom] = useState(fy.start);
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<'STATEMENT' | 'MONTHLY'>('STATEMENT');
  const pnl = useMemo(() => (books ? profitAndLoss(books, from, to) : null), [books, from, to]);
  const months = useMemo(() => (books ? monthlyPnl(books, to) : []), [books, to]);
  if (!pnl) return null;
  const debitTotal = pnl.openingStock + pnl.purchases.total + pnl.directExpenses.total + Math.max(0, pnl.grossProfit);
  const creditTotal = pnl.sales.total + pnl.directIncome.total + pnl.closingStock + Math.max(0, -pnl.grossProfit);
  const rows: (string | number)[][] = [
    ['Opening stock', pnl.openingStock],
    ...pnl.purchases.lines.map((l) => [l.name, l.amount]),
    ...pnl.directExpenses.lines.map((l) => [l.name, l.amount]),
    ...pnl.sales.lines.map((l) => [l.name, -l.amount]),
    ...pnl.directIncome.lines.map((l) => [l.name, -l.amount]),
    ['Closing stock', -pnl.closingStock],
    ['Gross profit', pnl.grossProfit],
    ...pnl.indirectIncome.lines.map((l) => [l.name, l.amount]),
    ...pnl.indirectExpenses.lines.map((l) => [l.name, -l.amount]),
    ['Net profit', pnl.netProfit],
  ];
  return (
    <div>
      <PageHeader
        title="Profit & loss"
        subtitle={`${fdate(from)} to ${fdate(to)} | net ${pnl.netProfit >= 0 ? 'profit' : 'loss'} ${money(Math.abs(pnl.netProfit))}`}
        actions={
          tab === 'STATEMENT' ? (
            <ExportButtons title={`Profit and Loss ${from} to ${to}`} csvName={`pnl-${from}-${to}.csv`} columns={[{ header: 'Particulars' }, { header: 'Amount (expense +, income -)', align: 'right' }]} rows={rows} />
          ) : (
            <ExportButtons
              title={`Monthly Profit and Loss FY ${fy.label}`}
              csvName={`monthly-pnl-${fy.label}.csv`}
              columns={[{ header: 'Month' }, { header: 'Sales', align: 'right' }, { header: 'Purchases', align: 'right' }, { header: 'Stock change', align: 'right' }, { header: 'Gross profit', align: 'right' }, { header: 'Expenses', align: 'right' }, { header: 'Net profit', align: 'right' }]}
              rows={months.map((m) => [monthLabel(m.month), m.sales, m.purchases, m.stockChange, m.grossProfit, m.indirectExpenses + m.directExpenses, m.netProfit])}
              footer={[['Total', ...['sales', 'purchases', 'stockChange', 'grossProfit'].map((k) => months.reduce((s, m) => s + (m[k as keyof typeof m] as number), 0)), months.reduce((s, m) => s + m.indirectExpenses + m.directExpenses, 0), months.reduce((s, m) => s + m.netProfit, 0)]]}
            />
          )
        }
      />
      <Tabs
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'STATEMENT', label: 'Statement' },
          { value: 'MONTHLY', label: 'Month by month' },
        ]}
      />
      <div className="my-3 flex flex-wrap items-center gap-2">
        {tab === 'STATEMENT' && (
          <>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span className="text-slate-500">to</span>
          </>
        )}
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value || today)} aria-label="To" />
      </div>
      {tab === 'STATEMENT' ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Side title="Trading account: debit" total={debitTotal} money={money}>
              <tr>
                <td>Opening stock</td>
                <td className="num">{money(pnl.openingStock)}</td>
              </tr>
              <SectionRows s={pnl.purchases} money={money} />
              <SectionRows s={pnl.directExpenses} money={money} />
              {pnl.grossProfit > 0 && (
                <tr className="font-medium text-emerald-700">
                  <td>Gross profit c/o</td>
                  <td className="num">{money(pnl.grossProfit)}</td>
                </tr>
              )}
            </Side>
            <Side title="Trading account: credit" total={creditTotal} money={money}>
              <SectionRows s={pnl.sales} money={money} />
              <SectionRows s={pnl.directIncome} money={money} />
              <tr>
                <td>Closing stock</td>
                <td className="num">{money(pnl.closingStock)}</td>
              </tr>
              {pnl.grossProfit < 0 && (
                <tr className="font-medium text-red-700">
                  <td>Gross loss c/o</td>
                  <td className="num">{money(-pnl.grossProfit)}</td>
                </tr>
              )}
            </Side>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Side title="Profit & loss account: expenses" total={Math.max(0, -pnl.grossProfit) + pnl.indirectExpenses.total + Math.max(0, pnl.netProfit)} money={money}>
              {pnl.grossProfit < 0 && (
                <tr>
                  <td>Gross loss b/f</td>
                  <td className="num">{money(-pnl.grossProfit)}</td>
                </tr>
              )}
              <SectionRows s={pnl.indirectExpenses} money={money} />
              {pnl.netProfit > 0 && (
                <tr className="font-semibold text-emerald-700">
                  <td>Net profit</td>
                  <td className="num">{money(pnl.netProfit)}</td>
                </tr>
              )}
            </Side>
            <Side title="Profit & loss account: incomes" total={Math.max(0, pnl.grossProfit) + pnl.indirectIncome.total + Math.max(0, -pnl.netProfit)} money={money}>
              {pnl.grossProfit > 0 && (
                <tr>
                  <td>Gross profit b/f</td>
                  <td className="num">{money(pnl.grossProfit)}</td>
                </tr>
              )}
              <SectionRows s={pnl.indirectIncome} money={money} />
              {pnl.netProfit < 0 && (
                <tr className="font-semibold text-red-700">
                  <td>Net loss</td>
                  <td className="num">{money(-pnl.netProfit)}</td>
                </tr>
              )}
            </Side>
          </div>
        </div>
      ) : (
        <Card bodyClassName="overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Sales</th>
                <th className="num">Purchases</th>
                <th className="num">Stock change</th>
                <th className="num">Gross profit</th>
                <th className="num">Expenses</th>
                <th className="num">Net profit</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <td className="font-medium">{monthLabel(m.month)}</td>
                  <td className="num">{money(m.sales)}</td>
                  <td className="num">{money(m.purchases)}</td>
                  <td className="num">{money(m.stockChange)}</td>
                  <td className="num">{money(m.grossProfit)}</td>
                  <td className="num">{money(m.indirectExpenses + m.directExpenses)}</td>
                  <td className={cx('num font-medium', m.netProfit < 0 ? 'text-red-700' : 'text-emerald-700')}>{money(m.netProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export function BalanceSheetPage() {
  useVoucherKeys();
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const [asOf, setAsOf] = useState(today);
  const bs = useMemo(() => (books ? balanceSheet(books, asOf) : null), [books, asOf]);
  if (!bs) return null;
  const balanced = Math.abs(bs.totalAssets - bs.totalLiabilities) < 0.01;
  const rows: (string | number)[][] = [
    ...bs.liabilities.flatMap((s) => [[s.label, s.total, ''], ...s.lines.map((l) => [`   ${l.name}`, l.amount, ''])]),
    ['Profit & Loss A/c (earlier years)', bs.profitPrior, ''],
    ['Profit & Loss A/c (current year)', bs.profitCurrent, ''],
    ...(bs.openingDifference ? [['Difference in opening balances', bs.openingDifference, '']] : []),
    ...bs.assets.flatMap((s) => [[s.label, '', s.total], ...s.lines.map((l) => [`   ${l.name}`, '', l.amount])]),
  ];
  return (
    <div>
      <PageHeader
        title="Balance sheet"
        subtitle={`As on ${fdate(asOf)}`}
        actions={
          <ExportButtons
            title={`Balance Sheet ${asOf}`}
            csvName={`balance-sheet-${asOf}.csv`}
            columns={[{ header: 'Particulars' }, { header: 'Liabilities', align: 'right' }, { header: 'Assets', align: 'right' }]}
            rows={rows}
            footer={[['Total', bs.totalLiabilities, bs.totalAssets]]}
          />
        }
      />
      <Input type="date" className="mb-3 w-44" value={asOf} onChange={(e) => setAsOf(e.target.value || today)} aria-label="As on" />
      {!balanced && <Alert tone="red">Assets and liabilities differ by {money(Math.abs(bs.totalAssets - bs.totalLiabilities))}.</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Side title="Liabilities & capital" total={bs.totalLiabilities} money={money}>
          {bs.liabilities.map((s) => (
            <SectionRows key={s.key} s={s} money={money} />
          ))}
          <tr className="bg-slate-50">
            <td className="font-medium">Profit & Loss A/c</td>
            <td className="num font-medium">{money(bs.profitPrior + bs.profitCurrent)}</td>
          </tr>
          <tr>
            <td className="pl-8">Earlier years</td>
            <td className="num text-slate-600">{money(bs.profitPrior)}</td>
          </tr>
          <tr>
            <td className="pl-8">Current year to date</td>
            <td className="num text-slate-600">{money(bs.profitCurrent)}</td>
          </tr>
          {bs.openingDifference !== 0 && (
            <tr>
              <td>Difference in opening balances</td>
              <td className="num">{money(bs.openingDifference)}</td>
            </tr>
          )}
        </Side>
        <Side title="Assets" total={bs.totalAssets} money={money}>
          {bs.assets.map((s) => (
            <SectionRows key={s.key} s={s} money={money} />
          ))}
        </Side>
      </div>
    </div>
  );
}

export function OutstandingPage() {
  useVoucherKeys();
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const [asOf, setAsOf] = useState(today);
  const [tab, setTab] = useState<'REC' | 'PAY'>('REC');
  const rows = useMemo(() => (books ? (tab === 'REC' ? receivablesAgeing(books, asOf) : payablesAgeing(books, asOf)) : []), [books, tab, asOf]);
  const sum = (i: number) => rows.reduce((s, r) => s + r.buckets[i], 0);
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <div>
      <PageHeader
        title="Outstanding & ageing"
        subtitle={`${tab === 'REC' ? 'Receivable' : 'Payable'} ${money(total)} as on ${fdate(asOf)}`}
        actions={
          <ExportButtons
            title={`${tab === 'REC' ? 'Receivables' : 'Payables'} ageing ${asOf}`}
            csvName={`ageing-${tab === 'REC' ? 'receivables' : 'payables'}-${asOf}.csv`}
            columns={[{ header: 'Party' }, ...AGEING_BUCKETS.map((b) => ({ header: b, align: 'right' as const })), { header: 'On account', align: 'right' }, { header: 'Total', align: 'right' }]}
            rows={rows.map((r) => [r.name, ...r.buckets, r.onAccount, r.total])}
            footer={[['Total', sum(0), sum(1), sum(2), sum(3), rows.reduce((s, r) => s + r.onAccount, 0), total]]}
          />
        }
      />
      <Tabs
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'REC', label: 'Receivables (customers)' },
          { value: 'PAY', label: 'Payables (suppliers)' },
        ]}
      />
      <Input type="date" className="my-3 w-44" value={asOf} onChange={(e) => setAsOf(e.target.value || today)} aria-label="As on" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {AGEING_BUCKETS.map((b, i) => (
          <div key={b} className={cx('card px-4 py-3', i === 3 && sum(3) > 0 && 'border-red-200 bg-red-50')}>
            <p className="text-xs text-slate-500">{b}</p>
            <p className="text-lg font-semibold tabular-nums">{money(sum(i))}</p>
          </div>
        ))}
      </div>
      <Card bodyClassName="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <EmptyState title="Nothing outstanding" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Party</th>
                {AGEING_BUCKETS.map((b) => (
                  <th key={b} className="num">
                    {b}
                  </th>
                ))}
                <th className="num">On account</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ledgerId}>
                  <td>
                    {r.ledgerId.startsWith('party:') ? (
                      <Link className="font-medium text-brand-700 hover:underline" to={`/parties/${r.ledgerId.slice(6)}`}>
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                    <div className="text-xs text-slate-500">
                      {r.billCount} bill(s){r.phone && ` | ${r.phone}`}
                    </div>
                  </td>
                  {r.buckets.map((v, i) => (
                    <td key={i} className={cx('num', i === 3 && v > 0 && 'font-medium text-red-700')}>
                      {v ? money(v) : '-'}
                    </td>
                  ))}
                  <td className="num">{r.onAccount ? money(r.onAccount) : '-'}</td>
                  <td className="num font-semibold">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
