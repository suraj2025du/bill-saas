import { getCountry } from './currency/countries';
import { addDays, todayISO } from './dates';
import { DOC_TYPES, DOC_TYPE_LIST } from './docs/docTypes';
import { newId, nowISO } from './ids';
import type {
  Address,
  AppSettings,
  Business,
  BusinessPreset,
  DispatchDetails,
  DocTotals,
  DocType,
  Expense,
  FeatureFlags,
  Godown,
  Ledger,
  LedgerGroup,
  LineItem,
  NumberSeries,
  Party,
  PartySnapshot,
  PaymentRecord,
  PrintSettings,
  Product,
  PurchaseBill,
  SalesDocument,
  SeriesKey,
  TemplateId,
  Voucher,
  VoucherType,
} from './model';
import { SCHEMA_VERSION } from './model';

export function emptyAddress(countryCode = 'IN', stateCode = ''): Address {
  return { line1: '', line2: '', city: '', pincode: '', stateCode, countryCode };
}

export function emptyTotals(): DocTotals {
  return {
    gross: 0,
    discount: 0,
    taxable: 0,
    cgst: 0,
    sgst: 0,
    utgst: 0,
    igst: 0,
    cess: 0,
    tax: 0,
    roundOff: 0,
    total: 0,
    tds: 0,
    tcs: 0,
    net: 0,
  };
}

export function emptyDispatch(): DispatchDetails {
  return {
    buyerOrderNo: '',
    buyerOrderDate: '',
    dispatchDocNo: '',
    deliveryNoteDate: '',
    dispatchedThrough: '',
    destination: '',
    transportMode: '',
    vehicleNo: '',
    vehicleType: 'REGULAR',
    transporterId: '',
    transporterName: '',
    transportDocNo: '',
    transportDocDate: '',
    distanceKm: 0,
    termsOfDelivery: '',
    ewayBillNo: '',
    exportPortPincode: '',
    exportPortStateCode: '',
  };
}

export function emptyPartySnapshot(countryCode = 'IN'): PartySnapshot {
  return {
    name: '',
    gstin: '',
    pan: '',
    registration: 'UNREGISTERED',
    address: emptyAddress(countryCode),
    phone: '',
    email: '',
  };
}

const FEATURES: Record<BusinessPreset, FeatureFlags> = {
  RETAIL: { inventory: true, godowns: false, batches: false, dispatch: false, tdsTcs: false, multiCurrency: false, recurring: false, posMode: true },
  WHOLESALE: { inventory: true, godowns: true, batches: true, dispatch: true, tdsTcs: true, multiCurrency: false, recurring: false, posMode: false },
  FREELANCER: { inventory: false, godowns: false, batches: false, dispatch: false, tdsTcs: true, multiCurrency: true, recurring: true, posMode: false },
  AGENCY: { inventory: false, godowns: false, batches: false, dispatch: false, tdsTcs: true, multiCurrency: true, recurring: true, posMode: false },
  MANUFACTURING: { inventory: true, godowns: true, batches: true, dispatch: true, tdsTcs: true, multiCurrency: true, recurring: false, posMode: false },
  GENERAL: { inventory: true, godowns: false, batches: false, dispatch: true, tdsTcs: true, multiCurrency: false, recurring: true, posMode: false },
};

export const PRESET_LABELS: Record<BusinessPreset, string> = {
  RETAIL: 'Retail Shop / POS',
  WHOLESALE: 'Wholesale / Trader',
  FREELANCER: 'Freelancer / IT Services',
  AGENCY: 'Agency / Consultancy',
  MANUFACTURING: 'Manufacturing',
  GENERAL: 'General MSME',
};

export function defaultFeatures(preset: BusinessPreset): FeatureFlags {
  return { ...FEATURES[preset] };
}

export function defaultTemplateFor(preset: BusinessPreset): TemplateId {
  switch (preset) {
    case 'RETAIL':
      return 'THERMAL';
    case 'WHOLESALE':
    case 'MANUFACTURING':
      return 'TALLY';
    case 'FREELANCER':
      return 'SERVICE';
    case 'AGENCY':
      return 'MODERN';
    case 'GENERAL':
      return 'BOXED';
  }
}

export function defaultPrintSettings(preset: BusinessPreset = 'GENERAL'): PrintSettings {
  return {
    template: defaultTemplateFor(preset),
    thermalWidth: 80,
    colors: { accent: '#4f46e5', headerBg: '#eef2ff', headerText: '#1e1b4b', bodyText: '#111827', border: '#9ca3af' },
    marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
    language: 'en',
    bilingual: false,
    copies: { original: true, duplicate: false, triplicate: false },
    watermark: { kind: 'NONE', text: '', position: 'DIAGONAL', opacity: 0.08 },
    autoStampPaid: false,
    show: {
      logo: true,
      signature: true,
      bankDetails: true,
      upiQr: true,
      invoiceQr: true,
      barcode: true,
      feedbackQr: false,
      hsnSummary: true,
      amountInWords: true,
      taxInWords: true,
      terms: true,
      declaration: true,
      customerSeal: true,
      dispatchDetails: preset === 'WHOLESALE' || preset === 'MANUFACTURING',
      shipTo: true,
    },
    fontScale: 1,
  };
}

const EXTRA_SERIES: Record<Exclude<SeriesKey, DocType>, string> = {
  RECEIPT: 'RCT/',
  PAYMENT: 'PAY/',
  VOUCHER_PAYMENT: 'PV/',
  VOUCHER_RECEIPT: 'RV/',
  VOUCHER_CONTRA: 'CV/',
  VOUCHER_JOURNAL: 'JV/',
};

function series(prefix: string): NumberSeries {
  return { prefix, nextNumber: 1, padding: 4, suffix: '', includeFY: true, resetEachFY: true, fy: '' };
}

export function defaultSeries(): Record<SeriesKey, NumberSeries> {
  const out = {} as Record<SeriesKey, NumberSeries>;
  for (const t of DOC_TYPE_LIST) out[t] = series(DOC_TYPES[t].defaultPrefix);
  for (const [key, prefix] of Object.entries(EXTRA_SERIES)) out[key as SeriesKey] = series(prefix);
  return out;
}

export function newBusiness(input: Partial<Business> & { name: string }): Business {
  const now = nowISO();
  const preset = input.preset ?? 'GENERAL';
  const countryCode = input.countryCode ?? 'IN';
  const country = getCountry(countryCode);
  return {
    id: newId('biz'),
    legalName: '',
    tagline: '',
    gstRegistration: countryCode === 'IN' ? 'REGULAR' : 'UNREGISTERED',
    gstin: '',
    pan: '',
    tan: '',
    stateCode: '',
    address1: '',
    address2: '',
    city: '',
    pincode: '',
    phone: '',
    email: '',
    website: '',
    currency: country?.currency ?? 'INR',
    logoDataUrl: '',
    signatureDataUrl: '',
    bankAccounts: [],
    upiAccounts: [],
    series: defaultSeries(),
    region: countryCode === 'IN' ? 'INDIA' : 'INTERNATIONAL',
    features: defaultFeatures(preset),
    googleReviewUrl: '',
    terms: '1. Goods once sold will not be taken back.\n2. Interest @18% p.a. will be charged if payment is delayed.',
    declaration:
      'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    print: defaultPrintSettings(preset),
    turnoverAbove10Cr: false,
    turnoverAbove5Cr: false,
    gstFiling: 'MONTHLY',
    fyStartMonth: countryCode === 'IN' ? 4 : 1,
    createdAt: now,
    updatedAt: now,
    ...input,
    preset,
    countryCode,
  };
}

export function newParty(businessId: string, partial: Partial<Party> = {}): Party {
  const now = nowISO();
  return {
    id: newId('pty'),
    businessId,
    kind: 'CUSTOMER',
    name: '',
    contactPerson: '',
    gstin: '',
    pan: '',
    registration: 'UNREGISTERED',
    billing: emptyAddress(),
    shipping: null,
    phone: '',
    email: '',
    creditDays: 0,
    openingBalance: 0,
    openingType: 'DR',
    tdsSection: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function partySnapshot(party: Party): PartySnapshot {
  return {
    name: party.name,
    gstin: party.gstin,
    pan: party.pan,
    registration: party.registration,
    address: { ...party.billing },
    phone: party.phone,
    email: party.email,
  };
}

export function newProduct(businessId: string, partial: Partial<Product> = {}): Product {
  const now = nowISO();
  return {
    id: newId('prd'),
    businessId,
    kind: 'GOODS',
    name: '',
    sku: '',
    barcode: '',
    hsn: '',
    description: '',
    category: '',
    unit: 'NOS',
    purchasePrice: 0,
    sellingPrice: 0,
    mrp: 0,
    gstRate: 18,
    cessRate: 0,
    priceIncludesTax: false,
    trackStock: true,
    openingStock: 0,
    openingStockRate: 0,
    lowStockLevel: 0,
    godownId: '',
    batchNo: '',
    expiryDate: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newGodown(businessId: string, name: string, isDefault = false): Godown {
  const now = nowISO();
  return { id: newId('gdn'), businessId, name, address: '', isDefault, createdAt: now, updatedAt: now };
}

export function newLineItem(partial: Partial<LineItem> = {}): LineItem {
  return {
    id: newId('li'),
    productId: '',
    name: '',
    description: '',
    hsn: '',
    qty: 1,
    unit: 'NOS',
    rate: 0,
    discountPct: 0,
    gstRate: 18,
    cessRate: 0,
    godownId: '',
    batchNo: '',
    taxable: 0,
    cgst: 0,
    sgst: 0,
    utgst: 0,
    igst: 0,
    cess: 0,
    total: 0,
    ...partial,
  };
}

/** Line pre-filled from a product (selling price for sales, purchase price for purchases). */
export function lineFromProduct(product: Product, forPurchase = false): LineItem {
  return newLineItem({
    productId: product.id,
    name: product.name,
    description: product.description,
    hsn: product.hsn,
    unit: product.unit,
    rate: forPurchase ? product.purchasePrice : product.sellingPrice,
    gstRate: product.gstRate,
    cessRate: product.cessRate,
    godownId: product.godownId,
    batchNo: product.batchNo,
  });
}

export function newSalesDocument(business: Business, docType: DocType, partial: Partial<SalesDocument> = {}): SalesDocument {
  const now = nowISO();
  const date = partial.date ?? todayISO();
  const defaultBank = business.bankAccounts.find((b) => b.isDefault) ?? business.bankAccounts[0];
  const defaultUpi = business.upiAccounts.find((u) => u.isDefault) ?? business.upiAccounts[0];
  return {
    id: newId('doc'),
    businessId: business.id,
    docType,
    status: 'DRAFT',
    number: '',
    date,
    dueDate: DOC_TYPES[docType].payable ? addDays(date, 15) : '',
    partyId: '',
    party: emptyPartySnapshot(business.countryCode),
    shipTo: null,
    placeOfSupply: business.stateCode,
    supplyKind: business.countryCode === 'IN' ? 'INTRA_STATE' : 'NON_GST',
    reverseCharge: false,
    exportWithTax: false,
    lutNumber: '',
    portCode: '',
    shippingBillNo: '',
    shippingBillDate: '',
    currency: business.currency,
    exchangeRate: 1,
    pricesIncludeTax: false,
    roundOff: business.currency === 'INR',
    items: [],
    totals: emptyTotals(),
    tds: null,
    tcs: null,
    refDocId: '',
    refDocNumber: '',
    refDocDate: '',
    creditNoteReason: '',
    convertedToId: '',
    stockApplied: DOC_TYPES[docType].stock !== 'NONE',
    dispatch: emptyDispatch(),
    recurring: null,
    recurringSourceId: '',
    bankAccountId: defaultBank?.id ?? '',
    upiAccountId: defaultUpi?.id ?? '',
    notes: '',
    terms: business.terms,
    template: '',
    cancelReason: '',
    cancelledAt: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newPayment(businessId: string, direction: 'IN' | 'OUT', partial: Partial<PaymentRecord> = {}): PaymentRecord {
  const now = nowISO();
  return {
    id: newId('pay'),
    businessId,
    direction,
    number: '',
    date: todayISO(),
    partyId: '',
    partyName: '',
    docId: '',
    amount: 0,
    mode: 'CASH',
    bankAccountId: '',
    reference: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newPurchase(business: Business, partial: Partial<PurchaseBill> = {}): PurchaseBill {
  const now = nowISO();
  return {
    id: newId('pur'),
    businessId: business.id,
    status: 'FINAL',
    supplierId: '',
    supplier: emptyPartySnapshot(business.countryCode),
    billNo: '',
    billDate: todayISO(),
    receivedDate: '',
    dueDate: '',
    placeOfSupply: business.stateCode,
    supplyKind: business.countryCode === 'IN' ? 'INTRA_STATE' : 'NON_GST',
    reverseCharge: false,
    pricesIncludeTax: false,
    roundOff: business.currency === 'INR',
    currency: business.currency,
    exchangeRate: 1,
    items: [],
    totals: emptyTotals(),
    itcCategory: 'INPUTS',
    tds: null,
    attachmentDataUrl: '',
    ocrText: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newExpense(businessId: string, partial: Partial<Expense> = {}): Expense {
  const now = nowISO();
  return {
    id: newId('exp'),
    businessId,
    date: todayISO(),
    ledgerId: 'sys:exp-office',
    description: '',
    vendorName: '',
    vendorGstin: '',
    billNo: '',
    supplyKind: 'INTRA_STATE',
    taxable: 0,
    gstRate: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    total: 0,
    itcEligible: false,
    paidVia: 'CASH',
    bankAccountId: '',
    tds: null,
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newVoucher(businessId: string, type: VoucherType, partial: Partial<Voucher> = {}): Voucher {
  const now = nowISO();
  return {
    id: newId('vch'),
    businessId,
    type,
    number: '',
    date: todayISO(),
    narration: '',
    lines: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newLedger(businessId: string, name: string, group: LedgerGroup, partial: Partial<Ledger> = {}): Ledger {
  const now = nowISO();
  return {
    id: newId('led'),
    businessId,
    name,
    group,
    openingBalance: 0,
    openingType: 'DR',
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function defaultSettings(): AppSettings {
  const now = nowISO();
  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return {
    id: 'app',
    activeBusinessId: '',
    setupComplete: false,
    customUnits: [],
    pin: null,
    autoLockMinutes: 0,
    lastAutoBackup: '',
    lastRecurringRun: '',
    drive: { clientId: '', autoUploadPdf: false, folderId: '', lastBackupAt: '' },
    dismissedNotifications: [],
    schemaVersion: SCHEMA_VERSION,
    licenseType: 'TRIAL',
    licenseKey: '',
    licenseExpiry: thirtyDaysLater,
    licenseOwner: '',
    licenseActivatedAt: '',
    createdAt: now,
    updatedAt: now,
  };
}
