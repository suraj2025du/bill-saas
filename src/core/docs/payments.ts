import { OTHER_SUPPLIERS_LEDGER, WALKIN_LEDGER, fxFactor, paymentFx } from '../accounting/postings';
import { currencyDecimals } from '../currency/countries';
import { daysBetween, todayISO } from '../dates';
import { parseLedgerRef } from '../ledgers';
import type { Business, ISODate, PaymentRecord, PurchaseBill, SalesDocument, Voucher } from '../model';
import { roundTo } from '../money';
import { DOC_TYPES } from './docTypes';

export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'NOT_APPLICABLE';

export interface PaymentSummary {
  /** Amount due on the document (totals.net). */
  total: number;
  /** Money received/paid against it (payments + bill-wise voucher lines). */
  paid: number;
  /** Credit notes issued against the invoice. */
  adjusted: number;
  balance: number;
  status: PaymentStatus;
  /** Days past the due date while a balance remains (0 otherwise). */
  overdueDays: number;
}

/** A payment, or a voucher's bill-wise line, counted against one document. */
export interface Settlement {
  direction: 'IN' | 'OUT';
  /** In the document's currency; these add up to paidIn / paidOut. */
  amount: number;
  /** In the book currency: the payment's value on its own date, or the voucher line. */
  bookAmount: number;
  source: { kind: 'PAYMENT'; payment: PaymentRecord } | { kind: 'VOUCHER'; voucher: Voucher };
}

export interface PaymentIndex {
  paidIn: Map<string, number>;
  paidOut: Map<string, number>;
  creditNotes: Map<string, number>;
  /** What paidIn and paidOut of each document are made of (design F06). */
  settlements: Map<string, Settlement[]>;
}

type Priced = Pick<SalesDocument, 'currency' | 'exchangeRate'>;

function docMap(invoices: readonly SalesDocument[], purchases: readonly PurchaseBill[]): Map<string, Priced> {
  const out = new Map<string, Priced>();
  for (const d of invoices) out.set(d.id, d);
  for (const b of purchases) out.set(b.id, b);
  return out;
}

/** A book-currency amount in a document's own currency, at the rate the document was booked at. */
function inDocCurrency(bookAmount: number, doc: Priced, business: Pick<Business, 'currency'>): number {
  return roundTo(bookAmount / fxFactor(business, doc.currency, doc.exchangeRate), currencyDecimals(doc.currency || business.currency));
}

/** How much of a document (in its own currency) a payment linked to it settles. */
export function paymentSettles(rec: PaymentRecord, doc: Priced, business: Pick<Business, 'currency'>): number {
  const fx = paymentFx(rec, doc, business);
  return fx.currency === (doc.currency || business.currency) ? rec.amount : inDocCurrency(roundTo(rec.amount * fx.rate), doc, business);
}

/**
 * Index money movements by document id once, so list screens can show the status of thousands of
 * invoices without rescanning every payment. Amounts are counted in each document's own currency
 * (review R1): a payment in that currency as entered, anything else (voucher lines are in the book
 * currency) converted at the document's rate.
 */
export function buildPaymentIndex(
  receipts: readonly PaymentRecord[],
  vouchers: readonly Voucher[],
  invoices: readonly SalesDocument[],
  purchases: readonly PurchaseBill[],
  business: Pick<Business, 'currency'>,
): PaymentIndex {
  const paidIn = new Map<string, number>();
  const paidOut = new Map<string, number>();
  const creditNotes = new Map<string, number>();
  const settlements = new Map<string, Settlement[]>();
  const docs = docMap(invoices, purchases);
  const add = (map: Map<string, number>, key: string, amount: number) => {
    if (!key || !amount) return;
    map.set(key, roundTo((map.get(key) ?? 0) + amount));
  };
  const settle = (docId: string, s: Settlement) => {
    if (!s.amount) return;
    add(s.direction === 'IN' ? paidIn : paidOut, docId, s.amount);
    const list = settlements.get(docId);
    if (list) list.push(s);
    else settlements.set(docId, [s]);
  };
  for (const r of receipts) {
    if (!r.docId) continue;
    // A document missing from the list (deleted, or after a report's date) keeps the amount as entered.
    const doc = docs.get(r.docId);
    const bookAmount = roundTo(r.amount * paymentFx(r, doc, business).rate);
    const amount = doc ? paymentSettles(r, doc, business) : r.amount;
    settle(r.docId, { direction: r.direction, amount, bookAmount, source: { kind: 'PAYMENT', payment: r } });
  }
  for (const v of vouchers) {
    for (const line of v.lines) {
      if (!line.docId) continue;
      const doc = docs.get(line.docId);
      for (const [direction, bookAmount] of [['IN', line.cr], ['OUT', line.dr]] as const) {
        const amount = doc ? inDocCurrency(bookAmount, doc, business) : bookAmount;
        settle(line.docId, { direction, amount, bookAmount, source: { kind: 'VOUCHER', voucher: v } });
      }
    }
  }
  for (const doc of invoices) {
    if (doc.docType === 'CREDIT_NOTE' && doc.status === 'FINAL' && doc.refDocId) add(creditNotes, doc.refDocId, doc.totals.net);
  }
  return { paidIn, paidOut, creditNotes, settlements };
}

/** Money received from (IN) or paid to (OUT) a party: a payment, or a party line of a receipt or payment voucher. */
export interface PartyPayment {
  key: string;
  direction: 'IN' | 'OUT';
  date: ISODate;
  number: string;
  /** Party ledger of a voucher line; '' for a payment, which names its party in partyName. */
  ledgerId: string;
  partyName: string;
  /** Invoice or bill it is set against; '' when on account. */
  docId: string;
  /** In `currency`. */
  amount: number;
  currency: string;
  /** In the book currency. */
  bookAmount: number;
  source: { kind: 'PAYMENT'; payment: PaymentRecord } | { kind: 'VOUCHER'; voucher: Voucher };
}

const isPartyLedger = (id: string) => parseLedgerRef(id).kind === 'party' || id === WALKIN_LEDGER || id === OTHER_SUPPLIERS_LEDGER;

/**
 * Every payment received or made, from the payment records and from receipt and payment vouchers
 * (design F06: money recorded the Tally way, with an F6 receipt voucher, is a payment too).
 */
export function partyPayments(
  receipts: readonly PaymentRecord[],
  vouchers: readonly Voucher[],
  invoices: readonly SalesDocument[],
  purchases: readonly PurchaseBill[],
  business: Pick<Business, 'currency'>,
): PartyPayment[] {
  const docs = docMap(invoices, purchases);
  const out: PartyPayment[] = [];
  for (const r of receipts) {
    const fx = paymentFx(r, r.docId ? docs.get(r.docId) : undefined, business);
    out.push({
      key: r.id,
      direction: r.direction,
      date: r.date,
      number: r.number,
      ledgerId: '',
      partyName: r.partyName,
      docId: r.docId,
      amount: r.amount,
      currency: fx.currency,
      bookAmount: roundTo(r.amount * fx.rate),
      source: { kind: 'PAYMENT', payment: r },
    });
  }
  for (const v of vouchers) {
    if (v.type !== 'RECEIPT' && v.type !== 'PAYMENT') continue;
    const direction = v.type === 'RECEIPT' ? 'IN' : 'OUT';
    v.lines.forEach((line, i) => {
      const amount = direction === 'IN' ? line.cr : line.dr;
      if (!(amount > 0) || !isPartyLedger(line.ledgerId)) return;
      out.push({
        key: `${v.id}:${i}`,
        direction,
        date: v.date,
        number: v.number,
        ledgerId: line.ledgerId,
        partyName: '',
        docId: line.docId,
        amount,
        currency: business.currency,
        bookAmount: amount,
        source: { kind: 'VOUCHER', voucher: v },
      });
    });
  }
  return out;
}

function summarize(total: number, paid: number, adjusted: number, dueDate: ISODate | '', today: ISODate): PaymentSummary {
  const balance = roundTo(total - paid - adjusted);
  let status: PaymentStatus = 'UNPAID';
  if (balance <= 0.005) status = 'PAID';
  else if (paid + adjusted > 0) status = 'PARTIAL';
  const overdueDays = status !== 'PAID' && dueDate && today > dueDate ? daysBetween(dueDate, today) : 0;
  return { total, paid, adjusted, balance: Math.max(0, balance), status, overdueDays };
}

const NOT_APPLICABLE: PaymentSummary = { total: 0, paid: 0, adjusted: 0, balance: 0, status: 'NOT_APPLICABLE', overdueDays: 0 };

/** Payment summary of a sales document (only final, payable types have a balance). */
export function salesPaymentSummary(doc: SalesDocument, index: PaymentIndex, today: ISODate = todayISO()): PaymentSummary {
  if (!DOC_TYPES[doc.docType].payable || doc.status !== 'FINAL') return NOT_APPLICABLE;
  return summarize(doc.totals.net, index.paidIn.get(doc.id) ?? 0, index.creditNotes.get(doc.id) ?? 0, doc.dueDate, today);
}

/** Payment summary of a purchase bill (amount we owe the supplier). */
export function purchasePaymentSummary(bill: PurchaseBill, index: PaymentIndex, today: ISODate = todayISO()): PaymentSummary {
  if (bill.status !== 'FINAL') return NOT_APPLICABLE;
  return summarize(bill.totals.net, index.paidOut.get(bill.id) ?? 0, 0, bill.dueDate, today);
}
