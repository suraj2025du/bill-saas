export type Cell = string | number | boolean | null | undefined;

/** Leading characters that make spreadsheet apps evaluate a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  // OWASP CSV injection guard: text that looks like a formula is prefixed with '.
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV. `bom` (default true) makes Excel read UTF-8 (₹, Hindi) correctly. */
export function toCsv(rows: readonly (readonly Cell[])[], bom = true): string {
  const body = rows.map((r) => r.map(escapeCell).join(',')).join('\r\n');
  return (bom ? '\uFEFF' : '') + body;
}

export interface Column<T> {
  header: string;
  value: (row: T) => Cell;
}

export function recordsToRows<T>(records: readonly T[], columns: readonly Column<T>[]): Cell[][] {
  return [columns.map((c) => c.header), ...records.map((r) => columns.map((c) => c.value(r)))];
}

export function recordsToCsv<T>(records: readonly T[], columns: readonly Column<T>[]): string {
  return toCsv(recordsToRows(records, columns));
}
