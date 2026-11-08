import { describe, expect, it } from 'vitest';
import {
  gstinCheckChar,
  isValidGstin,
  isValidPan,
  makeGstin,
  normalizeGstin,
  stateCodeFromGstin,
  validateGstin,
} from '../../../src/core/gst/gstin';
import { checkHsn, isServiceCode } from '../../../src/core/gst/hsn';
import { ALL_GST_RATES, isLegacyRateOn, isValidGstRate, rateOptions } from '../../../src/core/gst/rates';
import {
  FOREIGN_POS,
  SELECTABLE_STATES,
  getState,
  isKnownStateCode,
  isUtgstTerritory,
  stateLabel,
  stateName,
} from '../../../src/core/gst/states';
import { defaultPlaceOfSupply, determineSupplyKind, isInterState, supplyKindLabel } from '../../../src/core/gst/supply';
import {
  BUILT_IN_UNITS,
  allUnits,
  findUnit,
  isValidUqc,
  makeCustomUnit,
  normalizeUnitCode,
  uqcFor,
} from '../../../src/core/gst/units';

describe('GSTIN', () => {
  it('accepts a real GSTIN with a valid checksum', () => {
    const v = validateGstin('27AAPFU0939F1ZV');
    expect(v.valid).toBe(true);
    expect(v.stateCode).toBe('27');
    expect(v.pan).toBe('AAPFU0939F');
    expect(v.warnings).toEqual([]);
  });

  it('rejects typos, wrong length and bad characters', () => {
    expect(validateGstin('27AAPFU0939F1ZW').errors.join()).toMatch(/Checksum/);
    expect(validateGstin('27AAPFU0939F1Z').errors.join()).toMatch(/15 characters/);
    expect(validateGstin('27AAPFU0939F1Z#').errors.join()).toMatch(/letters/);
    expect(validateGstin('').errors.join()).toMatch(/empty/);
    expect(validateGstin('00AAPFU0939F1Z' + gstinCheckChar('00AAPFU0939F1Z')).errors.join()).toMatch(/state code/);
  });

  it('normalizes input and builds checksummed GSTINs', () => {
    expect(normalizeGstin(' 27aapfu0939f1zv ')).toBe('27AAPFU0939F1ZV');
    expect(isValidGstin(' 27aapfu0939f1zv')).toBe(true);
    const g = makeGstin('29', 'aabcu9603r');
    expect(isValidGstin(g)).toBe(true);
    expect(stateCodeFromGstin(g)).toBe('29');
    expect(stateCodeFromGstin('bad')).toBe('');
  });

  it('warns on non-regular formats but keeps them valid when the checksum matches', () => {
    const first = '0717USA00010N1';
    const v = validateGstin(first + gstinCheckChar(first));
    expect(v.valid).toBe(true);
    expect(v.warnings.length).toBe(1);
    expect(v.pan).toBe('');
  });

  it('validates the checksum input', () => {
    expect(() => gstinCheckChar('27AAPFU')).toThrow();
    expect(() => gstinCheckChar('27AAPFU0939F1#')).toThrow();
  });

  it('validates PAN', () => {
    expect(isValidPan('AAPFU0939F')).toBe(true);
    expect(isValidPan('AAPFU0939')).toBe(false);
  });
});

describe('states', () => {
  it('knows UTGST territories', () => {
    expect(isUtgstTerritory('04')).toBe(true);
    expect(isUtgstTerritory('38')).toBe(true);
    expect(isUtgstTerritory('26')).toBe(true);
    expect(isUtgstTerritory('97')).toBe(true);
    expect(isUtgstTerritory('07')).toBe(false); // Delhi has a legislature
    expect(isUtgstTerritory('34')).toBe(false);
    expect(isUtgstTerritory('27')).toBe(false);
  });

  it('labels states', () => {
    expect(stateName('27')).toBe('Maharashtra');
    expect(stateName(FOREIGN_POS)).toBe('Outside India');
    expect(stateName('00')).toBe('');
    expect(stateLabel('29')).toBe('29-Karnataka');
    expect(stateLabel('00')).toBe('00');
    expect(getState('37')?.name).toBe('Andhra Pradesh');
    expect(isKnownStateCode('25')).toBe(true);
    expect(SELECTABLE_STATES.some((st) => st.code === '25' || st.code === '99')).toBe(false);
  });
});

describe('supply kind', () => {
  const base = { businessCountry: 'IN', businessState: '27', partyRegistration: 'REGULAR' as const, partyCountry: 'IN' };

  it('applies CGST+SGST, CGST+UTGST and IGST correctly', () => {
    expect(determineSupplyKind({ ...base, placeOfSupply: '27' })).toBe('INTRA_STATE');
    expect(determineSupplyKind({ ...base, placeOfSupply: '29' })).toBe('INTER_STATE');
    expect(determineSupplyKind({ ...base, businessState: '04', placeOfSupply: '04' })).toBe('INTRA_UT');
    expect(determineSupplyKind({ ...base, placeOfSupply: '' })).toBe('INTRA_STATE');
  });

  it('detects exports, SEZ and non-Indian businesses', () => {
    expect(determineSupplyKind({ ...base, placeOfSupply: FOREIGN_POS })).toBe('EXPORT');
    expect(determineSupplyKind({ ...base, placeOfSupply: '27', partyRegistration: 'OVERSEAS' })).toBe('EXPORT');
    expect(determineSupplyKind({ ...base, placeOfSupply: '27', partyCountry: 'US' })).toBe('EXPORT');
    expect(determineSupplyKind({ ...base, placeOfSupply: '27', partyRegistration: 'SEZ' })).toBe('SEZ');
    expect(determineSupplyKind({ ...base, businessCountry: 'AE', placeOfSupply: '' })).toBe('NON_GST');
  });

  it('derives the default place of supply', () => {
    const party = { gstin: makeGstin('29', 'AACCK1234L'), stateCode: '33', countryCode: 'IN', registration: 'REGULAR' as const };
    expect(defaultPlaceOfSupply('27', party)).toBe('29');
    expect(defaultPlaceOfSupply('27', { ...party, gstin: '' })).toBe('33');
    expect(defaultPlaceOfSupply('27', { ...party, gstin: '', stateCode: '' })).toBe('27');
    expect(defaultPlaceOfSupply('27', { ...party, countryCode: 'US' })).toBe(FOREIGN_POS);
    expect(defaultPlaceOfSupply('27', null)).toBe('27');
  });

  it('describes supply kinds', () => {
    expect(isInterState('SEZ')).toBe(true);
    expect(isInterState('INTRA_UT')).toBe(false);
    for (const k of ['INTRA_STATE', 'INTRA_UT', 'INTER_STATE', 'EXPORT', 'SEZ', 'NON_GST'] as const) {
      expect(supplyKindLabel(k).length).toBeGreaterThan(5);
    }
    expect(supplyKindLabel('EXPORT', false)).toMatch(/LUT/);
    expect(supplyKindLabel('SEZ', false)).toMatch(/LUT/);
  });
});

describe('rates, units, HSN', () => {
  it('knows current, special and legacy slabs', () => {
    expect(isValidGstRate(40)).toBe(true);
    expect(isValidGstRate(13)).toBe(false);
    expect(ALL_GST_RATES).toContain(0.25);
    expect(isLegacyRateOn(12, '2025-10-01')).toBe(true);
    expect(isLegacyRateOn(12, '2025-09-01')).toBe(false);
    expect(isLegacyRateOn(18, '2025-10-01')).toBe(false);
    expect(rateOptions('2026-01-01').slice(0, 4)).toEqual([0, 5, 18, 40]);
    expect(rateOptions('2025-01-01').slice(0, 5)).toEqual([0, 5, 12, 18, 28]);
  });

  it('maps units to UQC', () => {
    expect(uqcFor('KG')).toBe('KGS');
    expect(uqcFor('HRS', [], '998314')).toBe('NA');
    expect(uqcFor('UNKNOWN')).toBe('OTH');
    const carat = makeCustomUnit('Carat', '', 'OTH', 3);
    expect(carat).toMatchObject({ code: 'CARAT', uqc: 'OTH', custom: true, decimals: 3 });
    expect(findUnit('CARAT', [carat])?.name).toBe('Carat');
    expect(allUnits([carat, BUILT_IN_UNITS[0]!]).length).toBe(BUILT_IN_UNITS.length + 1);
    expect(() => makeCustomUnit('X', 'X', 'BAD')).toThrow();
    expect(() => makeCustomUnit('', '', 'OTH')).toThrow();
    expect(normalizeUnitCode(' bundle-1 ')).toBe('BUNDLE1');
    expect(isValidUqc('NA')).toBe(true);
    expect(isValidUqc('XYZ')).toBe(false);
  });

  it('checks HSN/SAC codes', () => {
    expect(checkHsn('8539').valid).toBe(true);
    expect(checkHsn('85395000').valid).toBe(true);
    expect(checkHsn('853').errors[0]).toMatch(/4, 6 or 8/);
    expect(checkHsn('85A9').errors[0]).toMatch(/digits/);
    expect(checkHsn('').errors[0]).toMatch(/missing/);
    expect(checkHsn('8539', true).warnings[0]).toMatch(/6 or 8/);
    expect(isServiceCode('998314')).toBe(true);
    expect(isServiceCode('8539')).toBe(false);
  });
});
