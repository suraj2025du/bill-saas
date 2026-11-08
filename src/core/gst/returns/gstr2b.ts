import type { ISODate, PurchaseBill } from '../../model';
import { roundTo, toNumber } from '../../money';
import { normalizeGstin } from '../gstin';
import { fromPortalDate, inr, inrFactor } from './period';

/** One supplier document read from a GSTR-2B (or GSTR-2A) JSON download. */
export interface PortalDoc {
  supplierGstin: string;
  supplierName: string;
  number: string;
  date: ISODate | '';
  type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  value: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  itcAvailable: boolean;
  reverseCharge: boolean;
}

export interface Parsed2b {
  gstin: string;
  period: string;
  docs: PortalDoc[];
  /** Sections present in the file that are not reconciled (amendments, imports...). */
  skipped: string[];
  errors: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

function amounts(o: Obj): Pick<PortalDoc, 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess'> {
  const pick = (src: Obj, ...keys: string[]) => {
    for (const k of keys) if (src[k] !== undefined) return toNumber(src[k]);
    return 0;
  };
  const docLevel = ['txval', 'igst', 'cgst', 'sgst', 'cess'].some((k) => o[k] !== undefined);
  if (docLevel) {
    return { taxable: pick(o, 'txval'), igst: pick(o, 'igst', 'iamt'), cgst: pick(o, 'cgst', 'camt'), sgst: pick(o, 'sgst', 'samt'), cess: pick(o, 'cess', 'csamt') };
  }
  const out = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  for (const it of [...arr(o.items), ...arr(o.itms)]) {
    const d = isObj(it.itm_det) ? it.itm_det : it;
    out.taxable += pick(d, 'txval');
    out.igst += pick(d, 'igst', 'iamt');
    out.cgst += pick(d, 'cgst', 'camt');
    out.sgst += pick(d, 'sgst', 'samt');
    out.cess += pick(d, 'cess', 'csamt');
  }
  return {
    taxable: roundTo(out.taxable),
    igst: roundTo(out.igst),
    cgst: roundTo(out.cgst),
    sgst: roundTo(out.sgst),
    cess: roundTo(out.cess),
  };
}

/** Read a GSTR-2B / GSTR-2A JSON file downloaded from the GST portal. */
export function parse2b(input: unknown): Parsed2b {
  const errors: string[] = [];
  const skipped: string[] = [];
  const docs: PortalDoc[] = [];
  if (!isObj(input)) return { gstin: '', period: '', docs, skipped, errors: ['This is not a GSTR-2B JSON file.'] };
  const root = isObj(input.data) ? input.data : input;
  const data = isObj(root.docdata) ? root.docdata : root;
  const gstin = str(root.gstin) || str(input.gstin);
  const period = str(root.rtnprd) || str(root.fp) || str(input.fp);

  for (const sup of arr(data.b2b)) {
    const ctin = normalizeGstin(str(sup.ctin));
    for (const inv of arr(sup.inv)) {
      docs.push({
        supplierGstin: ctin,
        supplierName: str(sup.trdnm),
        number: str(inv.inum),
        date: fromPortalDate(str(inv.dt) || str(inv.idt)),
        type: 'INVOICE',
        value: toNumber(inv.val),
        ...amounts(inv),
        itcAvailable: str(inv.itcavl).toUpperCase() !== 'N',
        reverseCharge: (str(inv.rev) || str(inv.rchrg)).toUpperCase() === 'Y',
      });
    }
  }
  for (const sup of arr(data.cdnr)) {
    const ctin = normalizeGstin(str(sup.ctin));
    for (const nt of [...arr(sup.nt)]) {
      const t = (str(nt.typ) || str(nt.ntty)).toUpperCase();
      docs.push({
        supplierGstin: ctin,
        supplierName: str(sup.trdnm),
        number: str(nt.ntnum) || str(nt.nt_num),
        date: fromPortalDate(str(nt.dt) || str(nt.nt_dt)),
        type: t === 'D' ? 'DEBIT_NOTE' : 'CREDIT_NOTE',
        value: toNumber(nt.val),
        ...amounts(nt),
        itcAvailable: str(nt.itcavl).toUpperCase() !== 'N',
        reverseCharge: (str(nt.rev) || str(nt.rchrg)).toUpperCase() === 'Y',
      });
    }
  }
  for (const key of ['b2ba', 'cdnra', 'isd', 'isda', 'impg', 'impgsez']) {
    const v = data[key];
    if ((Array.isArray(v) && v.length) || (isObj(v) && Object.keys(v).length)) skipped.push(key);
  }
  if (!docs.length && !skipped.length) errors.push('No B2B invoices or credit/debit notes were found in this file.');
  return { gstin, period, docs, skipped, errors };
}

/**
 * Invoice number for matching: letter and digit groups only, upper case,
 * leading zeros dropped, so "inv/26-27/0045" matches "INV-26-27-45".
 */
export function normalizeDocNo(num: string): string {
  const tokens = num.toUpperCase().match(/[A-Z]+|\d+/g) ?? [];
  return tokens.map((t) => (/^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t)).join('|');
}

export type ReconStatus = 'MATCHED' | 'MISMATCH' | 'MISSING_IN_BOOKS' | 'MISSING_IN_2B';

export interface ReconRow {
  status: ReconStatus;
  supplierGstin: string;
  supplierName: string;
  number: string;
  date: ISODate | '';
  portal: PortalDoc | null;
  bill: PurchaseBill | null;
  differences: string[];
  /** Portal tax minus tax in your books. */
  taxDiff: number;
}

export interface ReconSummary {
  status: ReconStatus;
  count: number;
  portalTax: number;
  booksTax: number;
}

export interface ReconOptions {
  businessId: string;
  /** Bills in this date range are expected in the 2B. */
  from: ISODate;
  to: ISODate;
  /** Allowed difference in rupees for taxable value and tax (default 1). */
  tolerance?: number;
}

const taxOf = (d: { igst: number; cgst: number; sgst: number; cess: number }) => roundTo(d.igst + d.cgst + d.sgst + d.cess);

function billTax(bill: PurchaseBill): { taxable: number; tax: number; igst: number; cgst: number; sgst: number; cess: number } {
  const f = inrFactor(bill);
  const t = bill.totals;
  const igst = inr(t.igst, f);
  const cgst = inr(t.cgst, f);
  const sgst = inr(t.sgst + t.utgst, f);
  const cess = inr(t.cess, f);
  return { taxable: inr(t.taxable, f), tax: roundTo(igst + cgst + sgst + cess), igst, cgst, sgst, cess };
}

const expected = (b: PurchaseBill) =>
  b.status === 'FINAL' && !!b.supplier.gstin && b.itcCategory !== 'IMPORT_GOODS' && b.itcCategory !== 'IMPORT_SERVICES';

/** Match the portal's GSTR-2B documents with the purchase bills in your books. */
export function reconcile2b(portalDocs: readonly PortalDoc[], purchases: readonly PurchaseBill[], opts: ReconOptions): { rows: ReconRow[]; summary: ReconSummary[] } {
  const tol = opts.tolerance ?? 1;
  const bills = purchases.filter((b) => b.businessId === opts.businessId && expected(b));
  const index = new Map<string, PurchaseBill[]>();
  for (const b of bills) {
    const key = `${normalizeGstin(b.supplier.gstin)}|${normalizeDocNo(b.billNo)}`;
    index.set(key, [...(index.get(key) ?? []), b]);
  }
  const used = new Set<string>();
  const rows: ReconRow[] = [];

  for (const p of portalDocs) {
    const key = `${p.supplierGstin}|${normalizeDocNo(p.number)}`;
    const candidates = p.type === 'INVOICE' ? (index.get(key) ?? []).filter((b) => !used.has(b.id)) : [];
    const bill = candidates[0] ?? null;
    if (!bill) {
      rows.push({
        status: 'MISSING_IN_BOOKS',
        supplierGstin: p.supplierGstin,
        supplierName: p.supplierName,
        number: p.number,
        date: p.date,
        portal: p,
        bill: null,
        differences: p.type === 'INVOICE' ? ['Not recorded in your purchase bills.'] : ['Supplier issued a credit/debit note; record the adjustment.'],
        taxDiff: p.type === 'CREDIT_NOTE' ? -taxOf(p) : taxOf(p),
      });
      continue;
    }
    used.add(bill.id);
    const b = billTax(bill);
    const differences: string[] = [];
    const diff = (label: string, portal: number, books: number) => {
      if (Math.abs(portal - books) > tol) differences.push(`${label}: portal ${portal.toFixed(2)}, books ${books.toFixed(2)}`);
    };
    diff('Taxable value', p.taxable, b.taxable);
    diff('IGST', p.igst, b.igst);
    diff('CGST', p.cgst, b.cgst);
    diff('SGST', p.sgst, b.sgst);
    diff('Cess', p.cess, b.cess);
    if (p.date && p.date !== bill.billDate) differences.push(`Date: portal ${p.date}, books ${bill.billDate}`);
    if (p.reverseCharge !== bill.reverseCharge) differences.push('Reverse charge flag differs.');
    if (!p.itcAvailable) differences.push('Portal marks ITC as not available.');
    rows.push({
      status: differences.length ? 'MISMATCH' : 'MATCHED',
      supplierGstin: p.supplierGstin,
      supplierName: p.supplierName || bill.supplier.name,
      number: p.number,
      date: p.date,
      portal: p,
      bill,
      differences,
      taxDiff: roundTo(taxOf(p) - b.tax),
    });
  }

  for (const bill of bills) {
    if (used.has(bill.id) || bill.billDate < opts.from || bill.billDate > opts.to) continue;
    rows.push({
      status: 'MISSING_IN_2B',
      supplierGstin: normalizeGstin(bill.supplier.gstin),
      supplierName: bill.supplier.name,
      number: bill.billNo,
      date: bill.billDate,
      portal: null,
      bill,
      differences: ['Supplier has not reported this bill yet. ITC can be claimed only once it appears in GSTR-2B.'],
      taxDiff: -billTax(bill).tax,
    });
  }

  const order: ReconStatus[] = ['MISMATCH', 'MISSING_IN_BOOKS', 'MISSING_IN_2B', 'MATCHED'];
  rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.supplierName.localeCompare(b.supplierName));
  const summary = order.map((status) => {
    const list = rows.filter((r) => r.status === status);
    return {
      status,
      count: list.length,
      portalTax: roundTo(list.reduce((s, r) => s + (r.portal ? taxOf(r.portal) : 0), 0)),
      booksTax: roundTo(list.reduce((s, r) => s + (r.bill ? billTax(r.bill).tax : 0), 0)),
    };
  });
  return { rows, summary };
}
