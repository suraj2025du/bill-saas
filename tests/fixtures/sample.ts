import { computeDocument } from '../../src/core/gst/compute';
import { makeGstin } from '../../src/core/gst/gstin';
import { determineSupplyKind } from '../../src/core/gst/supply';
import {
  newBusiness,
  newLineItem,
  newParty,
  newProduct,
  newPurchase,
  newSalesDocument,
  partySnapshot,
} from '../../src/core/factories';
import type { Business, DocType, LineItem, Party, Product, PurchaseBill, SalesDocument } from '../../src/core/model';

export const BIZ_GSTIN = makeGstin('27', 'AAPFS1234K');
export const MH_CUSTOMER_GSTIN = makeGstin('27', 'AABCR5055K');
export const KA_CUSTOMER_GSTIN = makeGstin('29', 'AACCK1234L');

export function sampleBusiness(overrides: Partial<Business> = {}): Business {
  return newBusiness({
    name: 'Sharma Traders',
    gstin: BIZ_GSTIN,
    pan: 'AAPFS1234K',
    stateCode: '27',
    address1: '12 MG Road',
    city: 'Mumbai',
    pincode: '400001',
    preset: 'WHOLESALE',
    bankAccounts: [
      {
        id: 'bank_1',
        label: 'Current A/c',
        bankName: 'HDFC Bank',
        accountHolder: 'Sharma Traders',
        accountNumber: '50200012345678',
        ifsc: 'HDFC0000123',
        branch: 'Fort',
        swift: '',
        accountType: 'CURRENT',
        openingBalance: 25000,
        isDefault: true,
      },
    ],
    upiAccounts: [{ id: 'upi_1', vpa: 'sharmatraders@hdfcbank', payeeName: 'Sharma Traders', label: 'UPI', isDefault: true }],
    ...overrides,
  });
}

export function sampleParty(businessId: string, overrides: Partial<Party> = {}): Party {
  return newParty(businessId, {
    name: 'Reliance Retail',
    gstin: MH_CUSTOMER_GSTIN,
    registration: 'REGULAR',
    billing: { line1: 'Andheri East', line2: '', city: 'Mumbai', pincode: '400069', stateCode: '27', countryCode: 'IN' },
    creditDays: 30,
    ...overrides,
  });
}

export function sampleProduct(businessId: string, overrides: Partial<Product> = {}): Product {
  return newProduct(businessId, {
    name: 'LED Bulb 9W',
    hsn: '853950',
    unit: 'PCS',
    purchasePrice: 60,
    sellingPrice: 100,
    gstRate: 18,
    openingStock: 100,
    openingStockRate: 55,
    lowStockLevel: 10,
    ...overrides,
  });
}

export function line(partial: Partial<LineItem>): LineItem {
  return newLineItem({ name: 'Item', hsn: '853950', unit: 'PCS', ...partial });
}

/** A computed sales document for `party` (supply kind derived from GSTIN state). */
export function sampleDoc(
  business: Business,
  party: Party,
  items: Partial<LineItem>[],
  overrides: Partial<SalesDocument> = {},
  docType: DocType = 'TAX_INVOICE',
): SalesDocument {
  const base = newSalesDocument(business, docType, {
    partyId: party.id,
    party: partySnapshot(party),
    placeOfSupply: party.billing.stateCode,
    status: 'FINAL',
    number: 'INV/26-27/0001',
    date: '2026-10-01',
    dueDate: '2026-10-31',
    items: items.map(line),
    ...overrides,
  });
  const supplyKind =
    overrides.supplyKind ??
    determineSupplyKind({
      businessCountry: business.countryCode,
      businessState: business.stateCode,
      placeOfSupply: base.placeOfSupply,
      partyRegistration: party.registration,
      partyCountry: party.billing.countryCode,
    });
  const computed = computeDocument(base.items, {
    docType: base.docType,
    supplyKind,
    pricesIncludeTax: base.pricesIncludeTax,
    roundOff: base.roundOff,
    exportWithTax: base.exportWithTax,
    reverseCharge: base.reverseCharge,
    tds: base.tds,
    tcs: base.tcs,
  });
  return { ...base, supplyKind, items: computed.items, totals: computed.totals, tds: computed.tds, tcs: computed.tcs };
}

export function samplePurchase(business: Business, supplier: Party, items: Partial<LineItem>[], overrides: Partial<PurchaseBill> = {}): PurchaseBill {
  const base = newPurchase(business, {
    supplierId: supplier.id,
    supplier: partySnapshot(supplier),
    billNo: 'SUP-101',
    billDate: '2026-09-15',
    placeOfSupply: business.stateCode,
    items: items.map(line),
    ...overrides,
  });
  const computed = computeDocument(base.items, {
    docType: 'TAX_INVOICE',
    supplyKind: base.supplyKind,
    pricesIncludeTax: base.pricesIncludeTax,
    roundOff: base.roundOff,
    exportWithTax: false,
    reverseCharge: base.reverseCharge,
    tds: base.tds,
  });
  return { ...base, items: computed.items, totals: computed.totals, tds: computed.tds };
}
