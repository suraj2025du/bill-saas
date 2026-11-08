import { endOfMonth, fyOf, monthLabel, quarterOfFy, fyFromLabel } from '../../dates';
import type { ISODate, SalesDocument } from '../../model';
import { roundTo } from '../../money';

/** A GST return period: one month, one quarter (QRMP) or a whole financial year. */
export interface ReturnPeriod {
  kind: 'MONTH' | 'QUARTER' | 'YEAR';
  start: ISODate;
  end: ISODate;
  label: string;
  /** Portal return period `MMYYYY` (last month of the period). */
  fp: string;
}

function fpOf(end: ISODate): string {
  return `${end.slice(5, 7)}${end.slice(0, 4)}`;
}

export function monthPeriod(yyyyMm: string): ReturnPeriod {
  const start = `${yyyyMm}-01`;
  const end = endOfMonth(start);
  return { kind: 'MONTH', start, end, label: monthLabel(yyyyMm), fp: fpOf(end) };
}

export function quarterPeriod(fyLabel: string, q: 1 | 2 | 3 | 4, fyStartMonth = 4): ReturnPeriod {
  const quarter = quarterOfFy(fyFromLabel(fyLabel, fyStartMonth), q);
  return { kind: 'QUARTER', start: quarter.start, end: quarter.end, label: quarter.label, fp: fpOf(quarter.end) };
}

export function yearPeriod(fyLabel: string, fyStartMonth = 4): ReturnPeriod {
  const fy = fyFromLabel(fyLabel, fyStartMonth);
  return { kind: 'YEAR', start: fy.start, end: fy.end, label: `FY ${fy.label}`, fp: fpOf(fy.end) };
}

/** The return period that contains `date`, monthly or quarterly. */
export function periodContaining(date: ISODate, filing: 'MONTHLY' | 'QUARTERLY', fyStartMonth = 4): ReturnPeriod {
  if (filing === 'MONTHLY') return monthPeriod(date.slice(0, 7));
  const fy = fyOf(date, fyStartMonth);
  for (const q of [1, 2, 3, 4] as const) {
    const p = quarterPeriod(fy.label, q, fyStartMonth);
    if (date >= p.start && date <= p.end) return p;
  }
  return monthPeriod(date.slice(0, 7));
}

export const inPeriod = (date: ISODate, p: ReturnPeriod): boolean => date >= p.start && date <= p.end;

/** INR factor of a document (GST returns are always in rupees). */
export function inrFactor(doc: Pick<SalesDocument, 'currency' | 'exchangeRate'>): number {
  if (!doc.currency || doc.currency === 'INR') return 1;
  return doc.exchangeRate > 0 ? doc.exchangeRate : 1;
}

export const inr = (amount: number, factor: number): number => roundTo(amount * factor);

/** dd-mm-yyyy, the date format of GST portal JSON files. */
export function portalDate(date: ISODate): string {
  return date ? `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}` : '';
}

/** Portal JSON date (dd-mm-yyyy or dd/mm/yyyy) back to ISO; '' when unreadable. */
export function fromPortalDate(value: string): ISODate | '' {
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(String(value ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/** B2C (Large) threshold: Rs 2.5 lakh up to 31 Jul 2024, Rs 1 lakh from 1 Aug 2024. */
export function b2clLimit(date: ISODate): number {
  return date <= '2024-07-31' ? 250_000 : 100_000;
}

/** GSTR-1 Table 12 is split into B2B and B2C tabs from the May 2025 return period. */
export const HSN_SPLIT_FROM: ISODate = '2025-05-01';
export const HSN_DESC_MAX = 30;
