import type { ISODate } from '../model';
import { roundTo } from '../money';

/**
 * Income-tax estimate for a resident individual: old vs new regime,
 * presumptive income, Chapter VI-A, surcharge with marginal relief, cess,
 * advance-tax schedule and interest under sections 234B / 234C.
 *
 * Section numbers are the familiar Income-tax Act 1961 ones. From tax year
 * 2026-27 the Income-tax Act 2025 applies; it renumbers the sections but
 * keeps the slabs, rebate and limits used here. This is a planning helper,
 * not a return-filing utility: confirm the final figures with the e-filing
 * portal or a tax professional.
 */
export const SUPPORTED_FYS = ['2025-26', '2026-27'] as const;
export type SupportedFy = (typeof SUPPORTED_FYS)[number];
export type AgeGroup = 'BELOW_60' | 'SENIOR' | 'SUPER_SENIOR';
export type Regime = 'OLD' | 'NEW';
export type BusinessMode = 'NONE' | 'ACTUAL' | '44AD' | '44ADA' | '44AE';

export interface Vehicle {
  kind: 'HEAVY' | 'OTHER';
  /** Gross vehicle weight in tonnes (heavy goods vehicles only). */
  tons: number;
  /** Months (or part) the vehicle was owned during the year, 1-12. */
  months: number;
}

export interface ItrInput {
  fy: SupportedFy;
  age: AgeGroup;
  salary: number;
  businessMode: BusinessMode;
  /** Profit as per books (ACTUAL). */
  businessProfit: number;
  /** 44AD: turnover received by bank / UPI / cheque and in cash. */
  turnoverDigital: number;
  turnoverCash: number;
  /** 44ADA: gross receipts and the part received in cash. */
  grossReceipts: number;
  receiptsCash: number;
  vehicles: Vehicle[];
  /** Profit you choose to declare when it is higher than the presumptive minimum (0 = minimum). */
  declaredProfit: number;
  /** Net income from house property (negative for a loss). */
  houseProperty: number;
  interestSavings: number;
  interestDeposits: number;
  otherIncome: number;
  deductions: {
    sec80C: number;
    sec80CCD1B: number;
    sec80DSelf: number;
    sec80DParents: number;
    parentsSenior: boolean;
    sec80G: number;
    other: number;
  };
  /** TDS and TCS already credited in Form 26AS / AIS. */
  tdsTcs: number;
  /** Advance tax paid in each instalment window (not cumulative). */
  advancePaid: { jun: number; sep: number; dec: number; mar: number };
  /** Date the return is (or will be) filed, for section 234B. */
  filingDate: ISODate;
}

export interface SlabRow {
  from: number;
  to: number | null;
  rate: number;
  tax: number;
}

export interface RegimeResult {
  regime: Regime;
  grossTotalIncome: number;
  standardDeduction: number;
  deductions: number;
  deductionLines: { label: string; amount: number }[];
  totalIncome: number;
  slabTax: number;
  rebate87A: number;
  surcharge: number;
  surchargeRelief: number;
  cess: number;
  totalTax: number;
  slabs: SlabRow[];
}

export interface PresumptiveResult {
  section: '44AD' | '44ADA' | '44AE';
  minimum: number;
  income: number;
  eligible: boolean;
  limit: number;
  note: string;
}

export interface Instalment {
  due: ISODate;
  label: string;
  cumulativePct: number;
  required: number;
  paidCumulative: number;
  shortfall: number;
  months: number;
  interest: number;
}

export interface AdvanceTaxResult {
  regime: Regime;
  /** Tax after TDS/TCS ("assessed tax" for 234B, "tax due" for 234C). */
  taxDue: number;
  applicable: boolean;
  reason: string;
  instalments: Instalment[];
  interest234C: number;
  paid: number;
  interest234B: number;
  months234B: number;
  balancePayable: number;
}

export interface ItrResult {
  input: ItrInput;
  presumptive: PresumptiveResult | null;
  businessIncome: number;
  old: RegimeResult;
  new: RegimeResult;
  better: Regime;
  saving: number;
  advance: AdvanceTaxResult;
  warnings: string[];
}

export function defaultFilingDate(fy: SupportedFy, businessMode: BusinessMode = 'NONE'): ISODate {
  const end = Number(fy.slice(0, 4)) + 1;
  // Compliance row 20: from AY 2026-27 (FY 2025-26), non-audit business/profession cases are due 31 August.
  return businessMode !== 'NONE' ? `${end}-08-31` : `${end}-07-31`;
}

export function emptyItrInput(fy: SupportedFy = '2026-27'): ItrInput {
  return {
    fy,
    age: 'BELOW_60',
    salary: 0,
    businessMode: 'NONE',
    businessProfit: 0,
    turnoverDigital: 0,
    turnoverCash: 0,
    grossReceipts: 0,
    receiptsCash: 0,
    vehicles: [],
    declaredProfit: 0,
    houseProperty: 0,
    interestSavings: 0,
    interestDeposits: 0,
    otherIncome: 0,
    deductions: { sec80C: 0, sec80CCD1B: 0, sec80DSelf: 0, sec80DParents: 0, parentsSenior: false, sec80G: 0, other: 0 },
    tdsTcs: 0,
    advancePaid: { jun: 0, sep: 0, dec: 0, mar: 0 },
    filingDate: defaultFilingDate(fy, 'NONE'),
  };
}

const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
/** Section 288A / 288B: round to the nearest multiple of Rs 10. */
const round10 = (n: number) => Math.round(n / 10) * 10;
/** Rule 119A: interest is computed on amounts rounded down to Rs 100. */
const floor100 = (n: number) => Math.floor(pos(n) / 100) * 100;

type Slabs = readonly (readonly [upTo: number, rate: number])[];

const NEW_SLABS: Slabs = [
  [400_000, 0],
  [800_000, 5],
  [1_200_000, 10],
  [1_600_000, 15],
  [2_000_000, 20],
  [2_400_000, 25],
  [Infinity, 30],
];

function oldSlabs(age: AgeGroup): Slabs {
  const exempt = age === 'SUPER_SENIOR' ? 500_000 : age === 'SENIOR' ? 300_000 : 250_000;
  return [
    [exempt, 0],
    [500_000, 5],
    [1_000_000, 20],
    [Infinity, 30],
  ];
}

export function slabTax(income: number, slabs: Slabs): { tax: number; rows: SlabRow[] } {
  let prev = 0;
  let tax = 0;
  const rows: SlabRow[] = [];
  for (const [upTo, rate] of slabs) {
    if (upTo <= prev) continue;
    const portion = Math.max(0, Math.min(income, upTo) - prev);
    const t = (portion * rate) / 100;
    rows.push({ from: prev, to: Number.isFinite(upTo) ? upTo : null, rate, tax: roundTo(t) });
    tax += t;
    prev = upTo;
  }
  return { tax: roundTo(tax), rows };
}

const SURCHARGE: readonly (readonly [above: number, rate: number])[] = [
  [50_000_000, 37],
  [20_000_000, 25],
  [10_000_000, 15],
  [5_000_000, 10],
];

function surchargeRate(income: number, regime: Regime): number {
  for (const [above, rate] of SURCHARGE) {
    if (income > above) return regime === 'NEW' ? Math.min(rate, 25) : rate;
  }
  return 0;
}

/** Surcharge with marginal relief: the extra tax never exceeds the income above the threshold. */
function surchargeWithRelief(income: number, tax: number, regime: Regime, slabs: Slabs): { surcharge: number; relief: number } {
  const rate = surchargeRate(income, regime);
  if (!rate) return { surcharge: 0, relief: 0 };
  const gross = (tax * rate) / 100;
  const threshold = SURCHARGE.find(([above]) => income > above)![0];
  const atThreshold = slabTax(threshold, slabs).tax;
  const rateAtThreshold = surchargeRate(threshold, regime);
  const limit = atThreshold + (atThreshold * rateAtThreshold) / 100 + (income - threshold);
  const relief = Math.max(0, tax + gross - limit);
  return { surcharge: roundTo(gross - relief), relief: roundTo(relief) };
}

export function presumptiveIncome(input: ItrInput): PresumptiveResult | null {
  const declared = pos(input.declaredProfit);
  const newAct = input.fy === '2026-27';
  switch (input.businessMode) {
    case '44AD': {
      const turnover = pos(input.turnoverDigital) + pos(input.turnoverCash);
      const minimum = roundTo(pos(input.turnoverDigital) * 0.06 + pos(input.turnoverCash) * 0.08);
      const limit = turnover > 0 && pos(input.turnoverCash) <= turnover * 0.05 ? 30_000_000 : 20_000_000;
      return {
        section: '44AD',
        minimum,
        income: Math.max(minimum, declared),
        eligible: turnover <= limit,
        limit,
        note: `${newAct ? 'Section 58(2) Sl. 1 (earlier 44AD): ' : ''}6% of digital receipts + 8% of cash receipts. Limit Rs 3 crore when cash receipts are at most 5% of turnover, else Rs 2 crore.`,
      };
    }
    case '44ADA': {
      const receipts = pos(input.grossReceipts);
      const minimum = roundTo(receipts * 0.5);
      const limit = receipts > 0 && pos(input.receiptsCash) <= receipts * 0.05 ? 7_500_000 : 5_000_000;
      return {
        section: '44ADA',
        minimum,
        income: Math.max(minimum, declared),
        eligible: receipts <= limit,
        limit,
        note: `${newAct ? 'Section 58(2) Sl. 3 (earlier 44ADA): ' : ''}50% of gross receipts for specified professionals. Limit Rs 75 lakh when cash receipts are at most 5%, else Rs 50 lakh.`,
      };
    }
    case '44AE': {
      const months = (v: Vehicle) => Math.min(12, Math.max(0, Math.ceil(v.months)));
      const minimum = roundTo(
        input.vehicles.reduce((s, v) => s + (v.kind === 'HEAVY' ? 1_000 * pos(v.tons) * months(v) : 7_500 * months(v)), 0),
      );
      return {
        section: '44AE',
        minimum,
        income: Math.max(minimum, declared),
        eligible: input.vehicles.length <= 10,
        limit: 10,
        note: `${newAct ? 'Section 58(2) Sl. 2 (earlier 44AE): ' : ''}Heavy goods vehicle: Rs 1,000 per tonne of gross weight per month; other goods carriage: Rs 7,500 per month. At most 10 vehicles.`,
      };
    }
    default:
      return null;
  }
}

function computeRegime(input: ItrInput, regime: Regime, businessIncome: number): RegimeResult {
  const isNew = regime === 'NEW';
  const newAct = input.fy === '2026-27';
  const standardDeduction = Math.min(pos(input.salary), isNew ? 75_000 : 50_000);
  const netSalary = Math.max(0, pos(input.salary) - standardDeduction);
  const hp = isNew ? Math.max(0, input.houseProperty || 0) : Math.max(-200_000, input.houseProperty || 0);
  const otherSources = pos(input.interestSavings) + pos(input.interestDeposits) + pos(input.otherIncome);
  // Review Y10: section 71(2A) forbids setting a business loss off against salary.
  // A business loss can be set off only against non-salary heads (house property and other sources).
  const nonSalary = businessIncome < 0 ? Math.max(0, hp + otherSources + businessIncome) : businessIncome + hp + otherSources;
  const grossTotalIncome = Math.max(0, netSalary + nonSalary);

  const lines: { label: string; amount: number }[] = [];
  if (!isNew) {
    const d = input.deductions;
    const senior = input.age !== 'BELOW_60';
    const add = (label: string, amount: number) => {
      if (amount > 0) lines.push({ label, amount: roundTo(amount) });
    };
    add(newAct ? '80C / Schedule XV (s.123) (PF, PPF, ELSS, LIC, tuition...)' : '80C (PF, PPF, ELSS, LIC, tuition...)', Math.min(pos(d.sec80C), 150_000));
    add('80CCD(1B) (NPS)', Math.min(pos(d.sec80CCD1B), 50_000));
    add('80D (health insurance: self & family)', Math.min(pos(d.sec80DSelf), senior ? 50_000 : 25_000));
    add('80D (health insurance: parents)', Math.min(pos(d.sec80DParents), d.parentsSenior ? 50_000 : 25_000));
    if (senior) add('80TTB (interest, senior citizen)', Math.min(pos(input.interestSavings) + pos(input.interestDeposits), 50_000));
    else add('80TTA (savings interest)', Math.min(pos(input.interestSavings), 10_000));
    add('80G (donations, qualifying amount)', pos(d.sec80G));
    add('Other deductions', pos(d.other));
  }
  const deductions = Math.min(
    grossTotalIncome,
    lines.reduce((s, l) => s + l.amount, 0),
  );
  const totalIncome = round10(Math.max(0, grossTotalIncome - deductions));
  const slabs = isNew ? NEW_SLABS : oldSlabs(input.age);
  const { tax, rows } = slabTax(totalIncome, slabs);

  let rebate = 0;
  if (isNew) {
    if (totalIncome <= 1_200_000) rebate = Math.min(tax, 60_000);
    else if (tax > totalIncome - 1_200_000) rebate = tax - (totalIncome - 1_200_000);
  } else if (totalIncome <= 500_000) {
    rebate = Math.min(tax, 12_500);
  }
  const afterRebate = roundTo(tax - rebate);
  const { surcharge, relief } = surchargeWithRelief(totalIncome, afterRebate, regime, slabs);
  const cess = roundTo(((afterRebate + surcharge) * 4) / 100);
  return {
    regime,
    grossTotalIncome: roundTo(grossTotalIncome),
    standardDeduction,
    deductions: roundTo(deductions),
    deductionLines: lines,
    totalIncome,
    slabTax: tax,
    rebate87A: roundTo(rebate),
    surcharge,
    surchargeRelief: relief,
    cess,
    totalTax: round10(afterRebate + surcharge + cess),
    slabs: rows,
  };
}

function monthsOrPart(fromInclusive: ISODate, to: ISODate): number {
  if (to < fromInclusive) return 0;
  const [y1, m1] = fromInclusive.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

export function advanceTax(input: ItrInput, regime: RegimeResult, presumptiveOnly: boolean): AdvanceTaxResult {
  const startYear = Number(input.fy.slice(0, 4));
  const taxDue = Math.max(0, regime.totalTax - pos(input.tdsTcs));
  const p = input.advancePaid;
  const paid = roundTo(pos(p.jun) + pos(p.sep) + pos(p.dec) + pos(p.mar));
  const seniorNoBusiness = input.age !== 'BELOW_60' && input.businessMode === 'NONE';
  const base = { regime: regime.regime, taxDue, paid };
  if (taxDue < 10_000 || seniorNoBusiness) {
    return {
      ...base,
      applicable: false,
      reason: seniorNoBusiness
        ? 'Resident senior citizens without business income do not pay advance tax (s.207).'
        : 'Advance tax applies only when the tax after TDS/TCS is Rs 10,000 or more (s.208).',
      instalments: [],
      interest234C: 0,
      interest234B: 0,
      months234B: 0,
      balancePayable: roundTo(Math.max(0, taxDue - paid)),
    };
  }
  const schedule: { due: ISODate; label: string; pct: number; months: number; safe: number }[] = presumptiveOnly
    ? [{ due: `${startYear + 1}-03-15`, label: 'By 15 March (presumptive: single instalment)', pct: 100, months: 1, safe: 100 }]
    : [
        { due: `${startYear}-06-15`, label: 'By 15 June', pct: 15, months: 3, safe: 12 },
        { due: `${startYear}-09-15`, label: 'By 15 September', pct: 45, months: 3, safe: 36 },
        { due: `${startYear}-12-15`, label: 'By 15 December', pct: 75, months: 3, safe: 75 },
        { due: `${startYear + 1}-03-15`, label: 'By 15 March', pct: 100, months: 1, safe: 100 },
      ];
  const cumulative = [pos(p.jun), pos(p.jun) + pos(p.sep), pos(p.jun) + pos(p.sep) + pos(p.dec), paid];
  const instalments = schedule.map((s, i) => {
    const paidCumulative = roundTo(presumptiveOnly ? paid : cumulative[i]);
    const required = roundTo((taxDue * s.pct) / 100);
    const safe = (taxDue * s.safe) / 100;
    const shortfall = paidCumulative >= safe ? 0 : roundTo(Math.max(0, required - paidCumulative));
    const interest = roundTo((floor100(shortfall) * s.months) / 100);
    return { due: s.due, label: s.label, cumulativePct: s.pct, required, paidCumulative, shortfall, months: s.months, interest };
  });
  const interest234C = roundTo(instalments.reduce((s, x) => s + x.interest, 0));
  let interest234B = 0;
  let months234B = 0;
  if (paid < taxDue * 0.9) {
    months234B = monthsOrPart(`${startYear + 1}-04-01`, input.filingDate);
    interest234B = roundTo((floor100(taxDue - paid) * months234B) / 100);
  }
  return {
    ...base,
    applicable: true,
    reason: '',
    instalments,
    interest234C,
    interest234B,
    months234B,
    balancePayable: roundTo(Math.max(0, taxDue - paid) + interest234B + interest234C),
  };
}

export function computeItr(input: ItrInput): ItrResult {
  const warnings: string[] = [];
  const presumptive = presumptiveIncome(input);
  let businessIncome = 0;
  if (input.businessMode === 'ACTUAL') businessIncome = input.businessProfit || 0;
  else if (presumptive) {
    businessIncome = presumptive.income;
    if (!presumptive.eligible) {
      warnings.push(
        presumptive.section === '44AE'
          ? 'Section 44AE allows at most 10 goods vehicles; keep books and use actual profit instead.'
          : `Turnover is above the section ${presumptive.section} limit; keep books, get them audited if required and use actual profit.`,
      );
    }
    if (pos(input.declaredProfit) > 0 && input.declaredProfit < presumptive.minimum) {
      warnings.push(`Declared profit is below the presumptive minimum; the minimum (${presumptive.minimum.toFixed(0)}) is used. Declaring less needs books of account and an audit.`);
    }
  }
  if (businessIncome < 0) {
    warnings.push(
      'Business loss: set off only against non-salary income (house property, other sources) as per s.71(2A); it cannot be set off against salary. Carry-forward of any unabsorbed loss needs a return filed on time.',
    );
  }
  if (input.houseProperty < -200_000) warnings.push('Only Rs 2 lakh of house-property loss can be set off against other income in a year (old regime).');
  if (input.houseProperty < 0) warnings.push('Under the new regime a house-property loss cannot be set off against other income.');

  const oldR = computeRegime(input, 'OLD', businessIncome);
  const newR = computeRegime(input, 'NEW', businessIncome);
  const better: Regime = newR.totalTax <= oldR.totalTax ? 'NEW' : 'OLD';
  if (input.businessMode !== 'NONE' && better === 'OLD') {
    warnings.push('With business income, moving back to the new regime after opting out is allowed only once (Form 10-IEA).');
  }
  const chosen = better === 'NEW' ? newR : oldR;
  const presumptiveOnly = (input.businessMode === '44AD' || input.businessMode === '44ADA') && !!presumptive?.eligible;
  return {
    input,
    presumptive,
    businessIncome: roundTo(businessIncome),
    old: oldR,
    new: newR,
    better,
    saving: roundTo(Math.abs(oldR.totalTax - newR.totalTax)),
    advance: advanceTax(input, chosen, presumptiveOnly),
    warnings,
  };
}
