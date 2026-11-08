import { describe, expect, it } from 'vitest';
import { paymentFx } from '../../../src/core/accounting/postings';
import type { JournalEntry } from '../../../src/core/accounting/postings';
import { buildBooks, ledgerStatement, payablesAgeing, profitAndLoss, receivablesAgeing, trialBalance } from '../../../src/core/accounting/reports';
import type { BooksInput } from '../../../src/core/accounting/reports';
import { buildPaymentIndex, partyPayments, purchasePaymentSummary, salesPaymentSummary } from '../../../src/core/docs/payments';
import { newPayment, newVoucher } from '../../../src/core/factories';
import { makeGstin } from '../../../src/core/gst/gstin';
import type { PaymentRecord, PurchaseBill, Voucher } from '../../../src/core/model';
import { validateRecord } from '../../../src/core/schema';
import { sampleBusiness, sampleDoc, sampleParty, samplePurchase } from '../../fixtures/sample';

// Review R1 (2026-11-07): payments against invoices and bills in another currency were posted as if
// they were rupees, and bill-wise voucher lines (in rupees) were counted as if they were in the
// document's currency. These tests follow such payments through to the party ledger.

const business = sampleBusiness();
const buyer = sampleParty(business.id, {
  name: 'Acme Inc',
  gstin: '',
  registration: 'OVERSEAS',
  billing: { line1: '1 Main Street', line2: '', city: 'New York', pincode: '10001', stateCode: '96', countryCode: 'US' },
});
const supplier = sampleParty(business.id, { kind: 'SUPPLIER', name: 'Shenzhen Parts Co', gstin: makeGstin('27', 'AABCS1234D') });
/** USD 1,000 export invoice under LUT at 83, so Rs 83,000 is receivable. */
const invoice = sampleDoc(business, buyer, [{ qty: 1, rate: 1000, gstRate: 0 }], {
  currency: 'USD',
  exchangeRate: 83,
  placeOfSupply: '96',
  supplyKind: 'EXPORT',
  roundOff: false,
  date: '2026-10-01',
  dueDate: '2026-10-31',
});
/** USD 500 bill at 80, so Rs 40,000 is payable. */
const bill = samplePurchase(business, supplier, [{ qty: 1, rate: 500, gstRate: 0 }], { currency: 'USD', exchangeRate: 80, roundOff: false, billDate: '2026-10-02' });

const receipt = (partial: Partial<PaymentRecord>) =>
  newPayment(business.id, 'IN', { docId: invoice.id, partyId: buyer.id, partyName: buyer.name, mode: 'BANK', bankAccountId: 'bank_1', date: '2026-10-20', ...partial });
const payment = (partial: Partial<PaymentRecord>) =>
  newPayment(business.id, 'OUT', { docId: bill.id, partyId: supplier.id, partyName: supplier.name, mode: 'BANK', bankAccountId: 'bank_1', date: '2026-10-21', ...partial });

function books(receipts: PaymentRecord[], vouchers: Voucher[] = [], purchases: PurchaseBill[] = []) {
  const input: BooksInput = {
    business,
    invoices: [invoice],
    purchases,
    expenses: [],
    receipts,
    vouchers,
    parties: [buyer, supplier],
    ledgers: [],
    products: [],
  };
  return buildBooks(input);
}

const closing = (b: ReturnType<typeof books>, ledgerId: string) => ledgerStatement(b, ledgerId, '2026-04-01', '2026-10-31').closing;
const entryOf = (b: ReturnType<typeof books>, sourceId: string) => b.journal.find((e) => e.sourceId === sourceId)!;
const line = (e: JournalEntry, ledgerId: string) => e.lines.find((l) => l.ledgerId === ledgerId);
const BUYER = `party:${buyer.id}`;
const SUPPLIER = `party:${supplier.id}`;
const FX = 'sys:fx-gain-loss';

describe('payments in another currency (review R1)', () => {
  it('posts a dollar receipt recorded the way the payment dialog does at the invoice rate, so the party ledger is cleared', () => {
    // The dialog takes the amount in the invoice currency; older payments carry no currency.
    const pay = receipt({ amount: 1000 });
    const b = books([pay]);
    expect(salesPaymentSummary(invoice, buildPaymentIndex([pay], [], [invoice], [], business), '2026-10-25').status).toBe('PAID');
    expect(closing(b, BUYER)).toBe(0);
    expect(line(entryOf(b, pay.id), 'bank:bank_1')).toMatchObject({ dr: 83_000 });
    expect(line(entryOf(b, pay.id), FX)).toBeUndefined();
    expect(closing(b, 'bank:bank_1')).toBe(25_000 + 83_000);
  });

  it('books the difference between the receipt rate and the invoice rate as exchange gain or loss', () => {
    const gain = receipt({ amount: 1000, currency: 'USD', exchangeRate: 84 });
    const g = books([gain]);
    const e = entryOf(g, gain.id);
    expect(line(e, 'bank:bank_1')).toMatchObject({ dr: 84_000, cr: 0 });
    expect(line(e, BUYER)).toMatchObject({ dr: 0, cr: 83_000 });
    expect(line(e, FX)).toMatchObject({ dr: 0, cr: 1_000 });
    expect(closing(g, BUYER)).toBe(0);
    const tb = trialBalance(g, '2026-10-31');
    expect(tb.totalDr).toBe(tb.totalCr);
    // Exchange Gain/Loss sits under indirect expenses, as in ERPNext's standard chart; a gain shows as a negative expense.
    expect(profitAndLoss(g, '2026-10-01', '2026-10-31').indirectExpenses.lines.find((l) => l.id === FX)?.amount).toBe(-1_000);

    const loss = receipt({ amount: 1000, currency: 'USD', exchangeRate: 82 });
    const l = books([loss]);
    expect(line(entryOf(l, loss.id), 'bank:bank_1')).toMatchObject({ dr: 82_000 });
    expect(line(entryOf(l, loss.id), FX)).toMatchObject({ dr: 1_000, cr: 0 });
    expect(closing(l, BUYER)).toBe(0);
  });

  it('prevents penny/paise leftovers on multiple foreign part-payments (FU2)', () => {
    // USD 1,000 export invoice @ 83.13, so ₹83,130.00 is receivable.
    // Three installments: 333.33, 333.33, 333.34
    // With normal rounding:
    // 333.33 * 83.13 = 27709.72 (rounded)
    // 333.33 * 83.13 = 27709.72 (rounded)
    // 333.34 * 83.13 = 27710.55 (rounded)
    // Total sum = 83129.99, leaving 0.01 unpaid.
    // Our fix adjusts the last payment to 27710.56, making total sum 83130.00.
    const customInvoice = sampleDoc(business, buyer, [{ qty: 1, rate: 1000, gstRate: 0 }], {
      currency: 'USD',
      exchangeRate: 83.13,
      placeOfSupply: '96',
      supplyKind: 'EXPORT',
      roundOff: false,
      date: '2026-10-01',
      dueDate: '2026-10-31',
    });
    
    const pay1 = newPayment(business.id, 'IN', { docId: customInvoice.id, partyId: buyer.id, partyName: buyer.name, mode: 'BANK', bankAccountId: 'bank_1', date: '2026-10-10', amount: 333.33, currency: 'USD', exchangeRate: 83.13 });
    const pay2 = newPayment(business.id, 'IN', { docId: customInvoice.id, partyId: buyer.id, partyName: buyer.name, mode: 'BANK', bankAccountId: 'bank_1', date: '2026-10-11', amount: 333.33, currency: 'USD', exchangeRate: 83.13 });
    const pay3 = newPayment(business.id, 'IN', { docId: customInvoice.id, partyId: buyer.id, partyName: buyer.name, mode: 'BANK', bankAccountId: 'bank_1', date: '2026-10-12', amount: 333.34, currency: 'USD', exchangeRate: 83.13 });

    const input: BooksInput = {
      business,
      invoices: [customInvoice],
      purchases: [],
      expenses: [],
      receipts: [pay1, pay2, pay3],
      vouchers: [],
      parties: [buyer, supplier],
      ledgers: [],
      products: [],
    };
    const b = buildBooks(input);
    expect(ledgerStatement(b, BUYER, '2026-04-01', '2026-10-31').closing).toBe(0);
  });

  it('counts a bill-wise voucher line on a dollar invoice in dollars, at the invoice rate', () => {
    const v = newVoucher(business.id, 'RECEIPT', {
      number: 'RV/26-27/0001',
      date: '2026-10-22',
      lines: [
        { ledgerId: 'bank:bank_1', dr: 41_500, cr: 0, docId: '', note: '' },
        { ledgerId: BUYER, dr: 0, cr: 41_500, docId: invoice.id, note: '' },
      ],
    });
    const s = salesPaymentSummary(invoice, buildPaymentIndex([], [v], [invoice], [], business), '2026-10-25');
    expect(s).toMatchObject({ status: 'PARTIAL', paid: 500, balance: 500 });
    const b = books([], [v]);
    expect(closing(b, BUYER)).toBe(41_500);
    const row = receivablesAgeing(b, '2026-10-31').find((r) => r.ledgerId === BUYER)!;
    expect(row).toMatchObject({ bills: 41_500, total: 41_500, onAccount: 0 });
  });

  it('keeps the outstanding bills and the party ledger equal after a part-payment at another rate', () => {
    const pay = receipt({ amount: 400, currency: 'USD', exchangeRate: 85 });
    const b = books([pay]);
    expect(salesPaymentSummary(invoice, buildPaymentIndex([pay], [], [invoice], [], business), '2026-10-25')).toMatchObject({ status: 'PARTIAL', balance: 600 });
    expect(line(entryOf(b, pay.id), FX)).toMatchObject({ cr: 800 });
    const row = receivablesAgeing(b, '2026-10-31').find((r) => r.ledgerId === BUYER)!;
    expect(row).toMatchObject({ bills: 49_800, total: 49_800, onAccount: 0 });
  });

  it('settles the rupee value of a rupee payment against a dollar invoice, with no exchange difference', () => {
    const pay = receipt({ amount: 41_500, currency: 'INR', exchangeRate: 1 });
    expect(salesPaymentSummary(invoice, buildPaymentIndex([pay], [], [invoice], [], business), '2026-10-25')).toMatchObject({ paid: 500, balance: 500 });
    const e = entryOf(books([pay]), pay.id);
    expect(line(e, BUYER)).toMatchObject({ cr: 41_500 });
    expect(line(e, FX)).toBeUndefined();
  });

  it('keeps a payment with no linked document in the book currency', () => {
    const advance = receipt({ docId: '', amount: 5_000 });
    const e = entryOf(books([advance]), advance.id);
    expect(line(e, 'bank:bank_1')).toMatchObject({ dr: 5_000 });
    expect(line(e, BUYER)).toMatchObject({ cr: 5_000 });
  });

  it('pays a dollar purchase bill at the payment rate and books the difference', () => {
    const pay = payment({ amount: 500, currency: 'USD', exchangeRate: 82 });
    const b = books([pay], [], [bill]);
    const e = entryOf(b, pay.id);
    expect(line(e, SUPPLIER)).toMatchObject({ dr: 40_000, cr: 0 });
    expect(line(e, 'bank:bank_1')).toMatchObject({ dr: 0, cr: 41_000 });
    expect(line(e, FX)).toMatchObject({ dr: 1_000, cr: 0 });
    expect(closing(b, SUPPLIER)).toBe(0);
    expect(purchasePaymentSummary(bill, buildPaymentIndex([pay], [], [], [bill], business), '2026-10-25').status).toBe('PAID');

    const older = payment({ amount: 200 });
    expect(line(entryOf(books([older], [], [bill]), older.id), SUPPLIER)).toMatchObject({ dr: 16_000 });

    const v = newVoucher(business.id, 'PAYMENT', {
      number: 'PV/26-27/0001',
      date: '2026-10-22',
      lines: [
        { ledgerId: SUPPLIER, dr: 20_000, cr: 0, docId: bill.id, note: '' },
        { ledgerId: 'bank:bank_1', dr: 0, cr: 20_000, docId: '', note: '' },
      ],
    });
    expect(purchasePaymentSummary(bill, buildPaymentIndex([], [v], [], [bill], business), '2026-10-25')).toMatchObject({ status: 'PARTIAL', paid: 250, balance: 250 });
    const owed = payablesAgeing(books([], [v], [bill]), '2026-10-31').find((r) => r.ledgerId === SUPPLIER)!;
    expect(owed).toMatchObject({ bills: 20_000, total: 20_000, onAccount: 0 });
  });
});


describe('payment currency and rate (review R1)', () => {
  it("values a payment saved before payments had a currency in its document's currency, at the document's rate", () => {
    expect(paymentFx({}, invoice, business)).toEqual({ currency: 'USD', rate: 83 });
    expect(paymentFx({}, undefined, business)).toEqual({ currency: 'INR', rate: 1 });
    expect(paymentFx({ currency: 'INR', exchangeRate: 99 }, invoice, business)).toEqual({ currency: 'INR', rate: 1 });
    expect(paymentFx({ currency: 'USD', exchangeRate: 84 }, invoice, business)).toEqual({ currency: 'USD', rate: 84 });
    // A foreign amount without a rate (only a hand-edited backup has one) is valued like an older payment.
    expect(paymentFx({ currency: 'USD' }, invoice, business)).toEqual({ currency: 'USD', rate: 83 });
    expect(paymentFx({ currency: 'EUR' }, invoice, business)).toEqual({ currency: 'EUR', rate: 1 });
  });

  it('accepts payments with or without a currency in backups and saves, and refuses an invalid currency or rate', () => {
    const ok = receipt({ amount: 10 });
    expect(validateRecord('receipts', ok)).toBe('');
    expect(validateRecord('receipts', { ...ok, currency: 'USD', exchangeRate: 84 })).toBe('');
    expect(validateRecord('receipts', { ...ok, currency: 'usd' })).toMatch(/^currency: /);
    expect(validateRecord('receipts', { ...ok, currency: 'USD', exchangeRate: 0 })).toMatch(/^exchangeRate: /);
    expect(validateRecord('receipts', { ...ok, exchangeRate: '84' })).toMatch(/^exchangeRate: /);
  });
});

describe('what money a document was paid with (design F06)', () => {
  it('lists the payments and bill-wise voucher lines behind the amount paid, in the document currency', () => {
    const pay = receipt({ amount: 400, currency: 'USD', exchangeRate: 85, number: 'RCT/26-27/0001' });
    const v = newVoucher(business.id, 'RECEIPT', {
      number: 'RV/26-27/0001',
      date: '2026-10-22',
      lines: [
        { ledgerId: 'bank:bank_1', dr: 8_300, cr: 0, docId: '', note: '' },
        { ledgerId: BUYER, dr: 0, cr: 8_300, docId: invoice.id, note: '' },
      ],
    });
    const index = buildPaymentIndex([pay], [v], [invoice], [], business);
    expect(index.settlements.get(invoice.id)).toEqual([
      { direction: 'IN', amount: 400, bookAmount: 34_000, source: { kind: 'PAYMENT', payment: pay } },
      { direction: 'IN', amount: 100, bookAmount: 8_300, source: { kind: 'VOUCHER', voucher: v } },
    ]);
    expect(index.paidIn.get(invoice.id)).toBe(500);
    // A document missing from the list (deleted, or after a report's date) keeps the amounts as entered.
    expect(buildPaymentIndex([pay], [v], [], [], business).paidIn.get(invoice.id)).toBe(8_700);
  });

  it('lists payments and the party lines of receipt and payment vouchers as money received and paid', () => {
    const pay = receipt({ amount: 400, currency: 'USD', exchangeRate: 85, number: 'RCT/26-27/0001' });
    const older = payment({ amount: 100, number: 'PAY/26-27/0001' });
    const rv = newVoucher(business.id, 'RECEIPT', {
      number: 'RV/26-27/0002',
      lines: [
        { ledgerId: 'sys:cash', dr: 1_500, cr: 0, docId: '', note: '' },
        { ledgerId: BUYER, dr: 0, cr: 1_000, docId: '', note: '' },
        { ledgerId: 'sys:walkin', dr: 0, cr: 500, docId: '', note: '' },
      ],
    });
    const pv = newVoucher(business.id, 'PAYMENT', {
      number: 'PV/26-27/0002',
      lines: [
        { ledgerId: SUPPLIER, dr: 2_000, cr: 0, docId: bill.id, note: '' },
        { ledgerId: 'led_drawings', dr: 300, cr: 0, docId: '', note: '' },
        { ledgerId: 'bank:bank_1', dr: 0, cr: 2_300, docId: '', note: '' },
      ],
    });
    const jv = newVoucher(business.id, 'JOURNAL', {
      number: 'JV/26-27/0001',
      lines: [
        { ledgerId: BUYER, dr: 50, cr: 0, docId: '', note: '' },
        { ledgerId: 'sys:sales', dr: 0, cr: 50, docId: '', note: '' },
      ],
    });
    const rows = partyPayments([pay, older], [rv, pv, jv], [invoice], [bill], business);
    expect(rows.map((r) => [r.direction, r.number, r.ledgerId, r.docId, r.amount, r.currency, r.bookAmount, r.source.kind])).toEqual([
      ['IN', 'RCT/26-27/0001', '', invoice.id, 400, 'USD', 34_000, 'PAYMENT'],
      ['OUT', 'PAY/26-27/0001', '', bill.id, 100, 'USD', 8_000, 'PAYMENT'],
      ['IN', 'RV/26-27/0002', BUYER, '', 1_000, 'INR', 1_000, 'VOUCHER'],
      ['IN', 'RV/26-27/0002', 'sys:walkin', '', 500, 'INR', 500, 'VOUCHER'],
      ['OUT', 'PV/26-27/0002', SUPPLIER, bill.id, 2_000, 'INR', 2_000, 'VOUCHER'],
    ]);
    expect(rows[0]!.partyName).toBe('Acme Inc');
  });
});
