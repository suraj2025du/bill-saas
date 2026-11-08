import { addDays, daysBetween, todayISO } from '../dates';
import { emptyDispatch, emptyTotals } from '../factories';
import { newId, nowISO } from '../ids';
import type { CreditNoteReason, DocType, PaymentRecord, SalesDocument, Voucher } from '../model';
import { DOC_TYPES } from './docTypes';

export interface Check {
  ok: boolean;
  reason: string;
}

const ok: Check = { ok: true, reason: '' };
const no = (reason: string): Check => ({ ok: false, reason });

export function canEdit(doc: SalesDocument): Check {
  if (doc.status === 'CANCELLED') return no('A cancelled document cannot be edited.');
  return ok;
}

/** The first voucher with a bill-wise line set against `docId`. */
export function voucherAgainst(vouchers: readonly Voucher[], docId: string): Voucher | undefined {
  return vouchers.find((v) => v.lines.some((l) => l.docId === docId));
}

/** Cancel rules: no double cancel, no orphaned conversions, no payments or bill-wise vouchers left behind. */
export function canCancel(doc: SalesDocument, all: readonly SalesDocument[], payments: readonly PaymentRecord[], vouchers: readonly Voucher[]): Check {
  if (doc.status === 'CANCELLED') return no('Already cancelled.');
  if (doc.status === 'DRAFT') return no('Drafts are deleted, not cancelled.');
  if (doc.convertedToId) {
    const target = all.find((d) => d.id === doc.convertedToId);
    if (target && target.status !== 'CANCELLED') {
      return no(`Converted to ${DOC_TYPES[target.docType].shortLabel} ${target.number}. Cancel that first.`);
    }
  }
  if (payments.some((p) => p.docId === doc.id)) return no('Payments are recorded against it. Delete those payments first.');
  // Review Y12: a receipt voucher set against the invoice pays it just like a payment does.
  const voucher = voucherAgainst(vouchers, doc.id);
  if (voucher) return no(`Voucher ${voucher.number} is set against it (bill-wise). Change or delete that voucher first.`);
  const notes = all.filter((d) => d.refDocId === doc.id && d.docType === 'CREDIT_NOTE' && d.status === 'FINAL');
  if (notes.length) return no('Credit notes exist against it. Cancel them first.');
  return ok;
}

export function cancelDocument(doc: SalesDocument, reason: string): SalesDocument {
  const now = nowISO();
  return { ...doc, status: 'CANCELLED', cancelReason: reason.trim(), cancelledAt: now, updatedAt: now };
}

export function canConvert(source: SalesDocument, target: DocType): Check {
  if (source.status !== 'FINAL') return no('Finalize the document before converting it.');
  if (source.convertedToId) return no('Already converted.');
  if (!DOC_TYPES[source.docType].convertsTo.includes(target)) {
    return no(`${DOC_TYPES[source.docType].label} cannot become a ${DOC_TYPES[target].label}.`);
  }
  return ok;
}

function freshCopy(source: SalesDocument, docType: DocType): SalesDocument {
  const now = nowISO();
  const date = todayISO();
  const dueOffset = source.dueDate ? Math.max(0, daysBetween(source.date, source.dueDate)) : 15;
  return {
    ...source,
    id: newId('doc'),
    docType,
    status: 'DRAFT',
    number: '',
    date,
    dueDate: DOC_TYPES[docType].payable ? addDays(date, dueOffset) : '',
    items: source.items.map((i) => ({ ...i, id: newId('li') })),
    totals: { ...emptyTotals(), ...source.totals },
    dispatch: emptyDispatch(),
    refDocId: '',
    refDocNumber: '',
    refDocDate: '',
    creditNoteReason: '',
    convertedToId: '',
    stockApplied: DOC_TYPES[docType].stock !== 'NONE',
    recurring: null,
    recurringSourceId: '',
    cancelReason: '',
    cancelledAt: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * One-click conversion (challan / quotation / proforma -> invoice).
 * An invoice made from a delivery challan does not move stock again.
 */
export function convertDocument(source: SalesDocument, target: DocType): SalesDocument {
  const check = canConvert(source, target);
  if (!check.ok) throw new Error(check.reason);
  return {
    ...freshCopy(source, target),
    refDocId: source.id,
    refDocNumber: source.number,
    refDocDate: source.date,
    stockApplied: source.docType === 'DELIVERY_CHALLAN' ? false : DOC_TYPES[target].stock !== 'NONE',
  };
}

/** Mark the source as converted once the new document is saved. */
export function markConverted(source: SalesDocument, targetId: string): SalesDocument {
  return { ...source, convertedToId: targetId, updatedAt: nowISO() };
}

/** Draft credit note against an invoice. Goods returned restores stock; a price adjustment does not. */
export function createCreditNote(invoice: SalesDocument, reason: CreditNoteReason, goodsReturned: boolean): SalesDocument {
  if (invoice.status !== 'FINAL') throw new Error('Credit notes can only be issued against a final invoice.');
  if (invoice.docType !== 'TAX_INVOICE' && invoice.docType !== 'BILL_OF_SUPPLY') {
    throw new Error('Credit notes are issued against tax invoices or bills of supply.');
  }
  return {
    ...freshCopy(invoice, 'CREDIT_NOTE'),
    refDocId: invoice.id,
    refDocNumber: invoice.number,
    refDocDate: invoice.date,
    creditNoteReason: reason,
    stockApplied: goodsReturned,
    tds: null,
    tcs: null,
  };
}

/** New draft with the same party and items. */
export function duplicateDocument(doc: SalesDocument): SalesDocument {
  return freshCopy(doc, doc.docType);
}
