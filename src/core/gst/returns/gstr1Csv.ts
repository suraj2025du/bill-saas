import type { Cell } from '../../export/csv';
import { toCsv } from '../../export/csv';
import { stateName } from '../states';
import type { Gstr1DocRow, Gstr1Report, HsnRow } from './gstr1';
import { NIL_LABELS, mergeHsn } from './gstr1';

/**
 * GSTR-1 as one CSV file per table, with the column names of the GST offline tool's Excel
 * template (as also used by india-compliance). Tax amounts are included for checking.
 * The portal JSON stays the file to upload; these CSVs are for review and for other software.
 */
export interface CsvFile {
  name: string;
  text: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-11-05 -> 05-Nov-2026 (offline tool date format). */
export function offlineToolDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : '';
}

/** 27 -> 27-Maharashtra, 96 -> 96-Other Countries. */
export function posLabel(code: string): string {
  if (!code) return '';
  if (code === '96') return '96-Other Countries';
  const name = stateName(code);
  return name ? `${code}-${name}` : code;
}

const INVOICE_TYPE: Record<string, string> = {
  R: 'Regular B2B',
  SEWP: 'SEZ supplies with payment',
  SEWOP: 'SEZ supplies without payment',
  DE: 'Deemed Exp',
};

const yesNo = (v: boolean) => (v ? 'Y' : 'N');
const TAXES = ['Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'];

function b2b(rows: readonly Gstr1DocRow[]): Cell[][] {
  return [
    ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', ...TAXES],
    ...rows.flatMap((d) =>
      d.rates.map((x) => [d.gstin, d.party, d.number, offlineToolDate(d.date), d.value, posLabel(d.pos), yesNo(d.reverseCharge), '', INVOICE_TYPE[d.type] ?? d.type, d.etin, x.rt, x.txval, x.iamt, x.camt, x.samt, x.csamt]),
    ),
  ];
}

function b2cl(rows: readonly Gstr1DocRow[]): Cell[][] {
  return [
    ['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Cess Amount', 'E-Commerce GSTIN'],
    ...rows.flatMap((d) => d.rates.map((x) => [d.number, offlineToolDate(d.date), d.value, posLabel(d.pos), '', x.rt, x.txval, x.iamt, x.csamt, d.etin])),
  ];
}

function exp(rows: readonly Gstr1DocRow[]): Cell[][] {
  return [
    ['Export Type', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Port Code', 'Shipping Bill Number', 'Shipping Bill Date', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Cess Amount'],
    ...rows.flatMap((d) =>
      d.rates.map((x) => [d.type, d.number, offlineToolDate(d.date), d.value, d.portCode, d.shippingBillNo, offlineToolDate(d.shippingBillDate), x.rt, x.txval, x.iamt, x.csamt]),
    ),
  ];
}

function cdnr(rows: readonly Gstr1DocRow[]): Cell[][] {
  return [
    ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', ...TAXES],
    ...rows.flatMap((d) =>
      d.rates.map((x) => [d.gstin, d.party, d.number, offlineToolDate(d.date), d.noteType, posLabel(d.pos), yesNo(d.reverseCharge), INVOICE_TYPE[d.type] ?? d.type, d.value, '', x.rt, x.txval, x.iamt, x.camt, x.samt, x.csamt]),
    ),
  ];
}

function cdnur(rows: readonly Gstr1DocRow[]): Cell[][] {
  return [
    ['UR Type', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Cess Amount'],
    ...rows.flatMap((d) => d.rates.map((x) => [d.type, d.number, offlineToolDate(d.date), d.noteType, d.type === 'B2CL' ? posLabel(d.pos) : '', d.value, '', x.rt, x.txval, x.iamt, x.csamt])),
  ];
}

function hsn(rows: readonly HsnRow[]): Cell[][] {
  return [
    ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', ...TAXES],
    ...rows.map((h) => [h.hsn, h.description, h.uqc, h.qty, h.value, h.rate, h.taxable, h.igst, h.cgst, h.sgst, h.cess]),
  ];
}

/** Every non-empty GSTR-1 table as a CSV file (UTF-8 with BOM so Excel shows Hindi names). */
export function gstr1CsvFiles(r: Gstr1Report): CsvFile[] {
  const files: { name: string; rows: Cell[][] }[] = [];
  const add = (name: string, rows: Cell[][]) => {
    if (rows.length > 1) files.push({ name, rows });
  };
  add('b2b_sez_de.csv', b2b(r.b2b));
  add('b2cl.csv', b2cl(r.b2cl));
  add('b2cs.csv', [
    ['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', ...TAXES, 'E-Commerce GSTIN'],
    ...r.b2cs.map((x) => ['OE', posLabel(x.pos), '', x.rate, x.taxable, x.igst, x.cgst, x.sgst, x.cess, '']),
  ]);
  add('exp.csv', exp(r.exp));
  add('cdnr.csv', cdnr(r.cdnr));
  add('cdnur.csv', cdnur(r.cdnur));
  add('exemp.csv', [
    ['Description', 'Nil Rated Supplies', 'Exempted(other than nil rated/non GST supply)', 'Non-GST Supplies'],
    ...r.nil.map((n) => [NIL_LABELS[n.supplyType], n.nil, n.exempt, n.nonGst]),
  ]);
  if (r.hsnSplit) {
    add('hsn(b2b).csv', hsn(r.hsnB2b));
    add('hsn(b2c).csv', hsn(r.hsnB2c));
  } else {
    add('hsn.csv', hsn(mergeHsn([...r.hsnB2b, ...r.hsnB2c])));
  }
  add('docs.csv', [['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'], ...r.docs.map((d) => [d.label, d.from, d.to, d.total, d.cancelled])]);
  add('eco.csv', [
    ['Nature of Supply', 'GSTIN of E-Commerce Operator', 'Net value of supplies', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess'],
    ...r.eco.map((e) => ['Liable to collect tax u/s 52(TCS)', e.etin, e.value, e.igst, e.cgst, e.sgst, e.cess]),
  ]);
  return files.map((f) => ({ name: f.name, text: toCsv(f.rows) }));
}
