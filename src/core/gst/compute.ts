import { DOC_TYPES } from '../docs/docTypes';
import type { DocTotals, DocType, LineItem, SupplyKind, TaxDeduction } from '../model';
import { roundTo, sumMoney } from '../money';

export interface DeductionInput {
  section: string;
  rate: number;
  /** Override the base (e.g. 206C(1H) threshold excess). Defaults: TDS = taxable, TCS = total. */
  base?: number;
}

export interface ComputeOptions {
  docType: DocType;
  supplyKind: SupplyKind;
  pricesIncludeTax: boolean;
  roundOff: boolean;
  /** EXPORT / SEZ only: charge IGST (true) or zero-rate under LUT (false). */
  exportWithTax: boolean;
  /** Reverse charge: tax is shown but not collected, so it is excluded from the total. */
  reverseCharge: boolean;
  tds?: DeductionInput | null;
  tcs?: DeductionInput | null;
  /** Currency decimals (2 for INR, 0 for JPY, 3 for KWD). */
  decimals?: number;
}

export interface ComputedDocument {
  items: LineItem[];
  totals: DocTotals;
  tds: TaxDeduction | null;
  tcs: TaxDeduction | null;
}

function finite(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** Whether GST is charged at all for this document. */
export function chargesTax(opts: Pick<ComputeOptions, 'docType' | 'supplyKind' | 'exportWithTax'>): boolean {
  if (!DOC_TYPES[opts.docType].chargesTax) return false;
  if ((opts.supplyKind === 'EXPORT' || opts.supplyKind === 'SEZ') && !opts.exportWithTax) return false;
  return true;
}

/**
 * Compute one line. CGST and SGST (or UTGST) are always equal halves, as the
 * GST portal requires. With tax-inclusive prices the taxable value absorbs
 * the rounding so that taxable + taxes equals the entered amount exactly.
 */
export function computeLine(item: LineItem, opts: ComputeOptions): LineItem {
  const d = opts.decimals ?? 2;
  const qty = finite(item.qty);
  const rate = finite(item.rate);
  const discountPct = Math.min(Math.max(finite(item.discountPct), 0), 100);
  const gross = qty * rate;
  const net = roundTo(gross - (gross * discountPct) / 100, d);
  const taxed = chargesTax(opts);
  const g = taxed ? Math.max(0, finite(item.gstRate)) : 0;
  const c = taxed ? Math.max(0, finite(item.cessRate)) : 0;
  const base = opts.pricesIncludeTax ? net / (1 + (g + c) / 100) : net;

  let cgst = 0;
  let sgst = 0;
  let utgst = 0;
  let igst = 0;
  if (g > 0) {
    if (opts.supplyKind === 'INTRA_STATE') {
      cgst = roundTo((base * g) / 200, d);
      sgst = cgst;
    } else if (opts.supplyKind === 'INTRA_UT') {
      cgst = roundTo((base * g) / 200, d);
      utgst = cgst;
    } else {
      igst = roundTo((base * g) / 100, d);
    }
  }
  const cess = c > 0 ? roundTo((base * c) / 100, d) : 0;
  const taxable = opts.pricesIncludeTax ? roundTo(net - cgst - sgst - utgst - igst - cess, d) : net;
  const total = roundTo(taxable + cgst + sgst + utgst + igst + cess, d);
  return { ...item, qty, rate, discountPct, taxable, cgst, sgst, utgst, igst, cess, total };
}

function deduction(input: DeductionInput | null | undefined, defaultBase: number, d: number): TaxDeduction | null {
  if (!input || !input.section || !(finite(input.rate) > 0)) return null;
  const base = roundTo(input.base !== undefined ? Math.max(0, finite(input.base)) : defaultBase, d);
  return { section: input.section, rate: input.rate, base, amount: roundTo((base * input.rate) / 100, d) };
}

/** Compute every line and the document totals, TDS and TCS. */
export function computeDocument(items: readonly LineItem[], opts: ComputeOptions): ComputedDocument {
  const d = opts.decimals ?? 2;
  const lines = items.map((item) => computeLine(item, opts));
  const gross = sumMoney(
    lines.map((l) => l.qty * l.rate),
    d,
  );
  const discount = sumMoney(
    lines.map((l) => (l.qty * l.rate * l.discountPct) / 100),
    d,
  );
  const taxable = sumMoney(
    lines.map((l) => l.taxable),
    d,
  );
  const cgst = sumMoney(
    lines.map((l) => l.cgst),
    d,
  );
  const sgst = sumMoney(
    lines.map((l) => l.sgst),
    d,
  );
  const utgst = sumMoney(
    lines.map((l) => l.utgst),
    d,
  );
  const igst = sumMoney(
    lines.map((l) => l.igst),
    d,
  );
  const cess = sumMoney(
    lines.map((l) => l.cess),
    d,
  );
  const tax = roundTo(cgst + sgst + utgst + igst + cess, d);
  const preRound = opts.reverseCharge ? taxable : roundTo(taxable + tax, d);
  let total = preRound;
  let roundOff = 0;
  if (opts.roundOff) {
    total = roundTo(preRound, 0);
    roundOff = roundTo(total - preRound, d);
  }
  const tds = deduction(opts.tds, taxable, d);
  const tcs = deduction(opts.tcs, total, d);
  const net = roundTo(total + (tcs?.amount ?? 0) - (tds?.amount ?? 0), d);
  return {
    items: lines,
    tds,
    tcs,
    totals: {
      gross,
      discount,
      taxable,
      cgst,
      sgst,
      utgst,
      igst,
      cess,
      tax,
      roundOff,
      total,
      tds: tds?.amount ?? 0,
      tcs: tcs?.amount ?? 0,
      net,
    },
  };
}

export interface HsnTaxRow {
  hsn: string;
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  utgst: number;
  igst: number;
  cess: number;
  tax: number;
}

/** HSN-wise tax summary for printing (grouped by HSN + rate, in first-seen order). */
export function hsnTaxSummary(items: readonly LineItem[], decimals = 2): HsnTaxRow[] {
  const map = new Map<string, HsnTaxRow>();
  for (const l of items) {
    const key = `${l.hsn}|${l.gstRate}`;
    const row = map.get(key) ?? { hsn: l.hsn, gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, utgst: 0, igst: 0, cess: 0, tax: 0 };
    row.taxable = roundTo(row.taxable + l.taxable, decimals);
    row.cgst = roundTo(row.cgst + l.cgst, decimals);
    row.sgst = roundTo(row.sgst + l.sgst, decimals);
    row.utgst = roundTo(row.utgst + l.utgst, decimals);
    row.igst = roundTo(row.igst + l.igst, decimals);
    row.cess = roundTo(row.cess + l.cess, decimals);
    row.tax = roundTo(row.cgst + row.sgst + row.utgst + row.igst + row.cess, decimals);
    map.set(key, row);
  }
  return [...map.values()];
}

export interface TaxLine {
  label: string;
  rate: number;
  amount: number;
}

/** Tax lines to print below the items, e.g. "CGST 9%". Uses `localLabel` for NON_GST. */
export function taxLines(items: readonly LineItem[], supplyKind: SupplyKind, localLabel = 'VAT', decimals = 2): TaxLine[] {
  const byRate = new Map<string, TaxLine>();
  const add = (label: string, rate: number, amount: number) => {
    if (!amount) return;
    const key = `${label}|${rate}`;
    const line = byRate.get(key) ?? { label, rate, amount: 0 };
    line.amount = roundTo(line.amount + amount, decimals);
    byRate.set(key, line);
  };
  for (const l of items) {
    add('CGST', l.gstRate / 2, l.cgst);
    add('SGST', l.gstRate / 2, l.sgst);
    add('UTGST', l.gstRate / 2, l.utgst);
    add(supplyKind === 'NON_GST' ? localLabel : 'IGST', l.gstRate, l.igst);
    add('Cess', l.cessRate, l.cess);
  }
  return [...byRate.values()];
}
