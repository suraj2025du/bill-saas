/** SAC (services accounting) codes start with 99. */
export function isServiceCode(code: string): boolean {
  return /^99\d*$/.test(code.trim());
}

export interface HsnCheck {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * HSN/SAC must be 4, 6 or 8 digits. Businesses with aggregate turnover above
 * Rs 5 crore must report at least 6 digits; others at least 4.
 */
export function checkHsn(code: string, turnoverAbove5Cr = false): HsnCheck {
  const c = code.trim();
  const out: HsnCheck = { valid: false, errors: [], warnings: [] };
  if (!c) {
    out.errors.push('HSN/SAC code is missing.');
    return out;
  }
  if (!/^\d+$/.test(c)) {
    out.errors.push('HSN/SAC code must contain digits only.');
    return out;
  }
  if (![4, 6, 8].includes(c.length)) {
    out.errors.push('HSN/SAC code must be 4, 6 or 8 digits.');
    return out;
  }
  if (turnoverAbove5Cr && c.length < 6) {
    out.warnings.push('Turnover above Rs 5 crore needs a 6 or 8 digit HSN/SAC code.');
  }
  out.valid = true;
  return out;
}
