import { useCallback } from 'react';
import { getCurrency } from '../core/currency/countries';
import { formatMoney, formatNumber } from '../core/currency/format';
import { formatDate } from '../core/dates';
import { useBusinessOrNull } from '../store/hooks';

/** Money formatter in the active business currency (or a given one). */
export function useMoney(): (amount: number, currency?: string) => string {
  const biz = useBusinessOrNull();
  const base = biz?.currency ?? 'INR';
  return useCallback((amount: number, currency?: string) => formatMoney(amount || 0, currency || base), [base]);
}

/** Plain grouped number in the business currency's locale. */
export function useNum(): (amount: number) => string {
  const biz = useBusinessOrNull();
  const cur = getCurrency(biz?.currency ?? 'INR');
  return useCallback((amount: number) => formatNumber(amount || 0, cur.decimals, cur.locale), [cur]);
}

export const fdate = (iso: string) => (iso ? formatDate(iso, 'DMY') : '');
