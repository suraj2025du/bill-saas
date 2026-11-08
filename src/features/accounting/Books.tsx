import { FileDown, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ledgerInfo, ledgerStatement } from '../../core/accounting/reports';
import { fyOf, startOfMonth } from '../../core/dates';
import { recordsToCsv } from '../../core/export/csv';
import { bankLedgerId } from '../../core/ledgers';
import { ReportDocument } from '../../print/SimpleDocuments';
import { nodeToPdf, pageSpec, printNode } from '../../print/printing';
import { useBooks, useBusiness, useToday } from '../../store/hooks';
import { toast } from '../../ui/feedback';
import { downloadBlob, downloadCsv } from '../../ui/files';
import { Button, Card, EmptyState, Input, PageHeader, Select, Tabs } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { StatementTable, statementReport } from './Ledgers';
import { useVoucherKeys } from './Vouchers';

export function BooksPage() {
  useVoucherKeys();
  const biz = useBusiness();
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const fy = fyOf(today, biz.fyStartMonth);
  const [tab, setTab] = useState<'DAY' | 'CASH' | 'BANK'>('DAY');
  const [from, setFrom] = useState(startOfMonth(today) < fy.start ? fy.start : startOfMonth(today));
  const [to, setTo] = useState(today);
  const [bank, setBank] = useState(biz.bankAccounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const day = useMemo(() => (books ? books.journal.filter((e) => e.date >= from && e.date <= to) : []), [books, from, to]);
  const ledgerId = tab === 'CASH' ? 'sys:cash' : bankLedgerId(bank);
  const st = useMemo(() => (books && tab !== 'DAY' && (tab === 'CASH' || bank) ? ledgerStatement(books, ledgerId, from, to) : null), [books, tab, ledgerId, from, to, bank]);
  if (!books) return null;
  const name = (id: string) => ledgerInfo(books, id).name;

  const dayReport = (
    <ReportDocument
      business={biz}
      title="Day Book"
      subtitle={`${fdate(from)} to ${fdate(to)}`}
      columns={[{ header: 'Date', width: '20mm' }, { header: 'Voucher', width: '34mm' }, { header: 'Particulars' }, { header: 'Debit', align: 'right', width: '26mm' }, { header: 'Credit', align: 'right', width: '26mm' }]}
      rows={day.flatMap((e) => e.lines.map((l, i) => [i === 0 ? fdate(e.date) : '', i === 0 ? `${e.voucherType} ${e.voucherNo}` : '', name(l.ledgerId), l.dr || '', l.cr || '']))}
    />
  );
  const report = tab === 'DAY' ? dayReport : st ? statementReport(biz, st, money) : null;

  return (
    <div>
      <PageHeader
        title="Day, cash & bank book"
        actions={
          report && (
            <>
              {tab === 'DAY' && (
                <Button
                  onClick={() =>
                    downloadCsv(
                      recordsToCsv(
                        day.flatMap((e) => e.lines.map((l) => ({ e, l }))),
                        [
                          { header: 'Date', value: ({ e }) => fdate(e.date) },
                          { header: 'Type', value: ({ e }) => e.voucherType },
                          { header: 'Number', value: ({ e }) => e.voucherNo },
                          { header: 'Ledger', value: ({ l }) => name(l.ledgerId) },
                          { header: 'Debit', value: ({ l }) => l.dr },
                          { header: 'Credit', value: ({ l }) => l.cr },
                          { header: 'Narration', value: ({ e }) => e.narration },
                        ],
                      ),
                      `daybook-${from}-${to}.csv`,
                    )
                  }
                >
                  CSV
                </Button>
              )}
              <Button icon={<Printer className="h-4 w-4" />} onClick={() => void printNode(report, pageSpec(biz.print, 'A4'))}>
                Print
              </Button>
              <Button
                icon={<FileDown className="h-4 w-4" />}
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    downloadBlob(await nodeToPdf(report, pageSpec(biz.print, 'A4')), `${tab.toLowerCase()} book ${from} to ${to}.pdf`);
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
          )
        }
      />
      <Tabs
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'DAY', label: 'Day book' },
          { value: 'CASH', label: 'Cash book' },
          { value: 'BANK', label: 'Bank book' },
        ]}
      />
      <div className="my-3 flex flex-wrap items-center gap-2">
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span className="text-slate-500">to</span>
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        {tab === 'BANK' && (
          <Select className="w-64" value={bank} placeholder="Choose bank account" onValue={setBank} aria-label="Bank account" options={biz.bankAccounts.map((b) => ({ value: b.id, label: `${b.bankName || b.label} ...${b.accountNumber.slice(-4)}` }))} />
        )}
      </div>
      <Card bodyClassName="overflow-x-auto p-0">
        {tab === 'DAY' ? (
          day.length === 0 ? (
            <EmptyState title="No entries in this period" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Particulars</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                </tr>
              </thead>
              <tbody>
                {day.map((e) =>
                  e.lines.map((l, i) => (
                    <tr key={`${e.id}-${i}`} className={i === 0 ? 'border-t-2 border-slate-200' : ''}>
                      <td className="whitespace-nowrap">{i === 0 ? fdate(e.date) : ''}</td>
                      <td>
                        {i === 0 && (
                          <>
                            {e.voucherType}{' '}
                            <Link className="text-brand-700 underline underline-offset-2" to={e.sourceType === 'SALES' ? `/sales/${e.sourceId}` : e.sourceType === 'PURCHASE' ? `/purchases/${e.sourceId}` : e.sourceType === 'VOUCHER' ? `/accounts/vouchers/${e.sourceId}` : e.sourceType === 'EXPENSE' ? '/expenses' : '/payments'}>
                              {e.voucherNo || '(no number)'}
                            </Link>
                          </>
                        )}
                      </td>
                      <td className={l.cr ? 'pl-8' : ''}>{name(l.ledgerId)}</td>
                      <td className="num">{l.dr ? money(l.dr) : ''}</td>
                      <td className="num">{l.cr ? money(l.cr) : ''}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )
        ) : tab === 'BANK' && !biz.bankAccounts.length ? (
          <EmptyState title="No bank accounts" text="Add bank accounts in Settings > Business profile." />
        ) : st ? (
          <StatementTable st={st} />
        ) : (
          <EmptyState title="Choose a bank account" />
        )}
      </Card>
    </div>
  );
}
