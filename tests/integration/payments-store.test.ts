import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, newPayment, newVoucher } from '../../src/core/factories';
import { makeGstin } from '../../src/core/gst/gstin';
import type { PaymentRecord, Voucher } from '../../src/core/model';
import { putOp } from '../../src/data/adapter';
import { IndexedDbAdapter } from '../../src/data/indexeddb';
import { cancelSalesDocument, deletePurchase, savePayment } from '../../src/store/actions';
import { useStore } from '../../src/store/store';
import { sampleBusiness, sampleDoc, sampleParty, samplePurchase } from '../fixtures/sample';

// Store actions behind the payment dialog (review R1) and the cancel / delete guards (review Y12),
// run against browser storage as the app does.

const business = sampleBusiness();
const buyer = sampleParty(business.id, {
  name: 'Acme Inc',
  gstin: '',
  registration: 'OVERSEAS',
  billing: { line1: '1 Main Street', line2: '', city: 'New York', pincode: '10001', stateCode: '96', countryCode: 'US' },
});
const supplier = sampleParty(business.id, { kind: 'SUPPLIER', name: 'Bajaj Electricals', gstin: makeGstin('27', 'AABCB1234C') });
const invoice = sampleDoc(business, buyer, [{ qty: 1, rate: 1000, gstRate: 0 }], { currency: 'USD', exchangeRate: 83, placeOfSupply: '96', supplyKind: 'EXPORT', roundOff: false });
const bill = samplePurchase(business, supplier, [{ qty: 1, rate: 1000, gstRate: 18 }]);

let adapter: IndexedDbAdapter;

beforeEach(async () => {
  adapter = await IndexedDbAdapter.open(`payments-${Math.random().toString(36).slice(2)}`);
  const settings = { ...defaultSettings(), activeBusinessId: business.id, setupComplete: true };
  await adapter.commit({
    puts: [putOp('businesses', business), putOp('clients', buyer), putOp('clients', supplier), putOp('invoices', invoice), putOp('purchases', bill), putOp('settings', settings)],
    removes: [],
  });
  useStore.setState({ adapter, data: await adapter.loadAll(), boot: 'ready', unlocked: true });
});

const receipt = (partial: Partial<PaymentRecord>) =>
  newPayment(business.id, 'IN', { docId: invoice.id, partyId: buyer.id, partyName: buyer.name, mode: 'BANK', bankAccountId: 'bank_1', date: '2026-10-20', ...partial });
const stored = async () => adapter.loadAll();
const allocate = async (docId: string, ledgerId: string): Promise<Voucher> => {
  const v = newVoucher(business.id, 'RECEIPT', {
    number: 'RV/26-27/0001',
    date: '2026-10-22',
    lines: [
      { ledgerId: 'sys:cash', dr: 500, cr: 0, docId: '', note: '' },
      { ledgerId, dr: 0, cr: 500, docId, note: '' },
    ],
  });
  await adapter.commit({ puts: [putOp('vouchers', v)], removes: [] });
  useStore.setState({ data: await adapter.loadAll() });
  return v;
};

describe('savePayment with another currency (review R1)', () => {
  it('checks a dollar payment against the dollar balance and keeps its currency and rate', async () => {
    await expect(savePayment(receipt({ amount: 1000.5, currency: 'USD', exchangeRate: 84 }))).rejects.toMatchObject({
      details: ['Amount is more than the balance due (USD 1000.00). Record the extra as an advance without linking a bill.'],
    });
    const saved = await savePayment(receipt({ amount: 1000, currency: 'USD', exchangeRate: 84 }));
    expect(saved).toMatchObject({ number: 'RCT/26-27/0001', amount: 1000, currency: 'USD', exchangeRate: 84 });
    expect((await stored()).receipts).toEqual([saved]);
  });

  it("gives a payment saved without a currency the linked document's currency and rate", async () => {
    const linked = await savePayment(receipt({ amount: 300 }));
    expect(linked).toMatchObject({ currency: 'USD', exchangeRate: 83 });
    const advance = await savePayment(receipt({ docId: '', amount: 5000 }));
    expect(advance).toMatchObject({ currency: 'INR', exchangeRate: 1 });
  });

  it('asks for the exchange rate of a payment in another currency', async () => {
    await expect(savePayment(receipt({ amount: 100, currency: 'USD', exchangeRate: 0 }))).rejects.toMatchObject({
      details: ['Enter the exchange rate on the payment date (1 USD = ? INR).'],
    });
    expect((await stored()).receipts).toEqual([]);
  });
});

describe('cancel and delete guards with vouchers (review Y12)', () => {
  it('refuses to cancel an invoice that a voucher pays bill-wise', async () => {
    const v = await allocate(invoice.id, `party:${buyer.id}`);
    await expect(cancelSalesDocument(invoice, 'Wrong rate')).rejects.toThrow(`Voucher ${v.number} is set against it (bill-wise). Change or delete that voucher first.`);
    expect((await stored()).invoices[0]!.status).toBe('FINAL');
  });

  it('refuses to delete a purchase bill that a voucher pays bill-wise', async () => {
    const v = await allocate(bill.id, `party:${supplier.id}`);
    await expect(deletePurchase(bill)).rejects.toThrow(`Voucher ${v.number} is set against this bill (bill-wise). Change or delete that voucher first.`);
    expect((await stored()).purchases.map((b) => b.id)).toEqual([bill.id]);
  });

  it('still deletes a bill nothing is set against', async () => {
    await deletePurchase(bill);
    const after = await stored();
    expect(after.purchases).toEqual([]);
    expect(after.trash.map((t) => t.recordId)).toEqual([bill.id]);
  });
});
