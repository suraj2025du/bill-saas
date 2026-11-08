import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { monthKey, monthLabel } from '../../core/dates';
import { recordsToCsv } from '../../core/export/csv';
import { newExpense } from '../../core/factories';
import { isValidGstin, validateGstin } from '../../core/gst/gstin';
import { rateOptions } from '../../core/gst/rates';
import { EXPENSE_LEDGERS, GROUP_LABELS } from '../../core/ledgers';
import type { Expense, ExpensePaidVia } from '../../core/model';
import { getSection, sectionsFor } from '../../core/tds';
import { computeExpense, moveToTrash, saveExpense } from '../../store/actions';
import { useBusiness, useMine, useToday } from '../../store/hooks';
import { attempt, confirmDialog, toast } from '../../ui/feedback';
import { downloadCsv } from '../../ui/files';
import { Button, Card, Checkbox, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, TextInput } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';

const PAID_VIA: { value: ExpensePaidVia; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'CREDIT', label: 'Not paid yet (on credit)' },
];

function ExpenseDialog({ initial, onClose }: { initial: Expense; onClose: () => void }) {
  const biz = useBusiness();
  const ledgers = useMine('ledgers');
  const money = useMoney();
  const [e, setE] = useState<Expense>(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Expense>) => setE((x) => ({ ...x, ...patch }));
  const c = computeExpense(e);
  const indian = biz.countryCode === 'IN';
  const heads = [
    ...EXPENSE_LEDGERS.map((l) => ({ value: l.id, label: l.name })),
    ...ledgers.filter((l) => l.group === 'INDIRECT_EXPENSES' || l.group === 'DIRECT_EXPENSES').map((l) => ({ value: l.id, label: `${l.name} (${GROUP_LABELS[l.group]})` })),
  ];
  const submit = async () => {
    setBusy(true);
    try {
      await saveExpense(e);
      toast.success('Expense saved');
      onClose();
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={initial.description ? 'Edit expense' : 'New expense'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date">
          <Input type="date" value={e.date} onChange={(ev) => set({ date: ev.target.value })} />
        </Field>
        <Field label="Expense head">
          <Select value={e.ledgerId} onValue={(v) => set({ ledgerId: v })} options={heads} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <TextInput value={e.description} onValue={(v) => set({ description: v })} autoFocus />
        </Field>
        <Field label="Paid to (vendor)">
          <TextInput value={e.vendorName} onValue={(v) => set({ vendorName: v })} />
        </Field>
        <Field label="Bill / receipt no.">
          <TextInput value={e.billNo} onValue={(v) => set({ billNo: v })} />
        </Field>
        {indian && (
          <>
            <Field label="Vendor GSTIN (for ITC)" error={e.vendorGstin && !validateGstin(e.vendorGstin).valid ? validateGstin(e.vendorGstin).errors[0] : undefined}>
              <TextInput value={e.vendorGstin} maxLength={15} onValue={(v) => set({ vendorGstin: v.toUpperCase().replace(/\s/g, '') })} />
            </Field>
            <Field label="GST">
              <Select
                value={e.supplyKind}
                onValue={(v) => set({ supplyKind: v })}
                options={[
                  { value: 'INTRA_STATE', label: 'CGST + SGST (same state)' },
                  { value: 'INTER_STATE', label: 'IGST (other state)' },
                  { value: 'NON_GST', label: 'No GST' },
                ]}
              />
            </Field>
          </>
        )}
        <Field label="Amount before tax">
          <NumberInput value={e.taxable} onValue={(n) => set({ taxable: n })} />
        </Field>
        {indian && e.supplyKind !== 'NON_GST' && (
          <Field label="GST rate">
            <Select value={String(e.gstRate)} onValue={(v) => set({ gstRate: Number(v) })} options={[...new Set([0, ...rateOptions(e.date), e.gstRate])].sort((a, b) => a - b).map((r) => ({ value: String(r), label: `${r}%` }))} />
          </Field>
        )}
        <Field label="Paid via">
          <Select value={e.paidVia} onValue={(v) => set({ paidVia: v })} options={PAID_VIA} />
        </Field>
        {['BANK', 'UPI', 'CARD'].includes(e.paidVia) && (
          <Field label="From bank account">
            <Select value={e.bankAccountId} placeholder={biz.bankAccounts.length ? 'Choose' : 'No bank accounts (treated as cash)'} onValue={(v) => set({ bankAccountId: v })} options={biz.bankAccounts.map((b) => ({ value: b.id, label: `${b.bankName || b.label} ...${b.accountNumber.slice(-4)}` }))} />
          </Field>
        )}
        {indian && (
          <Field label="TDS deducted">
            <div className="flex gap-2">
              <Select
                value={e.tds?.section ?? ''}
                placeholder="None"
                onValue={(v) => {
                  const s = getSection(v);
                  set({ tds: s ? { section: s.code, rate: s.rates[0].rate, base: 0, amount: 0 } : null });
                }}
                options={sectionsFor('TDS', e.date).map((s) => ({ value: s.code, label: `${s.code} - ${s.title}` }))}
              />
              {e.tds && <NumberInput className="w-20" aria-label="TDS rate" value={e.tds.rate} onValue={(n) => set({ tds: { ...e.tds!, rate: n } })} />}
            </div>
          </Field>
        )}
        {indian && c.gstRate > 0 && (
          // Review Y7: credit needs a registered vendor, so the box works only with a valid vendor GSTIN.
          <Checkbox
            className="self-end"
            checked={c.itcEligible}
            disabled={!isValidGstin(e.vendorGstin)}
            onValue={(v) => set({ itcEligible: v })}
            label="Claim input tax credit"
            hint={isValidGstin(e.vendorGstin) ? "Needs the vendor's GST invoice in your name" : "Enter the vendor's GSTIN first: a bill without one never reaches GSTR-2B, so it gives no credit"}
          />
        )}
        <Field label="Notes" className="sm:col-span-2">
          <TextInput value={e.notes} onValue={(v) => set({ notes: v })} />
        </Field>
      </div>
      <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
        Tax {money(c.cgst + c.sgst + c.igst)} | Total <b>{money(c.total)}</b>
        {c.tds && ` | TDS ${money(c.tds.amount)} | Paid ${money(c.total - c.tds.amount)}`}
      </div>
    </Modal>
  );
}

export function ExpensesPage() {
  const biz = useBusiness();
  const expenses = useMine('expenses');
  const ledgers = useMine('ledgers');
  const money = useMoney();
  const today = useToday();
  const [edit, setEdit] = useState<Expense | null>(null);
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('ALL');
  const headName = (id: string) => EXPENSE_LEDGERS.find((l) => l.id === id)?.name ?? ledgers.find((l) => l.id === id)?.name ?? id;
  const months = useMemo(() => [...new Set(expenses.map((e) => monthKey(e.date)))].sort().reverse(), [expenses]);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return expenses
      .filter((e) => month === 'ALL' || monthKey(e.date) === month)
      .filter((e) => words.every((w) => `${e.description} ${e.vendorName} ${e.billNo} ${headName(e.ledgerId)}`.toLowerCase().includes(w)))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    // headName only depends on ledgers, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, month, q, ledgers]);
  const byHead = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of rows) m.set(e.ledgerId, (m.get(e.ledgerId) ?? 0) + e.total);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const total = rows.reduce((s, e) => s + e.total, 0);

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={`${rows.length} entries | ${money(total)}`}
        actions={
          <>
            <Button
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  recordsToCsv(rows, [
                    { header: 'Date', value: (e) => fdate(e.date) },
                    { header: 'Head', value: (e) => headName(e.ledgerId) },
                    { header: 'Description', value: (e) => e.description },
                    { header: 'Vendor', value: (e) => e.vendorName },
                    { header: 'Vendor GSTIN', value: (e) => e.vendorGstin },
                    { header: 'Bill no', value: (e) => e.billNo },
                    { header: 'Taxable', value: (e) => e.taxable },
                    { header: 'GST', value: (e) => e.cgst + e.sgst + e.igst },
                    { header: 'Total', value: (e) => e.total },
                    { header: 'ITC', value: (e) => e.itcEligible },
                    { header: 'Paid via', value: (e) => e.paidVia },
                  ]),
                  `expenses-${today}.csv`,
                )
              }
            >
              Export CSV
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(newExpense(biz.id))}>
              New expense
            </Button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <Select className="w-44" value={month} onValue={setMonth} aria-label="Month" options={[{ value: 'ALL', label: 'All months' }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))]} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="card overflow-x-auto">
          {rows.length === 0 ? (
            <EmptyState icon={<Wallet className="h-10 w-10" />} title="No expenses recorded" action={<Button variant="primary" onClick={() => setEdit(newExpense(biz.id))}>Add expense</Button>} />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Head</th>
                  <th>Description</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fdate(e.date)}</td>
                    <td>{headName(e.ledgerId)}</td>
                    <td>
                      {e.description || '-'}
                      <div className="text-xs text-slate-500">{[e.vendorName, e.billNo, e.paidVia.toLowerCase(), e.itcEligible && 'ITC'].filter(Boolean).join(' | ')}</div>
                    </td>
                    <td className="num font-medium">{money(e.total)}</td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEdit(e)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete"
                        onClick={async () => {
                          if (await confirmDialog({ title: 'Delete this expense?', message: 'It moves to the Trash bin for 30 days.', danger: true, confirmLabel: 'Delete' })) {
                            await attempt(() => moveToTrash('expenses', e), 'Deleted');
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Card title="By head">
          {byHead.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {byHead.map(([head, amt]) => (
                <li key={head}>
                  <div className="flex justify-between">
                    <span>{headName(head)}</span>
                    <span className="tabular-nums">{money(amt)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-slate-100">
                    <div className="h-full rounded bg-brand-500" style={{ width: `${Math.max(2, (amt / (byHead[0][1] || 1)) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {edit && <ExpenseDialog initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
