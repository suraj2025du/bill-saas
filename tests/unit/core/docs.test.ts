import { describe, expect, it } from 'vitest';
import { DOC_TYPES, DOC_TYPE_LIST, docLabel } from '../../../src/core/docs/docTypes';
import {
  canCancel,
  canConvert,
  canEdit,
  cancelDocument,
  convertDocument,
  createCreditNote,
  duplicateDocument,
  markConverted,
} from '../../../src/core/docs/lifecycle';
import { counterFor, previewNumber, renderNumber, takeNumber, validateDocNumber } from '../../../src/core/docs/numbering';
import { buildPaymentIndex, purchasePaymentSummary, salesPaymentSummary } from '../../../src/core/docs/payments';
import { dueRecurringRuns, makeRecurringCopy, nextRecurringDate } from '../../../src/core/docs/recurring';
import { EWAY_BILL_THRESHOLD, hasErrors, validateSalesDocument } from '../../../src/core/docs/validate';
import { defaultSeries, newPayment, newVoucher } from '../../../src/core/factories';
import { KA_CUSTOMER_GSTIN, sampleBusiness, sampleDoc, sampleParty, samplePurchase } from '../../fixtures/sample';

const biz = sampleBusiness();
const party = sampleParty(biz.id);

describe('doc types', () => {
  it('describes all seven document types', () => {
    expect(DOC_TYPE_LIST).toHaveLength(7);
    expect(DOC_TYPES.BILL_OF_SUPPLY.chargesTax).toBe(false);
    expect(DOC_TYPES.CREDIT_NOTE.stock).toBe('IN');
    expect(DOC_TYPES.DELIVERY_CHALLAN.convertsTo).toContain('TAX_INVOICE');
    expect(docLabel('PROFORMA')).toBe('Proforma Invoice');
  });
});

describe('numbering', () => {
  const series = defaultSeries().TAX_INVOICE;

  it('renders FY-based numbers within 16 characters', () => {
    expect(previewNumber(series, '2026-10-29')).toBe('INV/26-27/0001');
    expect(renderNumber({ ...series, includeFY: false, suffix: '-A' }, 7, '26-27')).toBe('INV/0007-A');
    const taken = takeNumber(series, '2026-10-29');
    expect(taken.number).toBe('INV/26-27/0001');
    expect(taken.series).toMatchObject({ nextNumber: 2, fy: '2026-27' });
  });

  it('resets the counter when the financial year changes', () => {
    const old = { ...series, nextNumber: 50, fy: '2025-26' };
    expect(counterFor(old, '2026-04-01')).toBe(1);
    expect(counterFor({ ...old, resetEachFY: false }, '2026-04-01')).toBe(50);
    expect(counterFor(old, '2026-03-31')).toBe(50);
  });

  it('skips numbers that already exist', () => {
    const used = new Set(['INV/26-27/0001', 'INV/26-27/0002']);
    expect(takeNumber(series, '2026-10-29', 4, (n) => used.has(n)).number).toBe('INV/26-27/0003');
  });

  it('enforces the GST number rules', () => {
    expect(validateDocNumber('INV/26-27/0001')).toEqual([]);
    expect(validateDocNumber('INV/2026-2027/000001')[0]).toMatch(/16 characters/);
    expect(validateDocNumber('INV#1')[0]).toMatch(/letters/);
    expect(validateDocNumber('')[0]).toMatch(/required/);
  });
});

describe('payments', () => {
  const inv = sampleDoc(biz, party, [{ qty: 1, rate: 1000, gstRate: 18 }]);

  it('moves from unpaid to partial to paid', () => {
    const index0 = buildPaymentIndex([], [], [inv], [], biz);
    expect(salesPaymentSummary(inv, index0, '2026-10-05')).toMatchObject({ status: 'UNPAID', balance: 1180, overdueDays: 0 });
    const p1 = newPayment(biz.id, 'IN', { docId: inv.id, amount: 500 });
    const s1 = salesPaymentSummary(inv, buildPaymentIndex([p1], [], [inv], [], biz), '2026-11-10');
    expect(s1).toMatchObject({ status: 'PARTIAL', paid: 500, balance: 680, overdueDays: 10 });
    const p2 = newPayment(biz.id, 'IN', { docId: inv.id, amount: 680 });
    expect(salesPaymentSummary(inv, buildPaymentIndex([p1, p2], [], [inv], [], biz)).status).toBe('PAID');
  });

  it('counts credit notes and bill-wise voucher lines', () => {
    const cn = { ...sampleDoc(biz, party, [{ qty: 1, rate: 100, gstRate: 18 }], {}, 'CREDIT_NOTE'), refDocId: inv.id };
    const v = newVoucher(biz.id, 'RECEIPT', {
      lines: [
        { ledgerId: 'sys:cash', dr: 1062, cr: 0, docId: '', note: '' },
        { ledgerId: `party:${party.id}`, dr: 0, cr: 1062, docId: inv.id, note: '' },
      ],
    });
    const s = salesPaymentSummary(inv, buildPaymentIndex([], [v], [inv, cn], [], biz));
    expect(s).toMatchObject({ adjusted: 118, paid: 1062, status: 'PAID', balance: 0 });
  });

  it('has no balance for quotations, drafts and tracks purchase bills', () => {
    const q = sampleDoc(biz, party, [{ qty: 1, rate: 100 }], {}, 'QUOTATION');
    expect(salesPaymentSummary(q, buildPaymentIndex([], [], [], [], biz)).status).toBe('NOT_APPLICABLE');
    expect(salesPaymentSummary({ ...inv, status: 'DRAFT' }, buildPaymentIndex([], [], [], [], biz)).status).toBe('NOT_APPLICABLE');
    const bill = samplePurchase(biz, party, [{ qty: 1, rate: 1000, gstRate: 18 }]);
    const out = newPayment(biz.id, 'OUT', { docId: bill.id, amount: 1180 });
    expect(purchasePaymentSummary(bill, buildPaymentIndex([out], [], [], [bill], biz)).status).toBe('PAID');
    expect(purchasePaymentSummary({ ...bill, status: 'CANCELLED' }, buildPaymentIndex([], [], [], [], biz)).status).toBe('NOT_APPLICABLE');
  });
});

describe('lifecycle', () => {
  const challan = sampleDoc(biz, party, [{ qty: 5, rate: 100, gstRate: 18 }], { number: 'DC/26-27/0001' }, 'DELIVERY_CHALLAN');
  const quote = sampleDoc(biz, party, [{ qty: 5, rate: 100, gstRate: 18 }], { number: 'QTN/26-27/0001' }, 'QUOTATION');
  const inv = sampleDoc(biz, party, [{ qty: 5, rate: 100, gstRate: 18 }]);

  it('converts a challan to an invoice without moving stock twice', () => {
    const converted = convertDocument(challan, 'TAX_INVOICE');
    expect(converted).toMatchObject({ docType: 'TAX_INVOICE', status: 'DRAFT', number: '', refDocId: challan.id, stockApplied: false });
    expect(converted.id).not.toBe(challan.id);
    expect(converted.items[0]!.id).not.toBe(challan.items[0]!.id);
    expect(convertDocument(quote, 'TAX_INVOICE').stockApplied).toBe(true);
    expect(markConverted(challan, converted.id).convertedToId).toBe(converted.id);
  });

  it('refuses invalid conversions', () => {
    expect(canConvert({ ...challan, status: 'DRAFT' }, 'TAX_INVOICE').ok).toBe(false);
    expect(canConvert({ ...challan, convertedToId: 'x' }, 'TAX_INVOICE').ok).toBe(false);
    expect(canConvert(inv, 'QUOTATION').ok).toBe(false);
    expect(() => convertDocument(inv, 'QUOTATION')).toThrow();
  });

  it('creates credit notes against final invoices', () => {
    const cn = createCreditNote(inv, 'SALES_RETURN', true);
    expect(cn).toMatchObject({ docType: 'CREDIT_NOTE', refDocId: inv.id, refDocNumber: inv.number, stockApplied: true, creditNoteReason: 'SALES_RETURN' });
    expect(createCreditNote(inv, 'POST_SALE_DISCOUNT', false).stockApplied).toBe(false);
    expect(() => createCreditNote({ ...inv, status: 'DRAFT' }, 'OTHER', false)).toThrow();
    expect(() => createCreditNote(quote, 'OTHER', false)).toThrow();
  });

  it('guards cancellation', () => {
    expect(canCancel(inv, [inv], [], []).ok).toBe(true);
    expect(canCancel({ ...inv, status: 'DRAFT' }, [], [], []).ok).toBe(false);
    expect(canCancel({ ...inv, status: 'CANCELLED' }, [], [], []).ok).toBe(false);
    expect(canCancel(inv, [inv], [newPayment(biz.id, 'IN', { docId: inv.id, amount: 10 })], []).reason).toMatch(/Payments/);
    const cn = { ...createCreditNote(inv, 'OTHER', false), status: 'FINAL' as const };
    expect(canCancel(inv, [inv, cn], [], []).reason).toMatch(/Credit notes/);
    const target = { ...convertDocument(challan, 'TAX_INVOICE'), status: 'FINAL' as const, number: 'INV/26-27/0009' };
    const src = markConverted(challan, target.id);
    expect(canCancel(src, [src, target], [], []).reason).toMatch(/Cancel that first/);
    expect(canCancel(src, [src, { ...target, status: 'CANCELLED' }], [], []).ok).toBe(true);
    const cancelled = cancelDocument(inv, ' wrong rate ');
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'wrong rate' });
    expect(canEdit(cancelled).ok).toBe(false);
    expect(canEdit(inv).ok).toBe(true);
  });

  it('refuses to cancel an invoice that a voucher pays bill-wise (review Y12)', () => {
    const v = newVoucher(biz.id, 'RECEIPT', {
      number: 'RV/26-27/0003',
      lines: [
        { ledgerId: 'sys:cash', dr: 100, cr: 0, docId: '', note: '' },
        { ledgerId: `party:${party.id}`, dr: 0, cr: 100, docId: inv.id, note: '' },
      ],
    });
    expect(canCancel(inv, [inv], [], [v])).toEqual({ ok: false, reason: 'Voucher RV/26-27/0003 is set against it (bill-wise). Change or delete that voucher first.' });
    const elsewhere = { ...v, lines: v.lines.map((l) => ({ ...l, docId: '' })) };
    expect(canCancel(inv, [inv], [], [elsewhere]).ok).toBe(true);
  });

  it('duplicates as a fresh draft', () => {
    const d = duplicateDocument(inv);
    expect(d).toMatchObject({ status: 'DRAFT', number: '', docType: 'TAX_INVOICE' });
    expect(d.id).not.toBe(inv.id);
  });
});

describe('recurring', () => {
  it('computes the next date for every frequency', () => {
    expect(nextRecurringDate('2026-01-31', 'MONTHLY')).toBe('2026-02-28');
    expect(nextRecurringDate('2026-01-01', 'WEEKLY')).toBe('2026-01-08');
    expect(nextRecurringDate('2026-01-15', 'QUARTERLY')).toBe('2026-04-15');
    expect(nextRecurringDate('2026-01-15', 'YEARLY')).toBe('2027-01-15');
  });

  it('finds due copies, caps them and honours the end date', () => {
    const src = sampleDoc(biz, party, [{ qty: 1, rate: 1000 }], {
      recurring: { enabled: true, frequency: 'MONTHLY', nextDate: '2026-08-01', endDate: '' },
    });
    const [run] = dueRecurringRuns([src], '2026-10-29');
    expect(run!.dates).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(run!.nextRule).toMatchObject({ nextDate: '2026-11-01', enabled: true });
    expect(dueRecurringRuns([src], '2026-10-29', 2)[0]!.dates).toHaveLength(2);
    const ending = { ...src, recurring: { ...src.recurring!, endDate: '2026-09-15' } };
    expect(dueRecurringRuns([ending], '2026-10-29')[0]).toMatchObject({ dates: ['2026-08-01', '2026-09-01'], nextRule: { enabled: false } });
    expect(dueRecurringRuns([{ ...src, status: 'CANCELLED' }], '2026-10-29')).toEqual([]);
    expect(dueRecurringRuns([src], '2026-07-01')).toEqual([]);
  });

  it('makes final copies that keep the credit period', () => {
    const src = sampleDoc(biz, party, [{ qty: 1, rate: 1000 }], { date: '2026-10-01', dueDate: '2026-10-31' });
    const copy = makeRecurringCopy(src, '2026-11-01');
    expect(copy).toMatchObject({ status: 'FINAL', number: '', date: '2026-11-01', dueDate: '2026-12-01', recurringSourceId: src.id, recurring: null });
    expect(makeRecurringCopy({ ...src, dueDate: '' }, '2026-11-01').dueDate).toBe('');
  });
});

describe('validation', () => {
  it('passes a clean invoice', () => {
    const inv = sampleDoc(biz, party, [{ qty: 1, rate: 1000, gstRate: 18 }]);
    expect(validateSalesDocument(inv, biz)).toEqual([]);
  });

  it('reports blocking errors', () => {
    const inv = sampleDoc(biz, party, [{ qty: 0, rate: -1, gstRate: 13, name: '', hsn: '12' }], { number: '' });
    const issues = validateSalesDocument({ ...inv, party: { ...inv.party, name: '', gstin: '27AAAAA0000A1Z5' }, placeOfSupply: '' }, biz);
    const text = issues.map((i) => i.message).join('\n');
    expect(hasErrors(issues)).toBe(true);
    expect(text).toMatch(/number is required/);
    expect(text).toMatch(/customer name/);
    expect(text).toMatch(/Checksum/);
    expect(text).toMatch(/Place of supply/);
    expect(text).toMatch(/quantity/);
    expect(text).toMatch(/negative/);
    expect(text).toMatch(/not a valid GST rate/);
    expect(text).toMatch(/4, 6 or 8/);
    expect(text).toMatch(/name is required/);
    expect(validateSalesDocument({ ...inv, items: [] }, biz, false).some((i) => i.field === 'items')).toBe(true);
  });

  it('enforces registration rules and warns on risky values', () => {
    const comp = sampleBusiness({ gstRegistration: 'COMPOSITION' });
    const inv = sampleDoc(comp, party, [{ qty: 1, rate: 1000, gstRate: 12 }], { dueDate: '2026-09-01' });
    const issues = validateSalesDocument(inv, comp);
    expect(issues.find((i) => i.field === 'docType')?.level).toBe('error');
    expect(issues.find((i) => i.field === 'dueDate')?.level).toBe('warning');
    expect(issues.find((i) => i.field === 'items.0.gstRate')?.level).toBe('warning');
    const unreg = sampleDoc(biz, { ...party, gstin: '' }, [{ qty: 1, rate: 10 }]);
    expect(validateSalesDocument(unreg, biz).some((i) => i.field === 'party.gstin')).toBe(true);
  });

  it('warns about e-way bills, exchange rates, LUT and unlinked notes', () => {
    const ka = sampleParty(biz.id, { gstin: KA_CUSTOMER_GSTIN, billing: { ...party.billing, stateCode: '29' } });
    const big = sampleDoc(biz, ka, [{ qty: 1, rate: EWAY_BILL_THRESHOLD, gstRate: 18 }]);
    expect(validateSalesDocument(big, biz).some((i) => i.field === 'dispatch.ewayBillNo')).toBe(true);
    const exp = sampleDoc(biz, party, [{ qty: 1, rate: 10 }], { supplyKind: 'EXPORT', exchangeRate: 0, currency: 'USD' });
    const ex = validateSalesDocument(exp, biz);
    expect(ex.some((i) => i.field === 'exchangeRate')).toBe(true);
    expect(ex.some((i) => i.field === 'lutNumber')).toBe(true);
    const dn = sampleDoc(biz, party, [{ qty: 1, rate: 10 }], {}, 'DEBIT_NOTE');
    expect(validateSalesDocument(dn, biz).some((i) => i.field === 'refDoc')).toBe(true);
    const nonReg = sampleDoc(biz, party, [{ qty: 1, rate: 10, gstin: '' } as never], {}, 'QUOTATION');
    expect(hasErrors(validateSalesDocument({ ...nonReg, items: [{ ...nonReg.items[0]!, hsn: '' }] }, biz))).toBe(false);
  });
});
