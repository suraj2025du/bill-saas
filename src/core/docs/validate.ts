import { fyOf, isValidISODate } from '../dates';
import { checkHsn } from '../gst/hsn';
import { validateGstin } from '../gst/gstin';
import { isLegacyRateOn, isValidGstRate } from '../gst/rates';
import { isInterState } from '../gst/supply';
import type { Business, SalesDocument } from '../model';
import { DOC_TYPES } from './docTypes';
import { validateDocNumber } from './numbering';

export interface Issue {
  level: 'error' | 'warning';
  field: string;
  message: string;
}

/** E-way bill is generally required for movement of goods above this value. */
export const EWAY_BILL_THRESHOLD = 50_000;

const NEEDS_GSTIN = new Set(['REGULAR', 'COMPOSITION', 'SEZ', 'UIN']);

/** Errors block finalizing; warnings are shown but allowed. */
export function validateSalesDocument(doc: SalesDocument, business: Business, finalizing = true): Issue[] {
  const issues: Issue[] = [];
  const err = (field: string, message: string) => issues.push({ level: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ level: 'warning', field, message });
  const meta = DOC_TYPES[doc.docType];
  const indian = business.countryCode === 'IN';
  const gstDoc = indian && meta.chargesTax;

  if (!isValidISODate(doc.date)) err('date', 'Enter a valid document date.');
  if (doc.dueDate && isValidISODate(doc.date) && doc.dueDate < doc.date) warn('dueDate', 'Due date is before the document date.');
  if (finalizing) for (const m of validateDocNumber(doc.number)) err('number', m);

  if (!doc.party.name.trim()) err('party', 'Select or enter the customer name.');
  if (doc.party.gstin) {
    const g = validateGstin(doc.party.gstin);
    for (const m of g.errors) err('party.gstin', `Customer GSTIN: ${m}`);
    for (const m of g.warnings) warn('party.gstin', `Customer GSTIN: ${m}`);
  } else if (indian && NEEDS_GSTIN.has(doc.party.registration)) {
    err('party.gstin', 'A registered customer needs a GSTIN (or change the registration type).');
  }

  if (indian && doc.docType === 'TAX_INVOICE' && business.gstRegistration !== 'REGULAR') {
    err('docType', 'Composition and unregistered businesses must issue a Bill of Supply, not a Tax Invoice.');
  }
  if (indian && !doc.placeOfSupply) err('placeOfSupply', 'Place of supply is required.');
  if ((doc.supplyKind === 'EXPORT' || doc.currency !== 'INR') && !(doc.exchangeRate > 0)) {
    err('exchangeRate', 'Enter the exchange rate (INR per unit of the invoice currency).');
  }
  if ((doc.supplyKind === 'EXPORT' || doc.supplyKind === 'SEZ') && !doc.exportWithTax && !doc.lutNumber.trim()) {
    warn('lutNumber', 'Zero-rated supply without IGST needs a LUT/bond reference.');
  }
  if (doc.ecoGstin) {
    if (!validateGstin(doc.ecoGstin).valid) err('ecoGstin', 'E-commerce operator GSTIN is not valid.');
    else if (doc.reverseCharge) warn('ecoGstin', 'A reverse-charge sale through an e-commerce operator is not reported in GSTR-1 Table 14 by this app.');
    if (business.gstin && doc.ecoGstin === business.gstin) err('ecoGstin', 'The e-commerce operator GSTIN cannot be your own GSTIN.');
  }

  if (doc.items.length === 0) err('items', 'Add at least one item.');
  doc.items.forEach((item, i) => {
    const row = `Item ${i + 1}`;
    if (!item.name.trim()) err(`items.${i}.name`, `${row}: name is required.`);
    if (!(item.qty > 0)) err(`items.${i}.qty`, `${row}: quantity must be more than 0.`);
    if (item.rate < 0) err(`items.${i}.rate`, `${row}: rate cannot be negative.`);
    if (gstDoc) {
      if (!isValidGstRate(item.gstRate)) err(`items.${i}.gstRate`, `${row}: ${item.gstRate}% is not a valid GST rate.`);
      else if (isLegacyRateOn(item.gstRate, doc.date)) {
        warn(`items.${i}.gstRate`, `${row}: the ${item.gstRate}% slab was removed for most goods on 22 Sep 2025.`);
      }
    }
    if (indian) {
      const h = checkHsn(item.hsn);
      const strict = meta.inGstr1 && business.gstRegistration === 'REGULAR';
      for (const m of h.errors) (strict ? err : warn)(`items.${i}.hsn`, `${row}: ${m}`);
    }
    if (item.cessRate > 0) {
      if (doc.date >= '2026-02-01') {
        err(`items.${i}.cessRate`, `${row}: Compensation cess ended on 1 February 2026 and cannot be charged.`);
      } else if (doc.date >= '2025-09-22') {
        const hsnClean = (item.hsn || '').replace(/\s/g, '');
        const isTobaccoOrPanMasala = hsnClean.startsWith('24') || hsnClean.startsWith('21069020');
        if (!isTobaccoOrPanMasala) {
          warn(`items.${i}.cessRate`, `${row}: Compensation cess was removed for non-tobacco goods on 22 Sep 2025.`);
        }
      }
    }
  });

  if (doc.docType === 'CREDIT_NOTE' || doc.docType === 'DEBIT_NOTE') {
    if (!doc.refDocId && (!doc.refDocNumber || !doc.refDocDate)) {
      err('refDoc', 'Credit/debit notes must cite the original invoice (serial number and date).');
    } else if (doc.docType === 'CREDIT_NOTE' && doc.refDocDate && isValidISODate(doc.refDocDate)) {
      const fy = fyOf(doc.refDocDate, business.fyStartMonth || 4);
      const deadline = `${fy.startYear + 1}-11-30`;
      if (doc.date > deadline) {
        err('date', `Credit note date cannot be after 30 November of the next financial year (${deadline}) under Section 34(2).`);
      }
    }
  }
  if (
    indian &&
    meta.stock === 'OUT' &&
    isInterState(doc.supplyKind) &&
    doc.totals.total * (doc.exchangeRate || 1) > EWAY_BILL_THRESHOLD &&
    !doc.dispatch.ewayBillNo
  ) {
    warn('dispatch.ewayBillNo', 'Goods above Rs 50,000: an E-Way Bill is usually required.');
  }
  return issues;
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
