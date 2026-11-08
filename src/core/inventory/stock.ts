import { DOC_TYPES } from '../docs/docTypes';
import type { ISODate, Product, PurchaseBill, SalesDocument } from '../model';
import { roundTo } from '../money';

export type MovementSource = 'OPENING' | 'PURCHASE' | 'SALE' | 'CHALLAN' | 'CREDIT_NOTE';

export interface StockMovement {
  productId: string;
  godownId: string;
  batchNo: string;
  date: ISODate;
  /** Positive = in, negative = out. */
  qty: number;
  /** Cost per unit in INR for purchases / opening stock (0 for outflows and returns). */
  unitCost: number;
  source: MovementSource;
  docId: string;
  docNumber: string;
}

export interface StockData {
  products: readonly Product[];
  invoices: readonly SalesDocument[];
  purchases: readonly PurchaseBill[];
}

/** Date used for opening-stock movements so they sort first. */
export const OPENING_DATE: ISODate = '0001-01-01';

/**
 * Every stock movement of a business up to `upTo` (inclusive), oldest first.
 * Only FINAL documents with `stockApplied` count, so an invoice converted from
 * a delivery challan never deducts the same goods twice.
 */
export function stockMovements(data: StockData, businessId: string, upTo?: ISODate): StockMovement[] {
  const goods = new Map(
    data.products.filter((p) => p.businessId === businessId && p.kind === 'GOODS' && p.trackStock).map((p) => [p.id, p]),
  );
  const out: StockMovement[] = [];
  for (const p of goods.values()) {
    if (!p.openingStock) continue;
    out.push({
      productId: p.id,
      godownId: p.godownId,
      batchNo: p.batchNo,
      date: OPENING_DATE,
      qty: p.openingStock,
      unitCost: p.openingStockRate || p.purchasePrice,
      source: 'OPENING',
      docId: '',
      docNumber: 'Opening stock',
    });
  }
  for (const bill of data.purchases) {
    if (bill.businessId !== businessId || bill.status !== 'FINAL' || (upTo && bill.billDate > upTo)) continue;
    for (const it of bill.items) {
      const product = goods.get(it.productId);
      if (!product || !it.qty) continue;
      out.push({
        productId: it.productId,
        godownId: it.godownId || product.godownId,
        batchNo: it.batchNo,
        date: bill.billDate,
        qty: it.qty,
        unitCost: roundTo((it.taxable * (bill.exchangeRate || 1)) / it.qty, 4),
        source: 'PURCHASE',
        docId: bill.id,
        docNumber: bill.billNo,
      });
    }
  }
  for (const doc of data.invoices) {
    if (doc.businessId !== businessId || doc.status !== 'FINAL' || !doc.stockApplied || (upTo && doc.date > upTo)) continue;
    const effect = DOC_TYPES[doc.docType].stock;
    if (effect === 'NONE') continue;
    const sign = effect === 'IN' ? 1 : -1;
    const source: MovementSource =
      doc.docType === 'DELIVERY_CHALLAN' ? 'CHALLAN' : doc.docType === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'SALE';
    for (const it of doc.items) {
      const product = goods.get(it.productId);
      if (!product || !it.qty) continue;
      out.push({
        productId: it.productId,
        godownId: it.godownId || product.godownId,
        batchNo: it.batchNo,
        date: doc.date,
        qty: sign * it.qty,
        unitCost: 0,
        source,
        docId: doc.id,
        docNumber: doc.number,
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function stockByProduct(movements: readonly StockMovement[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of movements) map.set(m.productId, roundTo((map.get(m.productId) ?? 0) + m.qty, 4));
  return map;
}

/** Key `${productId}|${godownId}|${batchNo}` -> quantity. */
export function stockByLocation(movements: readonly StockMovement[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of movements) {
    const key = `${m.productId}|${m.godownId}|${m.batchNo}`;
    map.set(key, roundTo((map.get(key) ?? 0) + m.qty, 4));
  }
  return map;
}

export function currentStock(data: StockData, businessId: string, upTo?: ISODate): Map<string, number> {
  return stockByProduct(stockMovements(data, businessId, upTo));
}

/** Goods at or below their low-stock alert level. */
export function lowStockProducts(products: readonly Product[], stock: ReadonlyMap<string, number>): { product: Product; qty: number }[] {
  return products
    .filter((p) => p.kind === 'GOODS' && p.trackStock && p.lowStockLevel > 0)
    .map((product) => ({ product, qty: stock.get(product.id) ?? 0 }))
    .filter((x) => x.qty <= x.product.lowStockLevel);
}
