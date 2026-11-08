import { describe, expect, it } from 'vitest';
import { chargesTax, computeDocument, computeLine, hsnTaxSummary, taxLines } from '../../../src/core/gst/compute';
import type { ComputeOptions } from '../../../src/core/gst/compute';
import { line } from '../../fixtures/sample';

const opts = (o: Partial<ComputeOptions> = {}): ComputeOptions => ({
  docType: 'TAX_INVOICE',
  supplyKind: 'INTRA_STATE',
  pricesIncludeTax: false,
  roundOff: false,
  exportWithTax: false,
  reverseCharge: false,
  ...o,
});

describe('computeLine', () => {
  it('splits intra-state tax into equal CGST and SGST', () => {
    const l = computeLine(line({ qty: 2, rate: 500, gstRate: 18 }), opts());
    expect(l).toMatchObject({ taxable: 1000, cgst: 90, sgst: 90, igst: 0, utgst: 0, total: 1180 });
  });

  it('charges IGST inter-state and CGST+UTGST intra-UT', () => {
    expect(computeLine(line({ qty: 1, rate: 1000, gstRate: 18 }), opts({ supplyKind: 'INTER_STATE' }))).toMatchObject({
      igst: 180,
      cgst: 0,
      total: 1180,
    });
    expect(computeLine(line({ qty: 1, rate: 1000, gstRate: 5 }), opts({ supplyKind: 'INTRA_UT' }))).toMatchObject({
      cgst: 25,
      utgst: 25,
      sgst: 0,
      total: 1050,
    });
  });

  it('back-calculates tax-inclusive prices so the total equals the entered price', () => {
    const l = computeLine(line({ qty: 1, rate: 100, gstRate: 18 }), opts({ pricesIncludeTax: true }));
    expect(l.cgst).toBe(7.63);
    expect(l.sgst).toBe(7.63);
    expect(l.taxable).toBe(84.74);
    expect(l.total).toBe(100);
  });

  it('applies discounts before tax', () => {
    const l = computeLine(line({ qty: 10, rate: 100, discountPct: 10, gstRate: 18 }), opts({ supplyKind: 'INTER_STATE' }));
    expect(l).toMatchObject({ taxable: 900, igst: 162, total: 1062 });
    expect(computeLine(line({ qty: 1, rate: 100, discountPct: 150 }), opts()).taxable).toBe(0);
  });

  it('removes GST for a Bill of Supply and for LUT exports', () => {
    expect(computeLine(line({ qty: 1, rate: 500, gstRate: 18 }), opts({ docType: 'BILL_OF_SUPPLY' }))).toMatchObject({
      taxable: 500,
      cgst: 0,
      total: 500,
    });
    expect(computeLine(line({ qty: 1, rate: 500, gstRate: 18 }), opts({ supplyKind: 'EXPORT' })).igst).toBe(0);
    expect(computeLine(line({ qty: 1, rate: 500, gstRate: 18 }), opts({ supplyKind: 'EXPORT', exportWithTax: true })).igst).toBe(90);
    expect(computeLine(line({ qty: 1, rate: 500, gstRate: 18 }), opts({ supplyKind: 'SEZ', exportWithTax: true })).igst).toBe(90);
  });

  it('adds cess and treats non-GST local tax like a single tax', () => {
    const l = computeLine(line({ qty: 1, rate: 1000, gstRate: 28, cessRate: 12 }), opts({ supplyKind: 'INTER_STATE' }));
    expect(l).toMatchObject({ igst: 280, cess: 120, total: 1400 });
    expect(computeLine(line({ qty: 1, rate: 100, gstRate: 5 }), opts({ supplyKind: 'NON_GST' })).igst).toBe(5);
  });

  it('treats garbage numbers as zero', () => {
    const l = computeLine(line({ qty: Number.NaN, rate: 100 }), opts());
    expect(l.total).toBe(0);
  });

  it('knows when tax is charged', () => {
    expect(chargesTax({ docType: 'QUOTATION', supplyKind: 'INTRA_STATE', exportWithTax: false })).toBe(true);
    expect(chargesTax({ docType: 'BILL_OF_SUPPLY', supplyKind: 'INTRA_STATE', exportWithTax: false })).toBe(false);
  });
});

describe('computeDocument', () => {
  it('totals lines, rounds off and keeps CGST = SGST', () => {
    const r = computeDocument([line({ qty: 1, rate: 849.15, gstRate: 18 })], opts({ roundOff: true }));
    expect(r.totals).toMatchObject({ taxable: 849.15, cgst: 76.42, sgst: 76.42, tax: 152.84, roundOff: 0.01, total: 1002, net: 1002 });
  });

  it('handles multiple rates and the gross/discount aids', () => {
    const r = computeDocument(
      [line({ qty: 2, rate: 100, gstRate: 5, discountPct: 10 }), line({ qty: 1, rate: 1000, gstRate: 18, hsn: '8471' })],
      opts({ supplyKind: 'INTER_STATE' }),
    );
    expect(r.totals.gross).toBe(1200);
    expect(r.totals.discount).toBe(20);
    expect(r.totals.taxable).toBe(1180);
    expect(r.totals.igst).toBe(9 + 180);
    expect(r.totals.total).toBe(1369);
  });

  it('excludes reverse-charge tax from the amount collected', () => {
    const r = computeDocument([line({ qty: 1, rate: 1000, gstRate: 5 })], opts({ reverseCharge: true, supplyKind: 'INTER_STATE' }));
    expect(r.totals.igst).toBe(50);
    expect(r.totals.total).toBe(1000);
  });

  it('deducts TDS on the taxable value and adds TCS on the total', () => {
    const r = computeDocument([line({ qty: 1, rate: 10000, gstRate: 18 })], opts({ tds: { section: '194C', rate: 2 } }));
    expect(r.tds).toEqual({ section: '194C', rate: 2, base: 10000, amount: 200 });
    expect(r.totals.net).toBe(11800 - 200);
    const t = computeDocument([line({ qty: 1, rate: 10000, gstRate: 18 })], opts({ tcs: { section: '206C(1F)', rate: 1 } }));
    expect(t.tcs?.base).toBe(11800);
    expect(t.totals.net).toBe(11918);
    const partial = computeDocument([line({ qty: 1, rate: 10000, gstRate: 18 })], opts({ tcs: { section: '206C(1H)', rate: 0.1, base: 5000 } }));
    expect(partial.tcs?.amount).toBe(5);
    const none = computeDocument([line({ qty: 1, rate: 100 })], opts({ tds: { section: '', rate: 2 }, tcs: { section: 'X', rate: 0 } }));
    expect(none.tds).toBeNull();
    expect(none.tcs).toBeNull();
  });

  it('supports zero-decimal currencies', () => {
    const r = computeDocument([line({ qty: 3, rate: 333.3, gstRate: 10 })], opts({ supplyKind: 'NON_GST', decimals: 0 }));
    expect(r.totals.taxable).toBe(1000);
    expect(r.totals.igst).toBe(100);
  });
});

describe('summaries', () => {
  it('groups HSN-wise tax and builds tax lines', () => {
    const r = computeDocument(
      [line({ qty: 1, rate: 100, gstRate: 18, hsn: '8539' }), line({ qty: 2, rate: 100, gstRate: 18, hsn: '8539' }), line({ qty: 1, rate: 100, gstRate: 5, hsn: '1006' })],
      opts(),
    );
    const h = hsnTaxSummary(r.items);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ hsn: '8539', taxable: 300, cgst: 27, sgst: 27, tax: 54 });
    const t = taxLines(r.items, 'INTRA_STATE');
    expect(t).toContainEqual({ label: 'CGST', rate: 9, amount: 27 });
    expect(t).toContainEqual({ label: 'SGST', rate: 2.5, amount: 2.5 });
    const v = taxLines(computeDocument([line({ qty: 1, rate: 100, gstRate: 5 })], opts({ supplyKind: 'NON_GST' })).items, 'NON_GST', 'VAT');
    expect(v).toEqual([{ label: 'VAT', rate: 5, amount: 5 }]);
  });
});
