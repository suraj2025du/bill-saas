import { useMemo } from 'react';
import { buildBooks } from '../core/accounting/reports';
import type { Books } from '../core/accounting/reports';
import { todayISO } from '../core/dates';
import { buildPaymentIndex } from '../core/docs/payments';
import type { PaymentIndex } from '../core/docs/payments';
import { defaultSettings } from '../core/factories';
import { currentStock } from '../core/inventory/stock';
import type { AppSettings, Business, CollectionMap, CollectionName } from '../core/model';
import { useStore } from './store';

const FALLBACK_SETTINGS: AppSettings = defaultSettings();

export function selectSettings(data: { settings: AppSettings[] }): AppSettings {
  return data.settings.find((s) => s.id === 'app') ?? FALLBACK_SETTINGS;
}

export function selectBusiness(data: { businesses: Business[]; settings: AppSettings[] }): Business | null {
  const s = selectSettings(data);
  return data.businesses.find((b) => b.id === s.activeBusinessId) ?? data.businesses[0] ?? null;
}

export function useSettings(): AppSettings {
  const list = useStore((s) => s.data.settings);
  return useMemo(() => selectSettings({ settings: list }), [list]);
}

export function useBusinessOrNull(): Business | null {
  const businesses = useStore((s) => s.data.businesses);
  const settings = useStore((s) => s.data.settings);
  return useMemo(() => selectBusiness({ businesses, settings }), [businesses, settings]);
}

/** The active business. Screens are only rendered once a business exists. */
export function useBusiness(): Business {
  const b = useBusinessOrNull();
  if (!b) throw new Error('No business is set up yet.');
  return b;
}

type BusinessScoped = { [K in CollectionName]: CollectionMap[K] extends { businessId: string } ? K : never }[CollectionName];

/** Records of one collection that belong to the active business. */
export function useMine<K extends BusinessScoped>(collection: K): CollectionMap[K][] {
  const list = useStore((s) => s.data[collection]) as CollectionMap[K][];
  const biz = useBusinessOrNull();
  return useMemo(() => (biz ? list.filter((r) => (r as { businessId: string }).businessId === biz.id) : []), [list, biz]);
}

export function usePaymentIndex(): PaymentIndex {
  const receipts = useMine('receipts');
  const vouchers = useMine('vouchers');
  const invoices = useMine('invoices');
  const purchases = useMine('purchases');
  const currency = useBusinessOrNull()?.currency ?? 'INR';
  return useMemo(() => buildPaymentIndex(receipts, vouchers, invoices, purchases, { currency }), [receipts, vouchers, invoices, purchases, currency]);
}

export function useStock(upTo?: string): Map<string, number> {
  const products = useStore((s) => s.data.products);
  const invoices = useStore((s) => s.data.invoices);
  const purchases = useStore((s) => s.data.purchases);
  const biz = useBusinessOrNull();
  return useMemo(
    () => (biz ? currentStock({ products, invoices, purchases }, biz.id, upTo) : new Map<string, number>()),
    [products, invoices, purchases, biz, upTo],
  );
}

/**
 * Books of the active business (journal + openings), rebuilt only when a record they are built from
 * changes: saving a setting, a godown or the trash leaves them as they are (review R4, Y13).
 */
export function useBooks(): Books | null {
  const invoices = useStore((s) => s.data.invoices);
  const purchases = useStore((s) => s.data.purchases);
  const expenses = useStore((s) => s.data.expenses);
  const receipts = useStore((s) => s.data.receipts);
  const vouchers = useStore((s) => s.data.vouchers);
  const parties = useStore((s) => s.data.clients);
  const ledgers = useStore((s) => s.data.ledgers);
  const products = useStore((s) => s.data.products);
  const biz = useBusinessOrNull();
  return useMemo(
    () => (biz ? buildBooks({ business: biz, invoices, purchases, expenses, receipts, vouchers, parties, ledgers, products }) : null),
    [biz, invoices, purchases, expenses, receipts, vouchers, parties, ledgers, products],
  );
}

/** Today's date, refreshed each render (cheap, and correct after midnight). */
export function useToday(): string {
  return todayISO();
}
