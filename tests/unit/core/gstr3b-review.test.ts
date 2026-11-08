import { describe, expect, it } from 'vitest';
import { newExpense } from '../../../src/core/factories';
import { makeGstin } from '../../../src/core/gst/gstin';
import type { Parsed2b, PortalDoc } from '../../../src/core/gst/returns/gstr2b';
import { buildGstr3b, gstr3bJson } from '../../../src/core/gst/returns/gstr3b';
import type { Gstr3bReport } from '../../../src/core/gst/returns/gstr3b';
import { monthPeriod, quarterPeriod } from '../../../src/core/gst/returns/period';
import type { Expense, PurchaseBill, SalesDocument } from '../../../src/core/model';
import { computeExpense } from '../../../src/store/actions';
import { KA_CUSTOMER_GSTIN, sampleBusiness, sampleDoc, sampleParty, samplePurchase } from '../../fixtures/sample';

// Regression tests for review batch 04 (GSTR-3B): compliance research rows 1, 18, 26 and 32
// (docs/reviews/2026-11-07-compliance-research.md) and code review Y7.

const SUPPLIER = makeGstin('27', 'AABCB1234C');
const LANDLORD = makeGstin('27', 'AAJFP4455R');
/** A GSTIN with one wrong check character, as a typo would give. */
const TYPO = SUPPLIER.slice(0, 14) + (SUPPLIER[14] === 'A' ? 'B' : 'A');
const OCT = monthPeriod('2026-10');
const ZERO = { igst: 0, cgst: 0, sgst: 0, cess: 0 };

const business = sampleBusiness();
const id = business.id;
const addr = (stateCode: string) => ({ line1: 'Street 1', line2: '', city: 'City', pincode: '560001', stateCode, countryCode: 'IN' });
const supplier = sampleParty(id, { kind: 'SUPPLIER', name: 'Bajaj Electricals', gstin: SUPPLIER });
const reliance = sampleParty(id);
const karnataka = sampleParty(id, { name: 'Karnataka Stores', gstin: KA_CUSTOMER_GSTIN, billing: addr('29') });

function data(o: { invoices?: SalesDocument[]; purchases?: PurchaseBill[]; expenses?: Expense[] }) {
  return { invoices: o.invoices ?? [], purchases: o.purchases ?? [], expenses: o.expenses ?? [] };
}

/** A GSTR-2B document as parse2b returns it. */
function portal(o: Partial<PortalDoc>): PortalDoc {
  return {
    supplierGstin: SUPPLIER,
    supplierName: 'Bajaj Electricals',
    number: '',
    date: '2026-10-15',
    type: 'INVOICE',
    value: 0,
    taxable: 0,
    igst: 0,
    cgst: 0,
    sgst: 0,
    cess: 0,
    itcAvailable: true,
    reverseCharge: false,
    ...o,
  };
}
const gstr2b = (docs: PortalDoc[], skipped: string[] = []): Parsed2b => ({ gstin: business.gstin, period: '102026', docs, skipped, errors: [] });

const itcRow = (r: Gstr3bReport, ty: string) => r.itcAvailable.find((x) => x.ty === ty)!;

/** Read a value out of untyped JSON by path. */
function pick(value: unknown, ...path: (string | number)[]): unknown {
  let cur: unknown = value;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

describe('Table 4(A)(5) from GSTR-2B (compliance row 1)', () => {
  // All bills: intra-state at 18%, so CGST and SGST are 9% each.
  const inBoth = samplePurchase(business, supplier, [{ qty: 10, rate: 100 }], { billNo: 'SUP-1', billDate: '2026-10-05' });
  const notReported = samplePurchase(business, supplier, [{ qty: 1, rate: 2_000 }], { billNo: 'SUP-2', billDate: '2026-10-20' });
  const lastMonth = samplePurchase(business, supplier, [{ qty: 1, rate: 500 }], { billNo: 'SUP-0', billDate: '2026-09-28' });
  const blocked = samplePurchase(business, supplier, [{ qty: 1, rate: 1_000 }], { billNo: 'CAR-1', billDate: '2026-10-07', itcCategory: 'INELIGIBLE' });
  const purchases = [inBoth, notReported, lastMonth, blocked];
  const file = gstr2b([
    portal({ number: 'SUP-1', date: '2026-10-05', taxable: 1_000, cgst: 90, sgst: 90 }),
    portal({ number: 'sup/0', date: '2026-09-28', taxable: 500, cgst: 45, sgst: 45 }),
    portal({ number: 'CAR-1', date: '2026-10-07', taxable: 1_000, cgst: 90, sgst: 90 }),
    portal({ number: 'X-9', date: '2026-10-21', taxable: 1_000, cgst: 90, sgst: 90 }),
    portal({ number: 'CN-7', type: 'CREDIT_NOTE', date: '2026-10-25', taxable: 100, cgst: 9, sgst: 9 }),
    portal({ number: 'N-1', date: '2026-10-11', taxable: 200, cgst: 18, sgst: 18, itcAvailable: false }),
    portal({ number: 'R-1', date: '2026-10-12', taxable: 1_000, cgst: 90, sgst: 90, reverseCharge: true }),
  ]);

  it('takes 4(A)(5) from the GSTR-2B documents, net of its credit notes, not from every bill dated in the period', () => {
    const r = buildGstr3b(business, data({ purchases }), OCT, file);
    expect(r.itcSource).toBe('GSTR2B');
    // SUP-1 + SUP-0 (a September bill the supplier reported in October) + CAR-1 + X-9 - CN-7.
    expect(itcRow(r, 'OTH')).toMatchObject({ iamt: 0, camt: 306, samt: 306, csamt: 0 });
    // Reverse-charge documents in the GSTR-2B do not go to 4(A)(5); 4(A)(3) follows the reverse-charge bills.
    expect(itcRow(r, 'ISRC')).toMatchObject({ camt: 0, samt: 0 });
    expect(r.notes.join(' ')).toMatch(/Reverse-charge documents in the GSTR-2B/);
  });

  it('reverses blocked credit in 4(B)(1) and documents missing from the books in 4(B)(2) (CBIC Circular 170/02/2022)', () => {
    const r = buildGstr3b(business, data({ purchases }), OCT, file);
    expect(r.itcReversed[0]).toMatchObject({ ty: 'RUL', camt: 90, samt: 90 });
    expect(r.itcReversed[1]).toMatchObject({ ty: 'OTH', camt: 90, samt: 90 });
    expect(r.itcNet).toEqual({ iamt: 0, camt: 126, samt: 126, csamt: 0 });
    expect(r.itc2b?.notInBooks.map((d) => d.number)).toEqual(['X-9']);
    expect(r.notes.join(' ')).toMatch(/not in your purchase bills or expenses/);
  });

  it('does not claim a bill of the period that is not in the GSTR-2B, and lists it', () => {
    const r = buildGstr3b(business, data({ purchases }), OCT, file);
    expect(r.itc2b?.notIn2b).toEqual([
      { source: 'PURCHASE', id: notReported.id, number: 'SUP-2', party: 'Bajaj Electricals', gstin: SUPPLIER, date: '2026-10-20', tax: 360 },
    ]);
    expect(r.notes.join(' ')).toMatch(/not in the GSTR-2B/);
  });

  it('puts ITC that the GSTR-2B marks as not available in 4(D)(2)', () => {
    const r = buildGstr3b(business, data({ purchases }), OCT, file);
    expect(r.itcIneligible[0]).toMatchObject({ ty: 'RUL', camt: 0, samt: 0 });
    expect(r.itcIneligible[1]).toMatchObject({ ty: 'OTH', camt: 18, samt: 18 });
    const json = gstr3bJson(r);
    expect(pick(json, 'itc_elg', 'itc_avl', 4)).toEqual({ ty: 'OTH', iamt: 0, camt: 306, samt: 306, csamt: 0 });
    expect(pick(json, 'itc_elg', 'itc_rev')).toEqual([
      { ty: 'RUL', iamt: 0, camt: 90, samt: 90, csamt: 0 },
      { ty: 'OTH', iamt: 0, camt: 90, samt: 90, csamt: 0 },
    ]);
    expect(pick(json, 'itc_elg', 'itc_inelg', 1)).toEqual({ ty: 'OTH', iamt: 0, camt: 18, samt: 18, csamt: 0 });
    expect(pick(json, 'itc_elg', 'itc_net')).toEqual({ iamt: 0, camt: 126, samt: 126, csamt: 0 });
  });

  it('keeps the books figure only as a fallback, with a warning, when no GSTR-2B is open', () => {
    const r = buildGstr3b(business, data({ purchases }), OCT);
    expect(r.itcSource).toBe('BOOKS');
    expect(r.itc2b).toBeNull();
    // The bills dated in October: SUP-1, SUP-2 and CAR-1 (reversed in 4(B)(1)).
    expect(itcRow(r, 'OTH')).toMatchObject({ camt: 360, samt: 360 });
    expect(r.itcReversed[0]).toMatchObject({ camt: 90, samt: 90 });
    expect(r.notes.join(' ')).toMatch(/No GSTR-2B is open/);
  });

  it('matches expenses by the vendor GSTIN and bill number', () => {
    const rent = newExpense(id, { date: '2026-10-02', ledgerId: 'sys:exp-rent', vendorName: 'Patel Estates', vendorGstin: LANDLORD, billNo: 'RENT-10', taxable: 10_000, gstRate: 18, cgst: 900, sgst: 900, total: 11_800, itcEligible: true });
    const lunch = newExpense(id, { date: '2026-10-03', vendorName: 'Bajaj Canteen', vendorGstin: SUPPLIER, billNo: 'LUNCH-4', taxable: 500, gstRate: 18, cgst: 45, sgst: 45, total: 590 });
    const noBillNo = newExpense(id, { date: '2026-10-04', vendorName: 'Patel Estates', vendorGstin: LANDLORD, taxable: 1_000, gstRate: 18, cgst: 90, sgst: 90, total: 1_180, itcEligible: true });
    const file2 = gstr2b([
      portal({ supplierGstin: LANDLORD, supplierName: 'Patel Estates', number: 'RENT/10', date: '2026-10-02', taxable: 10_000, cgst: 900, sgst: 900 }),
      portal({ number: 'LUNCH-4', date: '2026-10-03', taxable: 500, cgst: 45, sgst: 45 }),
    ]);
    const r = buildGstr3b(business, data({ expenses: [rent, lunch, noBillNo] }), OCT, file2);
    expect(itcRow(r, 'OTH')).toMatchObject({ camt: 945, samt: 945 });
    // An expense whose ITC is not claimed (food, s.17(5)) is in the GSTR-2B, so it is reported and reversed.
    expect(r.itcReversed[0]).toMatchObject({ camt: 45, samt: 45 });
    expect(r.itcReversed[1]).toMatchObject({ camt: 0, samt: 0 });
    expect(r.itc2b?.notInBooks).toEqual([]);
    expect(r.itc2b?.notIn2b).toEqual([{ source: 'EXPENSE', id: noBillNo.id, number: '', party: 'Patel Estates', gstin: LANDLORD, date: '2026-10-04', tax: 180 }]);
  });

  it('uses the GSTR-2B values for a document that differs from the bill, and lists it', () => {
    const bill = samplePurchase(business, supplier, [{ qty: 10, rate: 100 }], { billNo: 'SUP-5', billDate: '2026-10-05' });
    const r = buildGstr3b(business, data({ purchases: [bill] }), OCT, gstr2b([portal({ number: 'SUP-5', date: '2026-10-05', taxable: 1_100, cgst: 99, sgst: 99 })]));
    expect(itcRow(r, 'OTH')).toMatchObject({ camt: 99, samt: 99 });
    expect(r.itc2b?.differs.map((d) => d.number)).toEqual(['SUP-5']);
    expect(r.notes.join(' ')).toMatch(/differ between the GSTR-2B and your books/);
  });

  it('names the sections of the GSTR-2B it does not use', () => {
    const r = buildGstr3b(business, data({}), OCT, gstr2b([], ['b2ba', 'isd']));
    expect(r.notes.join(' ')).toMatch(/b2ba, isd/);
  });
});

describe('Table 4(D) labels (compliance row 18)', () => {
  it('labels 4(D)(1) and 4(D)(2) as the form does since FY 2023-24 and keeps the JSON types', () => {
    const r = buildGstr3b(business, data({}), OCT);
    expect(r.itcIneligible.map((x) => [x.ty, x.label])).toEqual([
      ['RUL', '(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period'],
      ['OTH', '(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules'],
    ]);
    expect((pick(gstr3bJson(r), 'itc_elg', 'itc_inelg') as { ty: string }[]).map((x) => x.ty)).toEqual(['RUL', 'OTH']);
  });
});

describe('negative liability (compliance row 26)', () => {
  // Inter-state sales to Karnataka at 18% IGST.
  const sale = (number: string, date: string, rate: number) => sampleDoc(business, karnataka, [{ qty: 1, rate }], { number, date });
  const credit = (number: string, date: string, rate: number, ref: SalesDocument) => sampleDoc(business, karnataka, [{ qty: 1, rate }], { number, date, refDocId: ref.id }, 'CREDIT_NOTE');

  const september = sale('INV/26-27/0090', '2026-09-10', 1_000);
  const octCredit = credit('CN/26-27/0001', '2026-10-05', 1_000, september);
  const octSale = sale('INV/26-27/0101', '2026-10-08', 100);

  it('carries the negative tax of a period to the negative liability statement instead of dropping it', () => {
    const r = buildGstr3b(business, data({ invoices: [september, octCredit, octSale] }), OCT);
    expect(r.outward.iamt).toBe(-162);
    expect(r.setOff.liability).toEqual(ZERO);
    expect(r.negativeLiability).toEqual({ opening: ZERO, used: ZERO, added: { ...ZERO, igst: 162 }, closing: { ...ZERO, igst: 162 } });
    expect(r.notes.join(' ')).toMatch(/negative liability statement/);
    expect(r.notes.join(' ')).not.toMatch(/not carried forward/);
  });

  it('sets the negative liability of earlier returns off against the tax of the next one, before ITC', () => {
    const nov = sale('INV/26-27/0120', '2026-11-03', 2_000);
    const r = buildGstr3b(business, data({ invoices: [september, octCredit, octSale, nov] }), monthPeriod('2026-11'));
    expect(r.negativeLiability).toEqual({ opening: { ...ZERO, igst: 162 }, used: { ...ZERO, igst: 162 }, added: ZERO, closing: ZERO });
    expect(r.setOff.liability.igst).toBe(198);
    expect(r.setOff.cash.igst).toBe(198);
    expect(r.notes.join(' ')).toMatch(/earlier returns/);
  });

  it('uses only as much as the tax of the period and carries the rest', () => {
    const nov = sale('INV/26-27/0121', '2026-11-03', 500);
    const invoices = [september, octCredit, octSale, nov];
    const r = buildGstr3b(business, data({ invoices }), monthPeriod('2026-11'));
    expect(r.negativeLiability.used.igst).toBe(90);
    expect(r.negativeLiability.closing.igst).toBe(72);
    expect(r.setOff.liability.igst).toBe(0);
    expect(buildGstr3b(business, data({ invoices }), monthPeriod('2026-12')).negativeLiability.opening.igst).toBe(72);
  });

  it('keeps each tax head separate', () => {
    const mhSale = sampleDoc(business, reliance, [{ qty: 1, rate: 1_000 }], { number: 'INV/26-27/0091', date: '2026-09-12' });
    const mhCredit = sampleDoc(business, reliance, [{ qty: 1, rate: 1_000 }], { number: 'CN/26-27/0002', date: '2026-10-06', refDocId: mhSale.id }, 'CREDIT_NOTE');
    const nov = sale('INV/26-27/0122', '2026-11-04', 1_000);
    const r = buildGstr3b(business, data({ invoices: [mhSale, mhCredit, nov] }), monthPeriod('2026-11'));
    expect(r.negativeLiability.opening).toEqual({ ...ZERO, cgst: 90, sgst: 90 });
    expect(r.negativeLiability.used).toEqual(ZERO);
    expect(r.setOff.liability.igst).toBe(180);
    expect(r.negativeLiability.closing).toEqual({ ...ZERO, cgst: 90, sgst: 90 });
  });

  it('starts with the September 2024 return, the first that accepts negative values', () => {
    const july = sale('INV/24-25/0001', '2024-07-10', 1_000);
    const augCredit = credit('CN/24-25/0001', '2024-08-20', 1_000, july);
    const sepCredit = credit('CN/24-25/0002', '2024-09-15', 500, july);
    const invoices = [july, augCredit, sepCredit];
    const sep = buildGstr3b(business, data({ invoices }), monthPeriod('2024-09'));
    expect(sep.negativeLiability.opening).toEqual(ZERO);
    expect(sep.negativeLiability.added.igst).toBe(90);
    expect(buildGstr3b(business, data({ invoices }), monthPeriod('2024-10')).negativeLiability.opening.igst).toBe(90);
  });

  it('walks earlier quarters for a quarterly return', () => {
    const q1 = sale('INV/26-27/0001', '2026-05-10', 2_000);
    const q2Credit = credit('CN/26-27/0010', '2026-08-10', 1_500, q1);
    const q2Sale = sale('INV/26-27/0050', '2026-09-01', 100);
    const invoices = [q1, q2Credit, q2Sale];
    expect(buildGstr3b(business, data({ invoices }), quarterPeriod('2026-27', 2)).negativeLiability.added.igst).toBe(252);
    expect(buildGstr3b(business, data({ invoices }), quarterPeriod('2026-27', 3)).negativeLiability.opening.igst).toBe(252);
  });
});

describe('outward reverse-charge sales (compliance row 32)', () => {
  it('puts their taxable value in 3.1(a) with no tax, as GSTR-1 Table 4B fills it on the portal', () => {
    const rcm = sampleDoc(
      business,
      reliance,
      [
        { qty: 1, rate: 1_000 },
        { name: 'Potatoes', hsn: '0701', qty: 1, rate: 50, gstRate: 0 },
      ],
      { date: '2026-10-03', number: 'INV/26-27/0200', reverseCharge: true },
    );
    const r = buildGstr3b(business, data({ invoices: [rcm] }), OCT);
    expect(r.outward).toEqual({ txval: 1_000, iamt: 0, camt: 0, samt: 0, csamt: 0 });
    expect(r.nilExempt).toBe(50);
    expect(r.setOff.liability).toEqual(ZERO);
    expect(r.notes.join(' ')).toMatch(/3\.1\(a\)/);
    const json = gstr3bJson(r);
    expect(pick(json, 'sup_details', 'osup_det')).toEqual({ txval: 1_000, iamt: 0, camt: 0, samt: 0, csamt: 0 });
    expect(pick(json, 'sup_details', 'osup_nil_exmp')).toEqual({ txval: 50 });
  });

  it('leaves them out of 3.2, which lists supplies with IGST', () => {
    const comp = sampleParty(id, { name: 'Comp Dealer', gstin: makeGstin('29', 'AACCC1234D'), registration: 'COMPOSITION', billing: addr('29') });
    const rcm = sampleDoc(business, comp, [{ qty: 1, rate: 1_000 }], { date: '2026-10-04', number: 'INV/26-27/0201', reverseCharge: true });
    const r = buildGstr3b(business, data({ invoices: [rcm] }), OCT);
    expect(r.outward.txval).toBe(1_000);
    expect(r.composition).toEqual([]);
  });
});

describe('input tax credit needs a valid vendor GSTIN (review Y7)', () => {
  it('does not claim ITC on an expense without a valid vendor GSTIN', () => {
    const phone = newExpense(id, { date: '2026-10-02', ledgerId: 'sys:exp-telephone', vendorName: 'Jio', taxable: 2_000, gstRate: 18, cgst: 180, sgst: 180, total: 2_360, itcEligible: true });
    const typo = newExpense(id, { date: '2026-10-03', vendorGstin: TYPO, billNo: 'T-1', taxable: 1_000, gstRate: 18, cgst: 90, sgst: 90, total: 1_180, itcEligible: true });
    const rent = newExpense(id, { date: '2026-10-04', vendorGstin: LANDLORD, billNo: 'RENT-11', taxable: 500, gstRate: 18, cgst: 45, sgst: 45, total: 590, itcEligible: true });
    const r = buildGstr3b(business, data({ expenses: [phone, typo, rent] }), OCT);
    expect(itcRow(r, 'OTH')).toMatchObject({ camt: 45, samt: 45 });
    // Without a GSTIN the bill never reaches GSTR-2B, so it is not reported and reversed either.
    expect(r.itcReversed[0]).toMatchObject({ camt: 0, samt: 0 });
    expect(r.notes.join(' ')).toMatch(/2 expenses marked "Claim input tax credit" have no valid vendor GSTIN/);
  });

  it('does not claim ITC on a purchase bill from a supplier without a GSTIN, but keeps reverse-charge ITC', () => {
    const shop = sampleParty(id, { kind: 'SUPPLIER', name: 'Local Shop', gstin: '', registration: 'UNREGISTERED' });
    const bill = samplePurchase(business, shop, [{ qty: 1, rate: 1_000 }], { billNo: 'LS-1', billDate: '2026-10-09' });
    const transport = samplePurchase(business, shop, [{ qty: 1, rate: 2_000, hsn: '996511' }], { billNo: 'GTA-1', billDate: '2026-10-10', reverseCharge: true });
    const r = buildGstr3b(business, data({ purchases: [bill, transport] }), OCT);
    expect(itcRow(r, 'OTH')).toMatchObject({ camt: 0, samt: 0 });
    expect(itcRow(r, 'ISRC')).toMatchObject({ camt: 180, samt: 180 });
    expect(r.inwardRcm).toMatchObject({ camt: 180, samt: 180 });
    expect(r.notes.join(' ')).toMatch(/1 purchase bill from a supplier without a valid GSTIN/);
  });

  it('saves "Claim input tax credit" on an expense only with a valid vendor GSTIN', () => {
    const base = { taxable: 1_000, gstRate: 18, itcEligible: true };
    expect(computeExpense(newExpense(id, base)).itcEligible).toBe(false);
    expect(computeExpense(newExpense(id, { ...base, vendorGstin: TYPO })).itcEligible).toBe(false);
    expect(computeExpense(newExpense(id, { ...base, vendorGstin: LANDLORD })).itcEligible).toBe(true);
    expect(computeExpense(newExpense(id, { ...base, vendorGstin: LANDLORD, supplyKind: 'NON_GST' })).itcEligible).toBe(false);
  });
});
