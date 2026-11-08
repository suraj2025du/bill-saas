import type { ISODate } from './model';
import { roundTo } from './money';

/**
 * TDS / TCS rules for invoices, purchases and expenses.
 *
 * - Section numbers use the familiar Income-tax Act 1961 codes. For any
 *   credit/payment on or after 1 Apr 2026 the Income-tax Act 2025 applies
 *   (TDS in s.393, TCS in s.394) and the quarterly statements are Form 140
 *   (was 26Q), Form 144 (was 27Q, non-residents) and Form 143 (was 27EQ).
 *   TDS rates and thresholds carry over; Finance Act 2026 made all 206C(1)
 *   TCS rates 2% from 1 Apr 2026 under s.394(1).
 * - TCS on sale of goods, s.206C(1H), was omitted from 1 Apr 2025 (Finance
 *   Act 2025) and is not carried into the 2025 Act. It is kept only for
 *   invoices dated up to 31 Mar 2025.
 */
export const NEW_ACT_FROM: ISODate = '2026-04-01';
export const TCS_206C1H_OMITTED_FROM: ISODate = '2025-04-01';
export const TCS_206C1H_THRESHOLD = 5_000_000;

export type TaxAct = 'IT_ACT_1961' | 'IT_ACT_2025';

export function actFor(date: ISODate): TaxAct {
  return date >= NEW_ACT_FROM ? 'IT_ACT_2025' : 'IT_ACT_1961';
}

export function actLabel(date: ISODate): string {
  return actFor(date) === 'IT_ACT_2025' ? 'Income-tax Act, 2025' : 'Income-tax Act, 1961';
}

/** Quarterly statement name for a date: 26Q / Form 140 (TDS), 27Q / Form 144 (NR TDS), 27EQ / Form 143 (TCS). */
export function returnFormFor(kind: 'TDS' | 'TCS' | 'NR', date: ISODate): string {
  const newAct = actFor(date) === 'IT_ACT_2025';
  if (kind === 'NR') return newAct ? 'Form 144 (earlier 27Q)' : 'Form 27Q';
  if (kind === 'TDS') return newAct ? 'Form 140 (earlier 26Q)' : 'Form 26Q';
  return newAct ? 'Form 143 (earlier 27EQ)' : 'Form 27EQ';
}

export interface RateOption {
  key: string;
  label: string;
  rate: number;
  validFrom?: ISODate;
  validTo?: ISODate;
}

export interface SectionDef {
  code: string;
  /** Section / table serial reference under the Income-tax Act, 2025 (from 1 Apr 2026). */
  newCode: string;
  kind: 'TDS' | 'TCS';
  title: string;
  rates: RateOption[];
  /** Single-payment threshold (0 = none). */
  thresholdSingle: number;
  /** Aggregate per party per FY (0 = none). */
  thresholdAnnual: number;
  /** 'EXCESS' taxes only the part above thresholdAnnual (194Q, 206C(1H)). */
  thresholdMode: 'WHOLE' | 'EXCESS';
  /** TDS base excludes GST when shown separately; TCS 206C(1H) includes it (Circular 17/2020). */
  base: 'TAXABLE' | 'TOTAL';
  validFrom: ISODate | '';
  validTo: ISODate | '';
  note: string;
}

const NOPAN = (rate: number): RateOption => ({ key: 'NOPAN', label: 'No PAN / inoperative PAN', rate });

export const TAX_SECTIONS: readonly SectionDef[] = [
  {
    code: '194C',
    newCode: '393(1) Sl. 6(i)',
    kind: 'TDS',
    title: 'Payment to contractors',
    rates: [
      { key: 'IND', label: 'Individual / HUF', rate: 1 },
      { key: 'OTH', label: 'Others', rate: 2 },
      NOPAN(20),
    ],
    thresholdSingle: 30_000,
    thresholdAnnual: 100_000,
    thresholdMode: 'WHOLE',
    base: 'TAXABLE',
    validFrom: '',
    validTo: '',
    note: 'Single payment above Rs 30,000 or aggregate above Rs 1,00,000 in the FY.',
  },
  {
    code: '194J',
    newCode: '393(1) Sl. 6(iii)',
    kind: 'TDS',
    title: 'Professional / technical fees',
    rates: [
      { key: 'PROF', label: 'Professional services, royalty', rate: 10 },
      { key: 'TECH', label: 'Technical services, call centre, film royalty', rate: 2 },
      NOPAN(20),
    ],
    thresholdSingle: 0,
    thresholdAnnual: 50_000,
    thresholdMode: 'WHOLE',
    base: 'TAXABLE',
    validFrom: '',
    validTo: '',
    note: 'Threshold Rs 50,000 per FY from 1 Apr 2025 (Rs 30,000 earlier).',
  },
  {
    code: '194H',
    newCode: '393(1) Sl. 1(ii)',
    kind: 'TDS',
    title: 'Commission / brokerage',
    rates: [{ key: 'STD', label: 'Standard', rate: 2 }, NOPAN(20)],
    thresholdSingle: 0,
    thresholdAnnual: 20_000,
    thresholdMode: 'WHOLE',
    base: 'TAXABLE',
    validFrom: '',
    validTo: '',
    note: '2% from 1 Oct 2024; threshold Rs 20,000 from 1 Apr 2025.',
  },
  {
    code: '194I',
    newCode: '393(1) Sl. 2(ii)',
    kind: 'TDS',
    title: 'Rent',
    rates: [
      { key: 'PM', label: 'Plant, machinery, equipment', rate: 2 },
      { key: 'LB', label: 'Land, building, furniture', rate: 10 },
      NOPAN(20),
    ],
    thresholdSingle: 50_000,
    thresholdAnnual: 0,
    thresholdMode: 'WHOLE',
    base: 'TAXABLE',
    validFrom: '',
    validTo: '',
    note: 'Rs 50,000 per month (or part of a month) from 1 Apr 2025.',
  },
  {
    code: '194O',
    newCode: '393(1) Sl. 8(v)',
    kind: 'TDS',
    title: 'E-commerce operator',
    rates: [{ key: 'STD', label: 'Standard', rate: 0.1 }, NOPAN(5)],
    thresholdSingle: 0,
    thresholdAnnual: 0,
    thresholdMode: 'WHOLE',
    base: 'TAXABLE',
    validFrom: '',
    validTo: '',
    note: '0.1% from 1 Oct 2024. Individuals/HUF with PAN: Rs 5 lakh exemption.',
  },
  {
    code: '194Q',
    newCode: '393(1) Sl. 8(ii)',
    kind: 'TDS',
    title: 'Purchase of goods',
    rates: [{ key: 'STD', label: 'Standard', rate: 0.1 }, NOPAN(5)],
    thresholdSingle: 0,
    thresholdAnnual: 5_000_000,
    thresholdMode: 'EXCESS',
    base: 'TAXABLE',
    validFrom: '',
    validTo: '',
    note: 'Buyer turnover above Rs 10 crore; on purchases above Rs 50 lakh from one seller in the FY.',
  },
  {
    code: '195',
    newCode: '393(2) Sl. 17',
    kind: 'TDS',
    title: 'Payment to non-resident',
    rates: [{ key: 'CUSTOM', label: 'Rate as per Act / DTAA', rate: 10 }, NOPAN(20)],
    thresholdSingle: 0,
    thresholdAnnual: 0,
    thresholdMode: 'WHOLE',
    base: 'TAXABLE',
    validFrom: '',
    validTo: '',
    note: 'Rate depends on the income type and the tax treaty; edit the rate. Reported in Form 27Q (Form 144 from 1 Apr 2026).',
  },
  {
    code: '206C(1H)',
    newCode: '206C(1H)',
    kind: 'TCS',
    title: 'Sale of goods (omitted from 1 Apr 2025)',
    rates: [{ key: 'STD', label: 'Standard', rate: 0.1 }, NOPAN(1)],
    thresholdSingle: 0,
    thresholdAnnual: TCS_206C1H_THRESHOLD,
    thresholdMode: 'EXCESS',
    base: 'TOTAL',
    validFrom: '',
    validTo: '2025-03-31',
    note: 'Seller turnover above Rs 10 crore; only the amount above Rs 50 lakh per buyer per FY; base includes GST (CBDT Circular 17/2020).',
  },
  {
    code: '206C(1F)',
    newCode: '394(1) Sl. 6',
    kind: 'TCS',
    title: 'Motor vehicle / notified goods above Rs 10 lakh',
    rates: [{ key: 'STD', label: 'Standard', rate: 1 }, NOPAN(5)],
    thresholdSingle: 1_000_000,
    thresholdAnnual: 0,
    thresholdMode: 'WHOLE',
    base: 'TOTAL',
    validFrom: '',
    validTo: '',
    note: 'On sale value above Rs 10 lakh.',
  },
  {
    code: '206C(1)',
    newCode: '394(1) Sl. 1-5',
    kind: 'TCS',
    title: 'Scrap, minerals, forest produce, liquor',
    // Finance Act 2026 made liquor, tendu leaves, timber/forest produce, scrap and minerals uniform 2% from 1 Apr 2026 under s.394(1).
    // No-PAN rate: twice the rate or 5%, whichever is higher (s.206CC; UNVERIFIED for the 2025 Act text).
    rates: [
      { key: 'STD_2026', label: 'Scrap / minerals / forest produce / tendu / liquor (from 1 Apr 2026)', rate: 2, validFrom: NEW_ACT_FROM },
      { key: 'SCRAP', label: 'Scrap / minerals / liquor (up to 31 Mar 2026)', rate: 1, validTo: '2026-03-31' },
      { key: 'FOREST', label: 'Timber / forest produce (up to 31 Mar 2026)', rate: 2, validTo: '2026-03-31' },
      { key: 'TENDU', label: 'Tendu leaves (up to 31 Mar 2026)', rate: 5, validTo: '2026-03-31' },
      NOPAN(5),
    ],
    thresholdSingle: 0,
    thresholdAnnual: 0,
    thresholdMode: 'WHOLE',
    base: 'TOTAL',
    validFrom: '',
    validTo: '',
    note: 'No threshold. Uniform 2% from 1 Apr 2026 (Finance Act 2026, s.394(1)); 1% / 2% / 5% up to 31 Mar 2026.',
  },
];

function filterRates(rates: readonly RateOption[], date?: ISODate): RateOption[] {
  if (!date) return [...rates];
  const filtered = rates.filter((r) => (!r.validFrom || date >= r.validFrom) && (!r.validTo || date <= r.validTo));
  return filtered.length ? filtered : [...rates];
}

export function getSection(code: string, date?: ISODate): SectionDef | undefined {
  const s = TAX_SECTIONS.find((x) => x.code === code);
  if (!s) return undefined;
  return date ? { ...s, rates: filterRates(s.rates, date) } : s;
}

/** Section code to write on statements for `date` (Income-tax Act 2025 table serial from 1 Apr 2026). */
export function sectionCodeFor(code: string, date: ISODate): string {
  const s = TAX_SECTIONS.find((x) => x.code === code);
  if (!s) return code;
  return actFor(date) === 'IT_ACT_2025' ? s.newCode : s.code;
}

export function sectionsFor(kind: 'TDS' | 'TCS', date: ISODate): SectionDef[] {
  return TAX_SECTIONS.filter((s) => s.kind === kind && isSectionAvailable(s, date)).map((s) => ({
    ...s,
    rates: filterRates(s.rates, date),
  }));
}

export function isSectionAvailable(section: SectionDef, date: ISODate): boolean {
  if (section.validFrom && date < section.validFrom) return false;
  if (section.validTo && date > section.validTo) return false;
  return true;
}

export interface ThresholdResult {
  applicable: boolean;
  /** Amount the rate applies to. */
  base: number;
  reason: string;
}

/**
 * Apply a section's threshold to one amount, given what was already paid /
 * credited to the same party earlier in the FY.
 */
export function applyThreshold(section: SectionDef, amount: number, cumulativeBefore: number, date: ISODate): ThresholdResult {
  if (!isSectionAvailable(section, date)) {
    return { applicable: false, base: 0, reason: `${section.code} does not apply on this date.` };
  }
  const after = cumulativeBefore + amount;
  if (section.thresholdMode === 'EXCESS' && section.thresholdAnnual > 0) {
    const excess = Math.max(0, after - section.thresholdAnnual);
    const base = roundTo(Math.min(amount, excess));
    return base > 0
      ? { applicable: true, base, reason: `Above the Rs ${section.thresholdAnnual.toLocaleString('en-IN')} threshold.` }
      : { applicable: false, base: 0, reason: 'Below the annual threshold.' };
  }
  const crossesSingle = section.thresholdSingle > 0 && amount > section.thresholdSingle;
  const crossesAnnual = section.thresholdAnnual > 0 && after > section.thresholdAnnual;
  const noThreshold = section.thresholdSingle === 0 && section.thresholdAnnual === 0;
  if (noThreshold || crossesSingle || crossesAnnual) return { applicable: true, base: roundTo(amount), reason: '' };
  return { applicable: false, base: 0, reason: 'Below the threshold.' };
}

/**
 * TCS u/s 206C(1H) for an invoice: only for invoices up to 31 Mar 2025, only
 * when the seller's turnover exceeded Rs 10 crore, and only on the part of the
 * buyer's FY total (including GST) above Rs 50 lakh.
 */
export function tcs206C1H(
  invoiceDate: ISODate,
  invoiceTotal: number,
  buyerFyTotalBefore: number,
  sellerTurnoverAbove10Cr: boolean,
): ThresholdResult {
  if (invoiceDate >= TCS_206C1H_OMITTED_FROM) {
    return { applicable: false, base: 0, reason: 'TCS on sale of goods (206C(1H)) was omitted from 1 April 2025.' };
  }
  if (!sellerTurnoverAbove10Cr) return { applicable: false, base: 0, reason: 'Seller turnover is not above Rs 10 crore.' };
  return applyThreshold(getSection('206C(1H)')!, invoiceTotal, buyerFyTotalBefore, invoiceDate);
}
