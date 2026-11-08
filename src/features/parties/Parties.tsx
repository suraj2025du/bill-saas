import { FileDown, Pencil, Plus, Printer, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useBlocker } from 'react-router';
import { ledgerStatement, receivablesAgeing, payablesAgeing } from '../../core/accounting/reports';
import { fyOf, todayISO } from '../../core/dates';
import { recordsToCsv } from '../../core/export/csv';
import { newParty } from '../../core/factories';
import { stateCodeFromGstin, validateGstin } from '../../core/gst/gstin';
import { FOREIGN_POS, SELECTABLE_STATES } from '../../core/gst/states';
import { partyLedgerId } from '../../core/ledgers';
import type { Address, Party, PartyKind } from '../../core/model';
import { sectionsFor } from '../../core/tds';
import { ReportDocument } from '../../print/SimpleDocuments';
import { nodeToPdf, pageSpec, printNode } from '../../print/printing';
import { moveToTrash, saveParty } from '../../store/actions';
import { useBooks, useBusiness, useMine, useToday } from '../../store/hooks';
import { useStore } from '../../store/store';
import { attempt, confirmDialog, toast } from '../../ui/feedback';
import { downloadBlob, downloadCsv } from '../../ui/files';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, NumberInput, PageHeader, Select, Tabs, TextInput, Textarea } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';

const REG_OPTIONS = [
  { value: 'REGULAR', label: 'Registered (regular)' },
  { value: 'COMPOSITION', label: 'Registered (composition)' },
  { value: 'UNREGISTERED', label: 'Unregistered business' },
  { value: 'CONSUMER', label: 'Consumer' },
  { value: 'SEZ', label: 'SEZ unit / developer' },
  { value: 'OVERSEAS', label: 'Overseas' },
  { value: 'UIN', label: 'UN body / embassy (UIN)' },
] as const;

const STATES = SELECTABLE_STATES.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` }));

export function PartyList() {
  const parties = useMine('clients');
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'ALL' | PartyKind>('ALL');
  const [q, setQ] = useState('');

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    if (!books) return map;
    for (const r of receivablesAgeing(books, today)) map.set(r.ledgerId, r.total);
    for (const r of payablesAgeing(books, today)) map.set(r.ledgerId, -r.total);
    return map;
  }, [books, today]);

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return parties
      .filter((p) => tab === 'ALL' || p.kind === tab || p.kind === 'BOTH')
      .filter((p) => words.every((w) => `${p.name} ${p.gstin} ${p.phone} ${p.email} ${p.billing.city}`.toLowerCase().includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [parties, tab, q]);

  const exportCsv = () =>
    downloadCsv(
      recordsToCsv(rows, [
        { header: 'Name', value: (p) => p.name },
        { header: 'Type', value: (p) => p.kind },
        { header: 'GSTIN', value: (p) => p.gstin },
        { header: 'PAN', value: (p) => p.pan },
        { header: 'Phone', value: (p) => p.phone },
        { header: 'E-mail', value: (p) => p.email },
        { header: 'City', value: (p) => p.billing.city },
        { header: 'State', value: (p) => p.billing.stateCode },
        { header: 'Balance (Dr+ / Cr-)', value: (p) => balances.get(partyLedgerId(p.id)) ?? 0 },
      ]),
      `parties-${today}.csv`,
    );

  return (
    <div>
      <PageHeader
        title="Parties"
        subtitle="Customers and suppliers"
        actions={
          <>
            <Button onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/parties/new')}>
              New party
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'ALL', label: 'All', count: parties.length },
          { value: 'CUSTOMER', label: 'Customers', count: parties.filter((p) => p.kind !== 'SUPPLIER').length },
          { value: 'SUPPLIER', label: 'Suppliers', count: parties.filter((p) => p.kind !== 'CUSTOMER').length },
        ]}
      />
      <div className="my-3">
        <Input className="max-w-xs" placeholder="Search name, GSTIN, phone, city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<Users className="h-10 w-10" />} title="No parties yet" action={<Button variant="primary" onClick={() => navigate('/parties/new')}>Add a party</Button>} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>GSTIN</th>
                <th>Contact</th>
                <th>Type</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const bal = balances.get(partyLedgerId(p.id)) ?? 0;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link className="font-medium text-brand-700 hover:underline" to={`/parties/${p.id}`}>
                        {p.name}
                      </Link>
                      <div className="text-xs text-slate-500">{p.billing.city}</div>
                    </td>
                    <td className="font-mono text-xs">{p.gstin || '-'}</td>
                    <td className="text-xs">
                      {p.phone}
                      {p.email && <div>{p.email}</div>}
                    </td>
                    <td>
                      <Badge tone={p.kind === 'SUPPLIER' ? 'blue' : p.kind === 'BOTH' ? 'brand' : 'gray'}>{p.kind.toLowerCase()}</Badge>
                    </td>
                    <td className={`num ${bal > 0 ? 'text-emerald-700' : bal < 0 ? 'text-red-700' : ''}`}>
                      {bal === 0 ? '-' : `${money(Math.abs(bal))} ${bal > 0 ? 'Dr' : 'Cr'}`}
                    </td>
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

function AddressFields({ value, onChange, indian }: { value: Address; onChange: (a: Address) => void; indian: boolean }) {
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Address line 1" className="sm:col-span-2">
        <TextInput value={value.line1} onValue={(v) => set({ line1: v })} />
      </Field>
      <Field label="Address line 2">
        <TextInput value={value.line2} onValue={(v) => set({ line2: v })} />
      </Field>
      <Field label="City">
        <TextInput value={value.city} onValue={(v) => set({ city: v })} />
      </Field>
      <Field label="PIN / ZIP code">
        <TextInput value={value.pincode} onValue={(v) => set({ pincode: v })} />
      </Field>
      {indian && (
        <Field label="Country">
          <Select
            value={value.countryCode === 'IN' ? 'IN' : 'XX'}
            onValue={(v) => set(v === 'IN' ? { countryCode: 'IN', stateCode: '' } : { countryCode: 'ZZ', stateCode: FOREIGN_POS })}
            options={[
              { value: 'IN', label: 'India' },
              { value: 'XX', label: 'Outside India' },
            ]}
          />
        </Field>
      )}
      {indian && value.countryCode === 'IN' && (
        <Field label="State">
          <Select value={value.stateCode} placeholder="Select state" onValue={(v) => set({ stateCode: v })} options={STATES} />
        </Field>
      )}
    </div>
  );
}

export function PartyEditor() {
  const { id } = useParams();
  const biz = useBusiness();
  const navigate = useNavigate();
  const existing = useStore((s) => s.data.clients.find((p) => p.id === id));
  const [p, setP] = useState<Party>(() => existing ?? newParty(biz.id, { billing: { line1: '', line2: '', city: '', pincode: '', stateCode: '', countryCode: biz.countryCode } }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const indian = biz.countryCode === 'IN';
  const set = (patch: Partial<Party>) => {
    setP((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const g = p.gstin ? validateGstin(p.gstin) : null;

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

  const onGstin = (v: string) => {
    const gstin = v.toUpperCase().replace(/\s/g, '');
    const check = validateGstin(gstin);
    if (check.valid) {
      set({
        gstin,
        pan: check.pan,
        registration: ['UNREGISTERED', 'CONSUMER', 'OVERSEAS'].includes(p.registration) ? 'REGULAR' : p.registration,
        billing: { ...p.billing, stateCode: stateCodeFromGstin(gstin), countryCode: 'IN' },
      });
    } else set({ gstin });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const saved = await saveParty(p);
      setDirty(false);
      toast.success('Party saved');
      navigate(`/parties/${saved.id}`, { replace: true });
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        back
        title={existing ? `Edit ${existing.name}` : 'New party'}
        actions={
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Save
          </Button>
        }
      />
      <div className="space-y-4">
        <Card title="Details" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" className="sm:col-span-2">
            <TextInput value={p.name} onValue={(v) => set({ name: v })} autoFocus />
          </Field>
          <Field label="Type">
            <Select<PartyKind>
              value={p.kind}
              onValue={(v) => set({ kind: v })}
              options={[
                { value: 'CUSTOMER', label: 'Customer' },
                { value: 'SUPPLIER', label: 'Supplier' },
                { value: 'BOTH', label: 'Customer and supplier' },
              ]}
            />
          </Field>
          {indian && (
            <>
              <Field label="GSTIN / UIN" error={g && !g.valid ? g.errors[0] : undefined} hint={g?.valid ? 'Valid GSTIN. State and PAN filled in.' : undefined}>
                <TextInput value={p.gstin} maxLength={15} onValue={onGstin} />
              </Field>
              <Field label="Registration">
                <Select value={p.registration} onValue={(v) => set({ registration: v })} options={REG_OPTIONS} />
              </Field>
              <Field label="PAN">
                <TextInput value={p.pan} maxLength={10} onValue={(v) => set({ pan: v.toUpperCase() })} />
              </Field>
            </>
          )}
          <Field label="Contact person">
            <TextInput value={p.contactPerson} onValue={(v) => set({ contactPerson: v })} />
          </Field>
          <Field label="Phone">
            <TextInput value={p.phone} onValue={(v) => set({ phone: v })} />
          </Field>
          <Field label="E-mail">
            <TextInput type="email" value={p.email} onValue={(v) => set({ email: v })} />
          </Field>
        </Card>
        <Card title="Billing address">
          <AddressFields value={p.billing} onChange={(a) => set({ billing: a })} indian={indian} />
        </Card>
        <Card title="Shipping address">
          <Checkbox checked={!!p.shipping} onValue={(v) => set({ shipping: v ? { ...p.billing } : null })} label="Different shipping address" />
          {p.shipping && (
            <div className="mt-3">
              <AddressFields value={p.shipping} onChange={(a) => set({ shipping: a })} indian={indian} />
            </div>
          )}
        </Card>
        <Card title="Accounts" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Credit period (days)">
            <NumberInput value={p.creditDays} onValue={(n) => set({ creditDays: Math.max(0, Math.round(n)) })} />
          </Field>
          <Field label="Opening balance">
            <NumberInput value={p.openingBalance} onValue={(n) => set({ openingBalance: Math.abs(n) })} />
          </Field>
          <Field label="Opening is">
            <Select
              value={p.openingType}
              onValue={(v) => set({ openingType: v })}
              options={[
                { value: 'DR', label: 'Dr (they owe us)' },
                { value: 'CR', label: 'Cr (we owe them)' },
              ]}
            />
          </Field>
          {indian && p.kind !== 'CUSTOMER' && (
            <Field label="Default TDS section">
              <Select
                value={p.tdsSection}
                placeholder="None"
                onValue={(v) => set({ tdsSection: v })}
                options={sectionsFor('TDS', todayISO()).map((s) => ({ value: s.code, label: `${s.code} - ${s.title}` }))}
              />
            </Field>
          )}
          <Field label="Notes" className="sm:col-span-2 lg:col-span-4">
            <Textarea rows={2} value={p.notes} onValue={(v) => set({ notes: v })} />
          </Field>
        </Card>
      </div>
    </div>
  );
}

export function PartyDetail() {
  const { id } = useParams();
  const biz = useBusiness();
  const books = useBooks();
  const today = useToday();
  const money = useMoney();
  const navigate = useNavigate();
  const party = useStore((s) => s.data.clients.find((p) => p.id === id));
  const invoices = useMine('invoices');
  const purchases = useMine('purchases');
  const receipts = useMine('receipts');
  const vouchers = useMine('vouchers');
  const fy = fyOf(today, biz.fyStartMonth);
  const [from, setFrom] = useState(fy.start);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);

  const statement = useMemo(() => (books && party ? ledgerStatement(books, partyLedgerId(party.id), from, to) : null), [books, party, from, to]);
  const ageing = useMemo(() => {
    if (!books || !party) return null;
    const list = party.kind === 'SUPPLIER' ? payablesAgeing(books, today) : receivablesAgeing(books, today);
    return list.find((r) => r.ledgerId === partyLedgerId(party.id)) ?? null;
  }, [books, party, today]);

  if (!party || !statement) return <EmptyState title="Party not found" action={<Link className="btn btn-secondary" to="/parties">Back</Link>} />;
  const dc = (n: number) => (n === 0 ? '0.00' : `${money(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`);
  const used =
    invoices.some((d) => d.partyId === party.id) ||
    purchases.some((b) => b.supplierId === party.id) ||
    receipts.some((r) => r.partyId === party.id) ||
    vouchers.some((v) => v.lines.some((l) => l.ledgerId === partyLedgerId(party.id)));

  const reportNode = (
    <ReportDocument
      business={biz}
      title="Account Statement"
      subtitle={`${party.name}${party.gstin ? ` (GSTIN ${party.gstin})` : ''} | ${fdate(from)} to ${fdate(to)}`}
      columns={[
        { header: 'Date', width: '20mm' },
        { header: 'Particulars' },
        { header: 'Voucher', width: '28mm' },
        { header: 'Debit', align: 'right', width: '24mm' },
        { header: 'Credit', align: 'right', width: '24mm' },
        { header: 'Balance', align: 'right', width: '30mm' },
      ]}
      rows={[
        [fdate(from), 'Opening balance', '', '', '', dc(statement.opening)],
        ...statement.rows.map((r) => [fdate(r.date), `${r.voucherType}${r.against ? ` - ${r.against}` : ''}`, r.voucherNo, r.dr || '', r.cr || '', dc(r.balance)]),
      ]}
      footer={[['', 'Total', '', statement.totalDr, statement.totalCr, dc(statement.closing)]]}
    />
  );

  const remove = async () => {
    if (used) {
      toast.error('This party has invoices, bills or payments. It cannot be deleted.');
      return;
    }
    if (await confirmDialog({ title: `Delete ${party.name}?`, message: 'It moves to the Trash bin for 30 days.', danger: true, confirmLabel: 'Delete' })) {
      if (await attempt(() => moveToTrash('clients', party), 'Moved to Trash')) navigate('/parties');
    }
  };

  return (
    <div>
      <PageHeader
        back="/parties"
        title={party.name}
        subtitle={[party.gstin && `GSTIN ${party.gstin}`, party.phone, party.billing.city].filter(Boolean).join(' | ')}
        actions={
          <>
            <Button icon={<Printer className="h-4 w-4" />} busy={busy} onClick={() => void printNode(reportNode, pageSpec(biz.print, 'A4'))}>
              Print statement
            </Button>
            <Button
              icon={<FileDown className="h-4 w-4" />}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  downloadBlob(await nodeToPdf(reportNode, pageSpec(biz.print, 'A4')), `Statement ${party.name} ${from} to ${to}.pdf`);
                } catch (e) {
                  toast.fromError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              PDF
            </Button>
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`/parties/${party.id}/edit`)}>
              Edit
            </Button>
            <Button variant="ghost" aria-label="Delete" onClick={() => void remove()}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
            {party.kind !== 'SUPPLIER' && (
              <Button variant="primary" onClick={() => navigate('/sales/new?type=TAX_INVOICE', { state: { partyId: party.id } })}>
                New invoice
              </Button>
            )}
          </>
        }
      />
      {ageing && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
          {['0-30 days', '31-60 days', '61-90 days', '90+ days'].map((label, i) => (
            <div key={label} className="card px-3 py-2">
              <p className="text-xs text-slate-500">{label}</p>
              <p className={`font-semibold tabular-nums ${i === 3 && ageing.buckets[3] > 0 ? 'text-red-700' : ''}`}>{money(ageing.buckets[i])}</p>
            </div>
          ))}
          <div className="card px-3 py-2">
            <p className="text-xs text-slate-500">On account</p>
            <p className="font-semibold tabular-nums">{money(ageing.onAccount)}</p>
          </div>
          <div className="card px-3 py-2">
            <p className="text-xs text-slate-500">{party.kind === 'SUPPLIER' ? 'We owe' : 'Receivable'}</p>
            <p className="font-semibold tabular-nums">{money(ageing.total)}</p>
          </div>
        </div>
      )}
      <Card
        title="Account statement"
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span className="text-slate-500">to</span>
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </div>
        }
        bodyClassName="overflow-x-auto p-0"
      >
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
            <tr className="bg-slate-50">
              <td>{fdate(from)}</td>
              <td colSpan={4} className="font-medium">
                Opening balance
              </td>
              <td className="num font-medium">{dc(statement.opening)}</td>
            </tr>
            {statement.rows.map((r, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap">{fdate(r.date)}</td>
                <td>
                  {r.voucherType}
                  {r.against && <span className="text-slate-500"> - {r.against}</span>}
                </td>
                <td>
                  {r.sourceType === 'SALES' ? (
                    <Link className="text-brand-700 hover:underline" to={`/sales/${r.sourceId}`}>
                      {r.voucherNo || '(no number)'}
                    </Link>
                  ) : r.sourceType === 'PURCHASE' ? (
                    <Link className="text-brand-700 hover:underline" to={`/purchases/${r.sourceId}`}>
                      {r.voucherNo || '(no number)'}
                    </Link>
                  ) : (
                    r.voucherNo
                  )}
                </td>
                <td className="num">{r.dr ? money(r.dr) : ''}</td>
                <td className="num">{r.cr ? money(r.cr) : ''}</td>
                <td className="num">{dc(r.balance)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td colSpan={3}>Closing balance</td>
              <td className="num">{money(statement.totalDr)}</td>
              <td className="num">{money(statement.totalCr)}</td>
              <td className="num">{dc(statement.closing)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
