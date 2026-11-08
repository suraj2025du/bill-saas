import { dmyToISO } from '../../core/dates';
import { isValidGstin, normalizeGstin } from '../../core/gst/gstin';

export interface OcrResult {
  text: string;
  gstins: string[];
  billNo: string;
  date: string;
  total: number;
  taxable: number;
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

function amountOf(s: string): number {
  const m = s.replace(/[,\s]/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : 0;
}

/** Common OCR confusions inside a GSTIN-shaped token. */
function fixGstin(token: string): string {
  const t = token.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (t.length !== 15) return t;
  const chars = t.split('');
  const digitAt = [0, 1, 7, 8, 9, 10];
  const letterAt = [2, 3, 4, 5, 6, 11];
  for (const i of digitAt) chars[i] = chars[i].replace('O', '0').replace('I', '1').replace('S', '5').replace('B', '8');
  for (const i of letterAt) chars[i] = chars[i].replace('0', 'O').replace('1', 'I').replace('5', 'S').replace('8', 'B');
  return chars.join('');
}

/** Pull the GSTINs, bill number, date and amounts out of OCR text. */
export function parseBillText(text: string): OcrResult {
  const upper = text.toUpperCase();
  const gstins = [
    ...new Set(
      (upper.match(/[0-9OI]{2}[A-Z0-9]{5}[0-9OISB]{4}[A-Z0-9][1-9A-Z]Z[0-9A-Z]/g) ?? [])
        .map(fixGstin)
        .map(normalizeGstin)
        .filter(isValidGstin),
    ),
  ];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let billNo = '';
  for (const l of lines) {
    const m = l.match(/(?:invoice|inv|bill|tax\s*invoice)\s*(?:no|number|#)\.?\s*[:-]?\s*([A-Z0-9][A-Z0-9/-]{0,19})/i);
    if (m) {
      billNo = m[1].replace(/[^A-Za-z0-9/-]/g, '');
      break;
    }
  }

  let date = '';
  const dm = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (dm) {
    const y = dm[3].length === 2 ? `20${dm[3]}` : dm[3];
    date = dmyToISO(`${dm[1].padStart(2, '0')}/${dm[2].padStart(2, '0')}/${y}`) ?? '';
  }
  if (!date) {
    const mm = text.match(/\b(\d{1,2})[\s-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,-]*(\d{4})\b/i);
    if (mm) date = `${mm[3]}-${MONTHS[mm[2].toLowerCase()]}-${mm[1].padStart(2, '0')}`;
  }

  const find = (re: RegExp) => {
    for (const l of [...lines].reverse()) {
      if (re.test(l)) {
        const nums = l.match(/[\d,]+\.\d{2}|[\d,]{3,}/g);
        if (nums?.length) return amountOf(nums[nums.length - 1]);
      }
    }
    return 0;
  };
  let total = find(/grand\s*total|total\s*amount|net\s*amount|invoice\s*value|amount\s*payable|total\s*\(?inr/i);
  if (!total) {
    const all = (text.match(/[\d,]+\.\d{2}/g) ?? []).map(amountOf);
    total = all.length ? Math.max(...all) : 0;
  }
  const taxable = find(/taxable\s*(?:value|amount)|sub\s*total/i);
  return { text, gstins, billNo, date, total, taxable: taxable && taxable <= total ? taxable : 0 };
}

/** Run the offline OCR engine (files in /ocr) on a bill image. */
export async function readBillImage(file: File, onProgress?: (p: number) => void): Promise<OcrResult> {
  if (!file.type.startsWith('image/')) throw new Error('OCR works on photos or scans (JPG, PNG, WebP). For PDFs, take a screenshot of the bill first.');
  const { createWorker } = await import('tesseract.js');
  const base = new URL('ocr/', document.baseURI).href;
  const worker = await createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base.replace(/\/$/, ''),
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(file);
    return parseBillText(data.text);
  } finally {
    await worker.terminate();
  }
}
