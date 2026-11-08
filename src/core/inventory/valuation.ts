import type { ISODate } from '../model';
import { roundTo } from '../money';
import type { StockData, StockMovement } from './stock';
import { stockMovements } from './stock';

export type ValuationMethod = 'WEIGHTED_AVERAGE' | 'LAST_PURCHASE' | 'STANDARD_COST';

export interface ValuationLine {
  productId: string;
  name: string;
  hsn: string;
  unit: string;
  qty: number;
  rate: number;
  value: number;
}

export interface StockValuation {
  asOf: ISODate;
  method: ValuationMethod;
  lines: ValuationLine[];
  total: number;
}

interface CostSoFar {
  qty: number;
  costQty: number;
  costValue: number;
  last: number;
}

function addMovement(acc: Map<string, CostSoFar>, m: StockMovement): void {
  const a = acc.get(m.productId) ?? { qty: 0, costQty: 0, costValue: 0, last: 0 };
  a.qty += m.qty;
  if (m.source === 'OPENING' || m.source === 'PURCHASE') {
    a.costQty += m.qty;
    a.costValue += m.qty * m.unitCost;
    if (m.source === 'PURCHASE') a.last = m.unitCost;
  }
  acc.set(m.productId, a);
}

const totalOf = (lines: readonly ValuationLine[]) => roundTo(lines.reduce((s, l) => s + l.value, 0));

/**
 * Value the closing stock of every tracked product on `asOf`.
 * Negative stock (sold before the purchase was entered) is valued at zero.
 */
export function valueStock(
  data: StockData,
  businessId: string,
  asOf: ISODate,
  method: ValuationMethod = 'WEIGHTED_AVERAGE',
): StockValuation {
  const acc = new Map<string, CostSoFar>();
  for (const m of stockMovements(data, businessId, asOf)) addMovement(acc, m);
  const lines = valuationLines(data, businessId, acc, method);
  return { asOf, method, lines, total: totalOf(lines) };
}

function valuationLines(data: StockData, businessId: string, acc: ReadonlyMap<string, CostSoFar>, method: ValuationMethod): ValuationLine[] {
  const lines: ValuationLine[] = [];
  for (const p of data.products) {
    if (p.businessId !== businessId || p.kind !== 'GOODS' || !p.trackStock) continue;
    const a = acc.get(p.id) ?? { qty: 0, costQty: 0, costValue: 0, last: 0 };
    let rate = p.purchasePrice;
    if (method === 'WEIGHTED_AVERAGE' && a.costQty > 0) rate = a.costValue / a.costQty;
    if (method === 'LAST_PURCHASE' && a.last > 0) rate = a.last;
    const qty = roundTo(a.qty, 4);
    rate = roundTo(rate, 4);
    lines.push({ productId: p.id, name: p.name, hsn: p.hsn, unit: p.unit, qty, rate, value: roundTo(Math.max(0, qty) * rate) });
  }
  return lines;
}

export function closingStockValue(data: StockData, businessId: string, asOf: ISODate, method?: ValuationMethod): number {
  return valueStock(data, businessId, asOf, method).total;
}

/**
 * `closingStockValue` on each of `dates` (in any order), from one pass over the stock movements
 * instead of one per date (review Y13: the month-by-month P&L valued the stock 24 times).
 */
export function closingStockValues(
  data: StockData,
  businessId: string,
  dates: readonly ISODate[],
  method: ValuationMethod = 'WEIGHTED_AVERAGE',
): number[] {
  const order = dates.map((date, i) => ({ date, i })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: number[] = [];
  if (!order.length) return out;
  // Movements come oldest first, so the movements up to each date are a run from the start of the list.
  const moves = stockMovements(data, businessId, order[order.length - 1].date);
  const acc = new Map<string, CostSoFar>();
  let next = 0;
  for (const { date, i } of order) {
    // Opening stock counts on every date, as in stockMovements.
    while (next < moves.length && (moves[next].source === 'OPENING' || moves[next].date <= date)) addMovement(acc, moves[next++]);
    out[i] = totalOf(valuationLines(data, businessId, acc, method));
  }
  return out;
}
