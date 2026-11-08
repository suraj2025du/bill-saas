import { DOC_TYPES } from '../../docs/docTypes';
import type { Business, LineItem, SalesDocument, UnitDef } from '../../model';
import { roundTo } from '../../money';
import { validateGstin } from '../gstin';
import { isServiceCode } from '../hsn';
import { uqcFor } from '../units';
import type { ReturnPeriod } from './period';
import { HSN_DESC_MAX, HSN_SPLIT_FROM, b2clLimit, inPeriod, inr, inrFactor, portalDate } from './period';

export interface RateDetail {
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

export interface Gstr1DocRow {
  docId: string;
  number: string;
  date: string;
  party: string;
  gstin: string;
  pos: string;
  /** Invoice / note value in INR. */
  value: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** R, SEWP, SEWOP (B2B / CDNR), WPAY / WOPAY (exports), B2CL / EXPWP / EXPWOP (CDNUR). */
  type: string;
  noteType: '' | 'C' | 'D';
  reverseCharge: boolean;
  interState: boolean;
  rates: RateDetail[];
  portCode: string;
  shippingBillNo: string;
  shippingBillDate: string;
  /** GSTIN of the e-commerce operator the sale went through ('' for direct sales). */
  etin: string;
}

/** Table 14(a): supplies made through one e-commerce operator that collects TCS u/s 52. */
export interface EcoRow {
  etin: string;
  /** Documents counted (invoices, debit notes and credit notes). */
  count: number;
  /** Net value of supplies in INR (credit notes subtract). */
  value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

/** TCS rate under section 52: 1% up to 9 Jul 2024, 0.5% from 10 Jul 2024 (Notification 15/2024-CT). */
export function ecoTcsRate(date: string): number {
  return date >= '2024-07-10' ? 0.5 : 1;
}

export interface B2csRow {
  supplyType: 'INTRA' | 'INTER';
  pos: string;
  rate: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export type NilSupplyType = 'INTRB2B' | 'INTRAB2B' | 'INTRB2C' | 'INTRAB2C';
export const NIL_LABELS: Record<NilSupplyType, string> = {
  INTRB2B: 'Inter-State supplies to registered persons',
  INTRAB2B: 'Intra-State supplies to registered persons',
  INTRB2C: 'Inter-State supplies to unregistered persons',
  INTRAB2C: 'Intra-State supplies to unregistered persons',
};

export interface NilRow {
  supplyType: NilSupplyType;
  nil: number;
  exempt: number;
  nonGst: number;
}

export interface HsnRow {
  hsn: string;
  description: string;
  uqc: string;
  qty: number;
  rate: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  value: number;
}

export interface DocIssueRow {
  nature: number;
  label: string;
  from: string;
  to: string;
  total: number;
  cancelled: number;
  net: number;
}

export const DOC_NATURES: Record<number, string> = {
  1: 'Invoices for outward supply',
  4: 'Debit Note',
  5: 'Credit Note',
  9: 'Delivery Challan for job work',
  10: 'Delivery Challan for supply on approval',
  11: 'Delivery Challan in case of liquid gas',
  12: 'Delivery Challan in cases other than by way of supply',
};

export interface SectionSummary {
  key: string;
  label: string;
  count: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr1Report {
  period: ReturnPeriod;
  gstin: string;
  b2b: Gstr1DocRow[];
  b2cl: Gstr1DocRow[];
  b2cs: B2csRow[];
  exp: Gstr1DocRow[];
  cdnr: Gstr1DocRow[];
  cdnur: Gstr1DocRow[];
  nil: NilRow[];
  hsnSplit: boolean;
  hsnB2b: HsnRow[];
  hsnB2c: HsnRow[];
  docs: DocIssueRow[];
  /** Table 14(a), one row per e-commerce operator. */
  eco: EcoRow[];
  summary: SectionSummary[];
  warnings: string[];
}

export interface Gstr1Options {
  customUnits?: readonly UnitDef[];
  /** Table 13 nature for delivery challans (0 = do not report). Default 12. */
  challanNature?: 0 | 9 | 10 | 11 | 12;
}

const UNREGISTERED = new Set(['UNREGISTERED', 'CONSUMER', 'OVERSEAS']);

function isRegistered(doc: SalesDocument): boolean {
  return !!doc.party.gstin && !UNREGISTERED.has(doc.party.registration);
}

const isIntra = (doc: SalesDocument) => doc.supplyKind === 'INTRA_STATE' || doc.supplyKind === 'INTRA_UT';

function rateDetails(items: readonly LineItem[], f: number, include: (i: LineItem) => boolean, rateOf: (i: LineItem) => number): RateDetail[] {
  const map = new Map<number, RateDetail>();
  for (const i of items) {
    if (!include(i)) continue;
    const rt = rateOf(i);
    const r = map.get(rt) ?? { rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
    r.txval = roundTo(r.txval + inr(i.taxable, f));
    r.iamt = roundTo(r.iamt + inr(i.igst, f));
    r.camt = roundTo(r.camt + inr(i.cgst, f));
    r.samt = roundTo(r.samt + inr(i.sgst + i.utgst, f));
    r.csamt = roundTo(r.csamt + inr(i.cess, f));
    map.set(rt, r);
  }
  return [...map.values()].sort((a, b) => a.rt - b.rt);
}

function docRow(doc: SalesDocument, type: string, rates: RateDetail[]): Gstr1DocRow {
  const f = inrFactor(doc);
  const sum = (k: keyof RateDetail) => roundTo(rates.reduce((s, r) => s + r[k], 0));
  return {
    docId: doc.id,
    number: doc.number,
    date: doc.date,
    party: doc.party.name,
    gstin: doc.party.gstin,
    pos: doc.placeOfSupply,
    value: inr(doc.totals.total, f),
    taxable: sum('txval'),
    igst: sum('iamt'),
    cgst: sum('camt'),
    sgst: sum('samt'),
    cess: sum('csamt'),
    type,
    noteType: doc.docType === 'CREDIT_NOTE' ? 'C' : doc.docType === 'DEBIT_NOTE' ? 'D' : '',
    reverseCharge: doc.reverseCharge,
    interState: !isIntra(doc),
    rates,
    portCode: doc.portCode,
    shippingBillNo: doc.shippingBillNo,
    shippingBillDate: doc.shippingBillDate,
    etin: ecoGstinOf(doc),
  };
}

const ecoGstinOf = (doc: SalesDocument): string => (doc.ecoGstin ?? '').trim().toUpperCase();

function b2bType(doc: SalesDocument): string {
  if (doc.supplyKind === 'SEZ') return doc.exportWithTax ? 'SEWP' : 'SEWOP';
  return 'R';
}

/** Series key of a document number: everything before the last run of digits. */
export function seriesKey(num: string): { key: string; n: number } {
  const m = /^(.*?)(\d+)(\D*)$/.exec(num);
  if (!m) return { key: num, n: 0 };
  return { key: `${m[1]}#${m[3]}`, n: Number(m[2]) };
}

function docIssue(docs: readonly SalesDocument[], challanNature: number): DocIssueRow[] {
  const natureOf = (d: SalesDocument): number => {
    if (d.docType === 'TAX_INVOICE' || d.docType === 'BILL_OF_SUPPLY') return 1;
    if (d.docType === 'DEBIT_NOTE') return 4;
    if (d.docType === 'CREDIT_NOTE') return 5;
    if (d.docType === 'DELIVERY_CHALLAN') return challanNature;
    return 0;
  };
  const groups = new Map<string, { nature: number; items: { num: string; n: number; cancelled: boolean }[] }>();
  for (const d of docs) {
    const nature = natureOf(d);
    if (!nature || !d.number) continue;
    const s = seriesKey(d.number);
    const key = `${nature}|${d.docType}|${s.key}`;
    const g = groups.get(key) ?? { nature, items: [] };
    g.items.push({ num: d.number, n: s.n, cancelled: d.status === 'CANCELLED' });
    groups.set(key, g);
  }
  const rows: DocIssueRow[] = [];
  for (const g of groups.values()) {
    g.items.sort((a, b) => a.n - b.n || a.num.localeCompare(b.num));
    const cancelled = g.items.filter((i) => i.cancelled).length;
    rows.push({
      nature: g.nature,
      label: DOC_NATURES[g.nature] ?? '',
      from: g.items[0].num,
      to: g.items[g.items.length - 1].num,
      total: g.items.length,
      cancelled,
      net: g.items.length - cancelled,
    });
  }
  return rows.sort((a, b) => a.nature - b.nature || a.from.localeCompare(b.from));
}

/** Build every GSTR-1 table for a period from the sales documents. */
export function buildGstr1(business: Business, invoices: readonly SalesDocument[], period: ReturnPeriod, opts: Gstr1Options = {}): Gstr1Report {
  const warnings: string[] = [];
  const report: Gstr1Report = {
    period,
    gstin: business.gstin,
    b2b: [],
    b2cl: [],
    b2cs: [],
    exp: [],
    cdnr: [],
    cdnur: [],
    nil: [],
    hsnSplit: period.start >= HSN_SPLIT_FROM,
    hsnB2b: [],
    hsnB2c: [],
    docs: [],
    eco: [],
    summary: [],
    warnings,
  };
  if (business.countryCode !== 'IN') {
    warnings.push('GSTR-1 applies only to businesses registered under Indian GST.');
    return report;
  }
  if (business.gstRegistration !== 'REGULAR') {
    warnings.push('Composition and unregistered businesses do not file GSTR-1 (composition dealers file CMP-08 and GSTR-4).');
  }
  if (!business.gstin) warnings.push('Add your GSTIN in Settings > Business before exporting.');

  const mine = invoices.filter((d) => d.businessId === business.id && inPeriod(d.date, period));
  const byId = new Map(invoices.map((d) => [d.id, d]));
  const b2cs = new Map<string, B2csRow>();
  const nil = new Map<NilSupplyType, NilRow>();
  const hsn = { b2b: new Map<string, HsnRow>(), b2c: new Map<string, HsnRow>() };
  const custom = opts.customUnits ?? [];
  const eco = new Map<string, EcoRow>();

  // Table 14(a): the sale also stays in B2B / B2CL / B2CS; this only totals it per operator.
  const addEco = (doc: SalesDocument) => {
    const etin = ecoGstinOf(doc);
    if (!etin) return;
    if (doc.docType === 'BILL_OF_SUPPLY') {
      warnings.push(`${doc.number}: a bill of supply is not reported in Table 14 (only taxable supplies through an e-commerce operator are).`);
      return;
    }
    if (doc.reverseCharge) {
      warnings.push(`${doc.number}: reverse-charge sale through e-commerce operator ${etin} is not added to Table 14. If the operator pays the tax under section 9(5), report it in Table 14(b) on the portal.`);
      return;
    }
    if (!validateGstin(etin).valid) {
      warnings.push(`${doc.number}: e-commerce operator GSTIN ${etin} is not valid, so this sale is missing from Table 14.`);
      return;
    }
    const f = inrFactor(doc);
    const sign = doc.docType === 'CREDIT_NOTE' ? -1 : 1;
    const zeroRated = doc.supplyKind === 'EXPORT' || doc.supplyKind === 'SEZ';
    const r = eco.get(etin) ?? { etin, count: 0, value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    r.count += 1;
    for (const i of doc.items) {
      if (!(zeroRated || i.gstRate > 0)) continue;
      r.value = roundTo(r.value + sign * inr(i.taxable, f));
      r.igst = roundTo(r.igst + sign * inr(i.igst, f));
      r.cgst = roundTo(r.cgst + sign * inr(i.cgst, f));
      r.sgst = roundTo(r.sgst + sign * inr(i.sgst + i.utgst, f));
      r.cess = roundTo(r.cess + sign * inr(i.cess, f));
    }
    eco.set(etin, r);
  };

  const addB2cs = (doc: SalesDocument, sign: number) => {
    const f = inrFactor(doc);
    const supplyType = isIntra(doc) ? 'INTRA' : 'INTER';
    for (const i of doc.items) {
      if (!(i.gstRate > 0)) continue;
      const key = `${supplyType}|${doc.placeOfSupply}|${i.gstRate}`;
      const r = b2cs.get(key) ?? { supplyType, pos: doc.placeOfSupply, rate: i.gstRate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      r.taxable = roundTo(r.taxable + sign * inr(i.taxable, f));
      r.igst = roundTo(r.igst + sign * inr(i.igst, f));
      r.cgst = roundTo(r.cgst + sign * inr(i.cgst, f));
      r.sgst = roundTo(r.sgst + sign * inr(i.sgst + i.utgst, f));
      r.cess = roundTo(r.cess + sign * inr(i.cess, f));
      b2cs.set(key, r);
    }
  };

  const addNil = (doc: SalesDocument, kind: 'nil' | 'exempt', items: readonly LineItem[], sign: number) => {
    const f = inrFactor(doc);
    const reg = isRegistered(doc);
    const t: NilSupplyType = isIntra(doc) ? (reg ? 'INTRAB2B' : 'INTRAB2C') : reg ? 'INTRB2B' : 'INTRB2C';
    const row = nil.get(t) ?? { supplyType: t, nil: 0, exempt: 0, nonGst: 0 };
    const amount = roundTo(items.reduce((s, i) => s + inr(i.taxable, f), 0));
    row[kind] = roundTo(row[kind] + sign * amount);
    nil.set(t, row);
  };

  const addHsn = (doc: SalesDocument, sign: number) => {
    const f = inrFactor(doc);
    const target = isRegistered(doc) || doc.supplyKind === 'SEZ' ? hsn.b2b : hsn.b2c;
    const taxed = DOC_TYPES[doc.docType].chargesTax;
    for (const i of doc.items) {
      const uqc = uqcFor(i.unit, custom, i.hsn);
      const service = isServiceCode(i.hsn) || uqc === 'NA';
      const rate = taxed ? i.gstRate : 0;
      const key = `${i.hsn}|${service ? 'NA' : uqc}|${rate}`;
      const r = target.get(key) ?? {
        hsn: i.hsn,
        description: i.name.trim().slice(0, HSN_DESC_MAX).trim(),
        uqc: service ? 'NA' : uqc,
        qty: 0,
        rate,
        taxable: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        cess: 0,
        value: 0,
      };
      if (!service) r.qty = roundTo(r.qty + sign * i.qty, 3);
      r.taxable = roundTo(r.taxable + sign * inr(i.taxable, f));
      r.igst = roundTo(r.igst + sign * inr(i.igst, f));
      r.cgst = roundTo(r.cgst + sign * inr(i.cgst, f));
      r.sgst = roundTo(r.sgst + sign * inr(i.sgst + i.utgst, f));
      r.cess = roundTo(r.cess + sign * inr(i.cess, f));
      r.value = roundTo(r.taxable + r.igst + r.cgst + r.sgst + r.cess);
      target.set(key, r);
      if (!i.hsn) warnings.push(`${doc.number}: item "${i.name}" has no HSN/SAC code.`);
    }
  };

  for (const doc of mine) {
    if (doc.status !== 'FINAL' || !DOC_TYPES[doc.docType].inGstr1) continue;
    addEco(doc);
    const f = inrFactor(doc);
    const reg = isRegistered(doc);
    const exportish = doc.supplyKind === 'EXPORT' || doc.supplyKind === 'SEZ';
    const taxedLine = (i: LineItem) => exportish || i.gstRate > 0;
    const allLines = () => true;
    const rate = (i: LineItem) => i.gstRate;
    if (doc.party.registration === 'REGULAR' && !doc.party.gstin) {
      warnings.push(`${doc.number}: registered customer without GSTIN is reported as B2C.`);
    }

    if (doc.docType === 'BILL_OF_SUPPLY') {
      addNil(doc, 'exempt', doc.items, 1);
      addHsn(doc, 1);
      continue;
    }

    if (doc.docType === 'TAX_INVOICE') {
      addHsn(doc, 1);
      if (!exportish) {
        const nilItems = doc.items.filter((i) => !(i.gstRate > 0));
        if (nilItems.length) addNil(doc, 'nil', nilItems, 1);
      }
      if (doc.supplyKind === 'EXPORT') {
        report.exp.push(docRow(doc, doc.exportWithTax ? 'WPAY' : 'WOPAY', rateDetails(doc.items, f, allLines, rate)));
      } else if (reg || doc.supplyKind === 'SEZ') {
        if (!doc.party.gstin) warnings.push(`${doc.number}: SEZ supply needs the recipient GSTIN.`);
        const rates = rateDetails(doc.items, f, taxedLine, rate);
        if (rates.length) report.b2b.push(docRow(doc, b2bType(doc), rates));
      } else if (!isIntra(doc) && inr(doc.totals.total, f) > b2clLimit(doc.date)) {
        const rates = rateDetails(doc.items, f, taxedLine, rate);
        if (rates.length) report.b2cl.push(docRow(doc, 'B2CL', rates));
      } else {
        addB2cs(doc, 1);
      }
      continue;
    }

    // Credit and debit notes
    const sign = doc.docType === 'CREDIT_NOTE' ? -1 : 1;
    addHsn(doc, sign);
    const rates = rateDetails(doc.items, f, allLines, rate);
    if (reg || doc.supplyKind === 'SEZ') {
      report.cdnr.push(docRow(doc, b2bType(doc), rates));
      continue;
    }
    if (doc.supplyKind === 'EXPORT') {
      report.cdnur.push(docRow(doc, doc.exportWithTax ? 'EXPWP' : 'EXPWOP', rates));
      continue;
    }
    const original = doc.refDocId ? byId.get(doc.refDocId) : undefined;
    const originalValue = original ? inr(original.totals.total, inrFactor(original)) : inr(doc.totals.total, f);
    const originalDate = original?.date ?? doc.date;
    if (!isIntra(doc) && originalValue > b2clLimit(originalDate)) {
      report.cdnur.push(docRow(doc, 'B2CL', rates));
    } else {
      addB2cs(doc, sign);
      const nilItems = doc.items.filter((i) => !(i.gstRate > 0));
      if (nilItems.length) addNil(doc, 'nil', nilItems, sign);
    }
  }

  report.b2cs = [...b2cs.values()].filter((r) => r.taxable || r.igst || r.cgst).sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  report.nil = (['INTRB2B', 'INTRAB2B', 'INTRB2C', 'INTRAB2C'] as NilSupplyType[]).map((t) => nil.get(t)).filter((r): r is NilRow => !!r);
  const sortHsn = (m: Map<string, HsnRow>) => [...m.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
  report.hsnB2b = sortHsn(hsn.b2b);
  report.hsnB2c = sortHsn(hsn.b2c);
  report.docs = docIssue(mine, opts.challanNature ?? 12);
  report.eco = [...eco.values()].sort((a, b) => a.etin.localeCompare(b.etin));
  if (report.b2cs.some((r) => r.taxable < 0)) warnings.push('B2C (Others) has a negative row: credit notes exceed sales for that state and rate.');
  report.summary = summarize(report);
  report.warnings = [...new Set(warnings)];
  return report;
}

function summarize(r: Gstr1Report): SectionSummary[] {
  const fromDocs = (key: string, label: string, rows: readonly Gstr1DocRow[]): SectionSummary => ({
    key,
    label,
    count: rows.length,
    taxable: roundTo(rows.reduce((s, x) => s + x.taxable, 0)),
    igst: roundTo(rows.reduce((s, x) => s + x.igst, 0)),
    cgst: roundTo(rows.reduce((s, x) => s + x.cgst, 0)),
    sgst: roundTo(rows.reduce((s, x) => s + x.sgst, 0)),
    cess: roundTo(rows.reduce((s, x) => s + x.cess, 0)),
  });
  const b2cs: SectionSummary = {
    key: 'b2cs',
    label: '7 - B2C (Others)',
    count: r.b2cs.length,
    taxable: roundTo(r.b2cs.reduce((s, x) => s + x.taxable, 0)),
    igst: roundTo(r.b2cs.reduce((s, x) => s + x.igst, 0)),
    cgst: roundTo(r.b2cs.reduce((s, x) => s + x.cgst, 0)),
    sgst: roundTo(r.b2cs.reduce((s, x) => s + x.sgst, 0)),
    cess: roundTo(r.b2cs.reduce((s, x) => s + x.cess, 0)),
  };
  const nilTotal = roundTo(r.nil.reduce((s, x) => s + x.nil + x.exempt + x.nonGst, 0));
  const total = (k: 'value' | 'igst' | 'cgst' | 'sgst' | 'cess') => roundTo(r.eco.reduce((s, x) => s + x[k], 0));
  const eco: SectionSummary[] = r.eco.length
    ? [
        {
          key: 'eco',
          label: '14 - Through e-commerce operators (also counted above)',
          count: r.eco.reduce((s, x) => s + x.count, 0),
          taxable: total('value'),
          igst: total('igst'),
          cgst: total('cgst'),
          sgst: total('sgst'),
          cess: total('cess'),
        },
      ]
    : [];
  return [
    fromDocs('b2b', '4A, 4B, 6B, 6C - B2B, SEZ, Deemed Exports', r.b2b),
    fromDocs('b2cl', '5 - B2C (Large)', r.b2cl),
    fromDocs('exp', '6A - Exports', r.exp),
    b2cs,
    { key: 'nil', label: '8 - Nil rated, exempted and non-GST', count: r.nil.length, taxable: nilTotal, igst: 0, cgst: 0, sgst: 0, cess: 0 },
    fromDocs('cdnr', '9B - Credit/Debit Notes (Registered)', r.cdnr),
    fromDocs('cdnur', '9B - Credit/Debit Notes (Unregistered)', r.cdnur),
    ...eco,
  ];
}

// ---------------------------------------------------------------- portal JSON

type Json = Record<string, unknown>;

function itemDetail(r: RateDetail, interState: boolean, igstOnly = false): Json {
  const d: Json = { txval: r.txval, rt: r.rt };
  if (interState || igstOnly) d.iamt = r.iamt;
  else {
    d.camt = r.camt;
    d.samt = r.samt;
  }
  d.csamt = r.csamt;
  return d;
}

function numbered(rates: readonly RateDetail[], interState: boolean, igstOnly = false): Json[] {
  return rates.map((r, i) => ({ num: i + 1, itm_det: itemDetail(r, interState, igstOnly) }));
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

/** One HSN table for periods before May 2025: B2B and B2C rows with the same HSN, UQC and rate are added up. */
export function mergeHsn(rows: readonly HsnRow[]): HsnRow[] {
  const merged = new Map<string, HsnRow>();
  for (const h of rows) {
    const key = `${h.hsn}|${h.uqc}|${h.rate}`;
    const m = merged.get(key);
    if (!m) merged.set(key, { ...h });
    else {
      m.qty = roundTo(m.qty + h.qty, 3);
      m.taxable = roundTo(m.taxable + h.taxable);
      m.igst = roundTo(m.igst + h.igst);
      m.cgst = roundTo(m.cgst + h.cgst);
      m.sgst = roundTo(m.sgst + h.sgst);
      m.cess = roundTo(m.cess + h.cess);
      m.value = roundTo(m.value + h.value);
    }
  }
  return [...merged.values()];
}

function hsnJson(rows: readonly HsnRow[]): Json[] {
  return rows.map((h, i) => ({
    num: i + 1,
    hsn_sc: h.hsn,
    desc: h.description,
    uqc: h.uqc,
    qty: h.qty,
    rt: h.rate,
    txval: h.taxable,
    iamt: h.igst,
    camt: h.cgst,
    samt: h.sgst,
    csamt: h.cess,
  }));
}

function stripEmpty<T>(obj: T): T | undefined {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj === 'string') return obj === '' ? undefined : obj;
  if (Array.isArray(obj)) {
    const arr = obj.map(stripEmpty).filter((x) => x !== undefined);
    return arr.length === 0 && obj.length > 0 ? undefined : (arr as unknown as T);
  }
  if (typeof obj === 'object') {
    const res: Record<string, unknown> = {};
    let hasKeys = false;
    for (const [key, raw] of Object.entries(obj as Record<string, unknown>)) {
      const val = stripEmpty(raw);
      if (val !== undefined) {
        res[key] = val;
        hasKeys = true;
      }
    }
    return hasKeys ? (res as unknown as T) : undefined;
  }
  return obj;
}

/** GSTR-1 JSON in the format of the GST portal offline tool. */
export function gstr1Json(r: Gstr1Report): Json {
  const json: Json = { gstin: r.gstin, fp: r.period.fp };
  if (r.b2b.length) {
    json.b2b = [...groupBy(r.b2b, (x) => x.gstin)].map(([ctin, docs]) => ({
      ctin,
      inv: docs.map((d) => ({
        inum: d.number,
        idt: portalDate(d.date),
        val: d.value,
        pos: d.pos,
        rchrg: d.reverseCharge ? 'Y' : 'N',
        inv_typ: d.type,
        itms: numbered(d.rates, d.interState || d.type !== 'R'),
      })),
    }));
  }
  if (r.b2cl.length) {
    json.b2cl = [...groupBy(r.b2cl, (x) => x.pos)].map(([pos, docs]) => ({
      pos,
      inv: docs.map((d) => ({ inum: d.number, idt: portalDate(d.date), val: d.value, itms: numbered(d.rates, true, true) })),
    }));
  }
  if (r.exp.length) {
    json.exp = [...groupBy(r.exp, (x) => x.type)].map(([exp_typ, docs]) => ({
      exp_typ,
      inv: docs.map((d) => {
        const inv: Json = { inum: d.number, idt: portalDate(d.date), val: d.value };
        if (d.portCode) inv.sbpcode = d.portCode;
        if (d.shippingBillNo) inv.sbnum = d.shippingBillNo;
        if (d.shippingBillDate) inv.sbdt = portalDate(d.shippingBillDate);
        inv.itms = d.rates.map((x) => ({ txval: x.txval, rt: x.rt, iamt: x.iamt, csamt: x.csamt }));
        return inv;
      }),
    }));
  }
  if (r.b2cs.length) {
    json.b2cs = r.b2cs.map((x) => {
      const row: Json = { sply_ty: x.supplyType, pos: x.pos, typ: 'OE', rt: x.rate, txval: x.taxable };
      if (x.supplyType === 'INTER') row.iamt = x.igst;
      else {
        row.camt = x.cgst;
        row.samt = x.sgst;
      }
      row.csamt = x.cess;
      return row;
    });
  }
  if (r.cdnr.length) {
    json.cdnr = [...groupBy(r.cdnr, (x) => x.gstin)].map(([ctin, notes]) => ({
      ctin,
      nt: notes.map((n) => ({
        ntty: n.noteType,
        nt_num: n.number,
        nt_dt: portalDate(n.date),
        val: n.value,
        pos: n.pos,
        rchrg: n.reverseCharge ? 'Y' : 'N',
        inv_typ: n.type,
        itms: numbered(n.rates, n.interState || n.type !== 'R'),
      })),
    }));
  }
  if (r.cdnur.length) {
    json.cdnur = r.cdnur.map((n) => {
      const row: Json = { typ: n.type, ntty: n.noteType, nt_num: n.number, nt_dt: portalDate(n.date), val: n.value };
      if (n.type === 'B2CL') row.pos = n.pos;
      row.itms = numbered(n.rates, true, true);
      return row;
    });
  }
  if (r.nil.length) {
    json.nil = { inv: r.nil.map((n) => ({ sply_ty: n.supplyType, expt_amt: n.exempt, nil_amt: n.nil, ngsup_amt: n.nonGst })) };
  }
  if (r.hsnB2b.length || r.hsnB2c.length) {
    if (r.hsnSplit) {
      json.hsn = { hsn_b2b: hsnJson(r.hsnB2b), hsn_b2c: hsnJson(r.hsnB2c) };
    } else {
      json.hsn = { data: hsnJson(mergeHsn([...r.hsnB2b, ...r.hsnB2c])) };
    }
  }
  if (r.docs.length) {
    json.doc_issue = {
      doc_det: [...groupBy(r.docs, (d) => String(d.nature))].map(([nature, rows]) => ({
        doc_num: Number(nature),
        docs: rows.map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.net })),
      })),
    };
  }
  if (r.eco.length) {
    // Table 14(a): operators liable to collect TCS u/s 52 ("paytx", section 9(5), is not supported).
    json.supeco = { clttx: r.eco.map((e) => ({ etin: e.etin, suppval: e.value, igst: e.igst, cgst: e.cgst, sgst: e.sgst, cess: e.cess })) };
  }
  return stripEmpty(json) || {};
}
