import { addDays, daysBetween, fyOf, listMonths, monthRange } from '../dates';
import type { FinancialYear } from '../dates';
import { buildPaymentIndex, purchasePaymentSummary, salesPaymentSummary } from '../docs/payments';
import { DOC_TYPES } from '../docs/docTypes';
import { OPENING_DATE } from '../inventory/stock';
import type { StockData } from '../inventory/stock';
import { closingStockValue, closingStockValues } from '../inventory/valuation';
import type { ValuationMethod } from '../inventory/valuation';
import { GROUP_LABELS, PNL_GROUPS, bankLedgerId, parseLedgerRef, partyLedgerId, resolveLedger } from '../ledgers';
import type { LedgerLookup, ResolvedLedger } from '../ledgers';
import type { ISODate, Ledger, LedgerGroup, Party, Product } from '../model';
import { roundTo } from '../money';
import type { BooksData, JournalEntry } from './postings';
import { OTHER_SUPPLIERS_LEDGER, WALKIN_LEDGER, buildJournal, fxFactor } from './postings';

export interface BooksInput extends BooksData {
  parties: readonly Party[];
  ledgers: readonly Ledger[];
  products: readonly Product[];
}

export interface Books {
  input: BooksInput;
  journal: JournalEntry[];
  /** Opening balance per ledger (Dr positive, Cr negative). */
  openings: Map<string, number>;
  lookup: LedgerLookup;
  fyStartMonth: number;
  valuation: ValuationMethod;
}

export function buildBooks(input: BooksInput, valuation: ValuationMethod = 'WEIGHTED_AVERAGE'): Books {
  const biz = input.business;
  const openings = new Map<string, number>();
  const add = (id: string, amount: number) => {
    if (amount) openings.set(id, roundTo((openings.get(id) ?? 0) + amount));
  };
  for (const p of input.parties) {
    if (p.businessId === biz.id) add(partyLedgerId(p.id), p.openingType === 'CR' ? -p.openingBalance : p.openingBalance);
  }
  for (const b of biz.bankAccounts) add(bankLedgerId(b.id), b.openingBalance);
  for (const l of input.ledgers) {
    // Income and expense ledgers start every year at zero, so they carry no opening balance.
    if (l.businessId === biz.id && !PNL_GROUPS.has(l.group)) {
      add(l.id, l.openingType === 'CR' ? -l.openingBalance : l.openingBalance);
    }
  }
  return {
    input,
    journal: buildJournal(input),
    openings,
    lookup: { business: biz, parties: input.parties, ledgers: input.ledgers },
    fyStartMonth: biz.fyStartMonth || 4,
    valuation,
  };
}

/**
 * Ledgers already resolved for a set of books. A report asks for the same party ledgers again and again
 * (each P&L section, each month), and resolving one searches the whole party list (review Y13).
 */
const resolved = new WeakMap<Books, Map<string, ResolvedLedger>>();

/** Ledger name and group; records that were deleted still resolve so totals stay complete. */
export function ledgerInfo(books: Books, id: string): ResolvedLedger {
  let known = resolved.get(books);
  if (!known) {
    known = new Map();
    resolved.set(books, known);
  }
  let info = known.get(id);
  if (!info) {
    info = resolveLedger(id, books.lookup) ?? deletedLedger(id);
    known.set(id, info);
  }
  return info;
}

function deletedLedger(id: string): ResolvedLedger {
  const ref = parseLedgerRef(id);
  const group: LedgerGroup = ref.kind === 'party' ? 'SUNDRY_DEBTORS' : ref.kind === 'bank' ? 'BANK' : 'SUSPENSE';
  return { id, name: `${id} (deleted)`, group, kind: ref.kind };
}

function stockData(books: Books): StockData {
  return { products: books.input.products, invoices: books.input.invoices, purchases: books.input.purchases };
}

export function stockValueOn(books: Books, date: ISODate): number {
  return closingStockValue(stockData(books), books.input.business.id, date, books.valuation);
}

/** Opening stock from the product master (before any purchase or sale). */
export function masterOpeningStock(books: Books): number {
  return stockValueOn(books, OPENING_DATE);
}

/** Signed (Dr+) movement per ledger for entries with from <= date <= to. */
function movements(books: Books, from: ISODate, to: ISODate): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of books.journal) {
    if (e.date < from || e.date > to) continue;
    for (const l of e.lines) out.set(l.ledgerId, roundTo((out.get(l.ledgerId) ?? 0) + l.dr - l.cr));
  }
  return out;
}

const isPnl = (books: Books, id: string) => PNL_GROUPS.has(ledgerInfo(books, id).group);

/**
 * Balance of every ledger on `asOf`: balance-sheet ledgers carry their whole
 * history; income and expense ledgers count only the financial year so far.
 */
export function balancesOn(books: Books, asOf: ISODate): Map<string, number> {
  const fy = fyOf(asOf, books.fyStartMonth);
  const all = movements(books, OPENING_DATE, asOf);
  const out = new Map<string, number>();
  for (const [id, amount] of books.openings) if (!isPnl(books, id)) out.set(id, amount);
  for (const [id, amount] of all) {
    if (isPnl(books, id)) continue;
    out.set(id, roundTo((out.get(id) ?? 0) + amount));
  }
  for (const [id, amount] of movements(books, fy.start, asOf)) {
    if (isPnl(books, id)) out.set(id, amount);
  }
  return out;
}

// ---------------------------------------------------------------- ledger statement

export interface StatementRow {
  date: ISODate;
  voucherType: string;
  voucherNo: string;
  narration: string;
  /** Main counter-ledger of the entry. */
  against: string;
  dr: number;
  cr: number;
  /** Running balance, Dr positive. */
  balance: number;
  sourceType: JournalEntry['sourceType'];
  sourceId: string;
}

export interface LedgerStatement {
  ledger: ResolvedLedger;
  from: ISODate;
  to: ISODate;
  opening: number;
  rows: StatementRow[];
  totalDr: number;
  totalCr: number;
  closing: number;
}

function counterLedger(books: Books, e: JournalEntry, ledgerId: string, side: 'dr' | 'cr'): string {
  const others = e.lines.filter((l) => l.ledgerId !== ledgerId && (side === 'dr' ? l.cr : l.dr) > 0);
  if (!others.length) return '';
  const main = others.reduce((a, b) => ((side === 'dr' ? b.cr : b.dr) > (side === 'dr' ? a.cr : a.dr) ? b : a));
  const name = ledgerInfo(books, main.ledgerId).name;
  return others.length > 1 ? `${name} & others` : name;
}

export function ledgerStatement(books: Books, ledgerId: string, from: ISODate, to: ISODate): LedgerStatement {
  const ledger = ledgerInfo(books, ledgerId);
  const pnl = PNL_GROUPS.has(ledger.group);
  const openFrom = pnl ? fyOf(from, books.fyStartMonth).start : OPENING_DATE;
  let opening = pnl ? 0 : (books.openings.get(ledgerId) ?? 0);
  const rows: StatementRow[] = [];
  let totalDr = 0;
  let totalCr = 0;
  for (const e of books.journal) {
    if (e.date > to) break;
    const mine = e.lines.filter((l) => l.ledgerId === ledgerId);
    if (!mine.length) continue;
    const dr = roundTo(mine.reduce((s, l) => s + l.dr, 0));
    const cr = roundTo(mine.reduce((s, l) => s + l.cr, 0));
    if (e.date < from) {
      if (e.date >= openFrom) opening = roundTo(opening + dr - cr);
      continue;
    }
    totalDr = roundTo(totalDr + dr);
    totalCr = roundTo(totalCr + cr);
    rows.push({
      date: e.date,
      voucherType: e.voucherType,
      voucherNo: e.voucherNo,
      narration: e.narration,
      against: counterLedger(books, e, ledgerId, dr >= cr ? 'dr' : 'cr'),
      dr,
      cr,
      balance: 0,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
    });
  }
  let running = opening;
  for (const r of rows) {
    running = roundTo(running + r.dr - r.cr);
    r.balance = running;
  }
  return { ledger, from, to, opening, rows, totalDr, totalCr, closing: running };
}

// ---------------------------------------------------------------- trial balance

export interface TrialRow {
  id: string;
  name: string;
  group: LedgerGroup | 'OPENING_STOCK' | 'PNL_PRIOR' | 'DIFFERENCE';
  dr: number;
  cr: number;
}

export interface TrialBalance {
  asOf: ISODate;
  fy: FinancialYear;
  rows: TrialRow[];
  totalDr: number;
  totalCr: number;
}

function signedRow(id: string, name: string, group: TrialRow['group'], amount: number): TrialRow {
  return { id, name, group, dr: amount > 0 ? amount : 0, cr: amount < 0 ? -amount : 0 };
}

/** Sum of Cr - Dr of income/expense ledgers for entries in [from, to]. */
function pnlPostings(books: Books, from: ISODate, to: ISODate): number {
  let p = 0;
  for (const [id, amount] of movements(books, from, to)) if (isPnl(books, id)) p -= amount;
  return roundTo(p);
}

/** Profit of the years before `fy` (postings plus the stock built up meanwhile). */
function priorProfit(books: Books, fy: FinancialYear): number {
  const dayBefore = addDays(fy.start, -1);
  const pPrior = pnlPostings(books, OPENING_DATE, dayBefore);
  return roundTo(pPrior + stockValueOn(books, dayBefore) - masterOpeningStock(books));
}

/** Total opening balances (Dr - Cr) including master opening stock; non-zero means the books need capital. */
export function openingDifference(books: Books): number {
  let o = 0;
  for (const v of books.openings.values()) o += v;
  return roundTo(o + masterOpeningStock(books));
}

export function trialBalance(books: Books, asOf: ISODate): TrialBalance {
  const fy = fyOf(asOf, books.fyStartMonth);
  const rows: TrialRow[] = [];
  for (const [id, amount] of balancesOn(books, asOf)) {
    if (!amount) continue;
    const info = ledgerInfo(books, id);
    rows.push(signedRow(id, info.name, info.group, amount));
  }
  rows.sort((a, b) => (a.group === b.group ? a.name.localeCompare(b.name) : String(a.group).localeCompare(String(b.group))));
  const openingStock = stockValueOn(books, addDays(fy.start, -1));
  if (openingStock) rows.push(signedRow('opening-stock', 'Opening Stock', 'OPENING_STOCK', openingStock));
  const prior = priorProfit(books, fy);
  if (prior) rows.push(signedRow('pnl-prior', 'Profit & Loss A/c (earlier years)', 'PNL_PRIOR', -prior));
  const diff = openingDifference(books);
  if (diff) rows.push(signedRow('opening-diff', 'Difference in opening balances', 'DIFFERENCE', -diff));
  const totalDr = roundTo(rows.reduce((s, r) => s + r.dr, 0));
  const totalCr = roundTo(rows.reduce((s, r) => s + r.cr, 0));
  return { asOf, fy, rows, totalDr, totalCr };
}

// ---------------------------------------------------------------- profit & loss

export interface ReportLine {
  id: string;
  name: string;
  amount: number;
}

export interface ReportSection {
  key: string;
  label: string;
  lines: ReportLine[];
  total: number;
}

export interface ProfitAndLoss {
  from: ISODate;
  to: ISODate;
  openingStock: number;
  closingStock: number;
  sales: ReportSection;
  directIncome: ReportSection;
  purchases: ReportSection;
  directExpenses: ReportSection;
  grossProfit: number;
  indirectIncome: ReportSection;
  indirectExpenses: ReportSection;
  netProfit: number;
}

function section(books: Books, moves: Map<string, number>, group: LedgerGroup, sign: 1 | -1): ReportSection {
  const lines: ReportLine[] = [];
  for (const [id, amount] of moves) {
    const info = ledgerInfo(books, id);
    if (info.group !== group || !amount) continue;
    lines.push({ id, name: info.name, amount: roundTo(sign * amount) });
  }
  lines.sort((a, b) => b.amount - a.amount);
  return { key: group, label: GROUP_LABELS[group], lines, total: roundTo(lines.reduce((s, l) => s + l.amount, 0)) };
}

export function profitAndLoss(books: Books, from: ISODate, to: ISODate): ProfitAndLoss {
  return pnlWithStock(books, from, to, stockValueOn(books, addDays(from, -1)), stockValueOn(books, to));
}

function pnlWithStock(books: Books, from: ISODate, to: ISODate, openingStock: number, closingStock: number): ProfitAndLoss {
  const moves = movements(books, from, to);
  const sales = section(books, moves, 'SALES', -1);
  const directIncome = section(books, moves, 'DIRECT_INCOME', -1);
  const purchases = section(books, moves, 'PURCHASE', 1);
  const directExpenses = section(books, moves, 'DIRECT_EXPENSES', 1);
  const indirectIncome = section(books, moves, 'INDIRECT_INCOME', -1);
  const indirectExpenses = section(books, moves, 'INDIRECT_EXPENSES', 1);
  const grossProfit = roundTo(
    sales.total + directIncome.total + closingStock - openingStock - purchases.total - directExpenses.total,
  );
  const netProfit = roundTo(grossProfit + indirectIncome.total - indirectExpenses.total);
  return {
    from,
    to,
    openingStock,
    closingStock,
    sales,
    directIncome,
    purchases,
    directExpenses,
    grossProfit,
    indirectIncome,
    indirectExpenses,
    netProfit,
  };
}

export interface MonthlyPnlRow {
  month: string;
  sales: number;
  purchases: number;
  stockChange: number;
  directExpenses: number;
  grossProfit: number;
  indirectIncome: number;
  indirectExpenses: number;
  netProfit: number;
}

/** Month-by-month P&L for the financial year containing `asOf`, up to that date. */
export function monthlyPnl(books: Books, asOf: ISODate): MonthlyPnlRow[] {
  const fy = fyOf(asOf, books.fyStartMonth);
  const months = listMonths(fy.start, asOf).map((month) => {
    const r = monthRange(month);
    return { month, from: r.start, to: r.end < asOf ? r.end : asOf };
  });
  // Opening and closing stock of every month from one pass over the stock movements (review Y13).
  const dates = months.flatMap((m) => [addDays(m.from, -1), m.to]);
  const stock = closingStockValues(stockData(books), books.input.business.id, dates, books.valuation);
  return months.map(({ month, from, to }, i) => {
    const p = pnlWithStock(books, from, to, stock[2 * i], stock[2 * i + 1]);
    return {
      month,
      sales: roundTo(p.sales.total + p.directIncome.total),
      purchases: p.purchases.total,
      stockChange: roundTo(p.closingStock - p.openingStock),
      directExpenses: p.directExpenses.total,
      grossProfit: p.grossProfit,
      indirectIncome: p.indirectIncome.total,
      indirectExpenses: p.indirectExpenses.total,
      netProfit: p.netProfit,
    };
  });
}

// ---------------------------------------------------------------- balance sheet

export interface BalanceSheet {
  asOf: ISODate;
  liabilities: ReportSection[];
  assets: ReportSection[];
  closingStock: number;
  profitPrior: number;
  profitCurrent: number;
  openingDifference: number;
  totalLiabilities: number;
  totalAssets: number;
}

const LIABILITY_GROUPS: readonly LedgerGroup[] = [
  'CAPITAL',
  'RESERVES',
  'LOANS',
  'CURRENT_LIABILITIES',
  'DUTIES_TAXES',
  'PROVISIONS',
  'SUNDRY_CREDITORS',
  'SUSPENSE',
];
const ASSET_GROUPS: readonly LedgerGroup[] = [
  'FIXED_ASSETS',
  'INVESTMENTS',
  'STOCK',
  'SUNDRY_DEBTORS',
  'CASH',
  'BANK',
  'LOANS_ADVANCES',
  'DEPOSITS',
  'CURRENT_ASSETS',
];

export function balanceSheet(books: Books, asOf: ISODate): BalanceSheet {
  const fy = fyOf(asOf, books.fyStartMonth);
  const balances = balancesOn(books, asOf);
  const closingStock = stockValueOn(books, asOf);
  const liabilities = LIABILITY_GROUPS.map((g) => section(books, balances, g, -1)).filter((s) => s.lines.length);
  const assets = ASSET_GROUPS.map((g) => {
    const s = section(books, balances, g, 1);
    if (g === 'STOCK' && closingStock) {
      s.lines.unshift({ id: 'closing-stock', name: 'Closing Stock', amount: closingStock });
      s.total = roundTo(s.total + closingStock);
    }
    return s;
  }).filter((s) => s.lines.length);
  const profitPrior = priorProfit(books, fy);
  const profitCurrent = profitAndLoss(books, fy.start, asOf).netProfit;
  const diff = openingDifference(books);
  const totalLiabilities = roundTo(liabilities.reduce((s, x) => s + x.total, 0) + profitPrior + profitCurrent + diff);
  const totalAssets = roundTo(assets.reduce((s, x) => s + x.total, 0));
  return {
    asOf,
    liabilities,
    assets,
    closingStock,
    profitPrior,
    profitCurrent,
    openingDifference: diff,
    totalLiabilities,
    totalAssets,
  };
}

// ---------------------------------------------------------------- outstanding / ageing

export const AGEING_BUCKETS = ['0-30 days', '31-60 days', '61-90 days', '90+ days'] as const;

export interface AgeingRow {
  ledgerId: string;
  name: string;
  phone: string;
  buckets: [number, number, number, number];
  /** Bill-wise outstanding (sum of buckets). */
  bills: number;
  /** Advances, opening balances and receipts not linked to a bill. */
  onAccount: number;
  /** Ledger balance: bills + on account. */
  total: number;
  billCount: number;
}

function bucketOf(days: number): 0 | 1 | 2 | 3 {
  if (days <= 30) return 0;
  if (days <= 60) return 1;
  if (days <= 90) return 2;
  return 3;
}

/**
 * Balance (Dr positive, not rounded) of every ledger on `asOf`, from one pass over the journal.
 * The ageing reports used to scan the whole journal once per party (review R4).
 */
function ledgerBalancesOn(books: Books, asOf: ISODate): Map<string, number> {
  const bal = new Map(books.openings);
  for (const e of books.journal) {
    if (e.date > asOf) break;
    for (const l of e.lines) bal.set(l.ledgerId, (bal.get(l.ledgerId) ?? 0) + (l.dr - l.cr));
  }
  return bal;
}

function finishAgeing(books: Books, rows: Map<string, AgeingRow>, asOf: ISODate, sign: 1 | -1, parties: ReadonlyMap<string, Party>): AgeingRow[] {
  const balances = ledgerBalancesOn(books, asOf);
  const isBoth = (ledgerId: string) => {
    const ref = parseLedgerRef(ledgerId);
    return ref.kind === 'party' && parties.get(ref.key)?.kind === 'BOTH';
  };
  for (const row of rows.values()) {
    row.bills = roundTo(row.buckets.reduce((s, x) => s + x, 0));
    row.total = roundTo(sign * (balances.get(row.ledgerId) ?? 0));
    row.onAccount = roundTo(row.total - row.bills);
  }
  return [...rows.values()]
    .filter((r) => r.bills > 0 || r.total > 0 || (r.total < 0 && !isBoth(r.ledgerId)))
    .sort((a, b) => b.total - a.total);
}

const partiesById = (books: Books) => new Map(books.input.parties.map((p) => [p.id, p]));

function ageingRow(books: Books, ledgerId: string, parties: ReadonlyMap<string, Party>): AgeingRow {
  const ref = parseLedgerRef(ledgerId);
  const party = ref.kind === 'party' ? parties.get(ref.key) : undefined;
  return {
    ledgerId,
    name: ledgerInfo(books, ledgerId).name,
    phone: party?.phone ?? '',
    buckets: [0, 0, 0, 0],
    bills: 0,
    onAccount: 0,
    total: 0,
    billCount: 0,
  };
}

/** Customer outstanding by invoice age, with the ledger balance as the total. */
export function receivablesAgeing(books: Books, asOf: ISODate): AgeingRow[] {
  const { input } = books;
  const biz = input.business;
  const upTo = <T extends { businessId: string; date: string }>(rows: readonly T[]) =>
    rows.filter((r) => r.businessId === biz.id && r.date <= asOf);
  const invoices = upTo(input.invoices);
  const index = buildPaymentIndex(upTo(input.receipts), upTo(input.vouchers), invoices, [], biz);
  const parties = partiesById(books);
  const rows = new Map<string, AgeingRow>();
  const rowFor = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = ageingRow(books, id, parties);
      rows.set(id, r);
    }
    return r;
  };
  for (const doc of invoices) {
    if (!DOC_TYPES[doc.docType].payable) continue;
    const s = salesPaymentSummary(doc, index, asOf);
    if (s.status === 'NOT_APPLICABLE' || s.balance <= 0) continue;
    const row = rowFor(doc.partyId ? partyLedgerId(doc.partyId) : WALKIN_LEDGER);
    const b = bucketOf(daysBetween(doc.date, asOf));
    row.buckets[b] = roundTo(row.buckets[b] + s.balance * fxFactor(biz, doc.currency, doc.exchangeRate));
    row.billCount += 1;
  }
  for (const p of input.parties) {
    if (p.businessId === biz.id && p.kind !== 'SUPPLIER') rowFor(partyLedgerId(p.id));
  }
  rowFor(WALKIN_LEDGER);
  return finishAgeing(books, rows, asOf, 1, parties);
}

/** Supplier outstanding by bill age (what we owe). */
export function payablesAgeing(books: Books, asOf: ISODate): AgeingRow[] {
  const { input } = books;
  const biz = input.business;
  const mine = <T extends { businessId: string }>(rows: readonly T[]) => rows.filter((r) => r.businessId === biz.id);
  const bills = mine(input.purchases).filter((b) => b.billDate <= asOf);
  const index = buildPaymentIndex(
    mine(input.receipts).filter((r) => r.date <= asOf),
    mine(input.vouchers).filter((v) => v.date <= asOf),
    [],
    bills,
    biz,
  );
  const parties = partiesById(books);
  const rows = new Map<string, AgeingRow>();
  const rowFor = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = ageingRow(books, id, parties);
      rows.set(id, r);
    }
    return r;
  };
  for (const bill of bills) {
    const s = purchasePaymentSummary(bill, index, asOf);
    if (s.status === 'NOT_APPLICABLE' || s.balance <= 0) continue;
    const row = rowFor(bill.supplierId ? partyLedgerId(bill.supplierId) : OTHER_SUPPLIERS_LEDGER);
    const b = bucketOf(daysBetween(bill.billDate, asOf));
    row.buckets[b] = roundTo(row.buckets[b] + s.balance * fxFactor(biz, bill.currency, bill.exchangeRate));
    row.billCount += 1;
  }
  for (const p of input.parties) {
    if (p.businessId === biz.id && p.kind !== 'CUSTOMER') rowFor(partyLedgerId(p.id));
  }
  rowFor(OTHER_SUPPLIERS_LEDGER);
  return finishAgeing(books, rows, asOf, -1, parties);
}
