import { FileDown, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { balancesOn, ledgerInfo, ledgerStatement } from '../../core/accounting/reports';
import type { LedgerStatement } from '../../core/accounting/reports';
import { fyOf } from '../../core/dates';
import { newLedger } from '../../core/factories';
import { GROUP_LABELS, PNL_GROUPS, allLedgers } from '../../core/ledgers';
import type { Business, Ledger, LedgerGroup } from '../../core/model';
import { ReportDocument } from '../../print/SimpleDocuments';
import { nodeToPdf, pageSpec, printNode } from '../../print/printing';
import { deleteLedger, saveLedger } from '../../store/actions';
import { useBooks, useBusiness, useMine, useToday } from '../../store/hooks';
import { useStore } from '../../store/store';
import { attempt, confirmDialog, toast } from '../../ui/feedback';
import { downloadBlob } from '../../ui/files';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, TextInput } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { useVoucherKeys } from './Vouchers';

const GROUP_OPTIONS = (Object.keys(GROUP_LABELS) as LedgerGroup[]).map((g) => ({ value: g, label: GROUP_LABELS[g] }));

function LedgerDialog({ initial, onClose }: { initial: Ledger; onClose: () => void }) {
  const [l, setL] = useState(initial);
  const [busy, setBusy] = useState(false);
  const pnl = PNL_GROUPS.has(l.group);
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={initial.name ? `Edit ${initial.name}` : 'New ledger'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await attempt(() => saveLedger(l), 'Ledger saved');
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Name">
          <TextInput value={l.name} onValue={(v) => setL({ ...l, name: v })} autoFocus />
        </Field>
        <Field label="Group">
          <Select value={l.group} onValue={(g) => setL({ ...l, group: g })} options={GROUP_OPTIONS} />
        </Field>
        {!pnl && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opening balance">
              <NumberInput value={l.openingBalance} onValue={(n) => setL({ ...l, openingBalance: Math.abs(n) })} />
            </Field>
            <Field label="Dr / Cr">
              <Select
                value={l.openingType}
                onValue={(v) => setL({ ...l, openingType: v })}
                options={[
                  { value: 'DR', label: 'Dr (asset / receivable)' },
                  { value: 'CR', label: 'Cr (liability / capital)' },
                ]}
              />
            </Field>
          </div>
        )}
        {pnl && <p className="text-xs text-slate-500">Income and expense ledgers start every year at zero, so they have no opening balance.</p>}
        <Field label="Notes">
          <TextInput value={l.notes} onValue={(v) => setL({ ...l, notes: v })} />
        </Field>
      </div>
    </Modal>
  );
}

export function LedgersPage() {
  useVoucherKeys();
  const biz = useBusiness();
  const parties = useStore((s) => s.data.clients);
  const ledgers = useMine('ledgers');
  const allCustom = useStore((s) => s.data.ledgers);
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const [edit, setEdit] = useState<Ledger | null>(null);
  const [q, setQ] = useState('');
  const balances = useMemo(() => (books ? balancesOn(books, today) : new Map<string, number>()), [books, today]);
  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return allLedgers({ business: biz, parties, ledgers: allCustom })
      .filter((l) => words.every((w) => `${l.name} ${GROUP_LABELS[l.group]}`.toLowerCase().includes(w)))
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  }, [biz, parties, allCustom, q]);
  const groups = useMemo(() => {
    const m = new Map<LedgerGroup, typeof list>();
    for (const l of list) m.set(l.group, [...(m.get(l.group) ?? []), l]);
    return [...m];
  }, [list]);

  return (
    <div>
      <PageHeader
        title="Ledgers"
        subtitle="System, party, bank and your own ledgers with balances today"
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(newLedger(biz.id, '', 'INDIRECT_EXPENSES'))}>
            New ledger
          </Button>
        }
      />
      <Input className="mb-3 max-w-xs" placeholder="Search ledgers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map(([group, items]) => (
          <Card key={group} title={GROUP_LABELS[group]} bodyClassName="p-0">
            <ul className="divide-y divide-slate-100 text-sm">
              {items.map((l) => {
                const bal = balances.get(l.id) ?? 0;
                const custom = ledgers.find((x) => x.id === l.id);
                return (
                  <li key={l.id} className="flex items-center gap-2 px-4 py-1.5">
                    <Link className="flex-1 text-brand-700 hover:underline" to={`/accounts/ledger/${encodeURIComponent(l.id)}`}>
                      {l.name}
                    </Link>
                    {l.kind !== 'system' && <Badge tone="gray">{l.kind}</Badge>}
                    <span className="w-36 text-right tabular-nums">{bal ? `${money(Math.abs(bal))} ${bal > 0 ? 'Dr' : 'Cr'}` : '-'}</span>
                    {custom && (
                      <>
                        <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEdit(custom)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Delete"
                          onClick={async () => {
                            if (await confirmDialog({ title: `Delete ledger ${custom.name}?`, danger: true, confirmLabel: 'Delete' })) await attempt(() => deleteLedger(custom), 'Deleted');
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
      {edit && <LedgerDialog initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function statementReport(biz: Business, st: LedgerStatement, money: (n: number) => string) {
  const dc = (n: number) => (n === 0 ? '0.00' : `${money(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`);
  return (
    <ReportDocument
      business={biz}
      title={st.ledger.name}
      subtitle={`Ledger statement ${fdate(st.from)} to ${fdate(st.to)}`}
      columns={[
        { header: 'Date', width: '20mm' },
        { header: 'Particulars' },
        { header: 'Voucher', width: '30mm' },
        { header: 'Debit', align: 'right', width: '24mm' },
        { header: 'Credit', align: 'right', width: '24mm' },
        { header: 'Balance', align: 'right', width: '30mm' },
      ]}
      rows={[
        [fdate(st.from), 'Opening balance', '', '', '', dc(st.opening)],
        ...st.rows.map((r) => [fdate(r.date), `${r.voucherType}${r.against ? ` - ${r.against}` : ''}${r.narration ? ` (${r.narration})` : ''}`, r.voucherNo, r.dr || '', r.cr || '', dc(r.balance)]),
      ]}
      footer={[['', 'Total / closing', '', st.totalDr, st.totalCr, dc(st.closing)]]}
    />
  );
}

export function StatementTable({ st }: { st: LedgerStatement }) {
  const money = useMoney();
  const dc = (n: number) => (n === 0 ? '-' : `${money(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`);
  const link = (r: LedgerStatement['rows'][number]) => {
    switch (r.sourceType) {
      case 'SALES':
        return `/sales/${r.sourceId}`;
      case 'PURCHASE':
        return `/purchases/${r.sourceId}`;
      case 'VOUCHER':
        return `/accounts/vouchers/${r.sourceId}`;
      case 'RECEIPT':
      case 'PAYMENT':
        return '/payments';
      default:
        return '/expenses';
    }
  };
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Particulars</th>
          <th>Voucher</th>
          <th className="num">Debit</th>
          <th className="num">Credit</th>
          <th className="num">Balance</th>
        </tr>
      </thead>
      <tbody>
        <tr className="bg-slate-50 font-medium">
          <td>{fdate(st.from)}</td>
          <td colSpan={4}>Opening balance</td>
          <td className="num">{dc(st.opening)}</td>
        </tr>
        {st.rows.map((r, i) => (
          <tr key={i}>
            <td className="whitespace-nowrap">{fdate(r.date)}</td>
            <td>
              {r.voucherType}
              {r.against && <span className="text-slate-600"> - {r.against}</span>}
              {r.narration && <div className="text-xs text-slate-500">{r.narration}</div>}
            </td>
            <td>
              <Link className="text-brand-700 hover:underline" to={link(r)}>
                {r.voucherNo || '-'}
              </Link>
            </td>
            <td className="num">{r.dr ? money(r.dr) : ''}</td>
            <td className="num">{r.cr ? money(r.cr) : ''}</td>
            <td className="num">{dc(r.balance)}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td colSpan={3}>Closing balance</td>
          <td className="num">{money(st.totalDr)}</td>
          <td className="num">{money(st.totalCr)}</td>
          <td className="num">{dc(st.closing)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function LedgerStatementPage() {
  useVoucherKeys();
  const { ledgerId = '' } = useParams();
  const id = decodeURIComponent(ledgerId);
  const biz = useBusiness();
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const navigate = useNavigate();
  const fy = fyOf(today, biz.fyStartMonth);
  const [from, setFrom] = useState(fy.start);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const st = useMemo(() => (books ? ledgerStatement(books, id, from, to) : null), [books, id, from, to]);
  if (!books || !st) return <EmptyState title="Ledger not available" />;
  const info = ledgerInfo(books, id);
  const report = statementReport(biz, st, money);
  return (
    <div>
      <PageHeader
        back
        title={info.name}
        subtitle={GROUP_LABELS[info.group]}
        actions={
          <>
            {info.kind === 'party' && <Button onClick={() => navigate(`/parties/${id.slice(6)}`)}>Open party</Button>}
            <Button icon={<Printer className="h-4 w-4" />} onClick={() => void printNode(report, pageSpec(biz.print, 'A4'))}>
              Print
            </Button>
            <Button
              icon={<FileDown className="h-4 w-4" />}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  downloadBlob(await nodeToPdf(report, pageSpec(biz.print, 'A4')), `${info.name} ${from} to ${to}.pdf`);
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
        }
      />
      <Card
        title="Statement"
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span className="text-slate-500">to</span>
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </div>
        }
        bodyClassName="overflow-x-auto p-0"
      >
        <StatementTable st={st} />
      </Card>
    </div>
  );
}
