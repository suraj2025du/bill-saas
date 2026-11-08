import { Paperclip, Plus, Printer, Receipt, ScanText, ShoppingCart, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useBlocker } from 'react-router';
import { currencyDecimals } from '../../core/currency/countries';
import { fyOf } from '../../core/dates';
import { purchasePaymentSummary } from '../../core/docs/payments';
import { recordsToCsv } from '../../core/export/csv';
import { lineFromProduct, newLineItem, newParty, newPurchase, partySnapshot } from '../../core/factories';
import { stateCodeFromGstin, validateGstin } from '../../core/gst/gstin';
import { rateOptions } from '../../core/gst/rates';
import { SELECTABLE_STATES } from '../../core/gst/states';
import { determineSupplyKind, supplyKindLabel } from '../../core/gst/supply';
import type { ItcCategory, LineItem, PurchaseBill, SupplyKind } from '../../core/model';
import { roundTo } from '../../core/money';
import { applyThreshold, getSection, sectionsFor } from '../../core/tds';
import { computePurchase, deletePayment, deletePurchase, saveParty, savePurchase } from '../../store/actions';
import { useBusiness, useMine, usePaymentIndex, useToday } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Combobox } from '../../ui/Combobox';
import { attempt, confirmDialog, toast } from '../../ui/feedback';
import { downloadCsv, imageToDataUrl, pickFile, readFileDataUrl } from '../../ui/files';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, NumberInput, PageHeader, Select, Textarea, TextInput } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { PaymentDialog, printReceipt } from '../sales/PaymentDialog';
import { UnitSelect } from '../settings/UnitSelect';
import { readBillImage } from './ocr';

const ITC: { value: ItcCategory; label: string }[] = [
  { value: 'INPUTS', label: 'Inputs (goods for resale / production)' },
  { value: 'CAPITAL_GOODS', label: 'Capital goods (machinery, computers)' },
  { value: 'INPUT_SERVICES', label: 'Input services' },
  { value: 'IMPORT_GOODS', label: 'Import of goods (IGST on Bill of Entry)' },
  { value: 'IMPORT_SERVICES', label: 'Import of services (reverse charge)' },
  { value: 'INELIGIBLE', label: 'Ineligible / blocked (s.17(5))' },
];

export function PurchaseList() {
  const bills = useMine('purchases');
  const index = usePaymentIndex();
  const money = useMoney();
  const today = useToday();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return bills
      .filter((b) => words.every((w) => `${b.billNo} ${b.supplier.name} ${b.supplier.gstin}`.toLowerCase().includes(w)))
      .sort((a, b) => (a.billDate < b.billDate ? 1 : -1));
  }, [bills, q]);
  const itc = rows.filter((b) => b.status === 'FINAL' && b.itcCategory !== 'INELIGIBLE').reduce((s, b) => s + b.totals.tax, 0);

  const exportCsv = () =>
    downloadCsv(
      recordsToCsv(rows, [
        { header: 'Bill no', value: (b) => b.billNo },
        { header: 'Date', value: (b) => fdate(b.billDate) },
        { header: 'Supplier', value: (b) => b.supplier.name },
        { header: 'GSTIN', value: (b) => b.supplier.gstin },
        { header: 'ITC type', value: (b) => b.itcCategory },
        { header: 'Taxable', value: (b) => b.totals.taxable },
        { header: 'IGST', value: (b) => b.totals.igst },
        { header: 'CGST', value: (b) => b.totals.cgst },
        { header: 'SGST', value: (b) => b.totals.sgst + b.totals.utgst },
        { header: 'Total', value: (b) => b.totals.total },
        { header: 'Balance', value: (b) => purchasePaymentSummary(b, index, today).balance },
      ]),
      `purchases-${today}.csv`,
    );

  return (
    <div>
      <PageHeader
        title="Purchase bills"
        subtitle={`${rows.length} bills | eligible ITC ${money(itc)}`}
        actions={
          <>
            <Button onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/purchases/new')}>
              New purchase bill
            </Button>
          </>
        }
      />
      <div className="mb-3">
        <Input className="max-w-xs" placeholder="Search bill no., supplier, GSTIN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<ShoppingCart className="h-10 w-10" />} title="No purchase bills yet" action={<Button variant="primary" onClick={() => navigate('/purchases/new')}>Record a bill</Button>} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Date</th>
                <th>Supplier</th>
                <th className="num">Tax (ITC)</th>
                <th className="num">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const s = purchasePaymentSummary(b, index, today);
                return (
                  <tr key={b.id}>
                    <td>
                      <Link className="font-medium text-brand-700 hover:underline" to={`/purchases/${b.id}`}>
                        {b.billNo}
                      </Link>
                      {b.reverseCharge && <Badge tone="blue" className="ml-1">RCM</Badge>}
                    </td>
                    <td>{fdate(b.billDate)}</td>
                    <td>
                      {b.supplier.name}
                      {b.supplier.gstin && <div className="text-xs text-slate-500">{b.supplier.gstin}</div>}
                    </td>
                    <td className="num">
                      {money(b.totals.tax, b.currency)}
                      {b.itcCategory === 'INELIGIBLE' && <div className="text-xs text-red-600">not eligible</div>}
                    </td>
                    <td className="num">{money(b.totals.total, b.currency)}</td>
                    <td>
                      {b.status === 'CANCELLED' ? (
                        <Badge tone="red">Cancelled</Badge>
                      ) : s.status === 'PAID' ? (
                        <Badge tone="green">Paid</Badge>
                      ) : (
                        <Badge tone={s.overdueDays > 0 ? 'red' : 'amber'}>{s.status === 'PARTIAL' ? 'Partly paid' : 'Unpaid'}</Badge>
                      )}
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

function supplyFor(bill: PurchaseBill, businessState: string): SupplyKind {
  if (bill.supplier.address.countryCode && bill.supplier.address.countryCode !== 'IN') return 'INTER_STATE';
  const supplierState = bill.supplier.address.stateCode || stateCodeFromGstin(bill.supplier.gstin) || businessState;
  return determineSupplyKind({
    businessCountry: 'IN',
    businessState: supplierState,
    placeOfSupply: bill.placeOfSupply || businessState,
    partyRegistration: 'REGULAR',
    partyCountry: 'IN',
  });
}

export function PurchaseEditor() {
  const { id } = useParams();
  const biz = useBusiness();
  const parties = useMine('clients');
  const products = useMine('products');
  const godowns = useMine('godowns');
  const allBills = useMine('purchases');
  const index = usePaymentIndex();
  const money = useMoney();
  const navigate = useNavigate();
  const existing = useStore((s) => s.data.purchases.find((b) => b.id === id));
  const indian = biz.countryCode === 'IN';
  const [bill, setBill] = useState<PurchaseBill>(() => existing ?? { ...newPurchase(biz), items: [newLineItem({ gstRate: indian ? 18 : 0 })] });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ocr, setOcr] = useState<{ progress: number } | null>(null);
  const [pay, setPay] = useState(false);
  
  const set = (patch: Partial<PurchaseBill>) => {
    setBill((b) => ({ ...b, ...patch }));
    setDirty(true);
  };
  const computed = useMemo(() => computePurchase({ ...bill, supplyKind: indian ? supplyFor(bill, biz.stateCode) : 'NON_GST' }), [bill, indian, biz.stateCode]);
  const summary = existing ? purchasePaymentSummary(existing, index) : null;
  // Payments and bill-wise voucher lines, as the balance counts them (design F06).
  const settlements = existing ? (index.settlements.get(existing.id) ?? []).filter((s) => s.direction === 'OUT') : [];

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

  const tdsInfo = useMemo(() => {
    if (!bill.tds?.section) return null;
    const section = getSection(bill.tds.section);
    if (!section) return null;
    const fy = fyOf(bill.billDate, biz.fyStartMonth);
    const before = allBills
      .filter((b) => b.id !== bill.id && b.status === 'FINAL' && b.supplierId && b.supplierId === bill.supplierId && b.billDate >= fy.start && b.billDate < bill.billDate)
      .reduce((s, b) => s + b.totals.taxable, 0);
    return applyThreshold(section, computed.totals.taxable, before, bill.billDate);
  }, [bill.tds, bill.billDate, bill.id, bill.supplierId, allBills, computed.totals.taxable, biz.fyStartMonth]);

  const setLine = (i: number, patch: Partial<LineItem>) => {
    setBill((b) => ({ ...b, items: b.items.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
    setDirty(true);
  };

  const chooseSupplier = (pid: string) => {
    const p = parties.find((x) => x.id === pid);
    if (!p) return;
    const sec = p.tdsSection ? getSection(p.tdsSection) : undefined;
    set({ supplierId: p.id, supplier: partySnapshot(p), dueDate: bill.dueDate, tds: sec && !bill.tds ? { section: sec.code, rate: sec.rates[0].rate, base: 0, amount: 0 } : bill.tds });
  };

  const attach = async () => {
    const file = await pickFile('image/*,application/pdf');
    if (!file) return;
    try {
      const url = file.type.startsWith('image/') ? await imageToDataUrl(file, 1400, 0.8) : await readFileDataUrl(file);
      if (url.length > 4_000_000) throw new Error('The file is larger than about 3 MB. Attach a smaller photo or PDF.');
      set({ attachmentDataUrl: url });
      toast.success('Bill attached');
    } catch (e) {
      toast.fromError(e);
    }
  };

  const runOcr = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    setOcr({ progress: 0 });
    try {
      const r = await readBillImage(file, (progress) => setOcr({ progress }));
      const supplierGstin = r.gstins.find((g) => g !== biz.gstin) ?? '';
      const known = supplierGstin ? parties.find((p) => p.gstin === supplierGstin) : undefined;
      setBill((b) => ({
        ...b,
        ...(known ? { supplierId: known.id, supplier: partySnapshot(known) } : supplierGstin ? { supplier: { ...b.supplier, gstin: supplierGstin, address: { ...b.supplier.address, stateCode: stateCodeFromGstin(supplierGstin) } } } : {}),
        billNo: r.billNo || b.billNo,
        billDate: r.date || b.billDate,
        ocrText: r.text.slice(0, 20_000),
        items:
          r.taxable && b.items.length === 1 && !b.items[0].name
            ? [{ ...b.items[0], name: 'As per bill', qty: 1, rate: r.taxable, gstRate: r.total && r.taxable ? (rateOptions(b.billDate).find((x) => Math.abs(r.taxable * (1 + x / 100) - r.total) < 2) ?? b.items[0].gstRate) : b.items[0].gstRate }]
            : b.items,
      }));
      setDirty(true);
      const found = [supplierGstin && `GSTIN ${supplierGstin}`, r.billNo && `bill no. ${r.billNo}`, r.date && `date ${r.date}`, r.total && `total ${r.total}`].filter(Boolean);
      if (found.length) toast.info('Read from the photo', [found.join(', '), 'Please check every field before saving.']);
      else toast.error('Could not read the bill clearly. Try a sharper, straight photo.');
      const image = await imageToDataUrl(file, 1400, 0.8);
      set({ attachmentDataUrl: image });
    } catch (e) {
      toast.fromError(e);
    } finally {
      setOcr(null);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      let b = { ...bill, supplyKind: indian ? supplyFor(bill, biz.stateCode) : ('NON_GST' as const) };
      if (!b.supplierId && b.supplier.name.trim()) {
        const p = await saveParty(newParty(biz.id, { kind: 'SUPPLIER', name: b.supplier.name, gstin: b.supplier.gstin, registration: b.supplier.gstin ? 'REGULAR' : 'UNREGISTERED', billing: { ...b.supplier.address } }));
        b = { ...b, supplierId: p.id, supplier: partySnapshot(p) };
      }
      const saved = await savePurchase(b);
      setDirty(false);
      toast.success(`Bill ${saved.billNo} saved`);
      navigate(`/purchases/${saved.id}`, { replace: true });
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (await confirmDialog({ title: `Delete bill ${existing.billNo}?`, message: 'Stock and ITC from this bill are removed. It moves to the Trash bin for 30 days.', danger: true, confirmLabel: 'Delete' })) {
      if (await attempt(() => deletePurchase(existing), 'Moved to Trash')) navigate('/purchases');
    }
  };

  const supplierOptions = parties.filter((p) => p.kind !== 'CUSTOMER').map((p) => ({ value: p.id, label: p.name, hint: [p.gstin, p.billing.city].filter(Boolean).join(' | ') }));
  const productOptions = products.map((p) => ({ value: p.id, label: p.name, hint: [p.sku, p.hsn && `HSN ${p.hsn}`, `cost ${money(p.purchasePrice)}`].filter(Boolean).join(' | '), keywords: `${p.sku} ${p.barcode}` }));
  const g = bill.supplier.gstin ? validateGstin(bill.supplier.gstin) : null;
  const decimals = currencyDecimals(bill.currency);

  return (
    <div className="max-w-6xl">
      <PageHeader
        back="/purchases"
        title={existing ? `Bill ${existing.billNo}` : 'New purchase bill'}
        subtitle={indian ? supplyKindLabel(computed.supplyKind) : undefined}
        actions={
          <>
            <Button icon={<ScanText className="h-4 w-4" />} busy={!!ocr} onClick={() => void runOcr()}>
              {ocr ? `Reading ${Math.round(ocr.progress * 100)}%` : 'Read from photo'}
            </Button>
            {existing && (
              <Button variant="ghost" aria-label="Delete" onClick={() => void remove()}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
            {existing && summary && summary.balance > 0 && (
              <Button icon={<Receipt className="h-4 w-4" />} onClick={() => setPay(true)}>
                Record payment
              </Button>
            )}
            <Button variant="primary" busy={busy} onClick={() => void submit()}>
              Save bill
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <Card title="Supplier & bill" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier" className="sm:col-span-2">
            <Combobox
              value={bill.supplierId}
              displayValue={bill.supplier.name}
              options={supplierOptions}
              placeholder="Search supplier or type a new name"
              createLabel="New supplier"
              onValue={chooseSupplier}
              onCreate={(name) => set({ supplierId: '', supplier: { ...bill.supplier, name } })}
            />
          </Field>
          {indian && (
            <Field label="Supplier GSTIN" error={g && !g.valid ? g.errors[0] : undefined}>
              <TextInput
                value={bill.supplier.gstin}
                maxLength={15}
                onValue={(v) => {
                  const gstin = v.toUpperCase().replace(/\s/g, '');
                  set({ supplier: { ...bill.supplier, gstin, address: { ...bill.supplier.address, stateCode: validateGstin(gstin).valid ? stateCodeFromGstin(gstin) : bill.supplier.address.stateCode } } });
                }}
              />
            </Field>
          )}
          {indian && (
            <Field label="Supplier state">
              <Select
                value={bill.supplier.address.stateCode}
                placeholder="Select"
                onValue={(v) => set({ supplier: { ...bill.supplier, address: { ...bill.supplier.address, stateCode: v } } })}
                options={SELECTABLE_STATES.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` }))}
              />
            </Field>
          )}
          <Field label="Supplier's bill no.">
            <TextInput value={bill.billNo} onValue={(v) => set({ billNo: v })} />
          </Field>
          <Field label="Bill date">
            <Input type="date" value={bill.billDate} onChange={(e) => set({ billDate: e.target.value })} />
          </Field>
          <Field label="Goods received on">
            <Input type="date" value={bill.receivedDate} onChange={(e) => set({ receivedDate: e.target.value })} />
          </Field>
          <Field label="Payment due by">
            <Input type="date" value={bill.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
          </Field>
          {indian && (
            <>
              <Field label="ITC type" className="sm:col-span-2">
                <Select value={bill.itcCategory} onValue={(v) => set({ itcCategory: v, reverseCharge: v === 'IMPORT_SERVICES' ? true : bill.reverseCharge })} options={ITC} />
              </Field>
              <Checkbox className="self-end" checked={bill.reverseCharge} onValue={(v) => set({ reverseCharge: v })} label="Reverse charge (you pay the GST)" />
              <Checkbox className="self-end" checked={bill.pricesIncludeTax} onValue={(v) => set({ pricesIncludeTax: v })} label="Rates include GST" />
            </>
          )}
        </Card>

        <Card title="Items" bodyClassName="space-y-2 p-3">
          {bill.items.map((l, i) => {
            const c = computed.items[i];
            return (
              <div key={l.id} className="grid grid-cols-12 gap-2 rounded-md border border-slate-200 p-2">
                <div className="col-span-12 md:col-span-4">
                  <Combobox
                    ariaLabel={`Item ${i + 1}`}
                    value={l.productId}
                    displayValue={l.name}
                    options={productOptions}
                    placeholder="Search product or type"
                    createLabel="Add item"
                    onValue={(pid) => {
                      const p = products.find((x) => x.id === pid);
                      if (p) setBill((b) => ({ ...b, items: b.items.map((x, j) => (j === i ? { ...lineFromProduct(p, true), id: x.id, qty: x.qty || 1 } : x)) }));
                    }}
                    onCreate={(name) => setLine(i, { name, productId: '' })}
                  />
                </div>
                <div className="col-span-4 md:col-span-1">
                  <Input aria-label="HSN" placeholder="HSN" value={l.hsn} onChange={(e) => setLine(i, { hsn: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
                </div>
                <div className="col-span-4 md:col-span-1">
                  <NumberInput aria-label="Quantity" value={l.qty} onValue={(n) => setLine(i, { qty: n })} />
                </div>
                <div className="col-span-4 md:col-span-1">
                  <UnitSelect ariaLabel="Unit" value={l.unit} onValue={(v) => setLine(i, { unit: v })} />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <NumberInput aria-label="Rate" value={l.rate} onValue={(n) => setLine(i, { rate: n })} />
                </div>
                <div className="col-span-4 md:col-span-1">
                  {indian ? (
                    <Select aria-label="GST" value={String(l.gstRate)} onValue={(v) => setLine(i, { gstRate: Number(v) })} options={[...new Set([...rateOptions(bill.billDate), l.gstRate])].sort((a, b) => a - b).map((r) => ({ value: String(r), label: `${r}%` }))} />
                  ) : (
                    <NumberInput aria-label="Tax %" value={l.gstRate} onValue={(n) => setLine(i, { gstRate: n })} />
                  )}
                </div>
                <div className="col-span-4 flex items-center justify-end gap-1 md:col-span-2">
                  <span className="text-sm font-semibold tabular-nums">{money(c?.total ?? 0, bill.currency)}</span>
                  <Button size="sm" variant="ghost" aria-label="Remove" disabled={bill.items.length === 1} onClick={() => setBill((b) => ({ ...b, items: b.items.filter((_, j) => j !== i) }))}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
                {(biz.features.batches || biz.features.godowns) && l.productId && (
                  <div className="col-span-12 grid grid-cols-2 gap-2">
                    {biz.features.batches && <Input aria-label="Batch" placeholder="Batch no." value={l.batchNo} onChange={(e) => setLine(i, { batchNo: e.target.value })} />}
                    {biz.features.godowns && (
                      <Select aria-label="Godown" value={l.godownId} placeholder="Default godown" onValue={(v) => setLine(i, { godownId: v })} options={godowns.map((gd) => ({ value: gd.id, label: gd.name }))} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setBill((b) => ({ ...b, items: [...b.items, newLineItem({ gstRate: indian ? 18 : 0 })] }))}>
            Add item
          </Button>
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Taxable</span>
              <span>{money(computed.totals.taxable, bill.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">GST {bill.reverseCharge ? '(payable by you)' : ''}</span>
              <span>{money(computed.totals.tax, bill.currency)}</span>
            </div>
            {computed.totals.roundOff !== 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Round off</span>
                <span>{money(computed.totals.roundOff, bill.currency)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Bill total</span>
              <span>{money(computed.totals.total, bill.currency)}</span>
            </div>
            {(computed.totals.tds > 0 || computed.totals.tcs > 0) && (
              <div className="flex justify-between font-medium">
                <span>Payable to supplier</span>
                <span>{money(computed.totals.net, bill.currency)}</span>
              </div>
            )}
          </div>
        </Card>

        {indian && (
          <Card title="TDS / TCS" bodyClassName="grid gap-3 p-4 sm:grid-cols-3">
            <Field label="TDS you deduct" hint={tdsInfo ? (tdsInfo.applicable ? `Applies on ${money(tdsInfo.base)}. ${tdsInfo.reason}` : tdsInfo.reason) : undefined}>
              <div className="flex gap-2">
                <Select
                  value={bill.tds?.section ?? ''}
                  placeholder="None"
                  onValue={(v) => {
                    const s = getSection(v);
                    set({ tds: s ? { section: s.code, rate: s.rates[0].rate, base: 0, amount: 0 } : null });
                  }}
                  options={sectionsFor('TDS', bill.billDate).map((s) => ({ value: s.code, label: `${s.code} - ${s.title}` }))}
                />
                {bill.tds && <NumberInput className="w-20" aria-label="TDS rate" value={bill.tds.rate} onValue={(n) => set({ tds: { ...bill.tds!, rate: n } })} />}
              </div>
            </Field>
            <Field label="TCS charged by the supplier" hint="Claimed against your income tax">
              <NumberInput value={bill.totals.tcs} emptyZero onValue={(n) => set({ totals: { ...bill.totals, tcs: roundTo(Math.max(0, n), decimals) } })} />
            </Field>
          </Card>
        )}

        <Card title="Attachment & notes" bodyClassName="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<Paperclip className="h-4 w-4" />} onClick={() => void attach()}>
              {bill.attachmentDataUrl ? 'Replace attachment' : 'Attach bill photo / PDF'}
            </Button>
            {bill.attachmentDataUrl && (
              <>
                <a className="text-sm text-brand-700 hover:underline" href={bill.attachmentDataUrl} target="_blank" rel="noreferrer">
                  View attachment
                </a>
                <Button size="sm" variant="ghost" onClick={() => set({ attachmentDataUrl: '' })}>
                  Remove
                </Button>
              </>
            )}
          </div>
          {bill.attachmentDataUrl.startsWith('data:image') && <img src={bill.attachmentDataUrl} alt="Bill" className="max-h-64 rounded border" />}
          <Field label="Notes">
            <Textarea rows={2} value={bill.notes} onValue={(v) => set({ notes: v })} />
          </Field>
          {bill.ocrText && (
            <details>
              <summary className="cursor-pointer text-xs text-slate-500">Text read from the photo</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{bill.ocrText}</pre>
            </details>
          )}
        </Card>

        {existing && summary && (
          <Card title={`Payments | balance ${money(summary.balance, existing.currency)}`}>
            {settlements.length === 0 ? (
              <p className="text-sm text-slate-500">No payments recorded.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {settlements.map((s, i) => {
                  if (s.source.kind === 'VOUCHER') {
                    const v = s.source.voucher;
                    return (
                      <li key={`${v.id}-${i}`} className="py-2">
                        {fdate(v.date)} |{' '}
                        <Link className="text-brand-700 hover:underline" to={`/accounts/vouchers/${v.id}`}>
                          {v.number}
                        </Link>{' '}
                        | {v.type.toLowerCase()} voucher | <b>{money(s.amount, existing.currency)}</b>
                      </li>
                    );
                  }
                  const p = s.source.payment;
                  return (
                    <li key={p.id} className="flex items-center gap-2 py-2">
                      <span className="flex-1">
                        {fdate(p.date)} | {p.number} | {p.mode} | <b>{money(s.amount, existing.currency)}</b>
                      </span>
                      <Button size="sm" variant="ghost" aria-label="Print" onClick={() => void printReceipt(p)}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete"
                        onClick={async () => {
                          if (await confirmDialog({ title: `Delete payment ${p.number}?`, danger: true, confirmLabel: 'Delete' })) await attempt(() => deletePayment(p), 'Deleted');
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
        {bill.itcCategory === 'INELIGIBLE' && <Alert tone="amber">GST on this bill is added to its cost; no input tax credit is taken.</Alert>}
      </div>
      {pay && existing && <PaymentDialog open onClose={() => setPay(false)} direction="OUT" bill={existing} />}
    </div>
  );
}
