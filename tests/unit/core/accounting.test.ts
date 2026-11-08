import { describe, expect, it } from 'vitest';
import {
  buildJournal,
  expenseEntry,
  fxFactor,
  paymentEntry,
  purchaseEntry,
  salesEntry,
  voucherDifference,
  voucherEntry,
} from '../../../src/core/accounting/postings';
import type { JournalEntry } from '../../../src/core/accounting/postings';
import {
  balanceSheet,
  buildBooks,
  ledgerInfo,
  ledgerStatement,
  monthlyPnl,
  openingDifference,
  payablesAgeing,
  profitAndLoss,
  receivablesAgeing,
  trialBalance,
} from '../../../src/core/accounting/reports';
import type { BooksInput } from '../../../src/core/accounting/reports';
import { newBusiness, newExpense, newLedger, newPayment, newVoucher } from '../../../src/core/factories';
import { makeGstin } from '../../../src/core/gst/gstin';
import { KA_CUSTOMER_GSTIN, sampleBusiness, sampleDoc, sampleParty, sampleProduct, samplePurchase } from '../../fixtures/sample';

const lineOf = (e: JournalEntry | null, ledgerId: string) => e?.lines.find((l) => l.ledgerId === ledgerId);
const balanced = (e: JournalEntry) => Math.abs(e.lines.reduce((s, l) => s + l.dr - l.cr, 0)) < 0.001;

function scenario() {
  const business = sampleBusiness();
  const reliance = sampleParty(business.id, { openingBalance: 10_000, openingType: 'DR' });
  const karnataka = sampleParty(business.id, {
    name: 'Karnataka Stores',
    gstin: KA_CUSTOMER_GSTIN,
    billing: { line1: 'MG Road', line2: '', city: 'Bengaluru', pincode: '560001', stateCode: '29', countryCode: 'IN' },
  });
  const supplier = sampleParty(business.id, {
    kind: 'SUPPLIER',
    name: 'Bajaj Electricals',
    gstin: makeGstin('27', 'AABCB1234C'),
    openingBalance: 5_000,
    openingType: 'CR',
  });
  const product = sampleProduct(business.id);
  const purchase = samplePurchase(business, supplier, [{ productId: product.id, qty: 50, rate: 60 }]);
  const inv1 = sampleDoc(business, reliance, [{ productId: product.id, qty: 20, rate: 100 }]);
  const inv2 = sampleDoc(business, karnataka, [{ productId: product.id, qty: 10, rate: 100 }], {
    number: 'INV/26-27/0002',
    date: '2026-10-05',
  });
  const receipt = newPayment(business.id, 'IN', {
    partyId: reliance.id,
    docId: inv1.id,
    amount: 1_000,
    mode: 'BANK',
    bankAccountId: 'bank_1',
    date: '2026-10-10',
    number: 'RCT/26-27/0001',
  });
  const payment = newPayment(business.id, 'OUT', {
    partyId: supplier.id,
    docId: purchase.id,
    amount: 3_540,
    mode: 'CASH',
    date: '2026-09-20',
    number: 'PAY/26-27/0001',
  });
  const rent = newExpense(business.id, {
    date: '2026-10-02',
    ledgerId: 'sys:exp-rent',
    taxable: 5_000,
    gstRate: 18,
    cgst: 450,
    sgst: 450,
    total: 5_900,
    itcEligible: true,
    paidVia: 'BANK',
    bankAccountId: 'bank_1',
    tds: { section: '194I', rate: 10, base: 5_000, amount: 500 },
  });
  const capital = newVoucher(business.id, 'JOURNAL', {
    date: '2026-04-01',
    number: 'JV/26-27/0001',
    narration: 'Capital introduced',
    lines: [
      { ledgerId: 'sys:cash', dr: 20_000, cr: 0, docId: '', note: '' },
      { ledgerId: 'sys:capital', dr: 0, cr: 20_000, docId: '', note: '' },
    ],
  });
  const input: BooksInput = {
    business,
    invoices: [inv1, inv2],
    purchases: [purchase],
    expenses: [rent],
    receipts: [receipt, payment],
    vouchers: [capital],
    parties: [reliance, karnataka, supplier],
    ledgers: [],
    products: [product],
  };
  return { business, reliance, karnataka, supplier, product, purchase, inv1, inv2, input };
}

describe('postings', () => {
  it('posts an intra-state invoice to the party, sales and output CGST/SGST', () => {
    const { business, reliance, inv1 } = scenario();
    const e = salesEntry(inv1, business)!;
    expect(lineOf(e, `party:${reliance.id}`)).toMatchObject({ dr: 2_360, cr: 0 });
    expect(lineOf(e, 'sys:sales')).toMatchObject({ cr: 2_000 });
    expect(lineOf(e, 'sys:out-cgst')).toMatchObject({ cr: 180 });
    expect(lineOf(e, 'sys:out-sgst')).toMatchObject({ cr: 180 });
    expect(balanced(e)).toBe(true);
    expect(e.voucherType).toBe('Tax Invoice');
  });

  it('skips drafts, cancelled documents and types that do not post', () => {
    const { business, reliance } = scenario();
    expect(salesEntry(sampleDoc(business, reliance, [{ qty: 1, rate: 10 }], { status: 'DRAFT' }), business)).toBeNull();
    expect(salesEntry(sampleDoc(business, reliance, [{ qty: 1, rate: 10 }], { status: 'CANCELLED' }), business)).toBeNull();
    expect(salesEntry(sampleDoc(business, reliance, [{ qty: 1, rate: 10 }], {}, 'DELIVERY_CHALLAN'), business)).toBeNull();
    expect(salesEntry(sampleDoc(business, reliance, [{ qty: 1, rate: 10 }], {}, 'QUOTATION'), business)).toBeNull();
  });

  it('reverses sales and output tax for a credit note', () => {
    const { business, reliance, inv1 } = scenario();
    const cn = sampleDoc(business, reliance, [{ qty: 5, rate: 100 }], { refDocId: inv1.id, number: 'CN/26-27/0001' }, 'CREDIT_NOTE');
    const e = salesEntry(cn, business)!;
    expect(lineOf(e, 'sys:sales-return')).toMatchObject({ dr: 500 });
    expect(lineOf(e, 'sys:out-cgst')).toMatchObject({ dr: 45 });
    expect(lineOf(e, `party:${reliance.id}`)).toMatchObject({ cr: 590 });
    expect(balanced(e)).toBe(true);
  });

  it('books TDS deducted by the customer and leaves tax out under reverse charge', () => {
    const { business, karnataka, reliance } = scenario();
    const withTds = sampleDoc(business, karnataka, [{ qty: 10, rate: 100 }], { tds: { section: '194J', rate: 10, base: 1_000, amount: 0 } });
    const e = salesEntry(withTds, business)!;
    expect(lineOf(e, `party:${karnataka.id}`)).toMatchObject({ dr: 1_080 });
    expect(lineOf(e, 'sys:tds-receivable')).toMatchObject({ dr: 100 });
    expect(lineOf(e, 'sys:out-igst')).toMatchObject({ cr: 180 });
    expect(balanced(e)).toBe(true);

    const rcm = sampleDoc(business, reliance, [{ qty: 1, rate: 1_000 }], { reverseCharge: true });
    const r = salesEntry(rcm, business)!;
    expect(lineOf(r, 'sys:out-cgst')).toBeUndefined();
    expect(lineOf(r, `party:${reliance.id}`)).toMatchObject({ dr: 1_000 });
    expect(balanced(r)).toBe(true);
  });

  it('collects TCS and posts round-off on either side', () => {
    const { business, reliance } = scenario();
    const doc = sampleDoc(business, reliance, [{ qty: 1, rate: 99.5, gstRate: 5 }], { tcs: { section: '206C(1)', rate: 1, base: 104, amount: 0 } });
    const e = salesEntry(doc, business)!;
    expect(doc.totals.roundOff).toBeCloseTo(-0.48, 2);
    expect(lineOf(e, 'sys:round-off')).toMatchObject({ dr: 0.48 });
    expect(lineOf(e, 'sys:tcs-payable')).toMatchObject({ cr: 1.04 });
    expect(balanced(e)).toBe(true);

    const up = sampleDoc(business, reliance, [{ qty: 1, rate: 100.5, gstRate: 5 }]);
    const u = salesEntry(up, business)!;
    expect(up.totals.roundOff).toBeCloseTo(0.48, 2);
    expect(lineOf(u, 'sys:round-off')?.cr).toBeCloseTo(up.totals.roundOff, 2);
    expect(balanced(u)).toBe(true);

    const cnUp = sampleDoc(business, reliance, [{ qty: 1, rate: 100.5, gstRate: 5 }], {}, 'CREDIT_NOTE');
    expect(lineOf(salesEntry(cnUp, business), 'sys:round-off')?.dr).toBeCloseTo(cnUp.totals.roundOff, 2);
  });

  it('uses the exempt and export sales ledgers and converts foreign currency', () => {
    const { business, reliance } = scenario();
    const bos = sampleDoc(business, reliance, [{ qty: 2, rate: 50 }], {}, 'BILL_OF_SUPPLY');
    expect(lineOf(salesEntry(bos, business), 'sys:sales-exempt')).toMatchObject({ cr: 100 });

    const exp = sampleDoc(business, reliance, [{ qty: 10, rate: 100 }], {
      supplyKind: 'EXPORT',
      currency: 'USD',
      exchangeRate: 83,
      partyId: '',
    });
    const e = salesEntry(exp, business)!;
    expect(lineOf(e, 'sys:sales-export')).toMatchObject({ cr: 83_000 });
    expect(lineOf(e, 'sys:walkin')).toMatchObject({ dr: 83_000 });
    expect(fxFactor(business, 'INR', 83)).toBe(1);
    expect(fxFactor(business, 'USD', 0)).toBe(1);
  });

  it('posts VAT for a business outside India', () => {
    const dubai = newBusiness({ name: 'Dubai Trading', countryCode: 'AE' });
    const party = sampleParty(dubai.id, { gstin: '', registration: 'UNREGISTERED' });
    const doc = sampleDoc(dubai, party, [{ qty: 1, rate: 100, gstRate: 5 }], { supplyKind: 'NON_GST', currency: 'AED' });
    const e = salesEntry(doc, dubai)!;
    expect(lineOf(e, 'sys:out-vat')).toMatchObject({ cr: 5 });
    expect(balanced(e)).toBe(true);
  });

  it('posts purchases with ITC, ineligible ITC, reverse charge, capital goods and TDS', () => {
    const { business, supplier, purchase } = scenario();
    const e = purchaseEntry(purchase, business)!;
    expect(lineOf(e, 'sys:purchase')).toMatchObject({ dr: 3_000 });
    expect(lineOf(e, 'sys:in-cgst')).toMatchObject({ dr: 270 });
    expect(lineOf(e, `party:${supplier.id}`)).toMatchObject({ cr: 3_540 });
    expect(balanced(e)).toBe(true);

    const blocked = purchaseEntry({ ...purchase, itcCategory: 'INELIGIBLE' }, business)!;
    expect(lineOf(blocked, 'sys:purchase')).toMatchObject({ dr: 3_540 });
    expect(lineOf(blocked, 'sys:in-cgst')).toBeUndefined();

    const rcm = samplePurchase(business, supplier, [{ qty: 1, rate: 10_000 }], { reverseCharge: true });
    const r = purchaseEntry(rcm, business)!;
    expect(lineOf(r, 'sys:rcm-payable')).toMatchObject({ cr: 1_800 });
    expect(lineOf(r, `party:${supplier.id}`)).toMatchObject({ cr: 10_000 });
    expect(balanced(r)).toBe(true);

    const machine = purchaseEntry({ ...purchase, itcCategory: 'CAPITAL_GOODS' }, business)!;
    expect(lineOf(machine, 'sys:fixed-assets')).toMatchObject({ dr: 3_000 });
    const services = purchaseEntry({ ...purchase, itcCategory: 'INPUT_SERVICES' }, business)!;
    expect(lineOf(services, 'sys:purchase-services')).toMatchObject({ dr: 3_000 });

    const tds = samplePurchase(business, supplier, [{ qty: 1, rate: 100_000 }], { tds: { section: '194C', rate: 1, base: 100_000, amount: 0 } });
    const t = purchaseEntry(tds, business)!;
    expect(lineOf(t, 'sys:tds-payable')).toMatchObject({ cr: 1_000 });
    expect(lineOf(t, `party:${supplier.id}`)).toMatchObject({ cr: 117_000 });
    expect(balanced(t)).toBe(true);

    const noSupplier = purchaseEntry({ ...purchase, supplierId: '', totals: { ...purchase.totals, tcs: 10, net: 3_550 } }, business)!;
    expect(lineOf(noSupplier, 'sys:other-suppliers')).toMatchObject({ cr: 3_550 });
    expect(lineOf(noSupplier, 'sys:tcs-receivable')).toMatchObject({ dr: 10 });
    expect(purchaseEntry({ ...purchase, status: 'CANCELLED' }, business)).toBeNull();
  });

  it('posts expenses paid by bank, cash or on credit', () => {
    const { input } = scenario();
    const rent = expenseEntry(input.expenses[0])!;
    expect(lineOf(rent, 'sys:exp-rent')).toMatchObject({ dr: 5_000 });
    expect(lineOf(rent, 'sys:in-cgst')).toMatchObject({ dr: 450 });
    expect(lineOf(rent, 'bank:bank_1')).toMatchObject({ cr: 5_400 });
    expect(lineOf(rent, 'sys:tds-payable')).toMatchObject({ cr: 500 });
    expect(balanced(rent)).toBe(true);

    const tea = expenseEntry(newExpense('biz', { ledgerId: '', taxable: 100, gstRate: 5, cgst: 2.5, sgst: 2.5, total: 110, paidVia: 'CREDIT' }))!;
    expect(lineOf(tea, 'sys:exp-misc')).toMatchObject({ dr: 110 });
    expect(lineOf(tea, 'sys:expense-payable')).toMatchObject({ cr: 110 });
    expect(lineOf(expenseEntry(newExpense('biz', { taxable: 50, total: 50, paidVia: 'UPI' })), 'sys:cash')).toMatchObject({ cr: 50 });
    expect(expenseEntry(newExpense('biz'))).toBeNull();
  });

  it('posts receipts and payments, falling back to the document party or walk-in', () => {
    const { business, reliance, inv1, purchase, supplier } = scenario();
    const lookup = { invoices: new Map([[inv1.id, inv1]]), purchases: new Map([[purchase.id, purchase]]) };
    const r = paymentEntry(newPayment(business.id, 'IN', { docId: inv1.id, amount: 500, mode: 'UPI', bankAccountId: 'bank_1' }), business, lookup)!;
    expect(lineOf(r, 'bank:bank_1')).toMatchObject({ dr: 500 });
    expect(lineOf(r, `party:${reliance.id}`)).toMatchObject({ cr: 500 });
    const p = paymentEntry(newPayment(business.id, 'OUT', { docId: purchase.id, amount: 200 }), business, lookup)!;
    expect(lineOf(p, `party:${supplier.id}`)).toMatchObject({ dr: 200 });
    expect(lineOf(p, 'sys:cash')).toMatchObject({ cr: 200 });
    expect(lineOf(paymentEntry(newPayment(business.id, 'IN', { amount: 10 }), business), 'sys:walkin')).toMatchObject({ cr: 10 });
    expect(lineOf(paymentEntry(newPayment(business.id, 'OUT', { amount: 10 }), business), 'sys:other-suppliers')).toMatchObject({ dr: 10 });
    expect(paymentEntry(newPayment(business.id, 'IN', { amount: 0 }), business)).toBeNull();
  });

  it('keeps vouchers as entered and parks any difference in Suspense', () => {
    const v = newVoucher('biz', 'CONTRA', {
      lines: [
        { ledgerId: 'sys:cash', dr: 100, cr: 0, docId: '', note: '' },
        { ledgerId: 'bank:b1', dr: 0, cr: 90, docId: '', note: '' },
        { ledgerId: '', dr: 5, cr: 0, docId: '', note: '' },
      ],
    });
    expect(voucherDifference(v)).toBe(15);
    const e = voucherEntry(v)!;
    expect(e.voucherType).toBe('Contra');
    expect(lineOf(e, 'sys:suspense')).toMatchObject({ cr: 10 });
    expect(balanced(e)).toBe(true);
    expect(voucherEntry(newVoucher('biz', 'JOURNAL'))).toBeNull();
  });

  it('builds a sorted, balanced journal for one business only', () => {
    const { input, business } = scenario();
    const other = sampleBusiness();
    const foreign = sampleDoc(other, sampleParty(other.id), [{ qty: 1, rate: 10 }]);
    const journal = buildJournal({ ...input, invoices: [...input.invoices, foreign] });
    expect(journal).toHaveLength(7);
    expect(journal.every(balanced)).toBe(true);
    expect(journal.every((e) => e.sourceId !== foreign.id)).toBe(true);
    expect(journal.map((e) => e.date)).toEqual([...journal.map((e) => e.date)].sort());
    expect(business.id).not.toBe(other.id);
  });
});

describe('reports', () => {
  it('balances the trial balance including opening stock and opening difference', () => {
    const books = buildBooks(scenario().input);
    const tb = trialBalance(books, '2026-10-31');
    expect(tb.totalDr).toBe(64_540);
    expect(tb.totalCr).toBe(64_540);
    expect(tb.rows.find((r) => r.id === 'opening-stock')?.dr).toBe(5_500);
    expect(tb.rows.find((r) => r.id === 'opening-diff')?.cr).toBe(35_500);
    expect(openingDifference(books)).toBe(35_500);
  });

  it('computes trading and profit & loss with stock valuation', () => {
    const books = buildBooks(scenario().input);
    const pnl = profitAndLoss(books, '2026-04-01', '2026-10-31');
    expect(pnl.sales.total).toBe(3_000);
    expect(pnl.purchases.total).toBe(3_000);
    expect(pnl.openingStock).toBe(5_500);
    expect(pnl.closingStock).toBe(6_800);
    expect(pnl.grossProfit).toBe(1_300);
    expect(pnl.indirectExpenses.lines.find((l) => l.id === 'sys:exp-rent')?.amount).toBe(5_000);
    expect(pnl.netProfit).toBe(-3_700);

    const months = monthlyPnl(books, '2026-10-31');
    expect(months).toHaveLength(7);
    expect(months[6]).toMatchObject({ month: '2026-10', sales: 3_000 });
    expect(months.reduce((s, m) => s + m.netProfit, 0)).toBeCloseTo(-3_700, 1);
  });

  it('balances the balance sheet', () => {
    const books = buildBooks(scenario().input);
    const bs = balanceSheet(books, '2026-10-31');
    expect(bs.totalAssets).toBe(56_400);
    expect(bs.totalLiabilities).toBe(56_400);
    expect(bs.closingStock).toBe(6_800);
    expect(bs.profitCurrent).toBe(-3_700);
    expect(bs.assets.find((s) => s.key === 'STOCK')?.lines[0]).toMatchObject({ name: 'Closing Stock', amount: 6_800 });
  });

  it('carries earlier-year profit into the trial balance and balance sheet', () => {
    const s = scenario();
    const march = sampleDoc(s.business, s.reliance, [{ productId: s.product.id, qty: 5, rate: 100 }], {
      number: 'INV/25-26/0099',
      date: '2026-03-15',
    });
    const books = buildBooks({ ...s.input, invoices: [...s.input.invoices, march] });
    const tb = trialBalance(books, '2026-10-31');
    expect(tb.rows.find((r) => r.id === 'pnl-prior')?.cr).toBe(225);
    expect(tb.rows.find((r) => r.id === 'opening-stock')?.dr).toBe(5_225);
    expect(tb.totalDr).toBe(tb.totalCr);
    const bs = balanceSheet(books, '2026-10-31');
    expect(bs.profitPrior).toBe(225);
    expect(bs.totalAssets).toBe(bs.totalLiabilities);
  });

  it('prints a ledger statement with opening and running balance', () => {
    const { input, reliance } = scenario();
    const books = buildBooks(input);
    const st = ledgerStatement(books, `party:${reliance.id}`, '2026-10-01', '2026-10-31');
    expect(st.opening).toBe(10_000);
    expect(st.rows.map((r) => r.balance)).toEqual([12_360, 11_360]);
    expect(st.rows[0].against).toBe('Sales & others');
    expect(st.closing).toBe(11_360);
    expect(st.totalDr).toBe(2_360);
    expect(st.totalCr).toBe(1_000);

    const sales = ledgerStatement(books, 'sys:sales', '2026-10-05', '2026-10-31');
    expect(sales.opening).toBe(-2_000);
    expect(sales.closing).toBe(-3_000);
    const cash = ledgerStatement(books, 'sys:cash', '2026-04-01', '2026-10-31');
    expect(cash.closing).toBe(16_460);
  });

  it('ages receivables bill-wise and shows the rest on account', () => {
    const { input, reliance, karnataka, supplier } = scenario();
    const books = buildBooks(input);
    const rec = receivablesAgeing(books, '2026-10-31');
    const rel = rec.find((r) => r.ledgerId === `party:${reliance.id}`)!;
    expect(rel.buckets).toEqual([1_360, 0, 0, 0]);
    expect(rel.onAccount).toBe(10_000);
    expect(rel.total).toBe(11_360);
    expect(rec.find((r) => r.ledgerId === `party:${karnataka.id}`)?.bills).toBe(1_180);
    expect(rec.find((r) => r.ledgerId === 'sys:walkin')).toBeUndefined();

    const late = receivablesAgeing(books, '2027-01-15');
    expect(late.find((r) => r.ledgerId === `party:${reliance.id}`)?.buckets).toEqual([0, 0, 0, 1_360]);

    const pay = payablesAgeing(books, '2026-10-31');
    const sup = pay.find((r) => r.ledgerId === `party:${supplier.id}`)!;
    expect(sup.bills).toBe(0);
    expect(sup.total).toBe(5_000);
    expect(sup.onAccount).toBe(5_000);

    const unpaid = payablesAgeing(buildBooks({ ...input, receipts: [] }), '2026-11-10');
    expect(unpaid.find((r) => r.ledgerId === `party:${supplier.id}`)?.buckets).toEqual([0, 3_540, 0, 0]);
  });

  it('resolves deleted ledgers and ignores income-ledger openings', () => {
    const { input, business } = scenario();
    const misc = newLedger(business.id, 'Commission Received', 'INDIRECT_INCOME', { openingBalance: 999, openingType: 'CR' });
    const loan = newLedger(business.id, 'Bank Loan', 'LOANS', { openingBalance: 50_000, openingType: 'CR' });
    const books = buildBooks({ ...input, ledgers: [misc, loan] });
    expect(books.openings.has(misc.id)).toBe(false);
    expect(books.openings.get(loan.id)).toBe(-50_000);
    expect(ledgerInfo(books, 'party:gone').name).toContain('deleted');
    expect(ledgerInfo(books, 'bank:gone').group).toBe('BANK');
    expect(ledgerInfo(books, 'custom-gone').group).toBe('SUSPENSE');
    const bs = balanceSheet(books, '2026-10-31');
    expect(bs.totalAssets).toBe(bs.totalLiabilities);
  });
});
