import { getCurrency } from './countries';

const cache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    cache.set(key, f);
  }
  return f;
}

export interface MoneyFormatOptions {
  /** Show the currency symbol (default true). */
  symbol?: boolean;
  /** Override decimals (defaults to the currency's own). */
  decimals?: number;
}

/** ₹12,34,567.50 for INR (Indian grouping); $1,234,567.50 for USD; ¥1,235 for JPY. */
export function formatMoney(amount: number, currency = 'INR', opts: MoneyFormatOptions = {}): string {
  const cur = getCurrency(currency);
  const decimals = opts.decimals ?? cur.decimals;
  const value = Number.isFinite(amount) ? amount : 0;
  if (opts.symbol === false) {
    return formatter(cur.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  }
  return formatter(cur.locale, {
    style: 'currency',
    currency: cur.code,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Plain number with Indian grouping by default: 1,23,456.00 */
export function formatNumber(value: number, decimals = 2, locale = 'en-IN'): string {
  return formatter(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
    Number.isFinite(value) ? value : 0,
  );
}

/** Quantity: drops trailing zeros up to `maxDecimals` (10 -> "10", 2.5 -> "2.5"). */
export function formatQty(value: number, maxDecimals = 3): string {
  return formatter('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals }).format(
    Number.isFinite(value) ? value : 0,
  );
}

/** Rate as printed: 18 -> "18%", 0.25 -> "0.25%". */
export function formatRate(rate: number): string {
  return `${formatQty(rate, 3)}%`;
}
