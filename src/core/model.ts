// Domain model shared by the UI, the storage adapters and the local server.
//
// Conventions
// - Money is stored in the document currency, rounded with roundMoney().
//   INR equivalents for GST returns use `exchangeRate` (INR per 1 unit).
// - Empty optional text is '' (never undefined) so forms stay controlled.
// - Record ids come from newId(); references to "virtual" ledgers use the
//   prefixes documented in src/core/ledgers.ts.
// - Deleting a record moves it to the `trash` collection (30-day bin);
//   main collections never carry soft-delete flags.

export type ID = string;
/** Calendar date, ISO format YYYY-MM-DD, local (no time zone). */
export type ISODate = string;
/** Timestamp, ISO 8601 with time zone. */
export type ISODateTime = string;

export interface Timestamps {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------- business

export type BusinessPreset = 'RETAIL' | 'WHOLESALE' | 'FREELANCER' | 'AGENCY' | 'MANUFACTURING' | 'GENERAL';
export type Region = 'INDIA' | 'INTERNATIONAL' | 'BOTH';
export type GstRegistration = 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';

export interface BankAccount {
  id: ID;
  label: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
  swift: string;
  accountType: 'SAVINGS' | 'CURRENT' | 'OD' | 'CC';
  openingBalance: number;
  isDefault: boolean;
}

export interface UpiAccount {
  id: ID;
  vpa: string;
  payeeName: string;
  label: string;
  isDefault: boolean;
}

/** Document numbering series. Rendered numbers must be <= 16 chars (GST Rule 46). */
export interface NumberSeries {
  prefix: string;
  nextNumber: number;
  padding: number;
  suffix: string;
  /** Insert the short FY (e.g. 26-27) between prefix and number. */
  includeFY: boolean;
  /** Restart at 1 when the financial year changes. */
  resetEachFY: boolean;
  /** FY label (e.g. 2026-27) that `nextNumber` belongs to. */
  fy: string;
}

export type SeriesKey =
  | DocType
  | 'RECEIPT'
  | 'PAYMENT'
  | 'VOUCHER_PAYMENT'
  | 'VOUCHER_RECEIPT'
  | 'VOUCHER_CONTRA'
  | 'VOUCHER_JOURNAL';

/** Which optional areas the UI shows. Tailored by the business preset. */
export interface FeatureFlags {
  inventory: boolean;
  godowns: boolean;
  batches: boolean;
  dispatch: boolean;
  tdsTcs: boolean;
  multiCurrency: boolean;
  recurring: boolean;
  /** Fast counter billing; defaults print to the thermal template. */
  posMode: boolean;
}

export type TemplateId =
  | 'TALLY'
  | 'BOXED'
  | 'MODERN'
  | 'RETAIL'
  | 'MINIMAL'
  | 'EXECUTIVE'
  | 'COMPACT_A5'
  | 'SERVICE'
  | 'THERMAL';
export type ThermalWidth = 58 | 76 | 80 | 112;
export type LabelLanguage = 'en' | 'hi' | 'ta' | 'mr' | 'bn';
export type WatermarkKind = 'NONE' | 'DUPLICATE' | 'DRAFT' | 'PAID' | 'CANCELLED' | 'CUSTOM';

export interface PrintSettings {
  template: TemplateId;
  thermalWidth: ThermalWidth;
  colors: { accent: string; headerBg: string; headerText: string; bodyText: string; border: string };
  marginsMm: { top: number; right: number; bottom: number; left: number };
  language: LabelLanguage;
  /** Print English next to the selected language. */
  bilingual: boolean;
  /** GST Rule 48 copies. */
  copies: { original: boolean; duplicate: boolean; triplicate: boolean };
  watermark: { kind: WatermarkKind; text: string; position: 'DIAGONAL' | 'HEADER'; opacity: number };
  /** Stamp PAID automatically once an invoice is fully paid. */
  autoStampPaid: boolean;
  show: {
    logo: boolean;
    signature: boolean;
    bankDetails: boolean;
    upiQr: boolean;
    invoiceQr: boolean;
    barcode: boolean;
    feedbackQr: boolean;
    hsnSummary: boolean;
    amountInWords: boolean;
    taxInWords: boolean;
    terms: boolean;
    declaration: boolean;
    customerSeal: boolean;
    dispatchDetails: boolean;
    shipTo: boolean;
  };
  /** 0.8 – 1.3 */
  fontScale: number;
}

export interface Business extends Timestamps {
  id: ID;
  name: string;
  legalName: string;
  tagline: string;
  gstRegistration: GstRegistration;
  gstin: string;
  pan: string;
  tan: string;
  /** GST state code, e.g. '27'. '' for businesses outside India. */
  stateCode: string;
  address1: string;
  address2: string;
  city: string;
  pincode: string;
  /** ISO 3166 alpha-2, e.g. 'IN'. */
  countryCode: string;
  phone: string;
  email: string;
  website: string;
  /** Default billing currency (ISO 4217). */
  currency: string;
  logoDataUrl: string;
  signatureDataUrl: string;
  bankAccounts: BankAccount[];
  upiAccounts: UpiAccount[];
  series: Record<SeriesKey, NumberSeries>;
  preset: BusinessPreset;
  region: Region;
  features: FeatureFlags;
  googleReviewUrl: string;
  terms: string;
  declaration: string;
  print: PrintSettings;
  /** Turnover above Rs 10 crore in the previous FY (194Q / old 206C(1H) applicability). */
  turnoverAbove10Cr: boolean;
  /** Aggregate turnover above Rs 5 crore: 6-digit HSN and monthly GSTR-1. */
  turnoverAbove5Cr: boolean;
  /** GSTR-1 / GSTR-3B frequency: monthly, or quarterly under the QRMP scheme. */
  gstFiling: 'MONTHLY' | 'QUARTERLY';
  /** Month the financial year starts (4 = April for India). */
  fyStartMonth: number;
}

// ---------------------------------------------------------------- parties

export type PartyKind = 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
export type PartyRegistration = 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED' | 'CONSUMER' | 'SEZ' | 'OVERSEAS' | 'UIN';

export interface Address {
  line1: string;
  line2: string;
  city: string;
  pincode: string;
  /** GST state code ('27'), '96' for a foreign address, '' if unknown. */
  stateCode: string;
  countryCode: string;
}

export interface Party extends Timestamps {
  id: ID;
  businessId: ID;
  kind: PartyKind;
  name: string;
  contactPerson: string;
  gstin: string;
  pan: string;
  registration: PartyRegistration;
  billing: Address;
  shipping: Address | null;
  phone: string;
  email: string;
  creditDays: number;
  openingBalance: number;
  openingType: 'DR' | 'CR';
  /** Default TDS section to deduct when paying this supplier ('' = none). */
  tdsSection: string;
  notes: string;
}

// ---------------------------------------------------------------- inventory

export interface UnitDef {
  code: string;
  name: string;
  /** GST Unique Quantity Code for GSTR-1 HSN summary. */
  uqc: string;
  decimals: number;
  custom: boolean;
}

export interface Godown extends Timestamps {
  id: ID;
  businessId: ID;
  name: string;
  address: string;
  isDefault: boolean;
}

export interface Product extends Timestamps {
  id: ID;
  businessId: ID;
  kind: 'GOODS' | 'SERVICE';
  name: string;
  sku: string;
  barcode: string;
  hsn: string;
  description: string;
  category: string;
  unit: string;
  purchasePrice: number;
  sellingPrice: number;
  mrp: number;
  gstRate: number;
  cessRate: number;
  /** sellingPrice already includes GST. */
  priceIncludesTax: boolean;
  trackStock: boolean;
  openingStock: number;
  /** Cost per unit of the opening stock (for valuation). */
  openingStockRate: number;
  lowStockLevel: number;
  godownId: string;
  batchNo: string;
  expiryDate: ISODate | '';
}

// ---------------------------------------------------------------- documents

export type DocType =
  | 'TAX_INVOICE'
  | 'BILL_OF_SUPPLY'
  | 'QUOTATION'
  | 'PROFORMA'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'DELIVERY_CHALLAN';
export type DocStatus = 'DRAFT' | 'FINAL' | 'CANCELLED';

/**
 * INTRA_STATE: CGST + SGST · INTRA_UT: CGST + UTGST · INTER_STATE: IGST
 * EXPORT / SEZ: IGST when exportWithTax, else zero-rated under LUT
 * NON_GST: business outside India; one local tax (VAT/SST/...) kept in `igst`.
 */
export type SupplyKind = 'INTRA_STATE' | 'INTRA_UT' | 'INTER_STATE' | 'EXPORT' | 'SEZ' | 'NON_GST';

export interface LineItem {
  id: ID;
  productId: string;
  name: string;
  description: string;
  hsn: string;
  qty: number;
  unit: string;
  /** Unit price, tax-exclusive unless the document has pricesIncludeTax. */
  rate: number;
  discountPct: number;
  gstRate: number;
  cessRate: number;
  godownId: string;
  batchNo: string;
  // Snapshot written by computeDocument(); printed values never drift.
  taxable: number;
  cgst: number;
  sgst: number;
  utgst: number;
  igst: number;
  cess: number;
  total: number;
}

export interface DocTotals {
  /** Sum of qty x rate before discount (tax-exclusive). */
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  utgst: number;
  igst: number;
  cess: number;
  tax: number;
  roundOff: number;
  /** Invoice value: taxable + tax + roundOff. */
  total: number;
  /** TDS deducted by the counter-party (sales) or by us (purchases). */
  tds: number;
  /** TCS collected on top of the invoice value. */
  tcs: number;
  /** Amount actually receivable / payable: total + tcs - tds. */
  net: number;
}

export interface PartySnapshot {
  name: string;
  gstin: string;
  pan: string;
  registration: PartyRegistration;
  address: Address;
  phone: string;
  email: string;
}

export interface ShipTo {
  name: string;
  gstin: string;
  address: Address;
}

export interface DispatchDetails {
  buyerOrderNo: string;
  buyerOrderDate: string;
  dispatchDocNo: string;
  deliveryNoteDate: string;
  dispatchedThrough: string;
  destination: string;
  transportMode: '' | 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';
  vehicleNo: string;
  vehicleType: 'REGULAR' | 'ODC';
  transporterId: string;
  transporterName: string;
  transportDocNo: string;
  transportDocDate: string;
  distanceKm: number;
  termsOfDelivery: string;
  ewayBillNo: string;
  exportPortPincode?: string;
  exportPortStateCode?: string;
}

export interface TaxDeduction {
  /** Section code from src/core/tds.ts, e.g. '194C' or '206C(1H)'. */
  section: string;
  rate: number;
  base: number;
  amount: number;
}

export type RecurringFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export interface RecurringRule {
  enabled: boolean;
  frequency: RecurringFrequency;
  /** Date the next copy is due. */
  nextDate: ISODate;
  /** Stop after this date ('' = no end). */
  endDate: ISODate | '';
}

export type CreditNoteReason = 'SALES_RETURN' | 'POST_SALE_DISCOUNT' | 'DEFICIENCY' | 'CORRECTION' | 'OTHER';

export interface SalesDocument extends Timestamps {
  id: ID;
  businessId: ID;
  docType: DocType;
  status: DocStatus;
  /** '' while a draft has not been numbered yet. */
  number: string;
  date: ISODate;
  dueDate: ISODate | '';
  partyId: string;
  party: PartySnapshot;
  shipTo: ShipTo | null;
  /** State code of the place of supply; '96' for exports. */
  placeOfSupply: string;
  supplyKind: SupplyKind;
  reverseCharge: boolean;
  /** EXPORT / SEZ only: true = with payment of IGST, false = under LUT/bond. */
  exportWithTax: boolean;
  lutNumber: string;
  portCode: string;
  shippingBillNo: string;
  shippingBillDate: string;
  /**
   * GSTIN of the e-commerce operator (Amazon, Flipkart, Meesho...) the sale went through, which
   * collects TCS under section 52 of the CGST Act. Reported in GSTR-1 Table 14. Empty or missing
   * when the sale was made directly (older records do not have the field).
   */
  ecoGstin?: string;
  currency: string;
  /** INR per 1 unit of `currency` (1 for INR). */
  exchangeRate: number;
  pricesIncludeTax: boolean;
  roundOff: boolean;
  items: LineItem[];
  totals: DocTotals;
  tds: TaxDeduction | null;
  tcs: TaxDeduction | null;
  /** Credit/debit note -> original invoice; converted invoice -> source challan/quotation. */
  refDocId: string;
  refDocNumber: string;
  refDocDate: string;
  creditNoteReason: CreditNoteReason | '';
  /** Set on a challan/quotation/proforma once converted to an invoice. */
  convertedToId: string;
  /**
   * Whether this document moves stock. False for an invoice converted from a
   * delivery challan (the challan already moved it) and for credit notes that
   * are only price adjustments.
   */
  stockApplied: boolean;
  dispatch: DispatchDetails;
  recurring: RecurringRule | null;
  /** Template document this copy was generated from. */
  recurringSourceId: string;
  bankAccountId: string;
  upiAccountId: string;
  notes: string;
  terms: string;
  /** Per-document template override ('' = business default). */
  template: TemplateId | '';
  cancelReason: string;
  cancelledAt: ISODateTime | '';
}

// ---------------------------------------------------------------- money in / out

export type PaymentMode = 'CASH' | 'BANK' | 'UPI' | 'CHEQUE' | 'CARD' | 'OTHER';

/** Stored in the `receipts` collection: money received (IN) or paid (OUT). */
export interface PaymentRecord extends Timestamps {
  id: ID;
  businessId: ID;
  direction: 'IN' | 'OUT';
  number: string;
  date: ISODate;
  partyId: string;
  partyName: string;
  /** Invoice id (IN) or purchase bill id (OUT); '' = on account / advance. */
  docId: string;
  /** In `currency`. */
  amount: number;
  /**
   * Currency of `amount` (ISO 4217). Records saved before 2026-11-07 have none: they are in the
   * linked document's currency at that document's rate, or in the book currency when not linked
   * (see paymentFx in src/core/accounting/postings.ts).
   */
  currency?: string;
  /** Book currency per 1 unit of `currency` on the payment date (1 for the book currency). */
  exchangeRate?: number;
  mode: PaymentMode;
  /** Required for BANK / UPI / CHEQUE / CARD; '' means cash. */
  bankAccountId: string;
  reference: string;
  notes: string;
}

export type ItcCategory =
  | 'INPUTS'
  | 'CAPITAL_GOODS'
  | 'INPUT_SERVICES'
  | 'IMPORT_GOODS'
  | 'IMPORT_SERVICES'
  | 'INELIGIBLE';

export interface PurchaseBill extends Timestamps {
  id: ID;
  businessId: ID;
  status: 'FINAL' | 'CANCELLED';
  supplierId: string;
  supplier: PartySnapshot;
  /** Supplier's invoice number as printed on their bill. */
  billNo: string;
  billDate: ISODate;
  receivedDate: ISODate | '';
  dueDate: ISODate | '';
  placeOfSupply: string;
  supplyKind: SupplyKind;
  reverseCharge: boolean;
  pricesIncludeTax: boolean;
  roundOff: boolean;
  currency: string;
  exchangeRate: number;
  items: LineItem[];
  totals: DocTotals;
  itcCategory: ItcCategory;
  /** TDS we deduct from the supplier (194C/194J/194Q ...). */
  tds: TaxDeduction | null;
  attachmentDataUrl: string;
  ocrText: string;
  notes: string;
}

export type ExpensePaidVia = 'CASH' | 'BANK' | 'UPI' | 'CARD' | 'CREDIT';

export interface Expense extends Timestamps {
  id: ID;
  businessId: ID;
  date: ISODate;
  /** Expense ledger: a `sys:exp-*` id from src/core/ledgers.ts or a custom ledger id. */
  ledgerId: string;
  description: string;
  vendorName: string;
  vendorGstin: string;
  billNo: string;
  supplyKind: 'INTRA_STATE' | 'INTER_STATE' | 'NON_GST';
  taxable: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  itcEligible: boolean;
  paidVia: ExpensePaidVia;
  bankAccountId: string;
  tds: TaxDeduction | null;
  notes: string;
}

// ---------------------------------------------------------------- accounting

export type VoucherType = 'PAYMENT' | 'RECEIPT' | 'CONTRA' | 'JOURNAL';

export interface VoucherLine {
  ledgerId: string;
  dr: number;
  cr: number;
  /** Optional bill-wise allocation: invoice / purchase id. */
  docId: string;
  note: string;
}

export interface Voucher extends Timestamps {
  id: ID;
  businessId: ID;
  type: VoucherType;
  number: string;
  date: ISODate;
  narration: string;
  lines: VoucherLine[];
}

export type LedgerGroup =
  | 'CAPITAL'
  | 'RESERVES'
  | 'LOANS'
  | 'CURRENT_LIABILITIES'
  | 'DUTIES_TAXES'
  | 'PROVISIONS'
  | 'SUNDRY_CREDITORS'
  | 'FIXED_ASSETS'
  | 'INVESTMENTS'
  | 'CURRENT_ASSETS'
  | 'SUNDRY_DEBTORS'
  | 'CASH'
  | 'BANK'
  | 'STOCK'
  | 'LOANS_ADVANCES'
  | 'DEPOSITS'
  | 'SALES'
  | 'PURCHASE'
  | 'DIRECT_INCOME'
  | 'DIRECT_EXPENSES'
  | 'INDIRECT_INCOME'
  | 'INDIRECT_EXPENSES'
  | 'SUSPENSE';

/** User-created ledger. System, party and bank ledgers are virtual (see ledgers.ts). */
export interface Ledger extends Timestamps {
  id: ID;
  businessId: ID;
  name: string;
  group: LedgerGroup;
  openingBalance: number;
  openingType: 'DR' | 'CR';
  notes: string;
}

// ---------------------------------------------------------------- settings / trash

export interface PinHash {
  hash: string;
  salt: string;
  iterations: number;
}

export interface AppSettings extends Timestamps {
  id: 'app';
  activeBusinessId: string;
  setupComplete: boolean;
  customUnits: UnitDef[];
  pin: PinHash | null;
  /** Lock after this many idle minutes (0 = never). */
  autoLockMinutes: number;
  lastAutoBackup: ISODate | '';
  lastRecurringRun: ISODate | '';
  drive: { clientId: string; autoUploadPdf: boolean; folderId: string; lastBackupAt: ISODateTime | '' };
  dismissedNotifications: string[];
  schemaVersion: number;
  licenseType?: 'TRIAL' | 'STARTER' | 'ENTERPRISE';
  licenseKey?: string;
  licenseExpiry?: string;
  licenseOwner?: string;
  licenseActivatedAt?: string;
}

export type TrashableCollection = Exclude<CollectionName, 'settings' | 'trash'>;

export interface TrashEntry {
  id: ID;
  collection: TrashableCollection;
  recordId: ID;
  businessId: string;
  /** Human label shown in the Trash bin, e.g. "Invoice INV/26-27/0012". */
  label: string;
  record: unknown;
  deletedAt: ISODateTime;
}

// ---------------------------------------------------------------- collections

export interface CollectionMap {
  businesses: Business;
  clients: Party;
  products: Product;
  godowns: Godown;
  invoices: SalesDocument;
  purchases: PurchaseBill;
  expenses: Expense;
  receipts: PaymentRecord;
  vouchers: Voucher;
  ledgers: Ledger;
  settings: AppSettings;
  trash: TrashEntry;
}

export type CollectionName = keyof CollectionMap;

export const COLLECTIONS: readonly CollectionName[] = [
  'businesses',
  'clients',
  'products',
  'godowns',
  'invoices',
  'purchases',
  'expenses',
  'receipts',
  'vouchers',
  'ledgers',
  'settings',
  'trash',
] as const;

export const SCHEMA_VERSION = 1;
export const APP_ID = 'free-gst-billing';

export type CollectionData = { [K in CollectionName]: CollectionMap[K][] };

export interface DatabaseSnapshot {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: ISODateTime;
  collections: CollectionData;
}
