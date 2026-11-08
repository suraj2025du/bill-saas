/**
 * Commercial rounding (half away from zero) that is safe against binary
 * floating point artefacts: roundTo(1.005, 2) === 1.01.
 */
export function roundTo(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * factor + 1e-7) / factor;
  if (rounded === 0) return 0;
  return value < 0 ? -rounded : rounded;
}

export const roundMoney = roundTo;

/** Sum then round, so long lists do not accumulate float error. */
export function sumMoney(values: readonly number[], decimals = 2): number {
  let total = 0;
  for (const v of values) total += Number.isFinite(v) ? v : 0;
  return roundTo(total, decimals);
}

/** Parse user input ("1,234.50", " 12 ") into a finite number. */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,\s]/g, '');
    if (cleaned === '') return fallback;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/** Percentage of a base, rounded: pct(10000, 18) === 1800. */
export function pct(base: number, rate: number, decimals = 2): number {
  return roundTo((base * rate) / 100, decimals);
}

/** True when two amounts are equal within a tolerance (default half a paisa). */
export function moneyEquals(a: number, b: number, tolerance = 0.005): boolean {
  return Math.abs(a - b) <= tolerance;
}
