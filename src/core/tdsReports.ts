import type { Column } from './export/csv';
import { recordsToCsv } from './export/csv';
import type { Expense, ISODate, Party, PurchaseBill, SalesDocument } from './model';
import { roundTo } from './money';
import { actFor, getSection, returnFormFor, sectionCodeFor } from './tds';

/**
 * TDS / TCS registers for the quarterly statements.
 * - DEDUCTED: TDS we deducted from resident suppliers (Form 26Q, Form 140 from 1 Apr 2026).
 * - DEDUCTED_NR: TDS we deducted from non-residents u/s 195 (Form 27Q, Form 144 from 1 Apr 2026).
 * - COLLECTED: TCS we collected from buyers (Form 27EQ, Form 143 from 1 Apr 2026).
 * - SUFFERED: TDS our customers deducted from us (check against Form 26AS / AIS, Form 168 from TY 2026-27).
 */
export type TdsRegister = 'DEDUCTED' | 'DEDUCTED_NR' | 'COLLECTED' | 'SUFFERED';

export interface TdsRow {
  register: TdsRegister;
  section: string;
  sectionTitle: string;
  date: ISODate;
  partyName: string;
  pan: string;
  source: 'PURCHASE' | 'EXPENSE' | 'SALE';
  sourceId: string;
  docNo: string;
  /** Amount paid / credited (or received) that the rate applies to. */
  base: number;
  rate: number;
  tax: number;
}

export interface TdsData {
  businessId: string;
  purchases: readonly PurchaseBill[];
  expenses: readonly Expense[];
  invoices: readonly SalesDocument[];
  parties: readonly Party[];
}

export function tdsRegister(data: TdsData, from: ISODate, to: ISODate): TdsRow[] {
  const pan = new Map(data.parties.map((p) => [p.id, p.pan || (p.gstin.length === 15 ? p.gstin.slice(2, 12) : '')]));
  const rows: TdsRow[] = [];
  const within = (d: ISODate) => d >= from && d <= to;
  const title = (code: string) => getSection(code)?.title ?? '';
  const deductedReg = (code: string): TdsRegister => (code === '195' ? 'DEDUCTED_NR' : 'DEDUCTED');
  for (const b of data.purchases) {
    if (b.businessId !== data.businessId || b.status !== 'FINAL' || !b.tds || !within(b.billDate)) continue;
    rows.push({
      register: deductedReg(b.tds.section),
      section: b.tds.section,
      sectionTitle: title(b.tds.section),
      date: b.billDate,
      partyName: b.supplier.name,
      pan: b.supplier.pan || pan.get(b.supplierId) || '',
      source: 'PURCHASE',
      sourceId: b.id,
      docNo: b.billNo,
      base: b.tds.base,
      rate: b.tds.rate,
      tax: b.tds.amount,
    });
  }
  for (const e of data.expenses) {
    if (e.businessId !== data.businessId || !e.tds || !within(e.date)) continue;
    rows.push({
      register: deductedReg(e.tds.section),
      section: e.tds.section,
      sectionTitle: title(e.tds.section),
      date: e.date,
      partyName: e.vendorName,
      pan: e.vendorGstin.length === 15 ? e.vendorGstin.slice(2, 12) : '',
      source: 'EXPENSE',
      sourceId: e.id,
      docNo: e.billNo,
      base: e.tds.base,
      rate: e.tds.rate,
      tax: e.tds.amount,
    });
  }
  for (const d of data.invoices) {
    if (d.businessId !== data.businessId || d.status !== 'FINAL' || !within(d.date)) continue;
    const common = { date: d.date, partyName: d.party.name, pan: d.party.pan || pan.get(d.partyId) || '', source: 'SALE' as const, sourceId: d.id, docNo: d.number };
    if (d.tcs) {
      rows.push({ register: 'COLLECTED', section: d.tcs.section, sectionTitle: title(d.tcs.section), base: d.tcs.base, rate: d.tcs.rate, tax: d.tcs.amount, ...common });
    }
    if (d.tds) {
      rows.push({ register: 'SUFFERED', section: d.tds.section, sectionTitle: title(d.tds.section), base: d.tds.base, rate: d.tds.rate, tax: d.tds.amount, ...common });
    }
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.docNo.localeCompare(b.docNo)));
}

export interface SectionTotal {
  register: TdsRegister;
  section: string;
  count: number;
  base: number;
  tax: number;
}

export function tdsTotals(rows: readonly TdsRow[]): SectionTotal[] {
  const map = new Map<string, SectionTotal>();
  for (const r of rows) {
    const key = `${r.register}|${r.section}`;
    const t = map.get(key) ?? { register: r.register, section: r.section, count: 0, base: 0, tax: 0 };
    t.count += 1;
    t.base = roundTo(t.base + r.base);
    t.tax = roundTo(t.tax + r.tax);
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => a.register.localeCompare(b.register) || a.section.localeCompare(b.section));
}

/** Name of the quarterly statement a register belongs to on `date`. */
export function statementFor(register: TdsRegister, date: ISODate): string {
  if (register === 'SUFFERED') {
    return actFor(date) === 'IT_ACT_2025'
      ? 'Form 168 (earlier Form 26AS / AIS; deducted by your customers)'
      : 'Form 26AS / AIS (deducted by your customers)';
  }
  if (register === 'DEDUCTED_NR') return returnFormFor('NR', date);
  return returnFormFor(register === 'COLLECTED' ? 'TCS' : 'TDS', date);
}

/** Deductee / collectee-wise CSV for preparing the quarterly statement. */
export function tdsCsv(rows: readonly TdsRow[]): string {
  const cols: Column<TdsRow & { sr: number }>[] = [
    { header: 'Sr No', value: (r) => r.sr },
    { header: 'Section', value: (r) => sectionCodeFor(r.section, r.date) },
    { header: 'PAN', value: (r) => r.pan || 'PANNOTAVBL' },
    { header: 'Name', value: (r) => r.partyName },
    { header: 'Date of payment / credit', value: (r) => `${r.date.slice(8, 10)}/${r.date.slice(5, 7)}/${r.date.slice(0, 4)}` },
    { header: 'Amount paid / credited', value: (r) => r.base.toFixed(2) },
    { header: 'Rate (%)', value: (r) => r.rate },
    { header: 'Tax amount', value: (r) => r.tax.toFixed(2) },
    { header: 'Document no', value: (r) => r.docNo },
    { header: 'Register', value: (r) => r.register },
  ];
  return recordsToCsv(
    rows.map((r, i) => ({ ...r, sr: i + 1 })),
    cols,
  );
}
