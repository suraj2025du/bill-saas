import { DOC_TYPES } from '../../docs/docTypes';
import type { Business, Expense, ISODate, PurchaseBill, SalesDocument } from '../../model';
import { roundTo } from '../../money';
import { isValidGstin, normalizeGstin } from '../gstin';
import { normalizeDocNo } from './gstr2b';
import type { Parsed2b, PortalDoc } from './gstr2b';
import type { ReturnPeriod } from './period';
import { inPeriod, inr, inrFactor, periodContaining } from './period';

export interface TaxAmounts {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

export interface Heads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface PosRow {
  pos: string;
  txval: number;
  iamt: number;
}

export interface ItcRow extends Omit<TaxAmounts, 'txval'> {
  ty: string;
  label: string;
}

export interface SetOff {
  liability: Heads;
  rcm: Heads;
  credit: Heads;
  /** used[credit head][liability head] */
  used: Record<keyof Heads, Heads>;
  /** Forward-charge tax left after credit (payable in cash). */
  cash: Heads;
  /** Cash payable including reverse-charge tax (which can never be paid from credit). */
  cashTotal: Heads;
  carryForward: Heads;
}

/** A bill or expense of the period that claims ITC but is not in the GSTR-2B opened for it. */
export interface ItcGap {
  source: 'PURCHASE' | 'EXPENSE';
  id: string;
  number: string;
  party: string;
  gstin: string;
  date: ISODate;
  tax: number;
}

/** How the documents of a GSTR-2B compare with the books, for Table 4. */
export interface Itc2bCheck {
  /** In the GSTR-2B with ITC available but not in your purchase bills or expenses: reversed in 4(B)(2). */
  notInBooks: PortalDoc[];
  /** Bills and expenses of the period that claim ITC but are not in the GSTR-2B: not claimed. */
  notIn2b: ItcGap[];
  /** In both, with a different taxable value or tax: 4(A)(5) uses the GSTR-2B values. */
  differs: PortalDoc[];
}

/** The portal's negative liability statement (forward-charge tax), per tax head. */
export interface NegativeLiability {
  /** Balance brought from earlier returns, worked out from your invoices. */
  opening: Heads;
  /** Part of the opening balance set off against this period's tax, before ITC. */
  used: Heads;
  /** This period's own negative tax (credit notes above sales). */
  added: Heads;
  /** Balance carried to the next return. */
  closing: Heads;
}

export interface Gstr3bReport {
  period: ReturnPeriod;
  gstin: string;
  /** 3.1 (a) Outward taxable supplies (other than zero rated, nil rated and exempted); includes the taxable value of sales under reverse charge, with no tax. */
  outward: TaxAmounts;
  /** 3.1 (b) Zero rated (exports, SEZ). */
  zeroRated: TaxAmounts;
  /** 3.1 (c) Nil rated, exempted. */
  nilExempt: number;
  /** 3.1 (d) Inward supplies liable to reverse charge. */
  inwardRcm: TaxAmounts;
  /** 3.1 (e) Non-GST outward supplies. */
  nonGst: number;
  /** 3.2 Inter-state supplies by place of supply. */
  unregistered: PosRow[];
  composition: PosRow[];
  uin: PosRow[];
  itcAvailable: ItcRow[];
  itcReversed: ItcRow[];
  itcNet: Omit<TaxAmounts, 'txval'>;
  itcIneligible: ItcRow[];
  /** Where 4(A)(5) comes from: the GSTR-2B opened for the period, or the books when none is open. */
  itcSource: 'GSTR2B' | 'BOOKS';
  /** The GSTR-2B comparison, when a GSTR-2B is open. */
  itc2b: Itc2bCheck | null;
  /** Table 5: exempt, nil and non-GST inward supplies. */
  inwardExempt: { inter: number; intra: number };
  inwardNonGst: { inter: number; intra: number };
  negativeLiability: NegativeLiability;
  setOff: SetOff;
  notes: string[];
}

const zeroTax = (): TaxAmounts => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
const zeroHeads = (): Heads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });

function addTax(t: TaxAmounts, sign: number, f: number, v: { taxable: number; igst: number; cgst: number; sgst: number; utgst: number; cess: number }): void {
  t.txval = roundTo(t.txval + sign * inr(v.taxable, f));
  t.iamt = roundTo(t.iamt + sign * inr(v.igst, f));
  t.camt = roundTo(t.camt + sign * inr(v.cgst, f));
  t.samt = roundTo(t.samt + sign * inr(v.sgst + v.utgst, f));
  t.csamt = roundTo(t.csamt + sign * inr(v.cess, f));
}

const ITC_AVAILABLE = [
  ['IMPG', '(1) Import of goods'],
  ['IMPS', '(2) Import of services'],
  ['ISRC', '(3) Inward supplies liable to reverse charge (other than 1 & 2)'],
  ['ISD', '(4) Inward supplies from ISD'],
  ['OTH', '(5) All other ITC'],
] as const;

const itcRow = (ty: string, label: string): ItcRow => ({ ty, label, iamt: 0, camt: 0, samt: 0, csamt: 0 });

/**
 * Utilise input tax credit against output tax as the law requires:
 * IGST credit first (IGST, then CGST and SGST/UTGST), CGST credit for CGST
 * then IGST, SGST credit for SGST then IGST (only once CGST credit is used up),
 * cess only for cess (s.49, s.49A, s.49B, rule 88A). Reverse-charge tax is
 * always paid in cash. The split of IGST credit between CGST and SGST covers
 * the heads that their own credit cannot, so the cash outgo is the minimum.
 */
export function setOffItc(liability: Heads, credit: Heads, rcm: Heads = zeroHeads()): SetOff {
  const L = { ...liability };
  const C = { ...credit };
  const used: Record<keyof Heads, Heads> = { igst: zeroHeads(), cgst: zeroHeads(), sgst: zeroHeads(), cess: zeroHeads() };
  const utilise = (from: keyof Heads, to: keyof Heads, amount: number) => {
    const a = roundTo(Math.max(0, Math.min(amount, C[from], L[to])));
    if (!a) return;
    C[from] = roundTo(C[from] - a);
    L[to] = roundTo(L[to] - a);
    used[from][to] = roundTo(used[from][to] + a);
  };
  utilise('igst', 'igst', C.igst);
  // IGST credit towards the part of CGST / SGST that their own credit cannot pay.
  const shortC = Math.max(0, L.cgst - C.cgst);
  const shortS = Math.max(0, L.sgst - C.sgst);
  if (shortC + shortS > 0 && C.igst > 0) {
    const pool = Math.min(C.igst, shortC + shortS);
    const toC = roundTo((pool * shortC) / (shortC + shortS));
    utilise('igst', 'cgst', toC);
    utilise('igst', 'sgst', roundTo(pool - toC));
  }
  // Any IGST credit still left must be used before CGST / SGST credit (s.49A).
  if (C.igst > 0 && L.cgst + L.sgst > 0) {
    const pool = Math.min(C.igst, L.cgst + L.sgst);
    const toC = roundTo((pool * L.cgst) / (L.cgst + L.sgst));
    utilise('igst', 'cgst', toC);
    utilise('igst', 'sgst', roundTo(pool - toC));
  }
  utilise('cgst', 'cgst', C.cgst);
  utilise('cgst', 'igst', C.cgst);
  utilise('sgst', 'sgst', C.sgst);
  utilise('sgst', 'igst', C.sgst);
  utilise('cess', 'cess', C.cess);
  const cash = { ...L };
  const cashTotal: Heads = {
    igst: roundTo(L.igst + rcm.igst),
    cgst: roundTo(L.cgst + rcm.cgst),
    sgst: roundTo(L.sgst + rcm.sgst),
    cess: roundTo(L.cess + rcm.cess),
  };
  return { liability: { ...liability }, rcm: { ...rcm }, credit: { ...credit }, used, cash, cashTotal, carryForward: C };
}

function upsertPos(rows: PosRow[], pos: string, sign: number, txval: number, iamt: number): void {
  let r = rows.find((x) => x.pos === pos);
  if (!r) {
    r = { pos, txval: 0, iamt: 0 };
    rows.push(r);
  }
  r.txval = roundTo(r.txval + sign * txval);
  r.iamt = roundTo(r.iamt + sign * iamt);
}

/** Table 3.1 (a), (b), (c) and 3.2 from the sales documents of one period. */
function outwardSupplies(business: Business, invoices: readonly SalesDocument[], period: ReturnPeriod) {
  const outward = zeroTax();
  const zeroRated = zeroTax();
  let nilExempt = 0;
  const unregistered: PosRow[] = [];
  const composition: PosRow[] = [];
  const uin: PosRow[] = [];
  let rcmOutward = false;

  for (const doc of invoices) {
    if (doc.businessId !== business.id || doc.status !== 'FINAL' || !inPeriod(doc.date, period)) continue;
    const meta = DOC_TYPES[doc.docType];
    if (!meta.inGstr1) continue;
    const f = inrFactor(doc);
    const sign = doc.docType === 'CREDIT_NOTE' ? -1 : 1;
    if (doc.docType === 'BILL_OF_SUPPLY') {
      nilExempt = roundTo(nilExempt + sign * inr(doc.totals.taxable, f));
      continue;
    }
    if (doc.supplyKind === 'EXPORT' || doc.supplyKind === 'SEZ') {
      for (const i of doc.items) addTax(zeroRated, sign, f, i);
      continue;
    }
    if (doc.reverseCharge) {
      // Compliance row 32: the buyer pays this tax, so only the taxable value is reported, in 3.1(a),
      // as the portal fills it from GSTR-1 Table 4B (and India Compliance does). It is not in 3.2.
      rcmOutward = true;
      for (const i of doc.items) {
        if (i.gstRate > 0) outward.txval = roundTo(outward.txval + sign * inr(i.taxable, f));
        else nilExempt = roundTo(nilExempt + sign * inr(i.taxable, f));
      }
      continue;
    }
    for (const i of doc.items) {
      if (i.gstRate > 0) addTax(outward, sign, f, i);
      else nilExempt = roundTo(nilExempt + sign * inr(i.taxable, f));
    }
    if (doc.supplyKind === 'INTER_STATE') {
      const taxable = roundTo(doc.items.filter((i) => i.gstRate > 0).reduce((s, i) => s + inr(i.taxable, f), 0));
      const igst = roundTo(doc.items.reduce((s, i) => s + inr(i.igst, f), 0));
      const reg = doc.party.registration;
      if (!doc.party.gstin || reg === 'UNREGISTERED' || reg === 'CONSUMER') upsertPos(unregistered, doc.placeOfSupply, sign, taxable, igst);
      else if (reg === 'COMPOSITION') upsertPos(composition, doc.placeOfSupply, sign, taxable, igst);
      else if (reg === 'UIN') upsertPos(uin, doc.placeOfSupply, sign, taxable, igst);
    }
  }
  return { outward, zeroRated, nilExempt, unregistered, composition, uin, rcmOutward };
}

/** Forward-charge tax of a period per head, before any set-off; negative when credit notes exceed sales. */
const forwardTax = (o: { outward: TaxAmounts; zeroRated: TaxAmounts }): Heads => ({
  igst: roundTo(o.outward.iamt + o.zeroRated.iamt),
  cgst: o.outward.camt,
  sgst: o.outward.samt,
  cess: roundTo(o.outward.csamt + o.zeroRated.csamt),
});

const HEAD_KEYS: (keyof Heads)[] = ['igst', 'cgst', 'sgst', 'cess'];

/**
 * Negative liability statement, per head: an earlier negative balance is set off against this
 * period's tax first (GSTN GSTR-3B user guide, payment of tax, point b), and this period's own
 * negative tax is added to the balance. Returns the tax left for ITC and cash.
 */
function applyNegativeLiability(tax: Heads, opening: Heads): { payable: Heads; statement: NegativeLiability } {
  const payable = zeroHeads();
  const used = zeroHeads();
  const added = zeroHeads();
  const closing = zeroHeads();
  for (const h of HEAD_KEYS) {
    if (tax[h] >= 0) {
      used[h] = roundTo(Math.min(opening[h], tax[h]));
      payable[h] = roundTo(tax[h] - used[h]);
    } else {
      added[h] = roundTo(-tax[h]);
    }
    closing[h] = roundTo(opening[h] - used[h] + added[h]);
  }
  return { payable, statement: { opening: { ...opening }, used, added, closing } };
}

/** First return period of GSTR-3B that accepts negative values in Table 3.1 (portal, September 2024). */
export const NEGATIVE_LIABILITY_FROM: ISODate = '2024-09-01';

/**
 * Balance of the negative liability statement at the start of `period`, worked out from the
 * invoices of every earlier return of the same kind (monthly or quarterly) since September 2024.
 * shortcut: assumes every earlier return was filed with this app's figures and the same frequency;
 * a change of frequency or a figure edited on the portal needs a manual check of the statement.
 */
function negativeOpening(business: Business, invoices: readonly SalesDocument[], period: ReturnPeriod): Heads {
  if (period.kind === 'YEAR') return zeroHeads();
  const filing = period.kind === 'QUARTER' ? 'QUARTERLY' : 'MONTHLY';
  const from = periodContaining(NEGATIVE_LIABILITY_FROM, filing, business.fyStartMonth).start;
  const buckets = new Map<string, { period: ReturnPeriod; docs: SalesDocument[] }>();
  const byMonth = new Map<string, ReturnPeriod>();
  for (const doc of invoices) {
    if (doc.businessId !== business.id || doc.status !== 'FINAL' || doc.date < from || doc.date >= period.start) continue;
    const month = doc.date.slice(0, 7);
    let p = byMonth.get(month);
    if (!p) {
      p = periodContaining(doc.date, filing, business.fyStartMonth);
      byMonth.set(month, p);
    }
    const bucket = buckets.get(p.start) ?? { period: p, docs: [] };
    bucket.docs.push(doc);
    buckets.set(p.start, bucket);
  }
  let balance = zeroHeads();
  for (const key of [...buckets.keys()].sort()) {
    const b = buckets.get(key)!;
    balance = applyNegativeLiability(forwardTax(outwardSupplies(business, b.docs, b.period)), balance).statement.closing;
  }
  return balance;
}

const anyHead = (h: Heads) => HEAD_KEYS.some((k) => h[k] > 0);
const HEAD_LABEL: Record<keyof Heads, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST/UTGST', cess: 'cess' };
const fmtHeads = (h: Heads) =>
  HEAD_KEYS.filter((k) => h[k])
    .map((k) => `${HEAD_LABEL[k]} ${h[k].toFixed(2)}`)
    .join(', ') || 'nil';
const taxOf = (h: Heads) => roundTo(h.igst + h.cgst + h.sgst + h.cess);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function addHeads(row: ItcRow, sign: number, h: Heads): void {
  row.iamt = roundTo(row.iamt + sign * h.igst);
  row.camt = roundTo(row.camt + sign * h.cgst);
  row.samt = roundTo(row.samt + sign * h.sgst);
  row.csamt = roundTo(row.csamt + sign * h.cess);
}

/** A purchase bill or expense that can be in GSTR-2B: forward charge, from a supplier with a valid GSTIN. */
interface BookItc extends ItcGap {
  key: string;
  taxable: number;
  heads: Heads;
  /** Credit claimed in the books. */
  claims: boolean;
  /** Reported and reversed in 4(B)(1): blocked credit (s.17(5)), or an expense whose credit is not claimed. */
  reverse: boolean;
}

/**
 * Bills and expenses (of any date) whose credit goes to Table 4(A)(5). A supplier without a valid
 * GSTIN cannot report the bill in GSTR-1, so it never reaches GSTR-2B and gives no credit (review Y7).
 */
function forwardChargeItc(business: Business, purchases: readonly PurchaseBill[], expenses: readonly Expense[]): BookItc[] {
  const out: BookItc[] = [];
  for (const bill of purchases) {
    if (bill.businessId !== business.id || bill.status !== 'FINAL' || bill.reverseCharge) continue;
    if (bill.itcCategory === 'IMPORT_GOODS' || bill.itcCategory === 'IMPORT_SERVICES' || !isValidGstin(bill.supplier.gstin)) continue;
    const f = inrFactor(bill);
    const t = bill.totals;
    const heads = { igst: inr(t.igst, f), cgst: inr(t.cgst, f), sgst: inr(t.sgst + t.utgst, f), cess: inr(t.cess, f) };
    const gstin = normalizeGstin(bill.supplier.gstin);
    const blocked = bill.itcCategory === 'INELIGIBLE';
    out.push({ key: `P:${bill.id}`, source: 'PURCHASE', id: bill.id, number: bill.billNo, party: bill.supplier.name, gstin, date: bill.billDate, tax: taxOf(heads), taxable: inr(t.taxable, f), heads, claims: !blocked, reverse: blocked });
  }
  for (const e of expenses) {
    if (e.businessId !== business.id || !(e.cgst + e.sgst + e.igst > 0) || !isValidGstin(e.vendorGstin)) continue;
    const heads = { igst: e.igst, cgst: e.cgst, sgst: e.sgst, cess: 0 };
    const gstin = normalizeGstin(e.vendorGstin);
    out.push({ key: `E:${e.id}`, source: 'EXPENSE', id: e.id, number: e.billNo, party: e.vendorName, gstin, date: e.date, tax: taxOf(heads), taxable: e.taxable, heads, claims: e.itcEligible, reverse: !e.itcEligible });
  }
  return out;
}

/** Allowed difference in rupees between a GSTR-2B document and the books, as on the GSTR-2B page. */
const TOLERANCE_2B = 1;

/**
 * Table 4 from the GSTR-2B of the period (compliance row 1). As CBIC Circular 170/02/2022-GST para 4.3
 * describes: 4(A)(5) is every document of the GSTR-2B with ITC available, net of its credit notes;
 * blocked credit is reversed in 4(B)(1), a document that is not in the books (goods or services not
 * received or not recorded) in 4(B)(2), and ITC the GSTR-2B marks as not available goes to 4(D)(2).
 * Bills and expenses are matched by supplier GSTIN and invoice number, as the GSTR-2B page does.
 */
function itcFrom2b(docs: readonly PortalDoc[], book: readonly BookItc[], period: ReturnPeriod, rows: { row5: ItcRow; reversed: ItcRow[]; ineligible: ItcRow[] }) {
  const index = new Map<string, BookItc[]>();
  for (const b of book) {
    const no = normalizeDocNo(b.number);
    if (!no) continue;
    const list = index.get(`${b.gstin}|${no}`);
    if (list) list.push(b);
    else index.set(`${b.gstin}|${no}`, [b]);
  }
  const used = new Set<string>();
  const check: Itc2bCheck = { notInBooks: [], notIn2b: [], differs: [] };
  let rcm = 0;
  let notAvailable = 0;
  const off = (a: number, b: number) => Math.abs(a - b) > TOLERANCE_2B;
  for (const p of docs) {
    if (p.reverseCharge) {
      rcm++;
      continue;
    }
    const sign = p.type === 'CREDIT_NOTE' ? -1 : 1;
    const heads = { igst: p.igst, cgst: p.cgst, sgst: p.sgst, cess: p.cess };
    const no = normalizeDocNo(p.number);
    const match = sign > 0 && no ? index.get(`${normalizeGstin(p.supplierGstin)}|${no}`)?.find((b) => !used.has(b.key)) : undefined;
    if (match) used.add(match.key);
    if (!p.itcAvailable) {
      notAvailable++;
      addHeads(rows.ineligible[1], sign, heads);
      continue;
    }
    addHeads(rows.row5, sign, heads);
    if (sign < 0) continue;
    if (!match) {
      check.notInBooks.push(p);
      addHeads(rows.reversed[1], 1, heads);
      continue;
    }
    if (match.reverse) addHeads(rows.reversed[0], 1, heads);
    if (off(p.taxable, match.taxable) || HEAD_KEYS.some((h) => off(heads[h], match.heads[h]))) check.differs.push(p);
  }
  for (const b of book) {
    if (!b.claims || used.has(b.key) || !inPeriod(b.date, period) || !(b.tax > 0)) continue;
    check.notIn2b.push({ source: b.source, id: b.id, number: b.number, party: b.party, gstin: b.gstin, date: b.date, tax: b.tax });
  }
  return { check, rcm, notAvailable };
}

export function buildGstr3b(
  business: Business,
  data: { invoices: readonly SalesDocument[]; purchases: readonly PurchaseBill[]; expenses: readonly Expense[] },
  period: ReturnPeriod,
  /** The GSTR-2B of the same period, when the user has opened it: 4(A)(5) then comes from it. */
  gstr2b: Parsed2b | null = null,
): Gstr3bReport {
  const inwardRcm = zeroTax();
  const notes: string[] = [];
  const { outward, zeroRated, nilExempt, unregistered, composition, uin, rcmOutward } = outwardSupplies(business, data.invoices, period);
  if (rcmOutward) {
    notes.push('Your sales under reverse charge are in 3.1(a) at their taxable value, with no tax: the buyer pays that tax. The portal fills 3.1(a) the same way from GSTR-1 Table 4B.');
  }

  const avail = ITC_AVAILABLE.map(([ty, label]) => itcRow(ty, label));
  const rowOf = (ty: string) => avail.find((r) => r.ty === ty)!;
  const reversed = [itcRow('RUL', '(1) As per rules 38, 42 & 43 of CGST Rules and section 17(5)'), itcRow('OTH', '(2) Others')];
  // Compliance row 18: the Table 4(D) rows as named in the form from FY 2023-24 (GSTN GSTR-3B user guide).
  const ineligible = [
    itcRow('RUL', '(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period'),
    itcRow('OTH', '(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules'),
  ];
  const inwardExempt = { inter: 0, intra: 0 };
  const inwardNonGst = { inter: 0, intra: 0 };
  let billsWithoutGstin = 0;
  let expensesWithoutGstin = 0;
  const addItc = (row: ItcRow, f: number, v: { igst: number; cgst: number; sgst: number; utgst: number; cess: number }) => {
    row.iamt = roundTo(row.iamt + inr(v.igst, f));
    row.camt = roundTo(row.camt + inr(v.cgst, f));
    row.samt = roundTo(row.samt + inr(v.sgst + v.utgst, f));
    row.csamt = roundTo(row.csamt + inr(v.cess, f));
  };

  for (const bill of data.purchases) {
    if (bill.businessId !== business.id || bill.status !== 'FINAL' || !inPeriod(bill.billDate, period)) continue;
    const f = inrFactor(bill);
    const inter = bill.supplyKind === 'INTER_STATE' || bill.supplyKind === 'EXPORT' || bill.supplyKind === 'SEZ';
    for (const i of bill.items) {
      if (!(i.gstRate > 0)) {
        const amount = inr(i.taxable, f);
        if (inter) inwardExempt.inter = roundTo(inwardExempt.inter + amount);
        else inwardExempt.intra = roundTo(inwardExempt.intra + amount);
      }
    }
    if (bill.reverseCharge && bill.itcCategory !== 'IMPORT_GOODS') addTax(inwardRcm, 1, f, bill.totals);
    const imported = bill.itcCategory === 'IMPORT_GOODS' || bill.itcCategory === 'IMPORT_SERVICES';
    if (!imported && !bill.reverseCharge) {
      // Forward charge: 4(A)(5) comes from forwardChargeItc below, which needs the supplier's GSTIN (review Y7).
      const t = bill.totals;
      if (!isValidGstin(bill.supplier.gstin) && bill.itcCategory !== 'INELIGIBLE' && t.igst + t.cgst + t.sgst + t.utgst + t.cess > 0) billsWithoutGstin++;
      continue;
    }
    const target = bill.itcCategory === 'IMPORT_GOODS' ? rowOf('IMPG') : bill.itcCategory === 'IMPORT_SERVICES' ? rowOf('IMPS') : rowOf('ISRC');
    addItc(target, f, bill.totals);
    if (bill.itcCategory === 'INELIGIBLE') addItc(reversed[0], f, bill.totals);
  }
  for (const e of data.expenses) {
    if (e.businessId === business.id && inPeriod(e.date, period) && e.itcEligible && e.cgst + e.sgst + e.igst > 0 && !isValidGstin(e.vendorGstin)) expensesWithoutGstin++;
  }

  const book = forwardChargeItc(business, data.purchases, data.expenses);
  let itc2b: Itc2bCheck | null = null;
  if (gstr2b) {
    const res = itcFrom2b(gstr2b.docs, book, period, { row5: rowOf('OTH'), reversed, ineligible });
    itc2b = res.check;
    const { notInBooks, notIn2b, differs } = res.check;
    if (notInBooks.length) {
      const tax = roundTo(notInBooks.reduce((s, p) => s + p.igst + p.cgst + p.sgst + p.cess, 0));
      notes.push(
        `${count(notInBooks.length, 'document', 'documents')} in the GSTR-2B (tax ${tax.toFixed(2)}) ${notInBooks.length === 1 ? 'is' : 'are'} not in your purchase bills or expenses. As on the portal, ${notInBooks.length === 1 ? 'it is' : 'they are'} in 4(A)(5) and reversed in 4(B)(2) until the goods or services are received and recorded; then reclaim the credit in 4(A)(5) and 4(D)(1) of that return.`,
      );
    }
    if (notIn2b.length) {
      const tax = roundTo(notIn2b.reduce((s, g) => s + g.tax, 0));
      notes.push(
        `${count(notIn2b.length, 'bill or expense', 'bills and expenses')} of this period (tax ${tax.toFixed(2)}) ${notIn2b.length === 1 ? 'is' : 'are'} not in the GSTR-2B, so the credit is not claimed: it belongs to the return of the period whose GSTR-2B shows it (an earlier one, if the supplier reported it before you recorded it).`,
      );
    }
    if (differs.length) notes.push(`Values differ between the GSTR-2B and your books for ${count(differs.length, 'document', 'documents')}; 4(A)(5) uses the GSTR-2B values. Check ${differs.length === 1 ? 'it' : 'them'} on the GSTR-2B page.`);
    if (res.notAvailable) notes.push(`${count(res.notAvailable, 'document', 'documents')} in the GSTR-2B ${res.notAvailable === 1 ? 'is' : 'are'} marked "ITC not available" and ${res.notAvailable === 1 ? 'is' : 'are'} shown in 4(D)(2).`);
    if (res.rcm) notes.push(`Reverse-charge documents in the GSTR-2B (${res.rcm}) are not added to 4(A)(5): 3.1(d) and 4(A)(3) come from your reverse-charge purchase bills. Compare them with the GSTR-2B.`);
    if (gstr2b.skipped.length) notes.push(`Parts of the GSTR-2B not used here: ${gstr2b.skipped.join(', ')} (amendments, ISD and imports). Enter them on the portal.`);
  } else {
    for (const b of book) {
      if (!inPeriod(b.date, period)) continue;
      addHeads(rowOf('OTH'), 1, b.heads);
      if (b.reverse) addHeads(reversed[0], 1, b.heads);
    }
    notes.push(
      'No GSTR-2B is open, so 4(A)(5) is taken from your purchase bills and expenses dated in this period. The portal fills it from GSTR-2B, and credit that is not in GSTR-2B cannot be claimed: open the GSTR-2B of this period before you file.',
    );
  }
  if (expensesWithoutGstin) {
    notes.push(`${count(expensesWithoutGstin, 'expense', 'expenses')} marked "Claim input tax credit" ${expensesWithoutGstin === 1 ? 'has' : 'have'} no valid vendor GSTIN, so the credit is not claimed. Add the vendor's GSTIN to the expense to claim it.`);
  }
  if (billsWithoutGstin) {
    notes.push(`${count(billsWithoutGstin, 'purchase bill from a supplier', 'purchase bills from suppliers')} without a valid GSTIN ${billsWithoutGstin === 1 ? 'has' : 'have'} tax that is not claimed as credit: an unregistered supplier's bill never reaches GSTR-2B.`);
  }

  const sumItc = (rows: readonly ItcRow[]) => ({
    iamt: roundTo(rows.reduce((s, r) => s + r.iamt, 0)),
    camt: roundTo(rows.reduce((s, r) => s + r.camt, 0)),
    samt: roundTo(rows.reduce((s, r) => s + r.samt, 0)),
    csamt: roundTo(rows.reduce((s, r) => s + r.csamt, 0)),
  });
  const a = sumItc(avail);
  const b = sumItc(reversed);
  const itcNet = { iamt: roundTo(a.iamt - b.iamt), camt: roundTo(a.camt - b.camt), samt: roundTo(a.samt - b.samt), csamt: roundTo(a.csamt - b.csamt) };

  // Compliance row 26: negative tax goes to the negative liability statement and is set off, head by head,
  // against the tax of later returns before ITC (GSTN GSTR-3B user guide, payment of tax, point b).
  const { payable: liability, statement: negativeLiability } = applyNegativeLiability(forwardTax({ outward, zeroRated }), negativeOpening(business, data.invoices, period));
  if (anyHead(negativeLiability.added)) {
    notes.push(`Credit notes exceed sales this period: the negative tax (${fmtHeads(negativeLiability.added)}) goes to the negative liability statement on the portal and is set off against the tax of your next returns.`);
  }
  if (anyHead(negativeLiability.opening)) {
    notes.push(
      `Negative liability from earlier returns: ${fmtHeads(negativeLiability.opening)}. Set off against this period's tax before input tax credit: ${fmtHeads(negativeLiability.used)}; carried forward: ${fmtHeads(negativeLiability.closing)}. It is worked out from your invoices since September 2024; check it against the negative liability statement on the portal.`,
    );
  }
  const rcm: Heads = { igst: inwardRcm.iamt, cgst: inwardRcm.camt, sgst: inwardRcm.samt, cess: inwardRcm.csamt };
  const credit: Heads = {
    igst: Math.max(0, itcNet.iamt),
    cgst: Math.max(0, itcNet.camt),
    sgst: Math.max(0, itcNet.samt),
    cess: Math.max(0, itcNet.csamt),
  };
  const sortPos = (rows: PosRow[]) => rows.filter((r) => r.txval || r.iamt).sort((x, y) => x.pos.localeCompare(y.pos));

  return {
    period,
    gstin: business.gstin,
    outward,
    zeroRated,
    nilExempt,
    inwardRcm,
    nonGst: 0,
    unregistered: sortPos(unregistered),
    composition: sortPos(composition),
    uin: sortPos(uin),
    itcAvailable: avail,
    itcReversed: reversed,
    itcNet,
    itcIneligible: ineligible,
    itcSource: gstr2b ? 'GSTR2B' : 'BOOKS',
    itc2b,
    inwardExempt,
    inwardNonGst,
    negativeLiability,
    setOff: setOffItc(liability, credit, rcm),
    notes,
  };
}

type Json = Record<string, unknown>;
const taxJson = (t: Omit<TaxAmounts, 'txval'>): Json => ({ iamt: t.iamt, camt: t.camt, samt: t.samt, csamt: t.csamt });

/** GSTR-3B JSON in the format of the GSTR-3B offline utility. */
export function gstr3bJson(r: Gstr3bReport): Json {
  return {
    gstin: r.gstin,
    ret_period: r.period.fp,
    sup_details: {
      osup_det: { txval: r.outward.txval, ...taxJson(r.outward) },
      osup_zero: { txval: r.zeroRated.txval, iamt: r.zeroRated.iamt, csamt: r.zeroRated.csamt },
      osup_nil_exmp: { txval: r.nilExempt },
      isup_rev: { txval: r.inwardRcm.txval, ...taxJson(r.inwardRcm) },
      osup_nongst: { txval: r.nonGst },
    },
    inter_sup: {
      unreg_details: r.unregistered.map((x) => ({ pos: x.pos, txval: x.txval, iamt: x.iamt })),
      comp_details: r.composition.map((x) => ({ pos: x.pos, txval: x.txval, iamt: x.iamt })),
      uin_details: r.uin.map((x) => ({ pos: x.pos, txval: x.txval, iamt: x.iamt })),
    },
    itc_elg: {
      itc_avl: r.itcAvailable.map((x) => ({ ty: x.ty, ...taxJson(x) })),
      itc_rev: r.itcReversed.map((x) => ({ ty: x.ty, ...taxJson(x) })),
      itc_net: taxJson(r.itcNet),
      itc_inelg: r.itcIneligible.map((x) => ({ ty: x.ty, ...taxJson(x) })),
    },
    inward_sup: {
      isup_details: [
        { ty: 'GST', inter: r.inwardExempt.inter, intra: r.inwardExempt.intra },
        { ty: 'NONGST', inter: r.inwardNonGst.inter, intra: r.inwardNonGst.intra },
      ],
    },
  };
}
