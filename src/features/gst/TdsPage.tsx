import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { statementFor, tdsCsv, tdsRegister, tdsTotals } from '../../core/tdsReports';
import type { TdsRegister } from '../../core/tdsReports';
import { actLabel } from '../../core/tds';
import { useBusiness, useMine, useToday } from '../../store/hooks';
import { downloadCsv } from '../../ui/files';
import { Alert, Button, Card, EmptyState, PageHeader, Tabs } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { PeriodPicker, choiceToPeriod, defaultChoice } from './PeriodPicker';
import type { PeriodChoice } from './PeriodPicker';

const REGISTERS: { value: TdsRegister; label: string }[] = [
  { value: 'DEDUCTED', label: 'TDS deducted (residents)' },
  { value: 'DEDUCTED_NR', label: 'TDS on non-residents (195)' },
  { value: 'COLLECTED', label: 'TCS collected by you' },
  { value: 'SUFFERED', label: 'TDS deducted by customers' },
];

export function TdsPage() {
  const biz = useBusiness();
  const purchases = useMine('purchases');
  const expenses = useMine('expenses');
  const invoices = useMine('invoices');
  const parties = useMine('clients');
  const today = useToday();
  const money = useMoney();
  const [choice, setChoice] = useState<PeriodChoice>(() => defaultChoice(today, 'QUARTERLY', biz.fyStartMonth));
  const [register, setRegister] = useState<TdsRegister>('DEDUCTED');
  const period = useMemo(() => choiceToPeriod(choice, biz.fyStartMonth), [choice, biz.fyStartMonth]);
  const all = useMemo(() => tdsRegister({ businessId: biz.id, purchases, expenses, invoices, parties }, period.start, period.end), [biz.id, purchases, expenses, invoices, parties, period]);
  const rows = all.filter((r) => r.register === register);
  const totals = tdsTotals(rows);
  const missingPan = rows.filter((r) => !r.pan).length;

  return (
    <div>
      <PageHeader
        title="TDS / TCS register"
        subtitle={`${period.label} | ${statementFor(register, period.end)} | ${actLabel(period.end)}`}
        actions={
          <Button variant="primary" disabled={!rows.length} onClick={() => downloadCsv(tdsCsv(rows), `${register.toLowerCase()}-${period.fp}.csv`)}>
            Export CSV
          </Button>
        }
      />
      <div className="mb-3">
        <PeriodPicker value={choice} onChange={setChoice} allowYear />
      </div>
      <Tabs value={register} onValue={setRegister} tabs={REGISTERS.map((r) => ({ ...r, count: all.filter((x) => x.register === r.value).length }))} />
      {missingPan > 0 && (
        <div className="mt-3">
          <Alert tone="amber">{missingPan} entry(ies) have no PAN. Add the PAN in the party master; without a valid PAN a higher rate (s.206AA / 206CC) may apply.</Alert>
        </div>
      )}
      <div className="mt-3 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card title="By section">
          {totals.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing in this period.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {totals.map((t) => (
                <li key={t.section} className="flex justify-between">
                  <span>
                    {t.section} <span className="text-xs text-slate-500">({t.count})</span>
                  </span>
                  <span className="tabular-nums font-medium">{money(t.tax)}</span>
                </li>
              ))}
              <li className="flex justify-between border-t pt-2 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(totals.reduce((s, t) => s + t.tax, 0))}</span>
              </li>
            </ul>
          )}
        </Card>
        <div className="card overflow-x-auto">
          {rows.length === 0 ? (
            <EmptyState title="No entries" text="Add TDS to purchase bills or expenses, or TCS to invoices." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Party</th>
                  <th>PAN</th>
                  <th>Section</th>
                  <th>Document</th>
                  <th className="num">Amount</th>
                  <th className="num">Rate</th>
                  <th className="num">Tax</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.sourceId}-${r.register}`}>
                    <td>{fdate(r.date)}</td>
                    <td>{r.partyName}</td>
                    <td className="font-mono text-xs">{r.pan || <span className="text-red-600">missing</span>}</td>
                    <td title={r.sectionTitle}>{r.section}</td>
                    <td>
                      <Link className="text-brand-700 hover:underline" to={r.source === 'SALE' ? `/sales/${r.sourceId}` : r.source === 'PURCHASE' ? `/purchases/${r.sourceId}` : '/expenses'}>
                        {r.docNo || '-'}
                      </Link>
                    </td>
                    <td className="num">{money(r.base)}</td>
                    <td className="num">{r.rate}%</td>
                    <td className="num font-medium">{money(r.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Deposit tax by the 7th of the next month (30 April for March). File the quarterly statement with the challan details using the TIN-NSDL RPU utility; this CSV gives the deductee-wise data for it.
      </p>
    </div>
  );
}
