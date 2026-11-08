import { describe, expect, it } from 'vitest';
import { validateSalesDocument } from '../../../src/core/docs/validate';
import { makeGstin } from '../../../src/core/gst/gstin';
import { buildGstr1, ecoTcsRate, gstr1Json, mergeHsn } from '../../../src/core/gst/returns/gstr1';
import { gstr1CsvFiles, offlineToolDate, posLabel } from '../../../src/core/gst/returns/gstr1Csv';
import { monthPeriod } from '../../../src/core/gst/returns/period';
import { BIZ_GSTIN, KA_CUSTOMER_GSTIN, sampleBusiness, sampleDoc, sampleParty } from '../../fixtures/sample';

// A made-up e-commerce operator registration in Karnataka with a valid check digit.
const ECO = makeGstin('29', 'AAICE1234B');
const BAD_ECO = `${ECO.slice(0, 14)}${ECO.endsWith('0') ? '1' : '0'}`;

function world(month = '2026-10') {
  const business = sampleBusiness();
  const id = business.id;
  const consumerMH = sampleParty(id, { name: 'Walk-in', gstin: '', registration: 'CONSUMER' });
  const consumerKA = sampleParty(id, {
    name: 'Ravi (KA)',
    gstin: '',
    registration: 'CONSUMER',
    billing: { line1: 'Street 1', line2: '', city: 'Bengaluru', pincode: '560001', stateCode: '29', countryCode: 'IN' },
  });
  const karnataka = sampleParty(id, {
    name: 'Karnataka Stores',
    gstin: KA_CUSTOMER_GSTIN,
    billing: { line1: 'Street 1', line2: '', city: 'Bengaluru', pincode: '560001', stateCode: '29', countryCode: 'IN' },
  });
  const date = `${month}-10`;
  const doc = (...a: Parameters<typeof sampleDoc>) => sampleDoc(a[0], a[1], a[2], { date, ...a[3] }, a[4]);
  const intra = doc(business, consumerMH, [{ qty: 2, rate: 500, gstRate: 18 }], { number: 'INV/1', ecoGstin: ECO });
  const inter = doc(business, consumerKA, [{ qty: 1, rate: 1_000, gstRate: 5 }], { number: 'INV/2', ecoGstin: ` ${ECO.toLowerCase()} ` });
  const b2b = doc(business, karnataka, [{ qty: 1, rate: 2_000, gstRate: 18 }], { number: 'INV/3', ecoGstin: ECO });
  const credit = doc(business, consumerMH, [{ qty: 1, rate: 100, gstRate: 18 }], { number: 'CN/1', ecoGstin: ECO, refDocId: intra.id }, 'CREDIT_NOTE');
  const direct = doc(business, consumerMH, [{ qty: 1, rate: 300, gstRate: 18 }], { number: 'INV/4' });
  const rcm = doc(business, karnataka, [{ qty: 1, rate: 700, gstRate: 18 }], { number: 'INV/5', ecoGstin: ECO, reverseCharge: true });
  const badEco = doc(business, consumerMH, [{ qty: 1, rate: 400, gstRate: 18 }], { number: 'INV/6', ecoGstin: BAD_ECO });
  const bos = doc(business, consumerMH, [{ qty: 1, rate: 50, gstRate: 0 }], { number: 'BOS/1', ecoGstin: ECO }, 'BILL_OF_SUPPLY');
  return { business, docs: [intra, inter, b2b, credit, direct, rcm, badEco, bos], intra, b2b };
}

describe('GSTR-1 Table 14 (supplies through e-commerce operators)', () => {
  const w = world();
  const r = buildGstr1(w.business, w.docs, monthPeriod('2026-10'));

  it('totals taxable sales per operator, net of credit notes, and keeps them in their own tables', () => {
    expect(r.eco).toEqual([{ etin: ECO, count: 4, value: 3_900, igst: 410, cgst: 81, sgst: 81, cess: 0 }]);
    expect(r.b2b.map((d) => d.number)).toContain('INV/3');
    expect(r.b2b.find((d) => d.number === 'INV/3')?.etin).toBe(ECO);
    expect(r.b2cs.length).toBeGreaterThan(0);
    const row = r.summary.find((s) => s.key === 'eco');
    expect(row).toMatchObject({ count: 4, taxable: 3_900, igst: 410 });
  });

  it('leaves out reverse-charge sales, bills of supply and invalid operator GSTINs with a warning', () => {
    const text = r.warnings.join('\n');
    expect(text).toContain('INV/5: reverse-charge sale through e-commerce operator');
    expect(text).toContain('BOS/1: a bill of supply is not reported in Table 14');
    expect(text).toContain(`INV/6: e-commerce operator GSTIN ${BAD_ECO} is not valid`);
  });

  it('writes supeco.clttx in the portal JSON only when there are such sales', () => {
    const json = gstr1Json(r) as { supeco?: { clttx: unknown[] } };
    expect(json.supeco?.clttx).toEqual([{ etin: ECO, suppval: 3_900, igst: 410, cgst: 81, sgst: 81, cess: 0 }]);
    const none = buildGstr1(w.business, [w.docs[4]], monthPeriod('2026-10'));
    expect(none.eco).toEqual([]);
    expect(none.summary.some((s) => s.key === 'eco')).toBe(false);
    expect('supeco' in gstr1Json(none)).toBe(false);
  });

  it('uses the TCS rate in force on the date', () => {
    expect(ecoTcsRate('2024-07-09')).toBe(1);
    expect(ecoTcsRate('2024-07-10')).toBe(0.5);
  });

  it('validates the operator GSTIN on the invoice', () => {
    const issues = (o: Partial<typeof w.intra>) => validateSalesDocument({ ...w.intra, ...o }, w.business).map((i) => `${i.level}:${i.field}`);
    expect(issues({ ecoGstin: BAD_ECO })).toContain('error:ecoGstin');
    expect(issues({ ecoGstin: BIZ_GSTIN })).toContain('error:ecoGstin');
    expect(issues({ ecoGstin: ECO, reverseCharge: true })).toContain('warning:ecoGstin');
    expect(issues({ ecoGstin: ECO }).filter((i) => i.endsWith(':ecoGstin'))).toEqual([]);
    expect(issues({ ecoGstin: '' }).filter((i) => i.endsWith(':ecoGstin'))).toEqual([]);
  });
});

describe('GSTR-1 CSV export', () => {
  it('formats dates and places of supply like the offline tool', () => {
    expect(offlineToolDate('2026-11-05')).toBe('05-Nov-2026');
    expect(offlineToolDate('')).toBe('');
    expect(posLabel('27')).toBe('27-Maharashtra');
    expect(posLabel('96')).toBe('96-Other Countries');
    expect(posLabel('')).toBe('');
    expect(posLabel('XX')).toBe('XX');
  });

  it('writes one CSV per non-empty table with offline-tool column names', () => {
    const w = world();
    const files = gstr1CsvFiles(buildGstr1(w.business, w.docs, monthPeriod('2026-10')));
    const names = files.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['b2b_sez_de.csv', 'b2cs.csv', 'hsn(b2b).csv', 'hsn(b2c).csv', 'docs.csv', 'eco.csv']));
    expect(names).not.toContain('exp.csv');
    expect(names).not.toContain('hsn.csv');
    const lines = (name: string) => files.find((f) => f.name === name)!.text.split('\r\n');
    const b2b = lines('b2b_sez_de.csv');
    expect(b2b[0]).toBe(
      '\uFEFFGSTIN/UIN of Recipient,Receiver Name,Invoice Number,Invoice date,Invoice Value,Place Of Supply,Reverse Charge,Applicable % of Tax Rate,Invoice Type,E-Commerce GSTIN,Rate,Taxable Value,Integrated Tax Amount,Central Tax Amount,State/UT Tax Amount,Cess Amount',
    );
    expect(b2b).toContain(`${KA_CUSTOMER_GSTIN},Karnataka Stores,INV/3,10-Oct-2026,2360,29-Karnataka,N,,Regular B2B,${ECO},18,2000,360,0,0,0`);
    expect(lines('eco.csv')[1]).toBe(`Liable to collect tax u/s 52(TCS),${ECO},3900,410,81,81,0`);
    expect(lines('b2cs.csv')[0]).toContain('Type,Place Of Supply');
  });

  it('merges HSN B2B and B2C rows into one hsn.csv before May 2025', () => {
    const w = world('2025-04');
    const r = buildGstr1(w.business, w.docs, monthPeriod('2025-04'));
    expect(r.hsnSplit).toBe(false);
    const names = gstr1CsvFiles(r).map((f) => f.name);
    expect(names).toContain('hsn.csv');
    expect(names).not.toContain('hsn(b2b).csv');
    const merged = mergeHsn([...r.hsnB2b, ...r.hsnB2c]);
    const at18 = merged.filter((h) => h.rate === 18);
    expect(at18).toHaveLength(1);
    expect(at18[0].qty).toBe(r.hsnB2b.filter((h) => h.rate === 18).reduce((s, h) => s + h.qty, 0) + r.hsnB2c.filter((h) => h.rate === 18).reduce((s, h) => s + h.qty, 0));
  });

  it('returns no files for an empty period', () => {
    const w = world();
    expect(gstr1CsvFiles(buildGstr1(w.business, w.docs, monthPeriod('2026-01')))).toEqual([]);
  });
});
