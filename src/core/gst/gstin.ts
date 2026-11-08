import { getState } from './states';

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Regular taxpayer: 2-digit state + 10-char PAN + entity code + 'Z' + checksum. */
const REGULAR_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** Check character for the first 14 characters (Luhn mod-36, as used by GSTN). */
export function gstinCheckChar(first14: string): string {
  const s = first14.toUpperCase();
  if (s.length !== 14) throw new Error('GSTIN checksum needs exactly 14 characters');
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARSET.indexOf(s[i]!);
    if (v < 0) throw new Error(`Invalid GSTIN character: ${s[i]}`);
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36]!;
}

export interface GstinValidation {
  valid: boolean;
  normalized: string;
  stateCode: string;
  pan: string;
  errors: string[];
  warnings: string[];
}

export function normalizeGstin(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/** Fully offline GSTIN check: length, characters, state code and checksum. */
export function validateGstin(input: string): GstinValidation {
  const g = normalizeGstin(input ?? '');
  const result: GstinValidation = { valid: false, normalized: g, stateCode: '', pan: '', errors: [], warnings: [] };
  if (!g) {
    result.errors.push('GSTIN is empty.');
    return result;
  }
  if (g.length !== 15) {
    result.errors.push(`GSTIN must be 15 characters (got ${g.length}).`);
    return result;
  }
  if (!/^[0-9A-Z]{15}$/.test(g)) {
    result.errors.push('GSTIN may contain only letters A-Z and digits 0-9.');
    return result;
  }
  const state = g.slice(0, 2);
  if (!getState(state)) result.errors.push(`"${state}" is not a valid GST state code.`);
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) {
    result.errors.push('Checksum does not match: the GSTIN has a typo.');
  }
  if (REGULAR_RE.test(g)) {
    result.pan = g.slice(2, 12);
  } else {
    result.warnings.push('Not a regular taxpayer format (UIN, NRTP or TDS/TCS registration?). Please double-check.');
  }
  result.stateCode = getState(state) ? state : '';
  result.valid = result.errors.length === 0;
  return result;
}

export function isValidGstin(input: string): boolean {
  return validateGstin(input).valid;
}

export function stateCodeFromGstin(input: string): string {
  const v = validateGstin(input);
  return v.valid ? v.stateCode : '';
}

export function isValidPan(pan: string): boolean {
  return PAN_RE.test(pan.trim().toUpperCase());
}

/** Build a GSTIN with a correct checksum (used for sample data and tests). */
export function makeGstin(stateCode: string, pan: string, entity = '1'): string {
  const first14 = `${stateCode}${pan.toUpperCase()}${entity}Z`;
  return first14 + gstinCheckChar(first14);
}
