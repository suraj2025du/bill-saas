import { useMemo, useState } from 'react';
import { DOC_TYPES } from '../../core/docs/docTypes';
import { newLineItem, newSalesDocument } from '../../core/factories';
import { makeGstin } from '../../core/gst/gstin';
import type { LabelLanguage, PrintSettings, SalesDocument, TemplateId, ThermalWidth, WatermarkKind } from '../../core/model';
import { InvoiceDocument } from '../../print/InvoiceDocument';
import { LANGUAGE_NAMES } from '../../print/labels';
import { ScaledPreview } from '../../print/printing';
import { buildInvoiceView } from '../../print/view';
import { computeSales, saveBusiness } from '../../store/actions';
import { useBusiness, useMine } from '../../store/hooks';
import { attempt } from '../../ui/feedback';
import { Button, Card, Checkbox, Field, Input, NumberInput, PageHeader, Select, TextInput, cx } from '../../ui/kit';

export const TEMPLATE_INFO: { id: TemplateId; name: string; note: string }[] = [
  { id: 'TALLY', name: 'Tally style', note: 'Classic ruled boxes, dispatch details, HSN tax table' },
  { id: 'BOXED', name: 'Boxed grid', note: 'Ruled pad look' },
  { id: 'MODERN', name: 'Modern corporate', note: 'Colour band header' },
  { id: 'RETAIL', name: 'Retail brand', note: 'Centred brand, big total, UPI QR' },
  { id: 'MINIMAL', name: 'Minimalist', note: 'Clean, thin lines' },
  { id: 'EXECUTIVE', name: 'Executive bold', note: 'Dark header, bold totals' },
  { id: 'COMPACT_A5', name: 'Compact A5', note: 'Half page' },
  { id: 'SERVICE', name: 'Service consultant', note: 'Hides qty/rate for one-line services' },
  { id: 'THERMAL', name: 'Thermal POS', note: '58 / 76 / 80 / 112 mm rolls' },
];

const SHOW_LABELS: Record<keyof PrintSettings['show'], string> = {
  logo: 'Logo',
  signature: 'Signature block',
  bankDetails: 'Bank details',
  upiQr: 'UPI payment QR',
  invoiceQr: 'Invoice QR code',
  barcode: 'Barcode of invoice number',
  feedbackQr: 'Google review QR',
  hsnSummary: 'HSN tax summary',
  amountInWords: 'Amount in words',
  taxInWords: 'Tax in words',
  terms: 'Terms & conditions',
  declaration: 'Declaration',
  customerSeal: "Customer's seal & signature",
  dispatchDetails: 'Dispatch / transport details',
  shipTo: 'Ship-to address',
};

function sampleDoc(biz: ReturnType<typeof useBusiness>): SalesDocument {
  const doc = newSalesDocument(biz, biz.gstRegistration === 'REGULAR' || biz.countryCode !== 'IN' ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY', {
    number: 'INV/26-27/0001',
    status: 'FINAL',
    party: {
      name: 'Sample Customer Pvt Ltd',
      gstin: biz.countryCode === 'IN' ? makeGstin(biz.stateCode || '27', 'AABCR5055K') : '',
      pan: '',
      registration: biz.countryCode === 'IN' ? 'REGULAR' : 'UNREGISTERED',
      address: { line1: '12, Market Road', line2: '', city: 'Pune', pincode: '411001', stateCode: biz.stateCode || '27', countryCode: biz.countryCode },
      phone: '98765 43210',
      email: '',
    },
    placeOfSupply: biz.stateCode || '27',
    items: [
      newLineItem({ name: 'Steel water bottle 1L', hsn: '732393', qty: 12, unit: 'PCS', rate: 249, gstRate: 18 }),
      newLineItem({ name: 'Lunch box (3 tier)', hsn: '732393', qty: 6, unit: 'PCS', rate: 499, gstRate: 18, discountPct: 5 }),
      newLineItem({ name: 'Installation service', hsn: '998729', qty: 1, unit: 'NOS', rate: 500, gstRate: 18 }),
    ],
    notes: 'Thank you for your order.',
    dispatch: { ...newSalesDocument(biz, 'TAX_INVOICE').dispatch, vehicleNo: 'MH12AB1234', destination: 'Pune', dispatchedThrough: 'Road' },
  });
  return computeSales(doc);
}

export function PrintSettingsPage() {
  const biz = useBusiness();
  const invoices = useMine('invoices');
  const [s, setS] = useState<PrintSettings>(biz.print);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<PrintSettings>) => setS((x) => ({ ...x, ...patch }));
  const latest = useMemo(
    () => [...invoices].filter((d) => d.status === 'FINAL' && DOC_TYPES[d.docType].payable).sort((a, b) => (a.date < b.date ? 1 : -1))[0],
    [invoices],
  );
  const preview = useMemo(() => latest ?? sampleDoc(biz), [latest, biz]);
  const view = useMemo(() => buildInvoiceView({ ...preview, template: '' }, biz, { settings: s }), [preview, biz, s]);
  const dirty = JSON.stringify(s) !== JSON.stringify(biz.print);

  return (
    <div>
      <PageHeader
        back="/settings"
        title="Print & PDF design"
        subtitle={latest ? `Preview: ${latest.number}` : 'Preview: sample invoice'}
        actions={
          <>
            <Button disabled={!dirty} onClick={() => setS(biz.print)}>
              Undo changes
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={!dirty}
              onClick={async () => {
                setBusy(true);
                await attempt(() => saveBusiness({ ...biz, print: s }), 'Print settings saved');
                setBusy(false);
              }}
            >
              Save
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Design">
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATE_INFO.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={s.template === t.id}
                  className={cx('rounded-md border px-3 py-2 text-left text-sm', s.template === t.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50')}
                  onClick={() => set({ template: t.id })}
                >
                  <span className="block font-medium">{t.name}</span>
                  <span className="block text-xs text-slate-600">{t.note}</span>
                </button>
              ))}
            </div>
            {s.template === 'THERMAL' && (
              <Field label="Roll width" className="mt-3">
                <Select<`${ThermalWidth}`>
                  value={String(s.thermalWidth) as `${ThermalWidth}`}
                  onValue={(v) => set({ thermalWidth: Number(v) as ThermalWidth })}
                  options={[
                    { value: '58', label: '58 mm (2 inch)' },
                    { value: '76', label: '76 mm' },
                    { value: '80', label: '80 mm (3 inch)' },
                    { value: '112', label: '112 mm (4 inch)' },
                  ]}
                />
              </Field>
            )}
          </Card>
          <Card title="Colours & size" bodyClassName="grid grid-cols-2 gap-3 p-4">
            {(
              [
                ['accent', 'Accent'],
                ['headerBg', 'Header background'],
                ['headerText', 'Header text'],
                ['bodyText', 'Body text'],
                ['border', 'Table lines'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <div className="flex items-center gap-2">
                  <input type="color" className="h-8 w-10 cursor-pointer rounded border border-slate-300" value={s.colors[k]} onChange={(e) => set({ colors: { ...s.colors, [k]: e.target.value } })} aria-label={label} />
                  <Input className="font-mono text-xs" value={s.colors[k]} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && set({ colors: { ...s.colors, [k]: e.target.value } })} />
                </div>
              </Field>
            ))}
            <Field label={`Text size ${Math.round(s.fontScale * 100)}%`}>
              <input type="range" min={0.8} max={1.3} step={0.05} className="w-full" value={s.fontScale} onChange={(e) => set({ fontScale: Number(e.target.value) })} aria-label="Text size" />
            </Field>
            {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
              <Field key={k} label={`Margin ${k} (mm)`}>
                <NumberInput value={s.marginsMm[k]} onValue={(n) => set({ marginsMm: { ...s.marginsMm, [k]: Math.min(40, Math.max(0, n)) } })} />
              </Field>
            ))}
            <Button
              size="sm"
              className="col-span-2"
              onClick={() => set({ colors: { accent: '#4f46e5', headerBg: '#eef2ff', headerText: '#1e1b4b', bodyText: '#111827', border: '#9ca3af' } })}
            >
              Reset colours
            </Button>
          </Card>
          <Card title="Language & copies" bodyClassName="space-y-3 p-4">
            <Field label="Labels printed in">
              <Select<LabelLanguage> value={s.language} onValue={(language) => set({ language })} options={(Object.keys(LANGUAGE_NAMES) as LabelLanguage[]).map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))} />
            </Field>
            {s.language !== 'en' && <Checkbox checked={s.bilingual} onValue={(bilingual) => set({ bilingual })} label="Also show English (bilingual)" />}
            <p className="label">GST Rule 48 copies (printed together)</p>
            <div className="flex flex-wrap gap-4">
              {(['original', 'duplicate', 'triplicate'] as const).map((k) => (
                <Checkbox key={k} checked={s.copies[k]} onValue={(v) => set({ copies: { ...s.copies, [k]: v } })} label={k.charAt(0).toUpperCase() + k.slice(1)} />
              ))}
            </div>
          </Card>
          <Card title="Watermark" bodyClassName="grid grid-cols-2 gap-3 p-4">
            <Field label="Stamp">
              <Select<WatermarkKind>
                value={s.watermark.kind}
                onValue={(kind) => set({ watermark: { ...s.watermark, kind } })}
                options={[
                  { value: 'NONE', label: 'None' },
                  { value: 'DUPLICATE', label: 'DUPLICATE' },
                  { value: 'DRAFT', label: 'DRAFT' },
                  { value: 'PAID', label: 'PAID' },
                  { value: 'CANCELLED', label: 'CANCELLED' },
                  { value: 'CUSTOM', label: 'Custom text' },
                ]}
              />
            </Field>
            <Field label="Position">
              <Select
                value={s.watermark.position}
                onValue={(position) => set({ watermark: { ...s.watermark, position } })}
                options={[
                  { value: 'DIAGONAL', label: 'Diagonal' },
                  { value: 'HEADER', label: 'Header stamp' },
                ]}
              />
            </Field>
            {s.watermark.kind === 'CUSTOM' && (
              <Field label="Text" className="col-span-2">
                <TextInput value={s.watermark.text} maxLength={30} onValue={(text) => set({ watermark: { ...s.watermark, text } })} />
              </Field>
            )}
            <Field label={`Opacity ${Math.round(s.watermark.opacity * 100)}%`} className="col-span-2">
              <input type="range" min={0.03} max={0.4} step={0.01} className="w-full" value={s.watermark.opacity} onChange={(e) => set({ watermark: { ...s.watermark, opacity: Number(e.target.value) } })} aria-label="Opacity" />
            </Field>
            <Checkbox className="col-span-2" checked={s.autoStampPaid} onValue={(autoStampPaid) => set({ autoStampPaid })} label="Stamp PAID automatically on fully paid invoices" hint="CANCELLED and DRAFT are always stamped" />
          </Card>
          <Card title="Show on the invoice" bodyClassName="grid grid-cols-2 gap-2 p-4">
            {(Object.keys(SHOW_LABELS) as (keyof PrintSettings['show'])[]).map((k) => (
              <Checkbox key={k} checked={s.show[k]} onValue={(v) => set({ show: { ...s.show, [k]: v } })} label={SHOW_LABELS[k]} />
            ))}
          </Card>
        </div>
        <div>
          <div className="sticky top-0">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Live preview</p>
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
