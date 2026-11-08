import { DOC_TYPES } from '../docs/docTypes';
import type { Business, SalesDocument, UnitDef } from '../model';
import { roundTo } from '../money';
import { isServiceCode } from './hsn';
import { isInterState } from './supply';
import { uqcFor } from './units';
import { inr, inrFactor } from './returns/period';

/** E-Way Bill sub-supply types (NIC portal codes). */
export const EWAY_SUB_SUPPLY: Record<number, string> = {
  1: 'Supply',
  3: 'Export',
  4: 'Job Work',
  5: 'For Own Use',
  6: 'Job work Returns',
  7: 'Sales Return',
  8: 'Others',
  9: 'SKD/CKD/Lots',
  10: 'Line Sales',
  11: 'Recipient Not Known',
  12: 'Exhibition or Fairs',
};

export interface EwayOptions {
  /** Defaults: 1 (Supply) for invoices, 3 (Export) for exports, 8 (Others) for challans. */
  subSupplyType?: number;
  subSupplyDesc?: string;
  customUnits?: readonly UnitDef[];
}

export interface EwayResult {
  json: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

export const EWAY_DOC_TYPES: ReadonlySet<SalesDocument['docType']> = new Set(['TAX_INVOICE', 'BILL_OF_SUPPLY', 'DELIVERY_CHALLAN']);

const digits = (s: string) => s.replace(/\D/g, '');
const num = (s: string) => (digits(s) ? Number(digits(s)) : 0);
const slashDate = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const TRANS_MODE: Record<string, string> = { ROAD: '1', RAIL: '2', AIR: '3', SHIP: '4' };
const VEHICLE_RE = /^[A-Z]{2}[0-9]{1,3}[A-Z]{0,3}[0-9]{4}$|^[A-Z]{3}[0-9]{4}$|^DF[0-9A-Z]{5,}$|^TM[0-9A-Z]{5,}$|^(BP|NP)[0-9A-Z]{5,}$/;

/**
 * Bulk-upload JSON for the e-way bill portal (ewaybillgst.gov.in, version
 * 1.0.0621), built from a tax invoice, bill of supply or delivery challan.
 */
export function buildEwayBill(business: Business, doc: SalesDocument, opts: EwayOptions = {}): EwayResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const meta = DOC_TYPES[doc.docType];
  const f = inrFactor(doc);
  const d = doc.dispatch;
  if (!EWAY_DOC_TYPES.has(doc.docType)) errors.push(`An e-way bill is made from an invoice, bill of supply or delivery challan, not a ${meta.label}.`);
  if (doc.status !== 'FINAL') errors.push('Finalize the document first.');
  if (!business.gstin) errors.push('Your GSTIN is missing (Settings > Business).');
  if (!business.pincode) errors.push('Your PIN code is missing (Settings > Business).');
  const goods = doc.items.filter((i) => !isServiceCode(i.hsn));
  if (!goods.length) errors.push('E-way bills are only for goods; every item here is a service.');
  if (d.distanceKm > 4000) errors.push('Distance cannot exceed 4000 km.');
  if (d.transportMode && d.transportMode !== 'ROAD' && !d.transportDocNo) {
    warnings.push('Rail, air and ship movements need the transport document number.');
  }
  const vehicle = d.vehicleNo.toUpperCase().replace(/[\s-]/g, '');
  if (vehicle && !VEHICLE_RE.test(vehicle)) warnings.push(`Vehicle number "${d.vehicleNo}" does not look like a valid registration number.`);
  if (!vehicle && !d.transporterId) warnings.push('Add a vehicle number (Part-B) or a transporter ID; without either the bill is generated with Part-A only.');
  if (inr(doc.totals.total, f) <= 50_000) warnings.push('The consignment is Rs 50,000 or less; an e-way bill is usually optional.');

  const docDateMs = Date.parse(doc.date);
  const todayMs = Date.now();
  if (todayMs - docDateMs > 180 * 24 * 60 * 60 * 1000) {
    errors.push('The document date is more than 180 days in the past.');
  }

  const exported = doc.supplyKind === 'EXPORT';
  if (exported) {
    if (!d.exportPortPincode) errors.push('Export invoices require a port of exit PIN code in dispatch details.');
    if (!d.exportPortStateCode) errors.push('Export invoices require a port of exit State Code in dispatch details.');
  }
  const ship = doc.shipTo;
  const toAddr = ship?.address ?? doc.party.address;
  const toState = exported ? 96 : num(doc.placeOfSupply);
  const actualToState = exported ? num(d.exportPortStateCode || business.stateCode) : num(toAddr.stateCode || doc.placeOfSupply);
  const docType = doc.docType === 'BILL_OF_SUPPLY' ? 'BIL' : doc.docType === 'DELIVERY_CHALLAN' ? 'CHL' : 'INV';
  const subSupplyType = opts.subSupplyType ?? (exported ? 3 : doc.docType === 'DELIVERY_CHALLAN' ? 8 : 1);
  if (subSupplyType === 8 && !opts.subSupplyDesc) warnings.push('Sub-supply type "Others" needs a short description.');
  const sameState = !isInterState(doc.supplyKind);
  const custom = opts.customUnits ?? [];

  const itemList = goods.map((i, idx) => ({
    itemNo: idx + 1,
    productName: i.name.slice(0, 100),
    productDesc: (i.description || i.name).slice(0, 100),
    hsnCode: num(i.hsn),
    quantity: i.qty,
    qtyUnit: uqcFor(i.unit, custom, i.hsn),
    taxableAmount: inr(i.taxable, f),
    sgstRate: sameState && i.sgst + i.utgst > 0 ? i.gstRate / 2 : 0,
    cgstRate: sameState && i.cgst > 0 ? i.gstRate / 2 : 0,
    igstRate: !sameState && i.igst > 0 ? i.gstRate : 0,
    cessRate: i.cess > 0 ? i.cessRate : 0,
    cessNonAdvol: 0,
  }));
  const mainHsn = [...goods].sort((a, b) => b.taxable - a.taxable)[0]?.hsn ?? '';
  const sum = (pick: (i: (typeof goods)[number]) => number) => roundTo(goods.reduce((s, i) => s + inr(pick(i), f), 0));
  const goodsTotal = sum((i) => i.total);
  const otherValue = roundTo(inr(doc.totals.total, f) - goodsTotal);

  const bill: Record<string, unknown> = {
    userGstin: business.gstin,
    supplyType: 'O',
    subSupplyType,
    subSupplyDesc: subSupplyType === 8 ? (opts.subSupplyDesc ?? '').slice(0, 20) : '',
    docType,
    docNo: doc.number,
    docDate: slashDate(doc.date),
    transType: ship ? 2 : 1,
    fromGstin: business.gstin,
    fromTrdName: business.legalName || business.name,
    fromAddr1: business.address1.slice(0, 120),
    fromAddr2: business.address2.slice(0, 120),
    fromPlace: business.city.slice(0, 50),
    fromPincode: num(business.pincode),
    fromStateCode: num(business.stateCode),
    actualFromStateCode: num(business.stateCode),
    toGstin: doc.party.gstin || 'URP',
    toTrdName: (ship?.name || doc.party.name).slice(0, 100),
    toAddr1: toAddr.line1.slice(0, 120),
    toAddr2: toAddr.line2.slice(0, 120),
    toPlace: toAddr.city.slice(0, 50),
    toPincode: exported ? num(d.exportPortPincode || '') : num(toAddr.pincode),
    toStateCode: toState,
    actualToStateCode: actualToState,
    totalValue: sum((i) => i.taxable),
    cgstValue: sum((i) => i.cgst),
    sgstValue: sum((i) => i.sgst + i.utgst),
    igstValue: sum((i) => i.igst),
    cessValue: sum((i) => i.cess),
    TotNonAdvolVal: 0,
    OthValue: otherValue,
    totInvValue: inr(doc.totals.total, f),
    transMode: TRANS_MODE[d.transportMode] ?? '1',
    transDistance: String(Math.max(0, Math.round(d.distanceKm))),
    transporterName: d.transporterName.slice(0, 100),
    transporterId: d.transporterId.toUpperCase(),
    transDocNo: d.transportDocNo.slice(0, 15),
    transDocDate: slashDate(d.transportDocDate),
    vehicleNo: vehicle,
    vehicleType: d.vehicleType === 'ODC' ? 'O' : 'R',
    mainHsnCode: num(mainHsn),
    itemList,
  };
  if (!exported && !num(toAddr.pincode)) errors.push("Customer's PIN code is missing.");
  if (!d.distanceKm) warnings.push('Distance is 0 km: the portal will calculate it from the PIN codes.');
  return { json: { version: '1.0.0621', billLists: [bill] }, errors, warnings };
}
