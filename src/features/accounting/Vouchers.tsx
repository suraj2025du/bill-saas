import { Plus, Printer, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams, useBlocker } from 'react-router';
import { voucherDifference } from '../../core/accounting/postings';
import { previewNumber } from '../../core/docs/numbering';
import { newVoucher } from '../../core/factories';
import { GROUP_LABELS, allLedgers, parseLedgerRef } from '../../core/ledgers';
import type { Voucher, VoucherLine, VoucherType } from '../../core/model';
import { ReportDocument } from '../../print/SimpleDocuments';
import { pageSpec, printNode } from '../../print/printing';
import { moveToTrash, saveVoucher, voucherIssues } from '../../store/actions';
import { useBusiness, useMine } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Combobox } from '../../ui/Combobox';
import { attempt, confirmDialog, toast } from '../../ui/feedback';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Kbd, NumberInput, PageHeader, Tabs, TextInput, cx } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';

export const VOUCHER_KEYS: Record<string, VoucherType> = { F4: 'CONTRA', F5: 'PAYMENT', F6: 'RECEIPT', F7: 'JOURNAL' };
const LABEL: Record<VoucherType, string> = { CONTRA: 'Contra', PAYMENT: 'Payment', RECEIPT: 'Receipt', JOURNAL: 'Journal' };
const KEY_OF: Record<VoucherType, string> = { CONTRA: 'F4', PAYMENT: 'F5', RECEIPT: 'F6', JOURNAL: 'F7' };

/** F4-F7 open voucher entry (Tally keys) while an accounts screen is open. */
export function useVoucherKeys(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const type = VOUCHER_KEYS[e.key];
      if (!type || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      navigate(`/accounts/vouchers/new?type=${type}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}

function useLedgerOptions() {
  const biz = useBusiness();
  const parties = useStore((s) => s.data.clients);
  const ledgers = useStore((s) => s.data.ledgers);
  return useMemo(() => {
    const list = allLedgers({ business: biz, parties, ledgers });
    return { list, options: list.map((l) => ({ value: l.id, label: l.name, hint: GROUP_LABELS[l.group] })) };
  }, [biz, parties, ledgers]);
}

export function VoucherList() {
  useVoucherKeys();
  const vouchers = useMine('vouchers');
  const { list } = useLedgerOptions();
  const money = useMoney();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'ALL' | VoucherType>('ALL');
  const [q, setQ] = useState('');
  const name = (id: string) => list.find((l) => l.id === id)?.name ?? id;
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return vouchers
      .filter((v) => tab === 'ALL' || v.type === tab)
      .filter((v) => words.every((w) => `${v.number} ${v.narration}`.toLowerCase().includes(w)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.number.localeCompare(a.number)));
  }, [vouchers, tab, q]);
  return (
    <div>
      <PageHeader
        title="Vouchers"
        subtitle={
          <span className="flex flex-wrap items-center gap-1">
            Shortcuts: <Kbd>F4</Kbd> Contra <Kbd>F5</Kbd> Payment <Kbd>F6</Kbd> Receipt <Kbd>F7</Kbd> Journal
          </span>
        }
        actions={(['CONTRA', 'PAYMENT', 'RECEIPT', 'JOURNAL'] as const).map((t) => (
          <Button key={t} variant={t === 'PAYMENT' ? 'primary' : 'secondary'} icon={<Plus className="h-4 w-4" />} onClick={() => navigate(`/accounts/vouchers/new?type=${t}`)}>
            {LABEL[t]} ({KEY_OF[t]})
          </Button>
        ))}
      />
      <Tabs
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'ALL', label: 'All', count: vouchers.length },
          ...(['CONTRA', 'PAYMENT', 'RECEIPT', 'JOURNAL'] as const).map((t) => ({ value: t, label: LABEL[t], count: vouchers.filter((v) => v.type === t).length })),
        ]}
      />
      <div className="my-3">
        <Input className="max-w-xs" placeholder="Search number or narration" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title="No vouchers yet" text="Invoices, bills, expenses and payments post to the books automatically. Use vouchers for everything else." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Date</th>
                <th>Type</th>
                <th>Particulars</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const amount = v.lines.reduce((s, l) => s + l.dr, 0);
                return (
                  <tr key={v.id}>
                    <td>
                      <Link className="font-medium text-brand-700 hover:underline" to={`/accounts/vouchers/${v.id}`}>
                        {v.number}
                      </Link>
                    </td>
                    <td>{fdate(v.date)}</td>
                    <td>
                      <Badge tone="brand">{LABEL[v.type]}</Badge>
                    </td>
                    <td>
                      <div className="text-xs">
                        {v.lines.map((l, i) => (
                          <div key={i}>
                            {l.dr ? 'Dr' : 'Cr'} {name(l.ledgerId)}
                          </div>
                        ))}
                      </div>
                      {v.narration && <div className="text-xs italic text-slate-500">{v.narration}</div>}
                    </td>
                    <td className="num font-medium">{money(amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const blankLine = (): VoucherLine => ({ ledgerId: '', dr: 0, cr: 0, docId: '', note: '' });

function starterLines(type: VoucherType): VoucherLine[] {
  if (type === 'PAYMENT') return [blankLine(), { ...blankLine(), ledgerId: 'sys:cash' }];
  if (type === 'RECEIPT') return [{ ...blankLine(), ledgerId: 'sys:cash' }, blankLine()];
  return [blankLine(), blankLine()];
}

export function VoucherEditor() {
  useVoucherKeys();
  const { id } = useParams();
  const [params] = useSearchParams();
  const biz = useBusiness();
  const invoices = useMine('invoices');
  const purchases = useMine('purchases');
  const existing = useStore((s) => s.data.vouchers.find((v) => v.id === id));
  const navigate = useNavigate();
  const money = useMoney();
  const { list, options } = useLedgerOptions();
  const type = (existing?.type ?? (params.get('type') as VoucherType)) || 'PAYMENT';
  const [v, setV] = useState<Voucher>(() => existing ?? newVoucher(biz.id, type, { lines: starterLines(type) }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const updateV = (patch: Partial<Voucher> | ((prev: Voucher) => Voucher)) => {
    setV((curr) => (typeof patch === 'function' ? patch(curr) : { ...curr, ...patch }));
    setDirty(true);
  };

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !busy && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('You have unsaved changes. Leave without saving?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!existing && v.type !== type) {
      setV(newVoucher(biz.id, type, { lines: starterLines(type) }));
      setDirty(false);
    }
  }, [type, existing, v.type, biz.id]);

  const setLine = (i: number, patch: Partial<VoucherLine>) => {
    setV((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
    setDirty(true);
  };
  const diff = voucherDifference(v);
  const issues = voucherIssues(v);
  const totalDr = v.lines.reduce((s, l) => s + (l.dr || 0), 0);
  const totalCr = v.lines.reduce((s, l) => s + (l.cr || 0), 0);

  const billsFor = (ledgerId: string) => {
    const ref = parseLedgerRef(ledgerId);
    if (ref.kind !== 'party') return [];
    return [
      ...invoices.filter((d) => d.partyId === ref.key && d.status === 'FINAL').map((d) => ({ value: d.id, label: `Invoice ${d.number} (${money(d.totals.net, d.currency)})` })),
      ...purchases.filter((b) => b.supplierId === ref.key && b.status === 'FINAL').map((b) => ({ value: b.id, label: `Bill ${b.billNo} (${money(b.totals.net, b.currency)})` })),
    ];
  };

  const submit = async (another: boolean) => {
    setBusy(true);
    try {
      const saved = await saveVoucher(v);
      setDirty(false);
      toast.success(`${LABEL[saved.type]} voucher ${saved.number} saved`);
      if (another) {
        setV(newVoucher(biz.id, saved.type, { lines: starterLines(saved.type), date: saved.date }));
        setDirty(false);
      }
      else navigate('/accounts/vouchers');
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void submit(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const print = () =>
    printNode(
      <ReportDocument
        business={biz}
        title={`${LABEL[v.type]} Voucher`}
        subtitle={`No. ${v.number || '(unsaved)'} | ${fdate(v.date)}${v.narration ? ` | ${v.narration}` : ''}`}
        columns={[{ header: 'Ledger' }, { header: 'Debit', align: 'right', width: '32mm' }, { header: 'Credit', align: 'right', width: '32mm' }]}
        rows={v.lines.filter((l) => l.ledgerId).map((l) => [list.find((x) => x.id === l.ledgerId)?.name ?? l.ledgerId, l.dr || '', l.cr || ''])}
        footer={[['Total', totalDr, totalCr]]}
      />,
      pageSpec(biz.print, 'A5'),
    );

  const remove = async () => {
    if (!existing) return;
    if (await confirmDialog({ title: `Delete voucher ${existing.number}?`, message: 'It moves to the Trash bin for 30 days.', danger: true, confirmLabel: 'Delete' })) {
      if (await attempt(() => moveToTrash('vouchers', existing), 'Deleted')) navigate('/accounts/vouchers');
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        back="/accounts/vouchers"
        title={`${existing ? 'Edit' : 'New'} ${LABEL[v.type]} voucher (${KEY_OF[v.type]})`}
        subtitle={v.number || previewNumber(biz.series[`VOUCHER_${v.type}`], v.date, biz.fyStartMonth)}
        actions={
          <>
            {existing && (
              <Button variant="ghost" aria-label="Delete" onClick={() => void remove()}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
            <Button icon={<Printer className="h-4 w-4" />} onClick={() => void print()}>
              Print
            </Button>
            {!existing && (
              <Button busy={busy} onClick={() => void submit(true)}>
                Save & new
              </Button>
            )}
            <Button variant="primary" busy={busy} onClick={() => void submit(false)} title="Ctrl+S">
              Save
            </Button>
          </>
        }
      />
      {!existing && (
        <Tabs
          className="mb-3"
          value={v.type}
          onValue={(t) => navigate(`/accounts/vouchers/new?type=${t}`, { replace: true })}
          tabs={(['CONTRA', 'PAYMENT', 'RECEIPT', 'JOURNAL'] as const).map((t) => ({ value: t, label: `${LABEL[t]} (${KEY_OF[t]})` }))}
        />
      )}
      <Card bodyClassName="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={v.date} onChange={(e) => updateV({ date: e.target.value })} />
          </Field>
          <Field label="Narration" className="sm:col-span-2">
            <TextInput value={v.narration} onValue={(t) => updateV({ narration: t })} placeholder="Being..." />
          </Field>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="pb-1">Ledger</th>
              <th className="w-32 pb-1 text-right">Debit</th>
              <th className="w-32 pb-1 text-right">Credit</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {v.lines.map((l, i) => {
              const bills = billsFor(l.ledgerId);
              return (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2">
                    <Combobox ariaLabel={`Ledger ${i + 1}`} value={l.ledgerId} options={options} onValue={(x) => setLine(i, { ledgerId: x, docId: '' })} placeholder="Choose ledger" />
                    {bills.length > 0 && (
                      <select className="input mt-1 py-1 text-xs" value={l.docId} onChange={(e) => setLine(i, { docId: e.target.value })} aria-label="Against bill">
                        <option value="">On account (no bill)</option>
                        {bills.map((b) => (
                          <option key={b.value} value={b.value}>
                            Against {b.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <NumberInput aria-label="Debit" value={l.dr} emptyZero onValue={(n) => setLine(i, { dr: Math.max(0, n), cr: n > 0 ? 0 : l.cr })} />
                  </td>
                  <td className="py-1 pr-2">
                    <NumberInput aria-label="Credit" value={l.cr} emptyZero onValue={(n) => setLine(i, { cr: Math.max(0, n), dr: n > 0 ? 0 : l.dr })} />
                  </td>
                  <td className="py-1">
                    <Button size="sm" variant="ghost" aria-label="Remove line" disabled={v.lines.length <= 2} onClick={() => updateV((curr) => ({ ...curr, lines: curr.lines.filter((_, j) => j !== i) }))}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td className="pt-2">
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => updateV((curr) => ({ ...curr, lines: [...curr.lines, blankLine()] }))}>
                  Add line
                </Button>
                {Math.abs(diff) >= 0.005 && (
                  <Button
                    size="sm"
                    className="ml-2"
                    onClick={() => {
                      const idx = v.lines.findIndex((l) => !l.dr && !l.cr);
                      const patch = diff > 0 ? { cr: diff, dr: 0 } : { dr: -diff, cr: 0 };
                      if (idx >= 0) setLine(idx, patch);
                      else updateV((curr) => ({ ...curr, lines: [...curr.lines, { ...blankLine(), ...patch }] }));
                    }}
                  >
                    Balance {money(Math.abs(diff))}
                  </Button>
                )}
              </td>
              <td className="pt-2 text-right tabular-nums">{money(totalDr)}</td>
              <td className={cx('pt-2 text-right tabular-nums', Math.abs(diff) >= 0.005 && 'text-red-600')}>{money(totalCr)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        {issues.length > 0 && (
          <Alert tone="amber">
            <ul className="list-disc pl-5">
              {issues.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Alert>
        )}
      </Card>
    </div>
  );
}
