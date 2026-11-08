import type { Cell } from './csv';

export interface Sheet {
  name: string;
  rows: readonly (readonly Cell[])[];
  /** Make the first row bold (default true). */
  header?: boolean;
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function xml(text: string): string {
  return (
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Strip characters that are illegal in XML 1.0.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  );
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel sheet names: max 31 chars, none of []:*?/\ */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet').slice(0, 31);
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function sheetXml(sheet: Sheet): string {
  const bold = sheet.header !== false;
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnLetter(c)}${r + 1}`;
          const style = bold && r === 0 ? ' s="1"' : '';
          if (value === null || value === undefined || value === '') return '';
          if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}"${style}><v>${value}</v></c>` : '';
          const text = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Build an .xlsx workbook (one or more sheets) as bytes. */
export async function buildXlsx(sheets: readonly Sheet[]): Promise<Uint8Array> {
  if (!sheets.length) throw new Error('A workbook needs at least one sheet.');
  // Loaded on demand: the zip library is only needed when a file is exported.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets>${names
      .map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
