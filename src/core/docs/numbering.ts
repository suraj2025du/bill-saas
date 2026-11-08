import { fyOf } from '../dates';
import type { ISODate, NumberSeries } from '../model';

/** GST Rule 46(b): consecutive serial number, max 16 chars, letters/digits, '-' and '/'. */
export const DOC_NUMBER_MAX = 16;
const DOC_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9/-]*$/;

export function renderNumber(series: NumberSeries, n: number, fyShort: string): string {
  const num = String(Math.max(1, Math.trunc(n))).padStart(Math.max(0, Math.trunc(series.padding)), '0');
  return `${series.prefix}${series.includeFY ? `${fyShort}/` : ''}${num}${series.suffix ?? ''}`;
}

/** Problems with a document number ([] when valid). */
export function validateDocNumber(num: string): string[] {
  const errors: string[] = [];
  if (!num) errors.push('Document number is required.');
  else {
    if (num.length > DOC_NUMBER_MAX) errors.push(`Must be ${DOC_NUMBER_MAX} characters or fewer (GST rule); now ${num.length}.`);
    if (!DOC_NUMBER_RE.test(num)) errors.push('Use only letters, digits, "-" and "/".');
  }
  return errors;
}

/** Counter that applies on `date`, honouring the FY reset rule. */
export function counterFor(series: NumberSeries, date: ISODate, fyStartMonth = 4): number {
  const fy = fyOf(date, fyStartMonth);
  if (series.resetEachFY && series.fy && series.fy !== fy.label) return 1;
  return Math.max(1, Math.trunc(series.nextNumber));
}

export function previewNumber(series: NumberSeries, date: ISODate, fyStartMonth = 4): string {
  return renderNumber(series, counterFor(series, date, fyStartMonth), fyOf(date, fyStartMonth).short);
}

/**
 * Take the next free number. `exists` lets the caller skip numbers already
 * used (for example after a manual edit). Returns the updated series.
 */
export function takeNumber(
  series: NumberSeries,
  date: ISODate,
  fyStartMonth = 4,
  exists: (num: string) => boolean = () => false,
): { number: string; series: NumberSeries } {
  const fy = fyOf(date, fyStartMonth);
  let n = counterFor(series, date, fyStartMonth);
  let number = renderNumber(series, n, fy.short);
  let guard = 0;
  while (exists(number) && guard < 100_000) {
    n += 1;
    number = renderNumber(series, n, fy.short);
    guard += 1;
  }
  return { number, series: { ...series, nextNumber: n + 1, fy: fy.label } };
}
