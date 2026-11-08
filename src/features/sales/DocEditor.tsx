import { Eye, Plus, Save, ScanLine, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { CURRENCIES } from '../../core/currency/countries';
import { addDays, fyOf } from '../../core/dates';
import { DOC_TYPES, DOC_TYPE_LIST } from '../../core/docs/docTypes';
import { previewNumber } from '../../core/docs/numbering';
import { nextRecurringDate } from '../../core/docs/recurring';
import { validateSalesDocument } from '../../core/docs/validate';
import { lineFromProduct, newLineItem, newParty, newSalesDocument, partySnapshot } from '../../core/factories';
import { stateCodeFromGstin, validateGstin } from '../../core/gst/gstin';
import { rateOptions } from '../../core/gst/rates';
import { FOREIGN_POS, SELECTABLE_STATES } from '../../core/gst/states';
import { defaultPlaceOfSupply, determineSupplyKind, supplyKindLabel } from '../../core/gst/supply';
import type { Business, CreditNoteReason, DocType, LineItem, Party, Product, RecurringFrequency, SalesDocument } from '../../core/model';
import { roundTo } from '../../core/money';
import { getSection, sectionsFor, tcs206C1H } from '../../core/tds';
import { InvoiceDocument } from '../../print/InvoiceDocument';
import { ScaledPreview } from '../../print/printing';
import { buildInvoiceView } from '../../print/view';
import { computeSales, saveParty, saveSalesDocument } from '../../store/actions';
import { autoUploadPdf } from '../settings/DataSettings';
import { useBusiness, useMine, useStock } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Combobox } from '../../ui/Combobox';
import type { ComboOption } from '../../ui/Combobox';
import { attempt, toast } from '../../ui/feedback';
import { Alert, Button, Card, Checkbox, Field, Input, NumberInput, PageHeader, Select, Textarea, TextInput, cx } from '../../ui/kit';
import { useMoney } from '../../ui/money';
import { UnitSelect } from '../settings/UnitSelect';

const REGISTRATIONS = [
  { value: 'REGULAR', label: 'Registered (regular)' },
  { value: 'COMPOSITION', label: 'Registered (composition)' },
  { value: 'UNREGISTERED', label: 'Unregistered business' },
  { value: 'CONSUMER', label: 'Consumer' },
  { value: 'SEZ', label: 'SEZ unit / developer' },
  { value: 'OVERSEAS', label: 'Overseas' },
  { value: 'UIN', label: 'UN body / embassy (UIN)' },
] as const;

const CN_REASONS: { value: CreditNoteReason; label: string }[] = [
  { value: 'SALES_RETURN', label: 'Sales return' },
  { value: 'POST_SALE_DISCOUNT', label: 'Post-sale discount' },
  { value: 'DEFICIENCY', label: 'Deficiency in service' },
  { value: 'CORRECTION', label: 'Correction in invoice' },
  { value: 'OTHER', label: 'Other' },
];

const STATE_OPTIONS = [
  ...SELECTABLE_STATES.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` })),
  { value: FOREIGN_POS, label: '96 - Other country (export)' },
];

function withSupply(doc: SalesDocument, biz: Business): SalesDocument {
  const kind = determineSupplyKind({
    businessCountry: biz.countryCode,
    businessState: biz.stateCode,
    placeOfSupply: doc.placeOfSupply,
    partyRegistration: doc.party.registration,
    partyCountry: doc.party.address.countryCode,
  });
  return { ...doc, supplyKind: kind };
}

/** Rate for the document's price mode from a product's selling price. */
function productRate(p: Product, docIncludesTax: boolean): number {
  if (p.priceIncludesTax === docIncludesTax) return p.sellingPrice;
  const f = 1 + (p.gstRate + p.cessRate) / 100;
  return roundTo(p.priceIncludesTax ? p.sellingPrice / f : p.sellingPrice * f, 2);
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card title={title} actions={aside} bodyClassName="space-y-3 p-3">
      {children}
    </Card>
  );
}

export function DocEditor() {
  const biz = useBusiness();
  const parties = useMine('clients');
  const products = useMine('products');
  const invoices = useMine('invoices');
  const godowns = useMine('godowns');
  const stock = useStock();
  const money = useMoney();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [params] = useSearchParams();
  const allInvoices = useStore((s) => s.data.invoices);

  const initial = useMemo<SalesDocument>(() => {
    const fromState = (location.state as { draft?: SalesDocument } | null)?.draft;
    if (fromState) return fromState;
    if (id) {
      const existing = allInvoices.find((d) => d.id === id);
      if (existing) return existing;
    }
    const type = (params.get('type') as DocType) || 'TAX_INVOICE';
    const docType: DocType = DOC_TYPE_LIST.includes(type) ? type : 'TAX_INVOICE';
    const fallback = biz.countryCode === 'IN' && biz.gstRegistration !== 'REGULAR' && docType === 'TAX_INVOICE' ? 'BILL_OF_SUPPLY' : docType;
    const doc: SalesDocument = { ...newSalesDocument(biz, fallback), items: [newLineItem({ gstRate: biz.countryCode === 'IN' ? 18 : 0 })] };
    const presetParty = parties.find((p) => p.id === (location.state as { partyId?: string } | null)?.partyId);
    if (!presetParty) return doc;
    const pos = defaultPlaceOfSupply(biz.stateCode, {
      gstin: presetParty.gstin,
      stateCode: presetParty.billing.stateCode,
      countryCode: presetParty.billing.countryCode,
      registration: presetParty.registration,
    });
    return withSupply(
      {
        ...doc,
        partyId: presetParty.id,
        party: partySnapshot(presetParty),
        placeOfSupply: pos || doc.placeOfSupply,
        dueDate: DOC_TYPES[fallback].payable ? addDays(doc.date, presetParty.creditDays || 15) : '',
      },
      biz,
    );
    // The initial document is chosen once per screen visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [doc, setDoc] = useState<SalesDocument>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [scan, setScan] = useState('');
  const isNew = !allInvoices.some((d) => d.id === doc.id);
  const meta = DOC_TYPES[doc.docType];
  const indian = biz.countryCode === 'IN';

  const update = useCallback((patch: Partial<SalesDocument> | ((d: SalesDocument) => SalesDocument)) => {
    setDoc((d) => (typeof patch === 'function' ? patch(d) : { ...d, ...patch }));
    setDirty(true);
  }, []);

  const computed = useMemo(() => computeSales(doc), [doc]);
  const view = useMemo(() => buildInvoiceView(computed, biz), [computed, biz]);
  const issues = useMemo(() => validateSalesDocument(computed, biz, true), [computed, biz]);
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

  const save = useCallback(
    async (finalize: boolean) => {
      setBusy(true);
      try {
        const wasFinal = allInvoices.find((d) => d.id === doc.id)?.status === 'FINAL';
        const saved = await saveSalesDocument(doc, finalize || doc.status === 'FINAL');
        setDirty(false);
        toast.success(saved.status === 'FINAL' ? `${meta.shortLabel} ${saved.number} saved` : 'Draft saved');
        navigate(`/sales/${saved.id}`, { replace: true });
        if (saved.status === 'FINAL' && !wasFinal) void autoUploadPdf(saved);
      } catch (e) {
        toast.fromError(e);
      } finally {
        setBusy(false);
      }
    },
    [doc, meta.shortLabel, navigate, allInvoices],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!busy) void save(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, busy]);

  // ---------------------------------------------------------------- party

  const partyOptions = useMemo<ComboOption[]>(
    () =>
      parties
        .filter((p) => p.kind !== 'SUPPLIER' || doc.docType === 'DEBIT_NOTE')
        .map((p) => ({ value: p.id, label: p.name, hint: [p.gstin, p.billing.city, p.phone].filter(Boolean).join(' | '), keywords: `${p.gstin} ${p.phone}` })),
    [parties, doc.docType],
  );

  const choosePartyRecord = (p: Party) =>
    update((d) => {
      const pos = defaultPlaceOfSupply(biz.stateCode, { gstin: p.gstin, stateCode: p.billing.stateCode, countryCode: p.billing.countryCode, registration: p.registration });
      const next: SalesDocument = {
        ...d,
        partyId: p.id,
        party: partySnapshot(p),
        shipTo: p.shipping ? { name: p.name, gstin: p.gstin, address: { ...p.shipping } } : null,
        placeOfSupply: pos || d.placeOfSupply,
        dueDate: meta.payable ? addDays(d.date, p.creditDays || 15) : '',
      };
      return withSupply(next, biz);
    });

  const setSnapshot = (patch: Partial<SalesDocument['party']>) =>
    update((d) => {
      const party = { ...d.party, ...patch, address: { ...d.party.address, ...(patch.address ?? {}) } };
      let next: SalesDocument = { ...d, party };
      if (patch.gstin !== undefined) {
        const g = validateGstin(patch.gstin);
        if (g.valid) {
          const st = stateCodeFromGstin(patch.gstin);
          next = {
            ...next,
            party: { ...party, gstin: g.normalized, pan: g.pan, registration: ['UNREGISTERED', 'CONSUMER'].includes(party.registration) ? 'REGULAR' : party.registration, address: { ...party.address, stateCode: st } },
            placeOfSupply: st,
          };
        }
      }
      if (patch.address?.stateCode !== undefined && patch.address.stateCode) next = { ...next, placeOfSupply: patch.address.stateCode };
      if (patch.address?.countryCode !== undefined) {
        next = { ...next, placeOfSupply: patch.address.countryCode === 'IN' ? next.party.address.stateCode || biz.stateCode : FOREIGN_POS };
      }
      return withSupply(next, biz);
    });

  const saveSnapshotAsParty = () =>
    attempt(async () => {
      const p = await saveParty(
        newParty(biz.id, {
          name: doc.party.name,
          gstin: doc.party.gstin,
          pan: doc.party.pan,
          registration: doc.party.registration,
          billing: { ...doc.party.address },
          phone: doc.party.phone,
          email: doc.party.email,
        }),
      );
      update({ partyId: p.id });
    }, 'Saved to parties');

  // ---------------------------------------------------------------- items

  const productOptions = useMemo<ComboOption[]>(
    () =>
      products.map((p) => ({
        value: p.id,
        label: p.name,
        hint: [p.sku, p.hsn && `HSN ${p.hsn}`, money(p.sellingPrice), p.kind === 'GOODS' && p.trackStock ? `stock ${stock.get(p.id) ?? 0}` : ''].filter(Boolean).join(' | '),
        keywords: `${p.sku} ${p.barcode} ${p.hsn} ${p.category}`,
      })),
    [products, money, stock],
  );

  const setLine = (i: number, patch: Partial<LineItem>) => update((d) => ({ ...d, items: d.items.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const pickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    update((d) => ({
      ...d,
      items: d.items.map((l, j) => (j === i ? { ...lineFromProduct(p), id: l.id, qty: l.qty || 1, rate: productRate(p, d.pricesIncludeTax) } : l)),
    }));
  };
  const addLine = () => update((d) => ({ ...d, items: [...d.items, newLineItem({ gstRate: indian ? 18 : 0, unit: 'NOS' })] }));
  const removeLine = (i: number) => update((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
  const quickAdd = () => {
    const code = scan.trim().toLowerCase();
    if (!code) return;
    const p = products.find((x) => x.barcode.toLowerCase() === code || x.sku.toLowerCase() === code);
    if (!p) {
      toast.error(`No product with barcode or SKU "${scan}"`);
      return;
    }
    update((d) => {
      const at = d.items.findIndex((l) => l.productId === p.id);
      const items = at >= 0 ? d.items.map((l, j) => (j === at ? { ...l, qty: l.qty + 1 } : l)) : [...d.items.filter((l) => l.name || l.productId), { ...lineFromProduct(p), rate: productRate(p, d.pricesIncludeTax) }];
      return { ...d, items };
    });
    setScan('');
  };

  const rates = rateOptions(doc.date);
  const rateList = (current: number) => [...new Set([...rates, current])].sort((a, b) => a - b).map((r) => ({ value: String(r), label: `${r}%` }));

  // ---------------------------------------------------------------- TDS / TCS

  const tdsSections = sectionsFor('TDS', doc.date);
  const tcsSections = sectionsFor('TCS', doc.date);
  const buyerFyBefore = useMemo(() => {
    if (!doc.partyId) return 0;
    const fy = fyOf(doc.date, biz.fyStartMonth);
    return invoices
      .filter((d) => d.id !== doc.id && d.partyId === doc.partyId && d.status === 'FINAL' && DOC_TYPES[d.docType].payable && d.date >= fy.start && d.date < doc.date)
      .reduce((s, d) => s + d.totals.total, 0);
  }, [invoices, doc.partyId, doc.date, doc.id, biz.fyStartMonth]);
  const tcs1h = doc.tcs?.section === '206C(1H)' ? tcs206C1H(doc.date, computed.totals.total, buyerFyBefore, biz.turnoverAbove10Cr) : null;
  useEffect(() => {
    if (!tcs1h) return;
    if (doc.tcs && Math.abs((doc.tcs.base || 0) - tcs1h.base) > 0.004) setDoc((d) => (d.tcs ? { ...d, tcs: { ...d.tcs, base: tcs1h.base } } : d));
  }, [tcs1h, doc.tcs]);

  const original = doc.refDocId ? allInvoices.find((d) => d.id === doc.refDocId) : undefined;
  const refChoices = useMemo(
    () =>
      invoices
        .filter((d) => d.status === 'FINAL' && (d.docType === 'TAX_INVOICE' || d.docType === 'BILL_OF_SUPPLY') && (!doc.partyId || d.partyId === doc.partyId))
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 200)
        .map((d) => ({ value: d.id, label: `${d.number} | ${d.date} | ${d.party.name}` })),
    [invoices, doc.partyId],
  );

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const stockWarnings = meta.stock === 'OUT' && biz.features.inventory && doc.stockApplied
    ? computed.items.filter((l) => {
        const p = products.find((x) => x.id === l.productId);
        if (!p || p.kind !== 'GOODS' || !p.trackStock) return false;
        const already = allInvoices.find((d) => d.id === doc.id)?.status === 'FINAL' ? (allInvoices.find((d) => d.id === doc.id)?.items.find((x) => x.productId === p.id)?.qty ?? 0) : 0;
        return l.qty > (stock.get(p.id) ?? 0) + already;
      })
    : [];

  const exportish = doc.supplyKind === 'EXPORT' || doc.supplyKind === 'SEZ';
  const showCurrency = biz.features.multiCurrency || doc.currency !== biz.currency;
  const title = `${isNew ? 'New' : 'Edit'} ${meta.label}${doc.number ? ` ${doc.number}` : ''}`;

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={indian ? supplyKindLabel(doc.supplyKind, doc.exportWithTax) : undefined}
        back
        actions={
          <>
            <Button className="xl:hidden" icon={<Eye className="h-4 w-4" />} onClick={() => setShowPreview((s) => !s)}>
              {showPreview ? 'Hide preview' : 'Preview'}
            </Button>
            {doc.status !== 'FINAL' && (
              <Button icon={<Save className="h-4 w-4" />} busy={busy} onClick={() => void save(false)} title="Ctrl+S">
                Save draft
              </Button>
            )}
            <Button variant="primary" busy={busy} onClick={() => void save(true)}>
              {doc.status === 'FINAL' ? 'Save changes' : 'Finalize'}
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <Section title="Document">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Type">
                <Select<DocType>
                  value={doc.docType}
                  disabled={!isNew || !!doc.refDocId}
                  onValue={(t) => update((d) => ({ ...d, docType: t, dueDate: DOC_TYPES[t].payable ? d.dueDate || addDays(d.date, 15) : '', stockApplied: DOC_TYPES[t].stock !== 'NONE' }))}
                  options={DOC_TYPE_LIST.map((t) => ({ value: t, label: DOC_TYPES[t].label }))}
                />
              </Field>
              <Field label="Number" hint={doc.number ? 'Max 16 characters' : 'Given automatically when you finalize'}>
                <TextInput
                  value={doc.number}
                  placeholder={previewNumber(biz.series[doc.docType], doc.date, biz.fyStartMonth)}
                  onValue={(v) => update({ number: v.toUpperCase().replace(/\s/g, '') })}
                  maxLength={16}
                  invalid={issues.some((i) => i.field === 'number' && i.level === 'error' && doc.number !== '')}
                />
              </Field>
              <Field label="Date">
                <Input type="date" value={doc.date} onChange={(e) => update({ date: e.target.value })} />
              </Field>
              {meta.payable && (
                <Field label="Due date">
                  <Input type="date" value={doc.dueDate} onChange={(e) => update({ dueDate: e.target.value })} />
                </Field>
              )}
            </div>
            {(doc.docType === 'CREDIT_NOTE' || doc.docType === 'DEBIT_NOTE') && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Against invoice" className="sm:col-span-2">
                  <Select
                    value={doc.refDocId}
                    placeholder={original ? undefined : 'Select the original invoice'}
                    onValue={(v) => {
                      const ref = allInvoices.find((d) => d.id === v);
                      update({ refDocId: v, refDocNumber: ref?.number ?? '', refDocDate: ref?.date ?? '' });
                    }}
                    options={original && !refChoices.some((r) => r.value === original.id) ? [{ value: original.id, label: original.number }, ...refChoices] : refChoices}
                  />
                </Field>
                {doc.docType === 'CREDIT_NOTE' && (
                  <Field label="Reason">
                    <Select<CreditNoteReason | ''>
                      value={doc.creditNoteReason}
                      onValue={(v) => update({ creditNoteReason: v })}
                      options={CN_REASONS}
                      placeholder="Choose"
                    />
                  </Field>
                )}
                {doc.docType === 'CREDIT_NOTE' && (
                  <Checkbox checked={doc.stockApplied} onValue={(v) => update({ stockApplied: v })} label="Goods returned (add back to stock)" />
                )}
              </div>
            )}
          </Section>

          <Section
            title={doc.docType === 'DEBIT_NOTE' ? 'Party' : 'Customer'}
            aside={
              !doc.partyId && doc.party.name ? (
                <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => void saveSnapshotAsParty()}>
                  Save to parties
                </Button>
              ) : null
            }
          >
            <Combobox
              ariaLabel="Customer"
              value={doc.partyId}
              displayValue={doc.party.name}
              options={partyOptions}
              placeholder="Search customer by name, GSTIN or phone; or type a new name"
              createLabel="Bill to"
              onValue={(v) => {
                const p = parties.find((x) => x.id === v);
                if (p) choosePartyRecord(p);
              }}
              onCreate={(name) => update((d) => withSupply({ ...d, partyId: '', party: { ...d.party, name } }, biz))}
              invalid={!doc.party.name && issues.some((i) => i.field === 'party')}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Name">
                <TextInput value={doc.party.name} onValue={(v) => setSnapshot({ name: v })} />
              </Field>
              {indian && (
                <Field label="GSTIN / UIN" error={doc.party.gstin && !validateGstin(doc.party.gstin).valid ? validateGstin(doc.party.gstin).errors[0] : undefined}>
                  <TextInput value={doc.party.gstin} maxLength={15} onValue={(v) => setSnapshot({ gstin: v.toUpperCase().replace(/\s/g, '') })} placeholder="15 characters" />
                </Field>
              )}
              {indian && (
                <Field label="Registration">
                  <Select value={doc.party.registration} onValue={(v) => setSnapshot({ registration: v })} options={REGISTRATIONS} />
                </Field>
              )}
              <Field label="Address" className="sm:col-span-2">
                <TextInput value={doc.party.address.line1} onValue={(v) => setSnapshot({ address: { ...doc.party.address, line1: v } })} />
              </Field>
              <Field label="City">
                <TextInput value={doc.party.address.city} onValue={(v) => setSnapshot({ address: { ...doc.party.address, city: v } })} />
              </Field>
              <Field label="PIN code">
                <TextInput value={doc.party.address.pincode} onValue={(v) => setSnapshot({ address: { ...doc.party.address, pincode: v } })} />
              </Field>
              {indian && (
                <Field label="Country">
                  <Select
                    value={doc.party.address.countryCode === 'IN' ? 'IN' : 'XX'}
                    onValue={(v) => setSnapshot({ address: { ...doc.party.address, countryCode: v === 'IN' ? 'IN' : 'ZZ', stateCode: v === 'IN' ? doc.party.address.stateCode : FOREIGN_POS } })}
                    options={[
                      { value: 'IN', label: 'India' },
                      { value: 'XX', label: 'Outside India' },
                    ]}
                  />
                </Field>
              )}
              {indian && doc.party.address.countryCode === 'IN' && (
                <Field label="State">
                  <Select value={doc.party.address.stateCode} placeholder="Select state" onValue={(v) => setSnapshot({ address: { ...doc.party.address, stateCode: v } })} options={STATE_OPTIONS.filter((s) => s.value !== FOREIGN_POS)} />
                </Field>
              )}
              <Field label="Phone">
                <TextInput value={doc.party.phone} onValue={(v) => setSnapshot({ phone: v })} />
              </Field>
              <Field label="E-mail">
                <TextInput type="email" value={doc.party.email} onValue={(v) => setSnapshot({ email: v })} />
              </Field>
            </div>
            <Checkbox
              checked={!!doc.shipTo}
              onValue={(v) => update({ shipTo: v ? { name: doc.party.name, gstin: doc.party.gstin, address: { ...doc.party.address } } : null })}
              label="Ship to a different address"
            />
            {doc.shipTo && (
              <div className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Consignee name">
                  <TextInput value={doc.shipTo.name} onValue={(v) => update({ shipTo: { ...doc.shipTo!, name: v } })} />
                </Field>
                {indian && (
                  <Field label="Consignee GSTIN">
                    <TextInput value={doc.shipTo.gstin} maxLength={15} onValue={(v) => update({ shipTo: { ...doc.shipTo!, gstin: v.toUpperCase() } })} />
                  </Field>
                )}
                <Field label="Address">
                  <TextInput value={doc.shipTo.address.line1} onValue={(v) => update({ shipTo: { ...doc.shipTo!, address: { ...doc.shipTo!.address, line1: v } } })} />
                </Field>
                <Field label="City">
                  <TextInput value={doc.shipTo.address.city} onValue={(v) => update({ shipTo: { ...doc.shipTo!, address: { ...doc.shipTo!.address, city: v } } })} />
                </Field>
                <Field label="PIN code">
                  <TextInput value={doc.shipTo.address.pincode} onValue={(v) => update({ shipTo: { ...doc.shipTo!, address: { ...doc.shipTo!.address, pincode: v } } })} />
                </Field>
                {indian && (
                  <Field label="State">
                    <Select value={doc.shipTo.address.stateCode} placeholder="Select" onValue={(v) => update({ shipTo: { ...doc.shipTo!, address: { ...doc.shipTo!.address, stateCode: v } } })} options={STATE_OPTIONS} />
                  </Field>
                )}
              </div>
            )}
          </Section>

          {indian && (
            <Section title="Tax and supply">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Place of supply" hint={supplyKindLabel(doc.supplyKind, doc.exportWithTax)}>
                  <Select value={doc.placeOfSupply} placeholder="Select" onValue={(v) => update((d) => withSupply({ ...d, placeOfSupply: v }, biz))} options={STATE_OPTIONS} />
                </Field>
                {exportish && (
                  <Field label="Export / SEZ">
                    <Select
                      value={doc.exportWithTax ? 'WPAY' : 'WOPAY'}
                      onValue={(v) => update({ exportWithTax: v === 'WPAY' })}
                      options={[
                        { value: 'WOPAY', label: 'Without IGST (under LUT / bond)' },
                        { value: 'WPAY', label: 'With payment of IGST' },
                      ]}
                    />
                  </Field>
                )}
                {exportish && !doc.exportWithTax && (
                  <Field label="LUT / bond reference">
                    <TextInput value={doc.lutNumber} onValue={(v) => update({ lutNumber: v })} />
                  </Field>
                )}
                {meta.inGstr1 && meta.chargesTax && (
                  <Field
                    label="Sold through an e-commerce operator"
                    hint="Operator GSTIN (Amazon, Flipkart, Meesho...). Reported in GSTR-1 Table 14; the operator collects TCS u/s 52."
                    error={doc.ecoGstin && !validateGstin(doc.ecoGstin).valid ? 'Not a valid GSTIN' : undefined}
                  >
                    <TextInput value={doc.ecoGstin ?? ''} maxLength={15} onValue={(v) => update({ ecoGstin: v.toUpperCase().replace(/\s+/g, '') })} placeholder="Leave blank for direct sales" />
                  </Field>
                )}
                {doc.supplyKind === 'EXPORT' && (
                  <>
                    <Field label="Port code">
                      <TextInput value={doc.portCode} maxLength={6} onValue={(v) => update({ portCode: v.toUpperCase() })} placeholder="e.g. INNSA1" />
                    </Field>
                    <Field label="Shipping bill no.">
                      <TextInput value={doc.shippingBillNo} onValue={(v) => update({ shippingBillNo: v })} />
                    </Field>
                    <Field label="Shipping bill date">
                      <Input type="date" value={doc.shippingBillDate} onChange={(e) => update({ shippingBillDate: e.target.value })} />
                    </Field>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox checked={doc.reverseCharge} onValue={(v) => update({ reverseCharge: v })} label="Tax payable on reverse charge" />
                <Checkbox checked={doc.pricesIncludeTax} onValue={(v) => update({ pricesIncludeTax: v })} label="Rates include GST" />
                <Checkbox checked={doc.roundOff} onValue={(v) => update({ roundOff: v })} label="Round off the total" />
              </div>
            </Section>
          )}

          {showCurrency && (
            <Section title="Currency">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Invoice currency">
                  <Select
                    value={doc.currency}
                    onValue={(v) => update({ currency: v, exchangeRate: v === biz.currency ? 1 : doc.exchangeRate || 1, roundOff: v === 'INR' ? doc.roundOff : false })}
                    options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
                  />
                </Field>
                {doc.currency !== biz.currency && (
                  <Field label={`Exchange rate (1 ${doc.currency} = ? ${biz.currency})`} hint="Used to report the value in your books and GST returns">
                    <NumberInput value={doc.exchangeRate} onValue={(n) => update({ exchangeRate: n })} />
                  </Field>
                )}
                {!indian && (
                  <Checkbox checked={doc.pricesIncludeTax} onValue={(v) => update({ pricesIncludeTax: v })} label="Rates include tax" className="self-end" />
                )}
              </div>
            </Section>
          )}

          <Section
            title="Items"
            aside={
              biz.features.inventory && (
                <div className="flex items-center gap-1">
                  <ScanLine className="h-4 w-4 text-slate-400" />
                  <Input
                    className="w-48 py-1 text-xs"
                    placeholder="Scan barcode / SKU + Enter"
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        quickAdd();
                      }
                    }}
                    aria-label="Barcode or SKU"
                  />
                </div>
              )
            }
          >
            <div className="space-y-2">
              {doc.items.map((l, i) => {
                const c = computed.items[i];
                return (
                  <div key={l.id} className="rounded-md border border-slate-200 p-2">
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-12 md:col-span-5">
                        <Combobox
                          ariaLabel={`Item ${i + 1}`}
                          value={l.productId}
                          displayValue={l.name}
                          options={productOptions}
                          placeholder="Search product or type an item name"
                          createLabel="Add item"
                          onValue={(v) => pickProduct(i, v)}
                          onCreate={(name) => setLine(i, { name, productId: '' })}
                          invalid={!l.name && issues.some((x) => x.field === `items.${i}.name`)}
                        />
                      </div>
                      <div className="col-span-4 md:col-span-2">
                        <Input aria-label="HSN/SAC" placeholder="HSN/SAC" value={l.hsn} onChange={(e) => setLine(i, { hsn: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
                      </div>
                      <div className="col-span-4 md:col-span-2">
                        <NumberInput aria-label="Quantity" value={l.qty} onValue={(n) => setLine(i, { qty: n })} invalid={!(l.qty > 0)} />
                      </div>
                      <div className="col-span-4 md:col-span-3">
                        <UnitSelect ariaLabel="Unit" value={l.unit} onValue={(v) => setLine(i, { unit: v })} format={(u) => (u.name === u.code ? u.code : `${u.code} (${u.name})`)} />
                      </div>
                      <div className="col-span-12">
                        <Input aria-label="Description" className="py-1 text-xs" placeholder="Description (optional)" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                      </div>
                      <div className="col-span-4 md:col-span-3">
                        <Field label={doc.pricesIncludeTax ? 'Rate (incl. tax)' : 'Rate'}>
                          <NumberInput value={l.rate} onValue={(n) => setLine(i, { rate: n })} />
                        </Field>
                      </div>
                      <div className="col-span-4 md:col-span-2">
                        <Field label="Disc. %">
                          <NumberInput value={l.discountPct} emptyZero onValue={(n) => setLine(i, { discountPct: Math.min(100, Math.max(0, n)) })} />
                        </Field>
                      </div>
                      {meta.chargesTax && (
                        <div className="col-span-4 md:col-span-2">
                          <Field label={indian ? 'GST' : view.taxLabel}>
                            {indian ? (
                              <Select value={String(l.gstRate)} onValue={(v) => setLine(i, { gstRate: Number(v) })} options={rateList(l.gstRate)} />
                            ) : (
                              <NumberInput value={l.gstRate} onValue={(n) => setLine(i, { gstRate: n })} />
                            )}
                          </Field>
                        </div>
                      )}
                      {indian && meta.chargesTax && (
                        <div className="col-span-4 md:col-span-1">
                          <Field label="Cess %">
                            <NumberInput value={l.cessRate} emptyZero onValue={(n) => setLine(i, { cessRate: n })} />
                          </Field>
                        </div>
                      )}
                      <div className={cx('col-span-8 flex items-end justify-end gap-2', meta.chargesTax ? (indian ? 'md:col-span-4' : 'md:col-span-5') : 'md:col-span-7')}>
                        <div className="text-right">
                          <div className="text-[11px] text-slate-500">{doc.pricesIncludeTax || meta.chargesTax ? 'Line total (incl. GST)' : 'Amount'}</div>
                          <div className="font-semibold tabular-nums">{money(c?.total ?? 0, doc.currency)}</div>
                        </div>
                        <Button size="sm" variant="ghost" aria-label={`Remove item ${i + 1}`} onClick={() => removeLine(i)} disabled={doc.items.length === 1}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                      {(biz.features.godowns || biz.features.batches) && l.productId && (
                        <div className="col-span-12 grid grid-cols-2 gap-2">
                          {biz.features.godowns && (
                            <Select aria-label="Godown" value={l.godownId} placeholder="Default godown" onValue={(v) => setLine(i, { godownId: v })} options={godowns.map((g) => ({ value: g.id, label: g.name }))} />
                          )}
                          {biz.features.batches && <Input aria-label="Batch" placeholder="Batch no." value={l.batchNo} onChange={(e) => setLine(i, { batchNo: e.target.value })} />}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button icon={<Plus className="h-4 w-4" />} onClick={addLine}>
              Add item
            </Button>
            {stockWarnings.length > 0 && (
              <Alert tone="amber" title="Not enough stock">
                {stockWarnings.map((l) => `${l.name}: ${stock.get(l.productId) ?? 0} in stock`).join('; ')}. You can still save; stock will go negative.
              </Alert>
            )}
            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Taxable</span>
                <span className="tabular-nums">{money(computed.totals.taxable, doc.currency)}</span>
              </div>
              {view.taxLines.map((t) => (
                <div key={`${t.label}${t.rate}`} className="flex justify-between">
                  <span className="text-slate-500">
                    {t.label} {t.rate}%
                  </span>
                  <span className="tabular-nums">{money(t.amount, doc.currency)}</span>
                </div>
              ))}
              {computed.totals.roundOff !== 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Round off</span>
                  <span className="tabular-nums">{money(computed.totals.roundOff, doc.currency)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(computed.totals.total, doc.currency)}</span>
              </div>
              {(computed.totals.tcs > 0 || computed.totals.tds > 0) && (
                <div className="flex justify-between font-medium">
                  <span>Net receivable</span>
                  <span className="tabular-nums">{money(computed.totals.net, doc.currency)}</span>
                </div>
              )}
            </div>
          </Section>

          {indian && biz.features.tdsTcs && meta.payable && (
            <Section title="TDS / TCS">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="TDS deducted by the customer">
                  <div className="flex gap-2">
                    <Select
                      value={doc.tds?.section ?? ''}
                      placeholder="None"
                      onValue={(v) => {
                        const s = getSection(v);
                        update({ tds: s ? { section: s.code, rate: s.rates[0].rate, base: 0, amount: 0 } : null });
                      }}
                      options={tdsSections.map((s) => ({ value: s.code, label: `${s.code} - ${s.title}` }))}
                    />
                    {doc.tds && <NumberInput className="w-20" aria-label="TDS rate %" value={doc.tds.rate} onValue={(n) => update({ tds: { ...doc.tds!, rate: n } })} />}
                  </div>
                </Field>
                <Field label="TCS collected by you" hint={tcs1h?.reason || getSection(doc.tcs?.section ?? '')?.note}>
                  <div className="flex gap-2">
                    <Select
                      value={doc.tcs?.section ?? ''}
                      placeholder="None"
                      onValue={(v) => {
                        const s = getSection(v, doc.date);
                        update({ tcs: s ? { section: s.code, rate: s.rates[0].rate, base: 0, amount: 0 } : null });
                      }}
                      options={tcsSections.map((s) => ({ value: s.code, label: `${s.code} - ${s.title}` }))}
                    />
                    {doc.tcs && <NumberInput className="w-20" aria-label="TCS rate %" value={doc.tcs.rate} onValue={(n) => update({ tcs: { ...doc.tcs!, rate: n } })} />}
                  </div>
                </Field>
              </div>
            </Section>
          )}

          {(biz.features.dispatch || doc.docType === 'DELIVERY_CHALLAN') && meta.stock !== 'IN' && (
            <Section title="Dispatch & transport (for Tally print and E-Way Bill)">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ['buyerOrderNo', "Buyer's order no."],
                    ['dispatchDocNo', 'Dispatch doc no.'],
                    ['dispatchedThrough', 'Dispatched through'],
                    ['destination', 'Destination'],
                    ['transporterName', 'Transporter name'],
                    ['transporterId', 'Transporter ID (GSTIN/TRANSIN)'],
                    ['vehicleNo', 'Vehicle no.'],
                    ['transportDocNo', 'LR / RR / AWB no.'],
                    ['ewayBillNo', 'E-Way Bill no.'],
                    ['termsOfDelivery', 'Terms of delivery'],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <TextInput value={doc.dispatch[key]} onValue={(v) => update({ dispatch: { ...doc.dispatch, [key]: key === 'vehicleNo' || key === 'transporterId' ? v.toUpperCase() : v } })} />
                  </Field>
                ))}
                <Field label="Buyer's order date">
                  <Input type="date" value={doc.dispatch.buyerOrderDate} onChange={(e) => update({ dispatch: { ...doc.dispatch, buyerOrderDate: e.target.value } })} />
                </Field>
                <Field label="Transport mode">
                  <Select
                    value={doc.dispatch.transportMode}
                    placeholder="Not set"
                    onValue={(v) => update({ dispatch: { ...doc.dispatch, transportMode: v } })}
                    options={[
                      { value: 'ROAD', label: 'Road' },
                      { value: 'RAIL', label: 'Rail' },
                      { value: 'AIR', label: 'Air' },
                      { value: 'SHIP', label: 'Ship' },
                    ]}
                  />
                </Field>
                <Field label="Distance (km)">
                  <NumberInput value={doc.dispatch.distanceKm} emptyZero onValue={(n) => update({ dispatch: { ...doc.dispatch, distanceKm: Math.max(0, Math.round(n)) } })} />
                </Field>
                <Field label="Transport doc date">
                  <Input type="date" value={doc.dispatch.transportDocDate} onChange={(e) => update({ dispatch: { ...doc.dispatch, transportDocDate: e.target.value } })} />
                </Field>
                <Field label="Vehicle type">
                  <Select
                    value={doc.dispatch.vehicleType}
                    onValue={(v) => update({ dispatch: { ...doc.dispatch, vehicleType: v } })}
                    options={[
                      { value: 'REGULAR', label: 'Regular' },
                      { value: 'ODC', label: 'Over dimensional cargo' },
                    ]}
                  />
                </Field>
              </div>
            </Section>
          )}

          <Section title="Payment details, notes and terms">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Bank account to print">
                <Select value={doc.bankAccountId} placeholder="None" onValue={(v) => update({ bankAccountId: v })} options={biz.bankAccounts.map((b) => ({ value: b.id, label: `${b.bankName || b.label} ...${b.accountNumber.slice(-4)}` }))} />
              </Field>
              <Field label="UPI ID for the QR code">
                <Select value={doc.upiAccountId} placeholder="None" onValue={(v) => update({ upiAccountId: v })} options={biz.upiAccounts.map((u) => ({ value: u.id, label: u.vpa }))} />
              </Field>
              <Field label="Design for this document">
                <Select
                  value={doc.template}
                  placeholder={`Business default (${biz.print.template})`}
                  onValue={(v) => update({ template: v })}
                  options={(['TALLY', 'BOXED', 'MODERN', 'RETAIL', 'MINIMAL', 'EXECUTIVE', 'COMPACT_A5', 'SERVICE', 'THERMAL'] as const).map((t) => ({ value: t, label: t.replace('_', ' ') }))}
                />
              </Field>
            </div>
            <Field label="Notes (printed)">
              <Textarea rows={2} value={doc.notes} onValue={(v) => update({ notes: v })} />
            </Field>
            <Field label="Terms & conditions">
              <Textarea rows={3} value={doc.terms} onValue={(v) => update({ terms: v })} />
            </Field>
          </Section>

          {biz.features.recurring && doc.docType === 'TAX_INVOICE' && (
            <Section title="Recurring">
              <Checkbox
                checked={!!doc.recurring?.enabled}
                onValue={(v) => update({ recurring: v ? { enabled: true, frequency: 'MONTHLY', nextDate: nextRecurringDate(doc.date, 'MONTHLY'), endDate: '' } : null })}
                label="Create copies of this invoice automatically"
                hint="Copies are made when the app starts on or after each due date (only once this invoice is final)."
              />
              {doc.recurring?.enabled && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Repeat">
                    <Select<RecurringFrequency>
                      value={doc.recurring.frequency}
                      onValue={(f) => update({ recurring: { ...doc.recurring!, frequency: f, nextDate: nextRecurringDate(doc.date, f) } })}
                      options={[
                        { value: 'WEEKLY', label: 'Weekly' },
                        { value: 'MONTHLY', label: 'Monthly' },
                        { value: 'QUARTERLY', label: 'Quarterly' },
                        { value: 'YEARLY', label: 'Yearly' },
                      ]}
                    />
                  </Field>
                  <Field label="Next invoice on">
                    <Input type="date" value={doc.recurring.nextDate} onChange={(e) => update({ recurring: { ...doc.recurring!, nextDate: e.target.value } })} />
                  </Field>
                  <Field label="Stop after (optional)">
                    <Input type="date" value={doc.recurring.endDate} onChange={(e) => update({ recurring: { ...doc.recurring!, endDate: e.target.value } })} />
                  </Field>
                </div>
              )}
            </Section>
          )}

          {(errors.length > 0 || warnings.length > 0) && (
            <div className="space-y-2">
              {errors.length > 0 && (
                <Alert tone="red" title="Needed before finalizing">
                  <ul className="list-disc pl-5">
                    {errors.map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {warnings.length > 0 && (
                <Alert tone="amber" title="Please check">
                  <ul className="list-disc pl-5">
                    {warnings.map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </div>
          )}
        </div>

        <div className={cx('xl:block', showPreview ? 'block' : 'hidden')}>
          <div className="sticky top-0 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Live preview</p>
            <div tabIndex={0} role="region" aria-label="Invoice preview" className="max-h-[calc(100vh-9rem)] overflow-y-auto rounded-lg bg-slate-200 p-3">
              <ScaledPreview>
                <InvoiceDocument view={view} />
              </ScaledPreview>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
