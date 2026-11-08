export interface GstState {
  code: string;
  name: string;
  /** Union territory. */
  ut: boolean;
  /** Union territory WITHOUT legislature: intra-UT supplies use CGST + UTGST. */
  utgst: boolean;
  /** Old code kept only so historical GSTINs still validate. */
  legacy: boolean;
}

const s = (code: string, name: string, ut = false, utgst = false, legacy = false): GstState => ({
  code,
  name,
  ut,
  utgst,
  legacy,
});

export const GST_STATES: readonly GstState[] = [
  s('01', 'Jammu and Kashmir', true),
  s('02', 'Himachal Pradesh'),
  s('03', 'Punjab'),
  s('04', 'Chandigarh', true, true),
  s('05', 'Uttarakhand'),
  s('06', 'Haryana'),
  s('07', 'Delhi', true),
  s('08', 'Rajasthan'),
  s('09', 'Uttar Pradesh'),
  s('10', 'Bihar'),
  s('11', 'Sikkim'),
  s('12', 'Arunachal Pradesh'),
  s('13', 'Nagaland'),
  s('14', 'Manipur'),
  s('15', 'Mizoram'),
  s('16', 'Tripura'),
  s('17', 'Meghalaya'),
  s('18', 'Assam'),
  s('19', 'West Bengal'),
  s('20', 'Jharkhand'),
  s('21', 'Odisha'),
  s('22', 'Chhattisgarh'),
  s('23', 'Madhya Pradesh'),
  s('24', 'Gujarat'),
  s('25', 'Daman and Diu (before 2020)', true, true, true),
  s('26', 'Dadra and Nagar Haveli and Daman and Diu', true, true),
  s('27', 'Maharashtra'),
  s('28', 'Andhra Pradesh (before 2014)', false, false, true),
  s('29', 'Karnataka'),
  s('30', 'Goa'),
  s('31', 'Lakshadweep', true, true),
  s('32', 'Kerala'),
  s('33', 'Tamil Nadu'),
  s('34', 'Puducherry', true),
  s('35', 'Andaman and Nicobar Islands', true, true),
  s('36', 'Telangana'),
  s('37', 'Andhra Pradesh'),
  s('38', 'Ladakh', true, true),
  // "Other territory" is a Union territory under section 2(8) of the UTGST Act.
  s('97', 'Other Territory', true, true),
  s('99', 'Centre Jurisdiction'),
];

/** Place-of-supply code used for exports / supplies outside India. */
export const FOREIGN_POS = '96';

const BY_CODE = new Map(GST_STATES.map((st) => [st.code, st]));

/** States offered in pickers (no legacy codes, no centre jurisdiction). */
export const SELECTABLE_STATES: readonly GstState[] = GST_STATES.filter((st) => !st.legacy && st.code !== '99');

export function getState(code: string): GstState | undefined {
  return BY_CODE.get(code);
}

export function isKnownStateCode(code: string): boolean {
  return BY_CODE.has(code);
}

export function stateName(code: string): string {
  if (code === FOREIGN_POS) return 'Outside India';
  return BY_CODE.get(code)?.name ?? '';
}

/** "27-Maharashtra" style label used on invoices and in returns. */
export function stateLabel(code: string): string {
  const name = stateName(code);
  return name ? `${code}-${name}` : code;
}

export function isUtgstTerritory(code: string): boolean {
  return BY_CODE.get(code)?.utgst ?? false;
}
