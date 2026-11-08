import type { UnitDef } from '../model';
import { isServiceCode } from './hsn';

/** Official GST Unique Quantity Codes (UQC) used in the GSTR-1 HSN summary. */
export const UQC_CODES: readonly { code: string; name: string }[] = [
  { code: 'BAG', name: 'Bags' },
  { code: 'BAL', name: 'Bale' },
  { code: 'BDL', name: 'Bundles' },
  { code: 'BKL', name: 'Buckles' },
  { code: 'BOU', name: 'Billion of units' },
  { code: 'BOX', name: 'Box' },
  { code: 'BTL', name: 'Bottles' },
  { code: 'BUN', name: 'Bunches' },
  { code: 'CAN', name: 'Cans' },
  { code: 'CBM', name: 'Cubic metres' },
  { code: 'CCM', name: 'Cubic centimetres' },
  { code: 'CMS', name: 'Centimetres' },
  { code: 'CTN', name: 'Cartons' },
  { code: 'DOZ', name: 'Dozens' },
  { code: 'DRM', name: 'Drums' },
  { code: 'GGK', name: 'Great gross' },
  { code: 'GMS', name: 'Grammes' },
  { code: 'GRS', name: 'Gross' },
  { code: 'GYD', name: 'Gross yards' },
  { code: 'KGS', name: 'Kilograms' },
  { code: 'KLR', name: 'Kilolitre' },
  { code: 'KME', name: 'Kilometre' },
  { code: 'LTR', name: 'Litres' },
  { code: 'MLT', name: 'Millilitre' },
  { code: 'MTR', name: 'Metres' },
  { code: 'MTS', name: 'Metric ton' },
  { code: 'NOS', name: 'Numbers' },
  { code: 'OTH', name: 'Others' },
  { code: 'PAC', name: 'Packs' },
  { code: 'PCS', name: 'Pieces' },
  { code: 'PRS', name: 'Pairs' },
  { code: 'QTL', name: 'Quintal' },
  { code: 'ROL', name: 'Rolls' },
  { code: 'SET', name: 'Sets' },
  { code: 'SQF', name: 'Square feet' },
  { code: 'SQM', name: 'Square metres' },
  { code: 'SQY', name: 'Square yards' },
  { code: 'TBS', name: 'Tablets' },
  { code: 'TGM', name: 'Ten gross' },
  { code: 'THD', name: 'Thousands' },
  { code: 'TON', name: 'Tonnes' },
  { code: 'TUB', name: 'Tubes' },
  { code: 'UGS', name: 'US gallons' },
  { code: 'UNT', name: 'Units' },
  { code: 'YDS', name: 'Yards' },
];

/** UQC reported for services (SAC codes) in the HSN summary. */
export const SERVICE_UQC = 'NA';

const u = (code: string, name: string, uqc: string, decimals: number): UnitDef => ({
  code,
  name,
  uqc,
  decimals,
  custom: false,
});

export const BUILT_IN_UNITS: readonly UnitDef[] = [
  u('NOS', 'Numbers', 'NOS', 0),
  u('PCS', 'Pieces', 'PCS', 0),
  u('KG', 'Kilograms', 'KGS', 3),
  u('GM', 'Grams', 'GMS', 2),
  u('LTR', 'Litres', 'LTR', 3),
  u('ML', 'Millilitres', 'MLT', 0),
  u('MTR', 'Metres', 'MTR', 2),
  u('SQFT', 'Square feet', 'SQF', 2),
  u('SQM', 'Square metres', 'SQM', 2),
  u('HRS', 'Hours', 'OTH', 2),
  u('DAYS', 'Days', 'OTH', 1),
  u('BOX', 'Boxes', 'BOX', 0),
  u('DOZ', 'Dozens', 'DOZ', 2),
  u('SET', 'Sets', 'SET', 0),
  u('PAC', 'Packs', 'PAC', 0),
  u('BAG', 'Bags', 'BAG', 0),
  u('BTL', 'Bottles', 'BTL', 0),
  u('CTN', 'Cartons', 'CTN', 0),
  u('PRS', 'Pairs', 'PRS', 0),
  u('QTL', 'Quintals', 'QTL', 3),
  u('TON', 'Tonnes', 'TON', 3),
  u('UNT', 'Units', 'UNT', 0),
];

export function isValidUqc(code: string): boolean {
  return code === SERVICE_UQC || UQC_CODES.some((q) => q.code === code);
}

/** Unit codes are short upper-case tokens: 'CARAT' -> 'CARAT', ' bundle ' -> 'BUNDLE'. */
export function normalizeUnitCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function allUnits(custom: readonly UnitDef[] = []): UnitDef[] {
  const seen = new Set<string>();
  const out: UnitDef[] = [];
  for (const unit of [...BUILT_IN_UNITS, ...custom]) {
    if (seen.has(unit.code)) continue;
    seen.add(unit.code);
    out.push(unit);
  }
  return out;
}

export function findUnit(code: string, custom: readonly UnitDef[] = []): UnitDef | undefined {
  return allUnits(custom).find((unit) => unit.code === code);
}

/** UQC for the GSTR-1 HSN summary: 'NA' for services, else the unit's mapping (or OTH). */
export function uqcFor(unitCode: string, custom: readonly UnitDef[] = [], hsn = ''): string {
  if (hsn && isServiceCode(hsn)) return SERVICE_UQC;
  const uqc = findUnit(unitCode, custom)?.uqc;
  return uqc && isValidUqc(uqc) ? uqc : 'OTH';
}

/** Create a validated custom unit, e.g. Carat -> CARAT mapped to OTH. */
export function makeCustomUnit(name: string, code: string, uqc: string, decimals = 2): UnitDef {
  const c = normalizeUnitCode(code || name);
  if (!c) throw new Error('Unit code is required.');
  if (!isValidUqc(uqc)) throw new Error(`"${uqc}" is not a valid GST UQC.`);
  return { code: c, name: name.trim() || c, uqc, decimals: Math.min(Math.max(Math.trunc(decimals), 0), 4), custom: true };
}
