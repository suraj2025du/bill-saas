import { describe, expect, it } from 'vitest';
import {
  PRESET_LABELS,
  defaultFeatures,
  defaultSettings,
  defaultTemplateFor,
  lineFromProduct,
  newBusiness,
  newExpense,
  newGodown,
  newSalesDocument,
} from '../../../src/core/factories';
import { lowStockProducts, stockByLocation, stockByProduct, stockMovements, currentStock } from '../../../src/core/inventory/stock';
import { closingStockValue, valueStock } from '../../../src/core/inventory/valuation';
import { COLLECTIONS } from '../../../src/core/model';
import { emptyCollections, makeSnapshot, validateRecord, validateSnapshot } from '../../../src/core/schema';
import { convertDocument, createCreditNote } from '../../../src/core/docs/lifecycle';
import { sampleBusiness, sampleDoc, sampleParty, sampleProduct, samplePurchase } from '../../fixtures/sample';

const biz = sampleBusiness();
const party = sampleParty(biz.id);
const bulb = sampleProduct(biz.id, { openingStock: 10, openingStockRate: 100, purchasePrice: 100 });
const service = sampleProduct(biz.id, { kind: 'SERVICE', name: 'Installation', hsn: '998714', openingStock: 0 });

function snapshotWith() {
  const cols = emptyCollections();
  cols.businesses.push(biz);
  cols.clients.push(party);
  cols.products.push(bulb);
  cols.invoices.push(sampleDoc(biz, party, [{ productId: bulb.id, qty: 1, rate: 100 }]));
  cols.settings.push({ ...defaultSettings(), activeBusinessId: biz.id, setupComplete: true });
  return makeSnapshot(cols);
}

describe('snapshot validation', () => {
  it('accepts a valid backup', () => {
    const r = validateSnapshot(JSON.parse(JSON.stringify(snapshotWith())));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot.collections.invoices).toHaveLength(1);
  });

  it('rejects files that are not backups', () => {
    expect(validateSnapshot(null)).toMatchObject({ ok: false });
    expect(validateSnapshot([])).toMatchObject({ ok: false });
    const wrong = validateSnapshot({ app: 'other', schemaVersion: 99, collections: [] });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.errors.join('\n')).toMatch(/not a Free GST Billing backup/);
      expect(wrong.errors.join('\n')).toMatch(/newer app version/);
      expect(wrong.errors.join('\n')).toMatch(/no data collections/);
    }
    const noVersion = validateSnapshot({ app: 'free-gst-billing', collections: {} });
    expect(noVersion.ok).toBe(false);
  });

  it('reports broken records, duplicates and dangling references', () => {
    const snap = JSON.parse(JSON.stringify(snapshotWith()));
    snap.collections.invoices.push({ ...snap.collections.invoices[0], items: 'oops' });
    snap.collections.products.push({ ...snap.collections.products[0] });
    snap.collections.clients.push({ ...snap.collections.clients[0], id: 'pty_other', businessId: 'biz_missing' });
    snap.collections.vouchers = 'nope';
    snap.collections.settings.push({ ...snap.collections.settings[0] });
    snap.collections.settings[0].activeBusinessId = 'biz_missing';
    const r = validateSnapshot(snap);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const text = r.errors.join('\n');
      expect(text).toMatch(/invoices\[1\] items/);
      expect(text).toMatch(/duplicate id/);
      expect(text).toMatch(/refers to a business/);
      expect(text).toMatch(/vouchers: expected a list/);
      expect(text).toMatch(/more than one settings/);
      expect(text).toMatch(/active business/);
    }
    expect(validateSnapshot(snap, 2)).toMatchObject({ ok: false, errors: expect.any(Array) });
    const capped = validateSnapshot(snap, 2);
    if (!capped.ok) expect(capped.errors).toHaveLength(2);
  });

  it('validates single records and builds empty data', () => {
    expect(validateRecord('godowns', newGodown(biz.id, 'Main'))).toBe('');
    expect(validateRecord('godowns', { id: 'bad id!' })).toMatch(/id/);
    expect(Object.keys(emptyCollections())).toEqual([...COLLECTIONS]);
  });
});

describe('stock', () => {
  const purchase = samplePurchase(biz, party, [{ productId: bulb.id, qty: 10, rate: 120 }], { billDate: '2026-09-01' });
  const sale = sampleDoc(biz, party, [{ productId: bulb.id, qty: 3, rate: 150 }, { productId: service.id, qty: 1, rate: 500 }], { date: '2026-09-10' });
  const challan = sampleDoc(biz, party, [{ productId: bulb.id, qty: 2, rate: 150 }], { date: '2026-09-12', number: 'DC/1' }, 'DELIVERY_CHALLAN');
  const fromChallan = { ...convertDocument(challan, 'TAX_INVOICE'), status: 'FINAL' as const, number: 'INV/2' };
  const cn = { ...createCreditNote(sale, 'SALES_RETURN', true), status: 'FINAL' as const, number: 'CN/1', date: '2026-09-20' };
  const priceCn = { ...createCreditNote(sale, 'POST_SALE_DISCOUNT', false), status: 'FINAL' as const, number: 'CN/2' };
  const draft = { ...sale, id: 'doc_draft', status: 'DRAFT' as const };
  const cancelled = { ...sale, id: 'doc_cancel', status: 'CANCELLED' as const };
  const data = {
    products: [bulb, service],
    purchases: [purchase, { ...purchase, id: 'pur_x', status: 'CANCELLED' as const }],
    invoices: [sale, challan, fromChallan, cn, priceCn, draft, cancelled],
  };

  it('counts each movement once', () => {
    const moves = stockMovements(data, biz.id);
    expect(moves.map((m) => m.source)).toEqual(['OPENING', 'PURCHASE', 'SALE', 'CHALLAN', 'CREDIT_NOTE']);
    // 10 opening + 10 purchase - 3 sale - 2 challan + 1 return (credit note qty 3 copied; edit to 1)
    const stock = stockByProduct(moves);
    expect(stock.get(bulb.id)).toBe(10 + 10 - 3 - 2 + 3);
    expect(stock.has(service.id)).toBe(false);
    expect(currentStock(data, biz.id, '2026-09-05').get(bulb.id)).toBe(20);
    expect(stockByLocation(moves).get(`${bulb.id}|${bulb.godownId}|${bulb.batchNo}`)).toBe(18);
    expect(stockMovements(data, 'biz_other')).toEqual([]);
  });

  it('flags low stock', () => {
    const low = lowStockProducts([bulb, service, { ...bulb, id: 'p2', lowStockLevel: 0 }], new Map([[bulb.id, 5]]));
    expect(low).toEqual([{ product: bulb, qty: 5 }]);
  });

  it('values closing stock by weighted average, last purchase or standard cost', () => {
    const avg = valueStock(data, biz.id, '2026-12-31');
    const line = avg.lines.find((l) => l.productId === bulb.id)!;
    expect(line.qty).toBe(18);
    expect(line.rate).toBe(110);
    expect(line.value).toBe(1980);
    expect(valueStock(data, biz.id, '2026-12-31', 'LAST_PURCHASE').total).toBe(18 * 120);
    expect(valueStock(data, biz.id, '2026-12-31', 'STANDARD_COST').total).toBe(18 * 100);
    expect(closingStockValue(data, biz.id, '2026-08-31')).toBe(1000);
    const oversold = { ...data, invoices: [sampleDoc(biz, party, [{ productId: bulb.id, qty: 50, rate: 1 }])] };
    expect(valueStock(oversold, biz.id, '2026-12-31').lines[0]!.value).toBe(0);
    const noCost = { products: [{ ...bulb, openingStock: 0, purchasePrice: 77 }], purchases: [], invoices: [] };
    expect(valueStock(noCost, biz.id, '2026-12-31').lines[0]!.rate).toBe(77);
  });
});

describe('factories', () => {
  it('builds Indian and foreign businesses with preset defaults', () => {
    const india = newBusiness({ name: 'A', preset: 'RETAIL' });
    expect(india).toMatchObject({ countryCode: 'IN', currency: 'INR', fyStartMonth: 4, region: 'INDIA', gstRegistration: 'REGULAR' });
    expect(india.features.posMode).toBe(true);
    expect(india.print.template).toBe('THERMAL');
    const uae = newBusiness({ name: 'B', countryCode: 'AE' });
    expect(uae).toMatchObject({ currency: 'AED', fyStartMonth: 1, region: 'INTERNATIONAL', gstRegistration: 'UNREGISTERED' });
    expect(Object.keys(india.series)).toHaveLength(13);
    for (const p of Object.keys(PRESET_LABELS) as (keyof typeof PRESET_LABELS)[]) {
      expect(defaultTemplateFor(p)).toBeTruthy();
      expect(defaultFeatures(p)).toBeTruthy();
    }
  });

  it('builds documents with sensible defaults', () => {
    const inv = newSalesDocument(biz, 'TAX_INVOICE', { date: '2026-10-01' });
    expect(inv).toMatchObject({ dueDate: '2026-10-16', stockApplied: true, bankAccountId: 'bank_1', upiAccountId: 'upi_1', roundOff: true });
    const q = newSalesDocument(biz, 'QUOTATION');
    expect(q).toMatchObject({ dueDate: '', stockApplied: false });
    const foreign = newSalesDocument(newBusiness({ name: 'X', countryCode: 'GB' }), 'TAX_INVOICE');
    expect(foreign).toMatchObject({ supplyKind: 'NON_GST', roundOff: false, bankAccountId: '' });
    expect(lineFromProduct(bulb).rate).toBe(bulb.sellingPrice);
    expect(lineFromProduct(bulb, true).rate).toBe(bulb.purchasePrice);
    expect(newExpense(biz.id).ledgerId).toBe('sys:exp-office');
    expect(defaultSettings()).toMatchObject({ id: 'app', setupComplete: false, schemaVersion: 1 });
  });
});
