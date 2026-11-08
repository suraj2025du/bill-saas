import { describe, expect, it } from 'vitest';
import { newExpense, newPurchase } from '../../../src/core/factories';
import { buildEwayBill } from '../../../src/core/gst/eway';
import { makeGstin } from '../../../src/core/gst/gstin';
import { buildGstr1, gstr1Json, seriesKey } from '../../../src/core/gst/returns/gstr1';
import { normalizeDocNo, parse2b, reconcile2b } from '../../../src/core/gst/returns/gstr2b';
import { buildGstr3b, gstr3bJson, setOffItc } from '../../../src/core/gst/returns/gstr3b';
import {
  b2clLimit,
  fromPortalDate,
  inrFactor,
  monthPeriod,
  periodContaining,
  portalDate,
  quarterPeriod,
  yearPeriod,
} from '../../../src/core/gst/returns/period';
import type { Party, SalesDocument } from '../../../src/core/model';
import { statementFor, tdsCsv, tdsRegister, tdsTotals } from '../../../src/core/tdsReports';
import { KA_CUSTOMER_GSTIN, sampleBusiness, sampleDoc, sampleParty, samplePurchase } from '../../fixtures/sample';

/** Read a value out of untyped portal JSON by path, e.g. pick(json, 'b2b', 0, 'inv'). */
function pick(value: unknown, ...path: (string | number)[]): unknown {
  let cur: unknown = value;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);

const SEZ_GSTIN = makeGstin('29', 'AAACS1234D');
const SUPPLIER_GSTIN = makeGstin('27', 'AABCB1234C');

function world() {
  const business = sampleBusiness();
  const id = business.id;
  const addr = (stateCode: string, countryCode = 'IN') => ({ line1: 'Street 1', line2: '', city: 'City', pincode: '560001', stateCode, countryCode });
  const reliance = sampleParty(id);
  const karnataka = sampleParty(id, { name: 'Karnataka Stores', gstin: KA_CUSTOMER_GSTIN, billing: addr('29') });
  const consumerKA = sampleParty(id, { name: 'Ravi (KA)', gstin: '', registration: 'CONSUMER', billing: addr('29') });
  const consumerMH = sampleParty(id, { name: 'Walk-in', gstin: '', registration: 'CONSUMER' });
  const foreign = sampleParty(id, { name: 'Acme Inc', gstin: '', registration: 'OVERSEAS', billing: addr('96', 'US') });
  const sez = sampleParty(id, { name: 'SEZ Unit', gstin: SEZ_GSTIN, registration: 'SEZ', billing: addr('29') });
  const supplier = sampleParty(id, { kind: 'SUPPLIER', name: 'Bajaj Electricals', gstin: SUPPLIER_GSTIN });

  const doc = (p: Party, items: Parameters<typeof sampleDoc>[2], o: Partial<SalesDocument>, t?: SalesDocument['docType']) =>
    sampleDoc(business, p, items, { date: '2026-10-10', ...o }, t);
  const b2bIntra = doc(reliance, [{ qty: 20, rate: 100 }, { name: 'Potatoes', hsn: '0701', qty: 1, rate: 50, gstRate: 0 }], { number: 'INV/26-27/0001', date: '2026-10-01' });
  const b2bInter = doc(karnataka, [{ qty: 10, rate: 100 }], { number: 'INV/26-27/0002' });
  const b2cl = doc(consumerKA, [{ qty: 1, rate: 150_000 }], { number: 'INV/26-27/0003' });
  const b2csInter = doc(consumerKA, [{ qty: 1, rate: 1_000, gstRate: 5 }], { number: 'INV/26-27/0004' });
  const b2csIntra = doc(consumerMH, [{ qty: 2, rate: 500 }], { number: 'INV/26-27/0005' });
  const exportDoc = doc(foreign, [{ qty: 10, rate: 100 }], {
    number: 'INV/26-27/0006',
    supplyKind: 'EXPORT',
    placeOfSupply: '96',
    currency: 'USD',
    exchangeRate: 80,
    portCode: 'INNSA1',
    shippingBillNo: '1234567',
    shippingBillDate: '2026-10-12',
  });
  const sezDoc = doc(sez, [{ qty: 5, rate: 1_000 }], { number: 'INV/26-27/0007', supplyKind: 'SEZ' });
  const cancelled = doc(reliance, [{ qty: 1, rate: 10 }], { number: 'INV/26-27/0010', status: 'CANCELLED' });
  const bos = doc(consumerMH, [{ qty: 1, rate: 300 }], { number: 'BOS/26-27/0001' }, 'BILL_OF_SUPPLY');
  const cnReg = doc(reliance, [{ qty: 5, rate: 100 }], { number: 'CN/26-27/0001', refDocId: b2bIntra.id, date: '2026-10-20' }, 'CREDIT_NOTE');
  const cnSmall = doc(consumerMH, [{ qty: 1, rate: 100 }], { number: 'CN/26-27/0002', refDocId: b2csIntra.id }, 'CREDIT_NOTE');
  const cnLarge = doc(consumerKA, [{ qty: 1, rate: 10_000 }], { number: 'CN/26-27/0003', refDocId: b2cl.id }, 'CREDIT_NOTE');
  const september = doc(reliance, [{ qty: 1, rate: 999 }], { number: 'INV/26-27/0000', date: '2026-09-30' });
  const challan = doc(karnataka, [{ qty: 3, rate: 100 }], { number: 'DC/26-27/0001' }, 'DELIVERY_CHALLAN');
  const invoices = [b2bIntra, b2bInter, b2cl, b2csInter, b2csIntra, exportDoc, sezDoc, cancelled, bos, cnReg, cnSmall, cnLarge, september, challan];

  const purchases = [
    samplePurchase(business, supplier, [{ qty: 50, rate: 60 }], { billDate: '2026-10-15' }),
    samplePurchase(business, supplier, [{ qty: 1, rate: 10_000 }], { billNo: 'BOE-1', billDate: '2026-10-05', supplyKind: 'INTER_STATE', itcCategory: 'IMPORT_GOODS' }),
    samplePurchase(business, supplier, [{ qty: 1, rate: 10_000, hsn: '998211' }], { billNo: 'LEGAL-1', billDate: '2026-10-06', reverseCharge: true, itcCategory: 'INPUT_SERVICES' }),
    samplePurchase(business, supplier, [{ qty: 1, rate: 1_000 }], { billNo: 'CAR-1', billDate: '2026-10-07', itcCategory: 'INELIGIBLE' }),
    samplePurchase(business, supplier, [{ name: 'Rice', hsn: '1006', qty: 10, rate: 40, gstRate: 0 }], { billNo: 'RICE-1', billDate: '2026-10-08' }),
  ];
  const expenses = [
    // A claim needs the vendor's GSTIN (review Y7).
    newExpense(id, { date: '2026-10-02', ledgerId: 'sys:exp-rent', vendorGstin: makeGstin('27', 'AAJFP4455R'), taxable: 5_000, cgst: 450, sgst: 450, total: 5_900, itcEligible: true }),
    newExpense(id, { date: '2026-10-03', taxable: 1_000, cgst: 90, sgst: 90, total: 1_180, vendorGstin: SUPPLIER_GSTIN }),
    newExpense(id, { date: '2026-10-04', taxable: 500, cgst: 45, sgst: 45, total: 590 }),
  ];
  return { business, reliance, karnataka, consumerKA, sez, supplier, invoices, purchases, expenses, b2bIntra, b2bInter, exportDoc, challan };
}

describe('return periods', () => {
  it('builds month, quarter and year periods with portal fp', () => {
    expect(monthPeriod('2026-10')).toMatchObject({ start: '2026-10-01', end: '2026-10-31', fp: '102026' });
    expect(quarterPeriod('2026-27', 3)).toMatchObject({ start: '2026-10-01', end: '2026-12-31', fp: '122026', kind: 'QUARTER' });
    expect(yearPeriod('2026-27')).toMatchObject({ start: '2026-04-01', end: '2027-03-31', fp: '032027' });
    expect(periodContaining('2026-11-15', 'QUARTERLY').fp).toBe('122026');
    expect(periodContaining('2026-11-15', 'MONTHLY').fp).toBe('112026');
  });

  it('formats portal dates and the B2C large threshold', () => {
    expect(portalDate('2026-10-05')).toBe('05-10-2026');
    expect(portalDate('')).toBe('');
    expect(fromPortalDate('05/10/2026')).toBe('2026-10-05');
    expect(fromPortalDate('2026-10-05')).toBe('');
    expect(b2clLimit('2024-07-31')).toBe(250_000);
    expect(b2clLimit('2024-08-01')).toBe(100_000);
    expect(inrFactor({ currency: 'USD', exchangeRate: 0 })).toBe(1);
    expect(inrFactor({ currency: 'USD', exchangeRate: 83.5 })).toBe(83.5);
  });
});

describe('GSTR-1', () => {
  const w = world();
  const r = buildGstr1(w.business, w.invoices, monthPeriod('2026-10'));

  it('splits invoices into B2B, B2CL, B2CS, exports and SEZ', () => {
    expect(r.b2b.map((d) => d.number)).toEqual(['INV/26-27/0001', 'INV/26-27/0002', 'INV/26-27/0007']);
    const intra = r.b2b[0];
    expect(intra).toMatchObject({ value: 2_410, taxable: 2_000, cgst: 180, sgst: 180, type: 'R', interState: false });
    expect(intra.rates).toHaveLength(1);
    expect(r.b2b[2]).toMatchObject({ type: 'SEWOP', igst: 0, taxable: 5_000 });
    expect(r.b2cl).toHaveLength(1);
    expect(r.b2cl[0]).toMatchObject({ pos: '29', value: 177_000, igst: 27_000 });
    expect(r.exp[0]).toMatchObject({ type: 'WOPAY', value: 80_000, taxable: 80_000, igst: 0 });
    expect(r.exp[0].rates[0].rt).toBe(18);
  });

  it('nets small B2C credit notes into B2CS and reports the rest in CDNR / CDNUR', () => {
    expect(r.b2cs).toEqual([
      { supplyType: 'INTRA', pos: '27', rate: 18, taxable: 900, igst: 0, cgst: 81, sgst: 81, cess: 0 },
      { supplyType: 'INTER', pos: '29', rate: 5, taxable: 1_000, igst: 50, cgst: 0, sgst: 0, cess: 0 },
    ]);
    expect(r.cdnr).toHaveLength(1);
    expect(r.cdnr[0]).toMatchObject({ noteType: 'C', gstin: w.reliance.gstin, value: 590 });
    expect(r.cdnur).toHaveLength(1);
    expect(r.cdnur[0]).toMatchObject({ type: 'B2CL', noteType: 'C', value: 11_800, igst: 1_800 });
  });

  it('reports nil-rated and exempt supplies, HSN B2B/B2C and documents issued', () => {
    expect(r.nil).toEqual([
      { supplyType: 'INTRAB2B', nil: 50, exempt: 0, nonGst: 0 },
      { supplyType: 'INTRAB2C', nil: 0, exempt: 300, nonGst: 0 },
    ]);
    expect(r.hsnSplit).toBe(true);
    const bulbs = r.hsnB2b.find((h) => h.hsn === '853950' && h.rate === 18)!;
    expect(bulbs).toMatchObject({ qty: 30, taxable: 7_500, igst: 180, cgst: 135, sgst: 135 });
    expect(r.hsnB2b.find((h) => h.hsn === '0701')).toMatchObject({ rate: 0, taxable: 50 });
    expect(r.hsnB2c.find((h) => h.hsn === '853950' && h.rate === 0)).toMatchObject({ taxable: 300 });
    const inv = r.docs.find((d) => d.from === 'INV/26-27/0001')!;
    expect(inv).toMatchObject({ nature: 1, to: 'INV/26-27/0010', total: 8, cancelled: 1, net: 7 });
    expect(r.docs.find((d) => d.nature === 5)).toMatchObject({ total: 3, from: 'CN/26-27/0001', to: 'CN/26-27/0003' });
    expect(r.docs.find((d) => d.nature === 12)?.total).toBe(1);
    expect(r.docs.filter((d) => d.nature === 1)).toHaveLength(2);
    expect(r.summary.find((s) => s.key === 'b2b')).toMatchObject({ count: 3, taxable: 8_000 });
  });

  it('writes portal JSON', () => {
    const json = gstr1Json(r);
    expect(json).toMatchObject({ gstin: w.business.gstin, fp: '102026' });
    expect(json).not.toHaveProperty('version');
    expect(json).not.toHaveProperty('hash');
    const b2b = list(json.b2b);
    expect(b2b).toHaveLength(3);
    const rel = b2b.find((x) => x.ctin === w.reliance.gstin);
    expect(pick(rel, 'inv', 0)).toEqual({
      inum: 'INV/26-27/0001',
      idt: '01-10-2026',
      val: 2_410,
      pos: '27',
      rchrg: 'N',
      inv_typ: 'R',
      itms: [{ num: 1, itm_det: { txval: 2_000, rt: 18, camt: 180, samt: 180, csamt: 0 } }],
    });
    const ka = b2b.find((x) => x.ctin === w.karnataka.gstin);
    expect(pick(ka, 'inv', 0, 'itms', 0, 'itm_det')).toEqual({ txval: 1_000, rt: 18, iamt: 180, csamt: 0 });
    expect(pick(json, 'b2cl', 0)).toMatchObject({ pos: '29' });
    expect(pick(json, 'b2cl', 0, 'inv', 0, 'itms', 0, 'itm_det')).toEqual({ txval: 150_000, rt: 18, iamt: 27_000, csamt: 0 });
    expect(pick(json, 'exp', 0)).toMatchObject({ exp_typ: 'WOPAY' });
    expect(pick(json, 'exp', 0, 'inv', 0)).toMatchObject({ sbpcode: 'INNSA1', sbnum: '1234567', sbdt: '12-10-2026' });
    expect(pick(json, 'exp', 0, 'inv', 0, 'itms')).toEqual([{ txval: 80_000, rt: 18, iamt: 0, csamt: 0 }]);
    expect(pick(json, 'b2cs', 0)).toEqual({ sply_ty: 'INTRA', pos: '27', typ: 'OE', rt: 18, txval: 900, camt: 81, samt: 81, csamt: 0 });
    expect(pick(json, 'b2cs', 1)).toEqual({ sply_ty: 'INTER', pos: '29', typ: 'OE', rt: 5, txval: 1_000, iamt: 50, csamt: 0 });
    expect(pick(json, 'cdnr', 0, 'nt', 0)).toMatchObject({ ntty: 'C', nt_num: 'CN/26-27/0001', nt_dt: '20-10-2026', inv_typ: 'R' });
    expect(pick(json, 'cdnur', 0)).toMatchObject({ typ: 'B2CL', pos: '29', ntty: 'C' });
    expect(pick(json, 'nil', 'inv')).toEqual([
      { sply_ty: 'INTRAB2B', expt_amt: 0, nil_amt: 50, ngsup_amt: 0 },
      { sply_ty: 'INTRAB2C', expt_amt: 300, nil_amt: 0, ngsup_amt: 0 },
    ]);
    expect(Object.keys(pick(json, 'hsn') as object)).toEqual(['hsn_b2b', 'hsn_b2c']);
    expect(pick(json, 'hsn', 'hsn_b2b', 0)).toHaveProperty('hsn_sc');
    expect(list(pick(json, 'doc_issue', 'doc_det')).map((d) => d.doc_num)).toEqual([1, 5, 12]);
  });

  it('uses the single HSN table before May 2025 and warns on bad setups', () => {
    const w2 = world();
    const old = sampleDoc(w2.business, w2.reliance, [{ qty: 1, rate: 100 }], { date: '2025-04-10', number: 'INV/25-26/0001' });
    const old2 = sampleDoc(w2.business, sampleParty(w2.business.id, { gstin: '', registration: 'CONSUMER' }), [{ qty: 2, rate: 100 }], {
      date: '2025-04-11',
      number: 'INV/25-26/0002',
    });
    const r2 = buildGstr1(w2.business, [old, old2], monthPeriod('2025-04'));
    expect(r2.hsnSplit).toBe(false);
    const json = gstr1Json(r2);
    expect(pick(json, 'hsn', 'data')).toHaveLength(1);
    expect(pick(json, 'hsn', 'data', 0)).toMatchObject({ qty: 3, txval: 300 });

    const comp = buildGstr1({ ...w2.business, gstRegistration: 'COMPOSITION', gstin: '' }, [], monthPeriod('2026-10'));
    expect(comp.warnings.join(' ')).toMatch(/CMP-08/);
    expect(comp.warnings.join(' ')).toMatch(/GSTIN/);
    const abroad = buildGstr1({ ...w2.business, countryCode: 'AE' }, w2.invoices, monthPeriod('2026-10'));
    expect(abroad.b2b).toHaveLength(0);
    expect(abroad.warnings[0]).toMatch(/Indian GST/);
    const noHsn = sampleDoc(w2.business, w2.reliance, [{ qty: 1, rate: 100, hsn: '' }], { date: '2026-10-02', number: 'INV/26-27/0100' });
    expect(buildGstr1(w2.business, [noHsn], monthPeriod('2026-10')).warnings.join(' ')).toMatch(/no HSN/);
  });

  it('keys document series by the text around the last number', () => {
    expect(seriesKey('INV/26-27/0045')).toEqual({ key: 'INV/26-27/#', n: 45 });
    expect(seriesKey('A12B')).toEqual({ key: 'A#B', n: 12 });
    expect(seriesKey('NONUM')).toEqual({ key: 'NONUM', n: 0 });
  });
});

describe('GSTR-3B and ITC set-off', () => {
  const w = world();
  const r = buildGstr3b(w.business, w, monthPeriod('2026-10'));

  it('summarises outward supplies (3.1, 3.2)', () => {
    expect(r.outward).toEqual({ txval: 144_400, iamt: 25_430, camt: 216, samt: 216, csamt: 0 });
    expect(r.zeroRated.txval).toBe(85_000);
    expect(r.nilExempt).toBe(350);
    expect(r.inwardRcm).toEqual({ txval: 10_000, iamt: 0, camt: 900, samt: 900, csamt: 0 });
    expect(r.unregistered).toEqual([{ pos: '29', txval: 141_000, iamt: 25_250 }]);
    expect(r.composition).toEqual([]);
  });

  it('computes eligible ITC (Table 4) and exempt inward supplies (Table 5)', () => {
    const row = (ty: string) => r.itcAvailable.find((x) => x.ty === ty)!;
    expect(row('IMPG').iamt).toBe(1_800);
    expect(row('ISRC')).toMatchObject({ camt: 900, samt: 900 });
    expect(row('OTH')).toMatchObject({ camt: 900, samt: 900 });
    expect(r.itcReversed[0]).toMatchObject({ ty: 'RUL', camt: 180, samt: 180 });
    expect(r.itcNet).toEqual({ iamt: 1_800, camt: 1_620, samt: 1_620, csamt: 0 });
    expect(r.inwardExempt).toEqual({ inter: 0, intra: 400 });
  });

  it('sets off credit in the legal order and pays reverse charge in cash', () => {
    const s = r.setOff;
    expect(s.used.igst.igst).toBe(1_800);
    expect(s.used.cgst).toMatchObject({ cgst: 216, igst: 1_404 });
    expect(s.used.sgst).toMatchObject({ sgst: 216, igst: 1_404 });
    expect(s.cash).toEqual({ igst: 20_822, cgst: 0, sgst: 0, cess: 0 });
    expect(s.cashTotal).toEqual({ igst: 20_822, cgst: 900, sgst: 900, cess: 0 });
    expect(s.carryForward).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  it('uses IGST credit to cover SGST that SGST credit cannot', () => {
    const s = setOffItc({ igst: 0, cgst: 1_000, sgst: 1_000, cess: 0 }, { igst: 500, cgst: 1_000, sgst: 400, cess: 0 });
    expect(s.used.igst.sgst).toBe(500);
    expect(s.cash).toEqual({ igst: 0, cgst: 0, sgst: 100, cess: 0 });
  });

  it('uses CGST, then SGST credit for IGST and keeps cess separate', () => {
    const s = setOffItc({ igst: 1_000, cgst: 0, sgst: 0, cess: 100 }, { igst: 0, cgst: 600, sgst: 600, cess: 60 });
    expect(s.used.cgst.igst).toBe(600);
    expect(s.used.sgst.igst).toBe(400);
    expect(s.carryForward).toEqual({ igst: 0, cgst: 0, sgst: 200, cess: 0 });
    expect(s.cash).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 40 });
  });

  it('exhausts IGST credit before CGST/SGST credit (s.49A)', () => {
    const s = setOffItc({ igst: 100, cgst: 500, sgst: 500, cess: 0 }, { igst: 1_000, cgst: 500, sgst: 500, cess: 0 });
    expect(s.used.igst).toEqual({ igst: 100, cgst: 450, sgst: 450, cess: 0 });
    expect(s.carryForward).toEqual({ igst: 0, cgst: 450, sgst: 450, cess: 0 });
    expect(s.cash).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  it('writes the GSTR-3B JSON', () => {
    const json = gstr3bJson(r);
    expect(json.ret_period).toBe('102026');
    expect(pick(json, 'sup_details', 'osup_det')).toEqual({ txval: 144_400, iamt: 25_430, camt: 216, samt: 216, csamt: 0 });
    expect(pick(json, 'sup_details', 'osup_zero')).toEqual({ txval: 85_000, iamt: 0, csamt: 0 });
    expect(pick(json, 'inter_sup', 'unreg_details')).toEqual([{ pos: '29', txval: 141_000, iamt: 25_250 }]);
    expect(list(pick(json, 'itc_elg', 'itc_avl')).map((x) => x.ty)).toEqual(['IMPG', 'IMPS', 'ISRC', 'ISD', 'OTH']);
    expect(pick(json, 'itc_elg', 'itc_net')).toEqual({ iamt: 1_800, camt: 1_620, samt: 1_620, csamt: 0 });
    expect(pick(json, 'inward_sup', 'isup_details', 0)).toEqual({ ty: 'GST', inter: 0, intra: 400 });
  });

  it('puts reverse-charge sales in 3.1(a) at their taxable value, with no tax, and a note (compliance row 32)', () => {
    const w2 = world();
    const rcm = sampleDoc(w2.business, w2.reliance, [{ qty: 1, rate: 1_000 }], { date: '2026-10-03', number: 'INV/26-27/0200', reverseCharge: true });
    const r2 = buildGstr3b(w2.business, { invoices: [rcm], purchases: [], expenses: [] }, monthPeriod('2026-10'));
    expect(r2.nilExempt).toBe(0);
    expect(r2.outward).toEqual({ txval: 1_000, iamt: 0, camt: 0, samt: 0, csamt: 0 });
    expect(r2.notes[0]).toMatch(/reverse charge/);
  });
});

describe('GSTR-2B reconciliation', () => {
  const w = world();
  const file = {
    data: {
      gstin: w.business.gstin,
      rtnprd: '102026',
      docdata: {
        b2b: [
          {
            ctin: SUPPLIER_GSTIN.toLowerCase(),
            trdnm: 'Bajaj Electricals',
            inv: [
              { inum: 'SUP-0101', dt: '15-10-2026', val: 3_540, rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 3_000, igst: 0, cgst: 270, sgst: 270, cess: 0 }] },
              { inum: 'X-9', dt: '20-10-2026', val: 1_180, txval: 1_000, igst: 0, cgst: 90, sgst: 90, cess: 0 },
              { inum: 'Y-5', dt: '21-10-2026', val: 2_360, txval: 2_000, cgst: 180, sgst: 180 },
            ],
          },
        ],
        cdnr: [{ ctin: SUPPLIER_GSTIN, trdnm: 'Bajaj Electricals', nt: [{ ntnum: 'CN-1', typ: 'C', dt: '25-10-2026', val: 118, txval: 100, cgst: 9, sgst: 9 }] }],
        b2ba: [{ ctin: 'x' }],
      },
    },
  };

  it('parses portal JSON in either shape', () => {
    const parsed = parse2b(file);
    expect(parsed.gstin).toBe(w.business.gstin);
    expect(parsed.period).toBe('102026');
    expect(parsed.docs).toHaveLength(4);
    expect(parsed.docs[0]).toMatchObject({ supplierGstin: SUPPLIER_GSTIN, number: 'SUP-0101', date: '2026-10-15', taxable: 3_000, cgst: 270 });
    expect(parsed.docs[3]).toMatchObject({ type: 'CREDIT_NOTE', number: 'CN-1', taxable: 100 });
    expect(parsed.skipped).toEqual(['b2ba']);
    expect(parse2b('nope').errors[0]).toMatch(/not a GSTR-2B/);
    expect(parse2b({ docdata: {} }).errors[0]).toMatch(/No B2B/);
    const a2 = parse2b({ b2b: [{ ctin: SUPPLIER_GSTIN, inv: [{ inum: '7', idt: '01-10-2026', val: 118, itms: [{ num: 1, itm_det: { txval: 100, iamt: 18 } }] }] }] });
    expect(a2.docs[0]).toMatchObject({ taxable: 100, igst: 18, date: '2026-10-01' });
  });

  it('matches, flags mismatches and finds missing documents', () => {
    const books = [
      samplePurchase(w.business, w.supplier, [{ qty: 50, rate: 60 }], { billNo: 'SUP-101', billDate: '2026-10-15' }),
      samplePurchase(w.business, w.supplier, [{ qty: 1, rate: 2_000, gstRate: 5 }], { billNo: 'Y-5', billDate: '2026-10-21' }),
      samplePurchase(w.business, w.supplier, [{ qty: 1, rate: 500 }], { billNo: 'MISS-1', billDate: '2026-10-22' }),
      samplePurchase(w.business, w.supplier, [{ qty: 1, rate: 500 }], { billNo: 'OLD-1', billDate: '2026-08-22' }),
      { ...newPurchase(w.business), billNo: 'NOGSTIN', billDate: '2026-10-01' },
    ];
    const { rows, summary } = reconcile2b(parse2b(file).docs, books, { businessId: w.business.id, from: '2026-10-01', to: '2026-10-31' });
    const by = (num: string) => rows.find((r) => r.number === num)!;
    expect(by('SUP-0101').status).toBe('MATCHED');
    expect(by('Y-5').status).toBe('MISMATCH');
    expect(by('Y-5').differences.join(' ')).toMatch(/CGST: portal 180.00, books 50.00/);
    expect(by('Y-5').taxDiff).toBe(260);
    expect(by('X-9').status).toBe('MISSING_IN_BOOKS');
    expect(by('CN-1')).toMatchObject({ status: 'MISSING_IN_BOOKS', taxDiff: -18 });
    expect(by('MISS-1').status).toBe('MISSING_IN_2B');
    expect(rows.find((r) => r.number === 'OLD-1')).toBeUndefined();
    expect(rows.find((r) => r.number === 'NOGSTIN')).toBeUndefined();
    expect(rows[0].status).toBe('MISMATCH');
    expect(summary.find((s) => s.status === 'MATCHED')).toMatchObject({ count: 1, portalTax: 540, booksTax: 540 });
  });

  it('normalises invoice numbers', () => {
    expect(normalizeDocNo('inv/26-27/0045')).toBe(normalizeDocNo('INV-26-27-45'));
    expect(normalizeDocNo('A-000')).toBe('A|0');
  });
});

describe('E-Way Bill JSON', () => {
  const w = world();
  const withDispatch = {
    ...w.b2bInter,
    dispatch: { ...w.b2bInter.dispatch, transportMode: 'ROAD' as const, vehicleNo: 'mh-12 ab 1234', distanceKm: 842, transporterName: 'VRL' },
  };

  it('builds the NIC bulk JSON for an inter-state invoice', () => {
    const { json, errors, warnings } = buildEwayBill(w.business, withDispatch);
    expect(errors).toEqual([]);
    expect(warnings.join(' ')).toMatch(/50,000 or less/);
    const bill = (json.billLists as Record<string, unknown>[])[0];
    expect(json.version).toBe('1.0.0621');
    expect(bill).toMatchObject({
      supplyType: 'O',
      subSupplyType: 1,
      docType: 'INV',
      docNo: 'INV/26-27/0002',
      docDate: '10/10/2026',
      fromGstin: w.business.gstin,
      fromStateCode: 27,
      toGstin: w.karnataka.gstin,
      toStateCode: 29,
      totalValue: 1_000,
      igstValue: 180,
      cgstValue: 0,
      totInvValue: 1_180,
      OthValue: 0,
      transMode: '1',
      transDistance: '842',
      vehicleNo: 'MH12AB1234',
      vehicleType: 'R',
      mainHsnCode: 853950,
    });
    expect((bill.itemList as Record<string, unknown>[])[0]).toMatchObject({ igstRate: 18, cgstRate: 0, qtyUnit: expect.any(String), hsnCode: 853950 });
  });

  it('rejects documents that do not move goods and flags missing details', () => {
    const quote = sampleDoc(w.business, w.reliance, [{ qty: 1, rate: 100 }], {}, 'QUOTATION');
    expect(buildEwayBill(w.business, quote).errors.join(' ')).toMatch(/not a Quotation/);
    const service = sampleDoc(w.business, w.reliance, [{ qty: 1, rate: 100, hsn: '998314' }], { status: 'DRAFT' });
    const res = buildEwayBill({ ...w.business, gstin: '', pincode: '' }, service);
    expect(res.errors.join(' ')).toMatch(/Finalize/);
    expect(res.errors.join(' ')).toMatch(/only for goods/);
    expect(res.errors.join(' ')).toMatch(/GSTIN is missing/);
    const challan = buildEwayBill(w.business, { ...w.challan, dispatch: { ...w.challan.dispatch, vehicleNo: 'BAD', transportMode: 'AIR', distanceKm: 5000 } });
    expect((challan.json.billLists as Record<string, unknown>[])[0]).toMatchObject({ docType: 'CHL', subSupplyType: 8, transMode: '3' });
    expect(challan.errors.join(' ')).toMatch(/4000 km/);
    expect(challan.warnings.join(' ')).toMatch(/does not look like/);
    expect(challan.warnings.join(' ')).toMatch(/transport document/);
    const expMissing = buildEwayBill(w.business, w.exportDoc);
    expect(expMissing.errors).toContain('Export invoices require a port of exit PIN code in dispatch details.');
    expect(expMissing.errors).toContain('Export invoices require a port of exit State Code in dispatch details.');

    const exportWithPort = {
      ...w.exportDoc,
      dispatch: {
        ...w.exportDoc.dispatch,
        exportPortPincode: '400001',
        exportPortStateCode: '27',
      },
    };
    const exp = buildEwayBill(w.business, exportWithPort);
    expect(exp.errors).toEqual([]);
    expect((exp.json.billLists as Record<string, unknown>[])[0]).toMatchObject({
      toGstin: 'URP',
      toPincode: 400001,
      toStateCode: 96,
      actualToStateCode: 27,
      subSupplyType: 3,
      totInvValue: 80_000,
    });
  });
});

describe('TDS / TCS register', () => {
  it('collects deductions from purchases, expenses and sales', () => {
    const w = world();
    const bill = samplePurchase(w.business, w.supplier, [{ qty: 1, rate: 100_000 }], { billDate: '2026-10-09', tds: { section: '194C', rate: 1, base: 100_000, amount: 0 } });
    const rent = newExpense(w.business.id, { date: '2026-10-02', vendorName: 'Landlord', vendorGstin: SUPPLIER_GSTIN, tds: { section: '194I', rate: 10, base: 50_000, amount: 5_000 } });
    const sale = sampleDoc(w.business, w.karnataka, [{ qty: 1, rate: 10_000 }], {
      date: '2026-10-11',
      number: 'INV/26-27/0300',
      tds: { section: '194J', rate: 10, base: 10_000, amount: 0 },
      tcs: { section: '206C(1)', rate: 1, base: 11_800, amount: 0 },
    });
    const rows = tdsRegister(
      { businessId: w.business.id, purchases: [bill], expenses: [rent], invoices: [sale], parties: [w.supplier, w.karnataka] },
      '2026-10-01',
      '2026-12-31',
    );
    expect(rows.map((r) => [r.register, r.section, r.tax])).toEqual([
      ['DEDUCTED', '194I', 5_000],
      ['DEDUCTED', '194C', 1_000],
      ['COLLECTED', '206C(1)', 118],
      ['SUFFERED', '194J', 1_000],
    ]);
    expect(rows[1].pan).toBe('AABCB1234C');
    expect(rows[0].pan).toBe('AABCB1234C');
    expect(tdsTotals(rows).find((t) => t.register === 'DEDUCTED' && t.section === '194C')).toMatchObject({ count: 1, base: 100_000 });
    const csv = tdsCsv(rows);
    expect(csv.split('\r\n')[0]).toContain('Sr No,Section,PAN');
    expect(csv).toContain('11/10/2026');
    expect(statementFor('DEDUCTED', '2026-10-01')).toMatch(/Form 140/);
    expect(statementFor('COLLECTED', '2026-01-01')).toBe('Form 27EQ');
    expect(statementFor('SUFFERED', '2026-10-01')).toMatch(/26AS/);
  });
});
