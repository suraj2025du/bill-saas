import type { ISODate } from './model';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date of a Date object as YYYY-MM-DD. */
export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function parts(date: ISODate): [number, number, number] {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function fromUTC(ms: number): ISODate {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function toUTC(date: ISODate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * 86_400_000);
}

/** Adds months, clamping to the month end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${pad2(nm)}-${pad2(nd)}`;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000);
}

export function startOfMonth(date: ISODate): ISODate {
  const [y, m] = parts(date);
  return `${y}-${pad2(m)}-01`;
}

export function endOfMonth(date: ISODate): ISODate {
  const [y, m] = parts(date);
  return `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
}

/** 'YYYY-MM' */
export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

/** First and last date of a 'YYYY-MM' month. */
export function monthRange(yyyyMm: string): { start: ISODate; end: ISODate } {
  const start = `${yyyyMm}-01`;
  return { start, end: endOfMonth(start) };
}

/** All 'YYYY-MM' keys from the month of `start` to the month of `end`, inclusive. */
export function listMonths(start: ISODate, end: ISODate): string[] {
  const out: string[] = [];
  let cur = startOfMonth(start);
  const last = startOfMonth(end);
  while (cur <= last) {
    out.push(monthKey(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}

export function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** GST return period 'MMYYYY' for a date or a 'YYYY-MM' key. */
export function gstPeriod(dateOrMonth: string): string {
  const y = dateOrMonth.slice(0, 4);
  const m = dateOrMonth.slice(5, 7);
  return `${m}${y}`;
}

export function inRange(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

export interface FinancialYear {
  start: ISODate;
  end: ISODate;
  /** '2026-27' */
  label: string;
  /** '26-27' */
  short: string;
  startYear: number;
}

export function fyForStartYear(startYear: number, startMonth = 4): FinancialYear {
  const start = `${startYear}-${pad2(startMonth)}-01`;
  const end = addDays(addMonths(start, 12), -1);
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const label = startMonth === 1 ? String(startYear) : `${startYear}-${String(endYear).slice(2)}`;
  const short = startMonth === 1 ? String(startYear).slice(2) : `${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
  return { start, end, label, short, startYear };
}

/** Financial year containing `date` (India: April to March). */
export function fyOf(date: ISODate, startMonth = 4): FinancialYear {
  const [y, m] = parts(date);
  return fyForStartYear(m >= startMonth ? y : y - 1, startMonth);
}

/** Parse '2026-27' (or '2026') back to a financial year. */
export function fyFromLabel(label: string, startMonth = 4): FinancialYear {
  const y = Number(label.slice(0, 4));
  if (!Number.isInteger(y)) throw new Error(`Invalid financial year: ${label}`);
  return fyForStartYear(y, startMonth);
}

export interface Quarter {
  q: 1 | 2 | 3 | 4;
  start: ISODate;
  end: ISODate;
  /** 'Q1 (Apr-Jun 2026)' */
  label: string;
}

/** Quarter of the financial year containing `date` (Q1 = Apr-Jun for India). */
export function quarterOf(date: ISODate, startMonth = 4): Quarter {
  const fy = fyOf(date, startMonth);
  const idx = Math.floor(((parts(date)[1] - startMonth + 12) % 12) / 3);
  return quarterOfFy(fy, (idx + 1) as 1 | 2 | 3 | 4);
}

export function quarterOfFy(fy: FinancialYear, q: 1 | 2 | 3 | 4): Quarter {
  const start = addMonths(fy.start, (q - 1) * 3);
  const end = addDays(addMonths(start, 3), -1);
  const label = `Q${q} (${MONTHS[parts(start)[1] - 1]}-${MONTHS[parts(end)[1] - 1]} ${parts(end)[0]})`;
  return { q, start, end, label };
}

export type DateStyle = 'DMY' | 'DMY_SLASH' | 'D_MON_Y';

/** 29-10-2026 · 29/10/2026 · 29 Oct 2026 */
export function formatDate(date: ISODate | '', style: DateStyle = 'DMY'): string {
  if (!date || !isValidISODate(date)) return '';
  const [y, m, d] = parts(date);
  if (style === 'DMY_SLASH') return `${pad2(d)}/${pad2(m)}/${y}`;
  if (style === 'D_MON_Y') return `${pad2(d)} ${MONTHS[m - 1]} ${y}`;
  return `${pad2(d)}-${pad2(m)}-${y}`;
}

/** Parse 'DD-MM-YYYY' or 'DD/MM/YYYY' into ISO, or null when invalid. */
export function dmyToISO(input: string): ISODate | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(input.trim());
  if (!m) return null;
  const iso = `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
  return isValidISODate(iso) ? iso : null;
}
