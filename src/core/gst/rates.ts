import type { ISODate } from '../model';

/** GST 2.0 rate rationalisation (56th GST Council) took effect on this date. */
export const GST_REFORM_DATE: ISODate = '2025-09-22';

/** Main slabs from 22 Sep 2025: nil, merit 5%, standard 18%, special 40%. */
export const GST_RATES_CURRENT: readonly number[] = [0, 5, 18, 40];
/** Special rates for specific goods (e.g. 3% gold/silver, 0.25% rough diamonds). */
export const GST_RATES_SPECIAL: readonly number[] = [0.1, 0.25, 1, 1.5, 3, 6, 7.5];
/** Slabs removed for most goods on 22 Sep 2025; still valid for older invoices. */
export const GST_RATES_LEGACY: readonly number[] = [12, 28];

export const ALL_GST_RATES: readonly number[] = [...GST_RATES_CURRENT, ...GST_RATES_SPECIAL, ...GST_RATES_LEGACY].sort(
  (a, b) => a - b,
);

export function isValidGstRate(rate: number): boolean {
  return ALL_GST_RATES.includes(rate);
}

/** 12% / 28% on a document dated after the reform deserves a warning (not an error). */
export function isLegacyRateOn(rate: number, date: ISODate): boolean {
  return GST_RATES_LEGACY.includes(rate) && date >= GST_REFORM_DATE;
}

/** Rates to show in a picker for a given document date (current first). */
export function rateOptions(date: ISODate): number[] {
  const base = date >= GST_REFORM_DATE ? [...GST_RATES_CURRENT] : [0, 5, 12, 18, 28];
  const rest = ALL_GST_RATES.filter((r) => !base.includes(r));
  return [...base, ...rest];
}
