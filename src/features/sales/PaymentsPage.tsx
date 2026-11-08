import { Banknote, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { partyPayments } from '../../core/docs/payments';
import type { PartyPayment } from '../../core/docs/payments';
import { recordsToCsv } from '../../core/export/csv';
import { resolveLedger } from '../../core/ledgers';
import type { PaymentRecord } from '../../core/model';
import { roundTo } from '../../core/money';
import { deletePayment } from '../../store/actions';
import { useBusiness, useMine, useToday } from '../../store/hooks';
import { attempt, confirmDialog } from '../../ui/feedback';
import { downloadCsv } from '../../ui/files';
import { Badge, Button, EmptyState, Input, PageHeader, Tabs } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { PaymentDialog, printReceipt } from './PaymentDialog';

const modeOf = (r: PartyPayment) => (r.source.kind === 'PAYMENT' ? r.source.payment.mode : `${r.direction === 'IN' ? 'Receipt' : 'Payment'} voucher`);
const referenceOf = (r: PartyPayment) => (r.source.kind === 'PAYMENT' ? r.source.payment.reference : '');

export function PaymentsPage() {
  const biz = useBusiness();
  const receipts = useMine('receipts');
  const vouchers = useMine('vouchers');
  const invoices = useMine('invoices');
  const purchases = useMine('purchases');
  const parties = useMine('clients');
  const ledgers = useMine('ledgers');
  const money = useMoney();
  const today = useToday();
  const [tab, setTab] = useState<'IN' | 'OUT'>('IN');
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<{ direction: 'IN' | 'OUT'; existing?: PaymentRecord } | null>(null);

  // Payment records and the party lines of receipt / payment vouchers (design F06).
  const all = useMemo(() => {
    const lookup = { business: biz, parties, ledgers };
    return partyPayments(receipts, vouchers, invoices, purchases, biz).map((r) => ({ ...r, partyName: r.partyName || resolveLedger(r.ledgerId, lookup)?.name || '' }));
  }, [receipts, vouchers, invoices, purchases, biz, parties, ledgers]);

  const against = (docId: string): { label: string; to: string } | null => {
    if (!docId) return null;
    const inv = invoices.find((d) => d.id === docId);
    if (inv) return { label: inv.number, to: `/sales/${inv.id}` };
    const bill = purchases.find((b) => b.id === docId);
    return bill ? { label: bill.billNo, to: `/purchases/${bill.id}` } : null;
  };

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const notes = (r: PartyPayment) => (r.source.kind === 'PAYMENT' ? r.source.payment.notes : r.source.voucher.narration);
    return all
      .filter((r) => r.direction === tab)
      .filter((r) => words.every((w) => `${r.number} ${r.partyName} ${referenceOf(r)} ${notes(r)}`.toLowerCase().includes(w)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.number.localeCompare(a.number)));
  }, [all, tab, q]);
  const total = roundTo(rows.reduce((s, r) => s + r.bookAmount, 0));

  const exportCsv = () =>
    downloadCsv(
      recordsToCsv(rows, [
        { header: 'Number', value: (r) => r.number },
        { header: 'Date', value: (r) => fdate(r.date) },
        { header: 'Party', value: (r) => r.partyName },
        { header: 'Against', value: (r) => against(r.docId)?.label ?? 'On account' },
        { header: 'Mode', value: (r) => modeOf(r) },
        { header: 'Reference', value: (r) => referenceOf(r) },
        { header: 'Amount', value: (r) => r.amount },
        { header: 'Currency', value: (r) => r.currency },
        { header: `Amount (${biz.currency})`, value: (r) => r.bookAmount },
      ]),
      `${tab === 'IN' ? 'receipts' : 'payments'}-${today}.csv`,
    );

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle={`${rows.length} entries | ${money(total)}`}
        actions={
          <>
            <Button onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ direction: 'OUT' })}>
              Payment made
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ direction: 'IN' })}>
              Payment received
            </Button>
          </>
        }
      />
      <Tabs
        tabs={[
          { value: 'IN', label: 'Received', count: all.filter((r) => r.direction === 'IN').length },
          { value: 'OUT', label: 'Paid', count: all.filter((r) => r.direction === 'OUT').length },
        ]}
        value={tab}
        onValue={setTab}
      />
      <div className="my-3">
        <Input className="max-w-xs" placeholder="Search party, number, reference" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<Banknote className="h-10 w-10" />} title="No payments yet" text="Record payments from an invoice or bill, or add an advance here." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Date</th>
                <th>Party</th>
                <th>Against</th>
                <th>Mode</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const a = against(r.docId);
                const p = r.source.kind === 'PAYMENT' ? r.source.payment : null;
                return (
                  <tr key={r.key}>
                    <td className="font-medium">
                      {r.source.kind === 'VOUCHER' ? (
                        <Link className="text-brand-700 hover:underline" to={`/accounts/vouchers/${r.source.voucher.id}`}>
                          {r.number}
                        </Link>
                      ) : (
                        r.number
                      )}
                    </td>
                    <td>{fdate(r.date)}</td>
                    <td>{r.partyName || '-'}</td>
                    <td>
                      {a ? (
                        <Link className="text-brand-700 hover:underline" to={a.to}>
                          {a.label}
                        </Link>
                      ) : (
                        <Badge tone="blue">On account</Badge>
                      )}
                    </td>
                    <td>
                      {p ? (
                        <>
                          {p.mode}
                          {p.reference && <div className="text-xs text-slate-500">{p.reference}</div>}
                        </>
                      ) : (
                        <Badge tone="brand">Voucher</Badge>
                      )}
                    </td>
                    <td className="num font-medium">
                      {money(r.amount, r.currency)}
                      {r.currency !== biz.currency && <div className="text-xs font-normal text-slate-500">{money(r.bookAmount)}</div>}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {p && (
                        <>
                          <Button size="sm" variant="ghost" aria-label="Print" onClick={() => void printReceipt(p)}>
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setDialog({ direction: p.direction, existing: p })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Delete"
                            onClick={async () => {
                              if (await confirmDialog({ title: `Delete ${p.number}?`, message: 'It moves to the Trash bin for 30 days.', danger: true, confirmLabel: 'Delete' })) {
                                await attempt(() => deletePayment(p), 'Deleted');
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {dialog && (
        <PaymentDialog
          open
          onClose={() => setDialog(null)}
          direction={dialog.direction}
          existing={dialog.existing}
          doc={dialog.existing?.docId ? invoices.find((d) => d.id === dialog.existing!.docId) : undefined}
          bill={dialog.existing?.docId ? purchases.find((b) => b.id === dialog.existing!.docId) : undefined}
        />
      )}
    </div>
  );
}
