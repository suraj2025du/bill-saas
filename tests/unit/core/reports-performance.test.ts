import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  balanceSheet,
  buildBooks,
  ledgerStatement,
  monthlyPnl,
  payablesAgeing,
  profitAndLoss,
  receivablesAgeing,
  trialBalance,
} from '../../../src/core/accounting/reports';
import type { Books, BooksInput } from '../../../src/core/accounting/reports';
import { monthRange } from '../../../src/core/dates';
import { OPENING_DATE } from '../../../src/core/inventory/stock';
import type { StockData } from '../../../src/core/inventory/stock';
import { closingStockValue, closingStockValues } from '../../../src/core/inventory/valuation';
import { roundTo } from '../../../src/core/money';
import { LARGE_AS_OF, largeBooksInput } from '../../fixtures/large';

// Speed of the reports at the size the code review measured: 2,000 parties, 10,000 invoices and
// 10,000 receipts (review R4: 17,979 ms for one receivables ageing; Y13: 3,721 ms for the
// month-by-month P&L). Each budget is the slowest time allowed on this PC, in milliseconds: about five
// times the time measured after the fix under coverage (books 164, receivables 86, payables 33, P&L 97)
// and far below the old code on the same data (receivables 6,175, payables 940, P&L 1,785). The
// measurements are in docs/reviews/fixes/2026-11-07-03-speed.md.
const BUDGET_MS = { books: 1_000, receivables: 500, payables: 200, monthlyPnl: 500 };

/** Fastest of three runs, so one garbage-collection pause or a busy moment on the PC does not decide the result. */
function fastest(run: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return Math.round(best);
}

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

let input: BooksInput;
let books: Books;

beforeAll(() => {
  input = largeBooksInput();
  books = buildBooks(input);
});

// The long timeouts let a slow report fail on its budget, with the time it took, instead of on the 5 s test timeout.
describe('report speed with 2,000 parties and 10,000 invoices (review R4, Y13)', { timeout: 120_000 }, () => {
  it('builds the books within the budget', () => {
    expect(fastest(() => buildBooks(input))).toBeLessThan(BUDGET_MS.books);
  });

  it('builds the receivables ageing within the budget (Parties list, party page, Outstanding)', () => {
    expect(fastest(() => receivablesAgeing(books, LARGE_AS_OF))).toBeLessThan(BUDGET_MS.receivables);
  });

  it('builds the payables ageing within the budget', () => {
    expect(fastest(() => payablesAgeing(books, LARGE_AS_OF))).toBeLessThan(BUDGET_MS.payables);
  });

  it('builds the month-by-month P&L within the budget', () => {
    expect(fastest(() => monthlyPnl(books, LARGE_AS_OF))).toBeLessThan(BUDGET_MS.monthlyPnl);
  });
});

describe('the same figures on large data (review R4, Y13)', { timeout: 120_000 }, () => {
  it('builds the same reports as the code before this fix', () => {
    // Computed with the code as it was before review batch 03 (one journal scan per party, one stock valuation per
    // month end), on tests/fixtures/large.ts. A deliberate change to one of these reports, or to that data set,
    // changes its fingerprint: check the new figures, then update the value here.
    const rec = receivablesAgeing(books, LARGE_AS_OF);
    const pay = payablesAgeing(books, LARGE_AS_OF);
    const fy = profitAndLoss(books, '2026-04-01', LARGE_AS_OF);
    expect({
      receivableRows: rec.length,
      receivable: roundTo(rec.reduce((s, r) => s + r.total, 0)),
      payableRows: pay.length,
      payable: roundTo(pay.reduce((s, r) => s + r.total, 0)),
      netProfit: fy.netProfit,
      receivables: fingerprint(rec),
      receivablesMidYear: fingerprint(receivablesAgeing(books, '2026-10-15')),
      payables: fingerprint(pay),
      monthlyPnl: fingerprint(monthlyPnl(books, LARGE_AS_OF)),
      monthlyPnlMidMonth: fingerprint(monthlyPnl(books, '2026-10-15')),
      pnl: fingerprint(fy),
      balanceSheet: fingerprint(balanceSheet(books, LARGE_AS_OF)),
      trialBalance: fingerprint(trialBalance(books, LARGE_AS_OF)),
    }).toEqual({
      receivableRows: 906,
      receivable: 3_134_280,
      payableRows: 200,
      payable: 809_116,
      netProfit: 988_027.5,
      receivables: '418212f158554426',
      receivablesMidYear: 'a4696e63cc4c0ebb',
      payables: '86d51a94446ba5fb',
      monthlyPnl: 'e69020c974cca470',
      monthlyPnlMidMonth: 'cc5ad780f64d7060',
      pnl: '904c43f010eb603e',
      balanceSheet: 'e37aa4800a033729',
      trialBalance: '6bd243c088a50790',
    });
  });

  it("gives every party in the ageing its ledger balance as the total", () => {
    const rec = receivablesAgeing(books, LARGE_AS_OF);
    const pay = payablesAgeing(books, LARGE_AS_OF);
    const closing = (ledgerId: string) => ledgerStatement(books, ledgerId, OPENING_DATE, LARGE_AS_OF).closing;
    for (const row of rec.filter((_, i) => i % 50 === 0)) expect(row.total).toBeCloseTo(closing(row.ledgerId), 2);
    for (const row of pay.filter((_, i) => i % 10 === 0)) expect(row.total).toBeCloseTo(-closing(row.ledgerId), 2);
  });

  it('gives each month of the month-by-month P&L the figures of that month on its own', () => {
    const months = monthlyPnl(books, LARGE_AS_OF);
    expect(months).toHaveLength(12);
    for (const m of months) {
      const r = monthRange(m.month);
      const p = profitAndLoss(books, r.start, r.end);
      expect(m.stockChange).toBe(roundTo(p.closingStock - p.openingStock));
      expect(m.grossProfit).toBe(p.grossProfit);
      expect(m.netProfit).toBe(p.netProfit);
    }
  });

  it('values the stock on several dates exactly as on each date alone', () => {
    const data: StockData = { products: input.products, invoices: input.invoices, purchases: input.purchases };
    // Out of order, with dates before any stock (and before the opening stock), inside and after the year.
    const dates = ['2026-10-31', OPENING_DATE, '2026-03-31', '2026-04-30', '0000-12-31', LARGE_AS_OF, '2027-12-31', '2026-04-30'];
    for (const method of ['WEIGHTED_AVERAGE', 'LAST_PURCHASE', 'STANDARD_COST'] as const) {
      const one = dates.map((d) => closingStockValue(data, input.business.id, d, method));
      expect(closingStockValues(data, input.business.id, dates, method)).toEqual(one);
    }
    expect(closingStockValues(data, input.business.id, [])).toEqual([]);
  });
});
