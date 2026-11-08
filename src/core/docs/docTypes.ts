import type { DocType } from '../model';

export interface DocTypeMeta {
  type: DocType;
  label: string;
  shortLabel: string;
  defaultPrefix: string;
  /** False for Bill of Supply: GST is removed automatically. */
  chargesTax: boolean;
  /** Stock effect when FINAL: OUT reduces, IN restores, NONE ignores. */
  stock: 'OUT' | 'IN' | 'NONE';
  /** Posts to the books (sales/receivables/output tax). */
  postsToAccounts: boolean;
  /** Reported in GSTR-1 outward supply tables. */
  inGstr1: boolean;
  /** Has a balance that customers pay against. */
  payable: boolean;
  /** Document types this one can be converted into with one click. */
  convertsTo: DocType[];
}

export const DOC_TYPES: Record<DocType, DocTypeMeta> = {
  TAX_INVOICE: {
    type: 'TAX_INVOICE',
    label: 'Tax Invoice',
    shortLabel: 'Invoice',
    defaultPrefix: 'INV/',
    chargesTax: true,
    stock: 'OUT',
    postsToAccounts: true,
    inGstr1: true,
    payable: true,
    convertsTo: [],
  },
  BILL_OF_SUPPLY: {
    type: 'BILL_OF_SUPPLY',
    label: 'Bill of Supply',
    shortLabel: 'Bill of Supply',
    defaultPrefix: 'BOS/',
    chargesTax: false,
    stock: 'OUT',
    postsToAccounts: true,
    inGstr1: true,
    payable: true,
    convertsTo: [],
  },
  QUOTATION: {
    type: 'QUOTATION',
    label: 'Quotation',
    shortLabel: 'Quotation',
    defaultPrefix: 'QTN/',
    chargesTax: true,
    stock: 'NONE',
    postsToAccounts: false,
    inGstr1: false,
    payable: false,
    convertsTo: ['TAX_INVOICE', 'PROFORMA', 'BILL_OF_SUPPLY'],
  },
  PROFORMA: {
    type: 'PROFORMA',
    label: 'Proforma Invoice',
    shortLabel: 'Proforma',
    defaultPrefix: 'PRO/',
    chargesTax: true,
    stock: 'NONE',
    postsToAccounts: false,
    inGstr1: false,
    payable: false,
    convertsTo: ['TAX_INVOICE', 'BILL_OF_SUPPLY'],
  },
  CREDIT_NOTE: {
    type: 'CREDIT_NOTE',
    label: 'Credit Note',
    shortLabel: 'Credit Note',
    defaultPrefix: 'CN/',
    chargesTax: true,
    stock: 'IN',
    postsToAccounts: true,
    inGstr1: true,
    payable: false,
    convertsTo: [],
  },
  DEBIT_NOTE: {
    type: 'DEBIT_NOTE',
    label: 'Debit Note',
    shortLabel: 'Debit Note',
    defaultPrefix: 'DN/',
    chargesTax: true,
    stock: 'NONE',
    postsToAccounts: true,
    inGstr1: true,
    payable: true,
    convertsTo: [],
  },
  DELIVERY_CHALLAN: {
    type: 'DELIVERY_CHALLAN',
    label: 'Delivery Challan',
    shortLabel: 'Challan',
    defaultPrefix: 'DC/',
    chargesTax: true,
    stock: 'OUT',
    postsToAccounts: false,
    inGstr1: false,
    payable: false,
    convertsTo: ['TAX_INVOICE', 'BILL_OF_SUPPLY'],
  },
};

export const DOC_TYPE_LIST: readonly DocType[] = Object.keys(DOC_TYPES) as DocType[];

export function docLabel(type: DocType): string {
  return DOC_TYPES[type].label;
}
