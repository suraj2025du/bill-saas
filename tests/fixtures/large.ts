import type { BooksInput } from '../../src/core/accounting/reports';
import { addDays } from '../../src/core/dates';
import { newExpense, newPayment, newVoucher } from '../../src/core/factories';
import { makeGstin } from '../../src/core/gst/gstin';
import type { Business, CollectionData, Expense, Party, PartyKind, PaymentRecord, Product, PurchaseBill, SalesDocument, Voucher } from '../../src/core/model';
import { roundTo } from '../../src/core/money';
import { emptyCollections } from '../../src/core/schema';
import { sampleBusiness, sampleDoc, sampleParty, sampleProduct, samplePurchase } from './sample';

/**
 * One financial year (2026-27) of a wholesale business at the size the code review measured
 * (2,000 parties, 10,000 invoices and 10,000 receipts), plus stock, purchase bills, supplier
 * payments, vouchers, expenses and the other document types, so that every report path runs
 * (review R4, Y13). Records are copies of a few computed templates, so it builds in milliseconds,
 * and every id, name, date and amount is fixed, so the reports built from it are the same on every run.
 */
export interface LargeData {
  business: Business;
  parties: Party[];
  products: Product[];
  invoices: SalesDocument[];
  purchases: PurchaseBill[];
  receipts: PaymentRecord[];
  vouchers: Voucher[];
  expenses: Expense[];
}

export const LARGE_AS_OF = '2027-03-31';
const FY_START = '2026-04-01';
export const LARGE_COUNTS = { parties: 2_000, products: 300, taxInvoices: 10_000, otherDocs: 800, receipts: 10_000, purchases: 1_000 };

const pad = (n: number, width = 5) => String(n).padStart(width, '0');
/** Day `i` of `n`, spread evenly over the financial year, oldest first. */
const dayOf = (i: number, n: number) => addDays(FY_START, Math.floor((i * 365) / n));
const notAfterYearEnd = (date: string) => (date > LARGE_AS_OF ? LARGE_AS_OF : date);

export function largeData(): LargeData {
  const business = sampleBusiness();
  const customer = sampleParty(business.id);
  const supplier = sampleParty(business.id, { kind: 'SUPPLIER', name: 'Supplier', gstin: makeGstin('27', 'AABCB1234C') });

  // Every 20th party is a supplier and the next one both a customer and a supplier; every 7th has an opening balance.
  const parties = Array.from({ length: LARGE_COUNTS.parties }, (_, i): Party => {
    const kind: PartyKind = i % 20 === 0 ? 'SUPPLIER' : i % 20 === 1 ? 'BOTH' : 'CUSTOMER';
    return {
      ...(kind === 'SUPPLIER' ? supplier : customer),
      id: `pty_${pad(i)}`,
      name: `Party ${pad(i, 4)}`,
      kind,
      openingBalance: i % 7 === 0 ? 5_000 : 0,
      openingType: kind === 'SUPPLIER' ? 'CR' : 'DR',
    };
  });
  const buyers = parties.filter((p) => p.kind !== 'SUPPLIER');
  const sellers = parties.filter((p) => p.kind !== 'CUSTOMER');

  const product = sampleProduct(business.id);
  const products = Array.from({ length: LARGE_COUNTS.products }, (_, i): Product => ({
    ...product,
    id: `prd_${pad(i, 3)}`,
    name: `Item ${pad(i, 3)}`,
    purchasePrice: 50 + (i % 50),
    sellingPrice: 80 + (i % 50),
    openingStock: 1_000,
    openingStockRate: 45 + (i % 50),
  }));
  const productOf = (i: number) => products[i % products.length].id;

  const invoices: SalesDocument[] = [];
  const templates = [1, 2, 3, 4, 5].map((q) =>
    sampleDoc(business, customer, [
      { productId: products[0].id, qty: q, rate: 100 + q * 10 },
      { productId: products[1].id, qty: 1, rate: 250, gstRate: 5 },
    ]),
  );
  for (let i = 0; i < LARGE_COUNTS.taxInvoices; i++) {
    const tpl = templates[i % templates.length];
    const p = buyers[i % buyers.length];
    const date = dayOf(i, LARGE_COUNTS.taxInvoices);
    invoices.push({
      ...tpl,
      id: `doc_${pad(i)}`,
      number: `INV/26-27/${pad(i + 1)}`,
      date,
      dueDate: addDays(date, 30),
      partyId: p.id,
      party: { ...tpl.party, name: p.name },
      items: tpl.items.map((it, j) => ({ ...it, productId: productOf(i * 2 + j) })),
    });
  }

  // 200 each of quotations, delivery challans, credit notes (against part-paid invoices) and draft invoices.
  const others = [
    { docType: 'QUOTATION', prefix: 'QTN', rate: 500 },
    { docType: 'DELIVERY_CHALLAN', prefix: 'DC', rate: 500 },
    { docType: 'CREDIT_NOTE', prefix: 'CN', rate: 100 },
    { docType: 'TAX_INVOICE', prefix: '', rate: 500 },
  ] as const;
  const perType = LARGE_COUNTS.otherDocs / others.length;
  for (const [k, o] of others.entries()) {
    const tpl = sampleDoc(business, customer, [{ productId: products[2].id, qty: 1, rate: o.rate }], {}, o.docType);
    const isCredit = o.docType === 'CREDIT_NOTE';
    for (let i = 0; i < perType; i++) {
      const p = buyers[(i * 7 + k) % buyers.length];
      const ref = invoices[(i * 50 + 7) % LARGE_COUNTS.taxInvoices];
      invoices.push({
        ...tpl,
        id: `doc_${o.prefix || 'draft'}_${pad(i)}`,
        number: o.prefix ? `${o.prefix}/26-27/${pad(i + 1)}` : '',
        status: o.prefix ? 'FINAL' : 'DRAFT',
        date: isCredit ? notAfterYearEnd(addDays(ref.date, 5)) : dayOf(i, perType),
        partyId: isCredit ? ref.partyId : p.id,
        party: { ...tpl.party, name: isCredit ? ref.party.name : p.name },
        refDocId: isCredit ? ref.id : '',
        items: tpl.items.map((it) => ({ ...it, productId: productOf(i) })),
      });
    }
  }

  // One receipt per tax invoice: most paid in full, some in part, a few with a small amount.
  const pay = newPayment(business.id, 'IN', { mode: 'BANK', bankAccountId: 'bank_1' });
  const receipts: PaymentRecord[] = [];
  for (let i = 0; i < LARGE_COUNTS.receipts; i++) {
    const inv = invoices[i];
    const share = i % 10 < 6 ? 1 : i % 10 < 9 ? 0.5 : 0;
    receipts.push({
      ...pay,
      id: `pay_${pad(i)}`,
      number: `RCT/26-27/${pad(i + 1)}`,
      date: notAfterYearEnd(addDays(inv.date, i % 45)),
      partyId: inv.partyId,
      partyName: inv.party.name,
      docId: inv.id,
      amount: share ? roundTo(inv.totals.net * share) : 100,
      mode: i % 4 === 0 ? 'CASH' : 'BANK',
      bankAccountId: i % 4 === 0 ? '' : 'bank_1',
    });
  }

  const bill = samplePurchase(business, supplier, [
    { productId: products[0].id, qty: 20, rate: 60 },
    { productId: products[1].id, qty: 10, rate: 75 },
  ]);
  const purchases = Array.from({ length: LARGE_COUNTS.purchases }, (_, i): PurchaseBill => {
    const s = sellers[i % sellers.length];
    const billDate = dayOf(i, LARGE_COUNTS.purchases);
    return {
      ...bill,
      id: `pur_${pad(i)}`,
      billNo: `SUP-${pad(i)}`,
      billDate,
      dueDate: addDays(billDate, 30),
      supplierId: s.id,
      supplier: { ...bill.supplier, name: s.name },
      items: bill.items.map((it, j) => ({ ...it, productId: productOf(i * 3 + j) })),
    };
  });
  // Supplier payments against 800 of the bills, half of them in part.
  const out = newPayment(business.id, 'OUT', { mode: 'BANK', bankAccountId: 'bank_1' });
  for (let i = 0; i < 800; i++) {
    const b = purchases[i];
    receipts.push({
      ...out,
      id: `pout_${pad(i)}`,
      number: `PAY/26-27/${pad(i + 1)}`,
      date: notAfterYearEnd(addDays(b.billDate, 20)),
      partyId: b.supplierId,
      partyName: b.supplier.name,
      docId: b.id,
      amount: i % 2 ? roundTo(b.totals.net / 2) : b.totals.net,
    });
  }

  // Receipt vouchers set bill-wise against invoices that were paid only Rs 100, and salary journal vouchers.
  const rv = newVoucher(business.id, 'RECEIPT');
  const vouchers = Array.from({ length: 400 }, (_, i): Voucher => {
    const inv = invoices[i * 20 + 9];
    return {
      ...rv,
      id: `vch_${pad(i)}`,
      number: `RV/26-27/${pad(i + 1)}`,
      date: notAfterYearEnd(addDays(inv.date, 3)),
      lines: [
        { ledgerId: 'bank:bank_1', dr: 50, cr: 0, docId: '', note: '' },
        { ledgerId: `party:${inv.partyId}`, dr: 0, cr: 50, docId: inv.id, note: '' },
      ],
    };
  });
  const jv = newVoucher(business.id, 'JOURNAL');
  for (let i = 0; i < 100; i++) {
    vouchers.push({
      ...jv,
      id: `jv_${pad(i)}`,
      number: `JV/26-27/${pad(i + 1)}`,
      date: dayOf(i, 100),
      lines: [
        { ledgerId: 'sys:exp-salary', dr: 25_000, cr: 0, docId: '', note: '' },
        { ledgerId: 'sys:cash', dr: 0, cr: 25_000, docId: '', note: '' },
      ],
    });
  }

  const exp = newExpense(business.id, { taxable: 1_000, gstRate: 18, cgst: 90, sgst: 90, total: 1_180, itcEligible: true, paidVia: 'BANK', bankAccountId: 'bank_1' });
  const expenses = Array.from({ length: 300 }, (_, i): Expense => ({ ...exp, id: `exp_${pad(i)}`, date: dayOf(i, 300), billNo: `E-${i}` }));

  return { business, parties, products, invoices, purchases, receipts, vouchers, expenses };
}

export function largeBooksInput(d: LargeData = largeData()): BooksInput {
  return { business: d.business, invoices: d.invoices, purchases: d.purchases, expenses: d.expenses, receipts: d.receipts, vouchers: d.vouchers, parties: d.parties, ledgers: [], products: d.products };
}

/** The same records as the store holds them. */
export function largeCollections(d: LargeData = largeData()): CollectionData {
  const c = emptyCollections();
  c.businesses.push(d.business);
  c.clients = d.parties;
  c.products = d.products;
  c.invoices = d.invoices;
  c.purchases = d.purchases;
  c.receipts = d.receipts;
  c.vouchers = d.vouchers;
  c.expenses = d.expenses;
  return c;
}
