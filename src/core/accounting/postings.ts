import { DOC_TYPES } from '../docs/docTypes';
import { bankLedgerId, partyLedgerId } from '../ledgers';
import type {
  Business,
  DocTotals,
  Expense,
  ISODate,
  PaymentRecord,
  PurchaseBill,
  SalesDocument,
  SupplyKind,
  Voucher,
} from '../model';
import { roundTo } from '../money';

/**
 * Double-entry postings generated from the business records. Nothing here is
 * stored: the books are rebuilt from invoices, bills, expenses, payments and
 * vouchers, so a corrected invoice always corrects the ledgers too.
 *
 * Amounts are in the business (book) currency. A document in another
 * currency is converted with its `exchangeRate` (book currency per 1 unit).
 */
export type SourceType = 'SALES' | 'PURCHASE' | 'EXPENSE' | 'RECEIPT' | 'PAYMENT' | 'VOUCHER';

export interface JournalLine {
  ledgerId: string;
  dr: number;
  cr: number;
}

export interface JournalEntry {
  /** `${sourceType}:${sourceId}` */
  id: string;
  date: ISODate;
  sourceType: SourceType;
  sourceId: string;
  voucherType: string;
  voucherNo: string;
  narration: string;
  lines: JournalLine[];
}

export interface BooksData {
  business: Business;
  invoices: readonly SalesDocument[];
  purchases: readonly PurchaseBill[];
  expenses: readonly Expense[];
  receipts: readonly PaymentRecord[];
  vouchers: readonly Voucher[];
}

export const WALKIN_LEDGER = 'sys:walkin';
export const OTHER_SUPPLIERS_LEDGER = 'sys:other-suppliers';
export const FX_GAIN_LOSS_LEDGER = 'sys:fx-gain-loss';

/** Book-currency factor for a document. */
export function fxFactor(business: Pick<Business, 'currency'>, currency: string, exchangeRate: number): number {
  if (!currency || currency === business.currency) return 1;
  return exchangeRate > 0 ? exchangeRate : 1;
}

/**
 * Currency of a payment and its rate to the book currency (review R1). Payments saved before they
 * carried a currency were entered in the linked document's currency (the payment dialog asked for
 * that amount), so they are valued at that document's rate and book no exchange difference; a
 * payment with no linked document is in the book currency.
 */
export function paymentFx(
  rec: Pick<PaymentRecord, 'currency' | 'exchangeRate'>,
  doc: Pick<SalesDocument, 'currency' | 'exchangeRate'> | undefined,
  business: Pick<Business, 'currency'>,
): { currency: string; rate: number } {
  if (!rec.currency) {
    if (doc) return { currency: doc.currency || business.currency, rate: fxFactor(business, doc.currency, doc.exchangeRate) };
    return { currency: business.currency, rate: 1 };
  }
  if (rec.currency === business.currency) return { currency: rec.currency, rate: 1 };
  const rate = rec.exchangeRate ?? 0;
  if (rate > 0) return { currency: rec.currency, rate };
  // A foreign amount without a rate (a hand-edited backup): value it like an older payment.
  return { currency: rec.currency, rate: doc && doc.currency === rec.currency ? fxFactor(business, doc.currency, doc.exchangeRate) : 1 };
}

class EntryBuilder {
  private readonly map = new Map<string, JournalLine>();

  constructor(private readonly fx: number) {}

  dr(ledgerId: string, amount: number): this {
    return this.add(ledgerId, amount, 0);
  }

  cr(ledgerId: string, amount: number): this {
    return this.add(ledgerId, 0, amount);
  }

  private add(ledgerId: string, dr: number, cr: number): this {
    const d = roundTo(dr * this.fx);
    const c = roundTo(cr * this.fx);
    if (!d && !c) return this;
    const line = this.map.get(ledgerId) ?? { ledgerId, dr: 0, cr: 0 };
    line.dr = roundTo(line.dr + d);
    line.cr = roundTo(line.cr + c);
    this.map.set(ledgerId, line);
    return this;
  }

  /** Net each ledger to one side and absorb conversion rounding in Round Off. */
  lines(): JournalLine[] {
    const out: JournalLine[] = [];
    let diff = 0;
    for (const l of this.map.values()) {
      const net = roundTo(l.dr - l.cr);
      if (!net) continue;
      out.push({ ledgerId: l.ledgerId, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0 });
      diff = roundTo(diff + net);
    }
    if (diff) {
      const ro = out.find((l) => l.ledgerId === 'sys:round-off');
      if (ro) {
        const net = roundTo(ro.dr - ro.cr - diff);
        ro.dr = net > 0 ? net : 0;
        ro.cr = net < 0 ? -net : 0;
      } else {
        out.push({ ledgerId: 'sys:round-off', dr: diff < 0 ? -diff : 0, cr: diff > 0 ? diff : 0 });
      }
    }
    return out.filter((l) => l.dr || l.cr);
  }
}

function salesLedger(doc: SalesDocument): string {
  if (doc.docType === 'CREDIT_NOTE') return 'sys:sales-return';
  if (doc.docType === 'BILL_OF_SUPPLY') return 'sys:sales-exempt';
  if (doc.supplyKind === 'EXPORT' || doc.supplyKind === 'SEZ') return 'sys:sales-export';
  return 'sys:sales';
}

interface TaxSplit {
  cgst: number;
  sgst: number;
  utgst: number;
  igst: number;
  cess: number;
}

function taxSplit(t: Pick<DocTotals, 'cgst' | 'sgst' | 'utgst' | 'igst' | 'cess'>): TaxSplit {
  return { cgst: t.cgst, sgst: t.sgst, utgst: t.utgst, igst: t.igst, cess: t.cess };
}

function postTaxes(b: EntryBuilder, side: 'dr' | 'cr', prefix: 'out' | 'in', t: TaxSplit, supplyKind: SupplyKind | 'NON_GST'): void {
  const post = (ledger: string, amount: number) => (side === 'dr' ? b.dr(ledger, amount) : b.cr(ledger, amount));
  if (supplyKind === 'NON_GST') {
    post(`sys:${prefix}-vat`, t.igst + t.cgst + t.sgst + t.utgst);
    post(`sys:${prefix}-cess`, t.cess);
    return;
  }
  post(`sys:${prefix}-cgst`, t.cgst);
  post(`sys:${prefix}-sgst`, t.sgst);
  post(`sys:${prefix}-utgst`, t.utgst);
  post(`sys:${prefix}-igst`, t.igst);
  post(`sys:${prefix}-cess`, t.cess);
}

function partyOrWalkin(partyId: string, fallback: string): string {
  return partyId ? partyLedgerId(partyId) : fallback;
}

/** Sales, debit note or credit note. Quotations, proformas and challans do not post. */
export function salesEntry(doc: SalesDocument, business: Business): JournalEntry | null {
  const meta = DOC_TYPES[doc.docType];
  if (!meta.postsToAccounts || doc.status !== 'FINAL') return null;
  const t = doc.totals;
  const b = new EntryBuilder(fxFactor(business, doc.currency, doc.exchangeRate));
  const party = partyOrWalkin(doc.partyId, WALKIN_LEDGER);
  const returning = doc.docType === 'CREDIT_NOTE';
  // Reverse charge: the recipient pays the tax, so it is not collected here.
  const taxes = doc.reverseCharge ? taxSplit({ cgst: 0, sgst: 0, utgst: 0, igst: 0, cess: 0 }) : taxSplit(t);
  if (!returning) {
    b.dr(party, t.net);
    b.dr('sys:tds-receivable', t.tds);
    b.cr(salesLedger(doc), t.taxable);
    postTaxes(b, 'cr', 'out', taxes, doc.supplyKind);
    b.cr('sys:tcs-payable', t.tcs);
    if (t.roundOff > 0) b.cr('sys:round-off', t.roundOff);
    else b.dr('sys:round-off', -t.roundOff);
  } else {
    b.cr(party, t.net);
    b.cr('sys:tds-receivable', t.tds);
    b.dr(salesLedger(doc), t.taxable);
    postTaxes(b, 'dr', 'out', taxes, doc.supplyKind);
    b.dr('sys:tcs-payable', t.tcs);
    if (t.roundOff > 0) b.dr('sys:round-off', t.roundOff);
    else b.cr('sys:round-off', -t.roundOff);
  }
  return {
    id: `SALES:${doc.id}`,
    date: doc.date,
    sourceType: 'SALES',
    sourceId: doc.id,
    voucherType: meta.label,
    voucherNo: doc.number,
    narration: `${meta.shortLabel} to ${doc.party.name || 'customer'}`,
    lines: b.lines(),
  };
}

function purchaseCostLedger(bill: PurchaseBill): string {
  if (bill.itcCategory === 'CAPITAL_GOODS') return 'sys:fixed-assets';
  if (bill.itcCategory === 'INPUT_SERVICES' || bill.itcCategory === 'IMPORT_SERVICES') return 'sys:purchase-services';
  return 'sys:purchase';
}

/** Purchase bill: cost, input tax credit (or cost if ineligible), supplier, TDS deducted. */
export function purchaseEntry(bill: PurchaseBill, business: Business): JournalEntry | null {
  if (bill.status !== 'FINAL') return null;
  const t = bill.totals;
  const b = new EntryBuilder(fxFactor(business, bill.currency, bill.exchangeRate));
  const eligible = bill.itcCategory !== 'INELIGIBLE';
  const taxes = taxSplit(t);
  const taxTotal = roundTo(taxes.cgst + taxes.sgst + taxes.utgst + taxes.igst + taxes.cess);
  const cost = purchaseCostLedger(bill);
  b.dr(cost, t.taxable);
  if (eligible) postTaxes(b, 'dr', 'in', taxes, bill.supplyKind);
  else b.dr(cost, taxTotal);
  // Reverse charge: we owe the tax to the government instead of the supplier.
  if (bill.reverseCharge) b.cr('sys:rcm-payable', taxTotal);
  b.cr(partyOrWalkin(bill.supplierId, OTHER_SUPPLIERS_LEDGER), t.net);
  b.cr('sys:tds-payable', t.tds);
  // TCS charged by the supplier is a credit we claim against our own income tax.
  b.dr('sys:tcs-receivable', t.tcs);
  if (t.roundOff > 0) b.dr('sys:round-off', t.roundOff);
  else b.cr('sys:round-off', -t.roundOff);
  return {
    id: `PURCHASE:${bill.id}`,
    date: bill.billDate,
    sourceType: 'PURCHASE',
    sourceId: bill.id,
    voucherType: 'Purchase',
    voucherNo: bill.billNo,
    narration: `Purchase from ${bill.supplier.name || 'supplier'}`,
    lines: b.lines(),
  };
}

function cashOrBank(bankAccountId: string, cash: boolean): string {
  return cash || !bankAccountId ? 'sys:cash' : bankLedgerId(bankAccountId);
}

export function expenseEntry(exp: Expense): JournalEntry | null {
  const b = new EntryBuilder(1);
  const tax = roundTo(exp.cgst + exp.sgst + exp.igst);
  b.dr(exp.ledgerId || 'sys:exp-misc', exp.taxable);
  if (exp.itcEligible) {
    b.dr('sys:in-cgst', exp.cgst);
    b.dr('sys:in-sgst', exp.sgst);
    b.dr('sys:in-igst', exp.igst);
  } else {
    b.dr(exp.ledgerId || 'sys:exp-misc', tax);
  }
  // Paying expenses without tax shown (total > taxable + tax) books the difference as expense.
  const extra = roundTo(exp.total - exp.taxable - tax);
  if (extra) b.dr(exp.ledgerId || 'sys:exp-misc', extra);
  const tds = exp.tds?.amount ?? 0;
  const paidFrom = exp.paidVia === 'CREDIT' ? 'sys:expense-payable' : cashOrBank(exp.bankAccountId, exp.paidVia === 'CASH');
  b.cr(paidFrom, roundTo(exp.total - tds));
  b.cr('sys:tds-payable', tds);
  const lines = b.lines();
  if (!lines.length) return null;
  return {
    id: `EXPENSE:${exp.id}`,
    date: exp.date,
    sourceType: 'EXPENSE',
    sourceId: exp.id,
    voucherType: 'Expense',
    voucherNo: exp.billNo,
    narration: exp.description || exp.vendorName || 'Expense',
    lines,
  };
}

export interface DocPartyLookup {
  invoices: ReadonlyMap<string, SalesDocument>;
  purchases: ReadonlyMap<string, PurchaseBill>;
  receipts?: ReadonlyMap<string, readonly PaymentRecord[]>;
}

/**
 * Money received (Dr cash/bank, Cr party) or paid (Dr party, Cr cash/bank). Cash or bank gets the
 * payment's value on its own date; the party is settled at the rate its invoice or bill was booked
 * at, and the difference is an exchange gain or loss (review R1).
 */
export function paymentEntry(rec: PaymentRecord, business: Business, lookup?: DocPartyLookup): JournalEntry | null {
  if (!(rec.amount > 0)) return null;
  const b = new EntryBuilder(1);
  const inbound = rec.direction === 'IN';
  const money = cashOrBank(rec.bankAccountId, rec.mode === 'CASH');
  const invoice = inbound && rec.docId ? lookup?.invoices.get(rec.docId) : undefined;
  const bill = !inbound && rec.docId ? lookup?.purchases.get(rec.docId) : undefined;
  const doc = invoice ?? bill;
  const partyId = rec.partyId || invoice?.partyId || bill?.supplierId || '';
  const fx = paymentFx(rec, doc, business);
  const value = roundTo(rec.amount * fx.rate);
  // shortcut: each part-payment is converted on its own, so several of them can leave a few paise in the
  // party ledger of a fully paid foreign bill; settle the last one at the remaining book balance if that matters.
  let settled = doc && fx.currency === (doc.currency || business.currency) ? roundTo(rec.amount * fxFactor(business, doc.currency, doc.exchangeRate)) : value;

  if (doc && fx.currency === (doc.currency || business.currency) && lookup?.receipts) {
    const docId = rec.docId || '';
    const list = lookup.receipts.get(docId) ?? [];
    if (list.length > 1) {
      const idx = list.findIndex((r) => r.id === rec.id);
      if (idx >= 0) {
        const originalBookValue = roundTo(doc.totals.total * fxFactor(business, doc.currency, doc.exchangeRate));
        const cumForeignAmount = list.slice(0, idx + 1).reduce((s, r) => s + r.amount, 0);
        if (cumForeignAmount >= doc.totals.total - 0.005) {
          const priorSettled = list.slice(0, idx).reduce((s, r) => {
            return s + roundTo(r.amount * fxFactor(business, doc.currency, doc.exchangeRate));
          }, 0);
          settled = originalBookValue - priorSettled;
        }
      }
    }
  }

  const gain = roundTo(inbound ? value - settled : settled - value);
  if (inbound) {
    b.dr(money, value);
    b.cr(partyOrWalkin(partyId, WALKIN_LEDGER), settled);
  } else {
    b.dr(partyOrWalkin(partyId, OTHER_SUPPLIERS_LEDGER), settled);
    b.cr(money, value);
  }
  if (gain > 0) b.cr(FX_GAIN_LOSS_LEDGER, gain);
  else b.dr(FX_GAIN_LOSS_LEDGER, -gain);
  return {
    id: `${inbound ? 'RECEIPT' : 'PAYMENT'}:${rec.id}`,
    date: rec.date,
    sourceType: inbound ? 'RECEIPT' : 'PAYMENT',
    sourceId: rec.id,
    voucherType: inbound ? 'Receipt' : 'Payment',
    voucherNo: rec.number,
    narration: rec.notes || `${inbound ? 'Received from' : 'Paid to'} ${rec.partyName || 'party'}`,
    lines: b.lines(),
  };
}

const VOUCHER_LABEL: Record<Voucher['type'], string> = {
  PAYMENT: 'Payment',
  RECEIPT: 'Receipt',
  CONTRA: 'Contra',
  JOURNAL: 'Journal',
};

export function voucherEntry(v: Voucher): JournalEntry | null {
  const lines = v.lines
    .map((l) => ({ ledgerId: l.ledgerId, dr: roundTo(Math.max(0, l.dr)), cr: roundTo(Math.max(0, l.cr)) }))
    .filter((l) => l.ledgerId && (l.dr || l.cr));
  if (!lines.length) return null;
  // The voucher screen refuses unbalanced vouchers; imported data may still
  // carry one, so park the difference in Suspense and keep the books balanced.
  const diff = roundTo(lines.reduce((s, l) => s + l.dr - l.cr, 0));
  if (diff) lines.push({ ledgerId: 'sys:suspense', dr: diff < 0 ? -diff : 0, cr: diff > 0 ? diff : 0 });
  return {
    id: `VOUCHER:${v.id}`,
    date: v.date,
    sourceType: 'VOUCHER',
    sourceId: v.id,
    voucherType: VOUCHER_LABEL[v.type],
    voucherNo: v.number,
    narration: v.narration,
    lines,
  };
}

/** Difference between debits and credits of a voucher (0 when balanced). */
export function voucherDifference(v: Pick<Voucher, 'lines'>): number {
  return roundTo(v.lines.reduce((s, l) => s + (l.dr || 0) - (l.cr || 0), 0));
}

/** Every posting of one business, oldest first. */
export function buildJournal(data: BooksData): JournalEntry[] {
  const biz = data.business;
  const mine = <T extends { businessId: string }>(rows: readonly T[]) => rows.filter((r) => r.businessId === biz.id);
  const invoices = mine(data.invoices);
  const purchases = mine(data.purchases);
  const receipts = mine(data.receipts);

  const receiptsMap = new Map<string, PaymentRecord[]>();
  for (const r of receipts) {
    if (r.docId) {
      let list = receiptsMap.get(r.docId);
      if (!list) {
        list = [];
        receiptsMap.set(r.docId, list);
      }
      list.push(r);
    }
  }
  for (const list of receiptsMap.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
  }

  const lookup: DocPartyLookup = {
    invoices: new Map(invoices.map((d) => [d.id, d])),
    purchases: new Map(purchases.map((p) => [p.id, p])),
    receipts: receiptsMap,
  };
  const out: JournalEntry[] = [];
  const push = (e: JournalEntry | null) => {
    if (e && e.lines.length) out.push(e);
  };
  for (const d of invoices) push(salesEntry(d, biz));
  for (const p of purchases) push(purchaseEntry(p, biz));
  for (const e of mine(data.expenses)) push(expenseEntry(e));
  for (const r of receipts) push(paymentEntry(r, biz, lookup));
  for (const v of mine(data.vouchers)) push(voucherEntry(v));
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.voucherNo.localeCompare(b.voucherNo)));
}
