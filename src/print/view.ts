import { getCurrency, taxLabelFor } from '../core/currency/countries';
import { formatMoney, formatNumber, formatQty } from '../core/currency/format';
import { amountInWords } from '../core/currency/words';
import { formatDate } from '../core/dates';
import { DOC_TYPES } from '../core/docs/docTypes';
import type { PaymentSummary } from '../core/docs/payments';
import { chargesTax, hsnTaxSummary, taxLines } from '../core/gst/compute';
import type { HsnTaxRow, TaxLine } from '../core/gst/compute';
import { FOREIGN_POS, stateLabel } from '../core/gst/states';
import { supplyKindLabel } from '../core/gst/supply';
import type { BankAccount, Business, PrintSettings, SalesDocument, TemplateId, UpiAccount } from '../core/model';
import { upiLink } from './codes';
import { labelsFor, numberLabel } from './labels';
import type { Labels } from './labels';

export interface ViewRow {
  sr: number;
  name: string;
  description: string;
  hsn: string;
  qty: string;
  unit: string;
  rate: string;
  discount: string;
  taxable: string;
  gstRate: string;
  tax: string;
  total: string;
}

export interface InvoiceView {
  doc: SalesDocument;
  business: Business;
  settings: PrintSettings;
  template: TemplateId;
  labels: Labels;
  title: string;
  numberLabel: string;
  currency: string;
  decimals: number;
  /** Amount with currency symbol. */
  money: (n: number) => string;
  /** Amount without symbol, grouped for the currency's locale. */
  num: (n: number) => string;
  date: (iso: string) => string;
  taxLabel: string;
  taxed: boolean;
  intra: boolean;
  ut: boolean;
  supplyNote: string;
  placeOfSupply: string;
  rows: ViewRow[];
  totalQty: string;
  hsn: HsnTaxRow[];
  taxLines: TaxLine[];
  amountInWords: string;
  taxInWords: string;
  bank: BankAccount | null;
  upi: UpiAccount | null;
  upiUri: string;
  qrText: string;
  payment: PaymentSummary | null;
  watermark: string;
  copies: string[];
  allServices: boolean;
}

/** Watermark text for a document: CANCELLED / DRAFT win over the chosen stamp. */
export function watermarkFor(doc: SalesDocument, s: PrintSettings, payment: PaymentSummary | null): string {
  if (doc.status === 'CANCELLED') return 'CANCELLED';
  if (doc.status === 'DRAFT') return 'DRAFT';
  if (s.autoStampPaid && payment?.status === 'PAID') return 'PAID';
  switch (s.watermark.kind) {
    case 'NONE':
      return '';
    case 'CUSTOM':
      return s.watermark.text.trim();
    default:
      return s.watermark.kind;
  }
}

export function buildInvoiceView(
  doc: SalesDocument,
  business: Business,
  opts: { settings?: PrintSettings; payment?: PaymentSummary | null; copyLabels?: boolean } = {},
): InvoiceView {
  const settings = opts.settings ?? business.print;
  const template: TemplateId = doc.template || settings.template;
  const labels = labelsFor(settings.language, settings.bilingual);
  const cur = getCurrency(doc.currency);
  const decimals = cur.decimals;
  const meta = DOC_TYPES[doc.docType];
  const taxed = chargesTax({ docType: doc.docType, supplyKind: doc.supplyKind, exportWithTax: doc.exportWithTax });
  const indian = business.countryCode === 'IN';
  const taxLabel = indian ? 'GST' : taxLabelFor(business.countryCode);
  const intra = doc.supplyKind === 'INTRA_STATE' || doc.supplyKind === 'INTRA_UT';
  const num = (n: number) => formatNumber(n, decimals, cur.locale);
  const money = (n: number) => formatMoney(n, doc.currency);
  const date = (iso: string) => formatDate(iso, 'DMY');
  const allServices = doc.items.length > 0 && doc.items.every((i) => i.hsn.startsWith('99'));

  const rows: ViewRow[] = doc.items.map((i, idx) => ({
    sr: idx + 1,
    name: i.name,
    description: i.description,
    hsn: i.hsn,
    qty: formatQty(i.qty),
    unit: i.unit,
    rate: num(i.rate),
    discount: i.discountPct ? `${formatQty(i.discountPct, 2)}%` : '',
    taxable: num(i.taxable),
    gstRate: taxed ? `${formatQty(i.gstRate, 2)}%` : '',
    tax: num(i.cgst + i.sgst + i.utgst + i.igst + i.cess),
    total: num(i.total),
  }));
  const totalQty = formatQty(doc.items.reduce((s, i) => s + (i.qty || 0), 0));

  const bank = business.bankAccounts.find((b) => b.id === doc.bankAccountId) ?? null;
  const upi = business.upiAccounts.find((u) => u.id === doc.upiAccountId) ?? null;
  const payment = opts.payment ?? null;
  const due = payment && payment.status !== 'NOT_APPLICABLE' ? payment.balance : doc.totals.net;
  const upiUri = upi && meta.payable && doc.status !== 'CANCELLED' ? upiLink(upi.vpa, upi.payeeName || business.name, due, doc.currency, doc.number) : '';

  let supplyNote = '';
  if (doc.reverseCharge) supplyNote = `${labels.reverseCharge}: Yes`;
  else if (indian && (doc.supplyKind === 'EXPORT' || doc.supplyKind === 'SEZ')) {
    supplyNote = supplyKindLabel(doc.supplyKind, doc.exportWithTax) + (doc.lutNumber && !doc.exportWithTax ? ` (LUT ${doc.lutNumber})` : '');
  } else if (doc.docType === 'BILL_OF_SUPPLY') supplyNote = business.gstRegistration === 'COMPOSITION' ? 'Composition taxable person, not eligible to collect tax on supplies' : '';

  // Compliance row 17 (Rule 48): services invoices are issued in duplicate (Original for Recipient,
  // Duplicate for Supplier); goods invoices in triplicate.
  const copySelected = allServices
    ? [
        settings.copies.original && labels.original,
        (settings.copies.duplicate || settings.copies.triplicate) && labels.duplicateSupplier,
      ].filter((x): x is string => !!x)
    : [
        settings.copies.original && labels.original,
        settings.copies.duplicate && labels.duplicate,
        settings.copies.triplicate && labels.triplicate,
      ].filter((x): x is string => !!x);
  const ruleCopies = opts.copyLabels !== false && indian && (doc.docType === 'TAX_INVOICE' || doc.docType === 'BILL_OF_SUPPLY');
  const copies = ruleCopies && copySelected.length ? copySelected : [''];

  const qrText = [
    `${meta.label} ${doc.number || '(draft)'}`,
    `Date ${date(doc.date)}`,
    business.gstin && `Seller GSTIN ${business.gstin}`,
    doc.party.gstin && `Buyer GSTIN ${doc.party.gstin}`,
    `Value ${doc.currency} ${doc.totals.total.toFixed(decimals)}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    doc,
    business,
    settings,
    template,
    labels,
    title: labels[doc.docType],
    numberLabel: numberLabel(labels, doc.docType, settings.language),
    currency: doc.currency,
    decimals,
    money,
    num,
    date,
    taxLabel,
    taxed,
    intra,
    ut: doc.supplyKind === 'INTRA_UT',
    supplyNote,
    placeOfSupply: !indian ? '' : doc.placeOfSupply === FOREIGN_POS ? 'Outside India (96)' : stateLabel(doc.placeOfSupply),
    rows,
    totalQty,
    hsn: taxed && indian ? hsnTaxSummary(doc.items, decimals) : [],
    taxLines: taxed ? taxLines(doc.items, doc.supplyKind, taxLabel === 'GST' ? 'Tax' : taxLabel, decimals) : [],
    // Review Y9: Amount in Words under Grand Total must match the invoice Grand Total (doc.totals.total),
    // not the net receivable after TDS/TCS.
    amountInWords: amountInWords(doc.totals.total, doc.currency),
    taxInWords: doc.totals.tax ? amountInWords(doc.totals.tax, doc.currency) : '',
    bank,
    upi,
    upiUri,
    qrText,
    payment,
    watermark: watermarkFor(doc, settings, payment),
    copies,
    allServices,
  };
}

export const PAGE_MM: Record<'A4' | 'A5', { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
};

export function pageOf(template: TemplateId): 'A4' | 'A5' | 'THERMAL' {
  if (template === 'THERMAL') return 'THERMAL';
  if (template === 'COMPACT_A5') return 'A5';
  return 'A4';
}

export function addressLines(a: { line1: string; line2: string; city: string; pincode: string; stateCode: string; countryCode: string }): string[] {
  const cityLine = [a.city, a.pincode].filter(Boolean).join(' - ');
  const state = a.countryCode === 'IN' && a.stateCode && a.stateCode !== FOREIGN_POS ? stateLabel(a.stateCode) : a.countryCode !== 'IN' ? a.countryCode : '';
  return [a.line1, a.line2, [cityLine, state].filter(Boolean).join(', ')].filter(Boolean);
}
