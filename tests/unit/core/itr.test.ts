import { describe, expect, it } from 'vitest';
import { advanceTax, computeItr, defaultFilingDate, emptyItrInput, presumptiveIncome, slabTax } from '../../../src/core/itr/incomeTax';
import type { ItrInput } from '../../../src/core/itr/incomeTax';

const input = (over: Partial<ItrInput> = {}): ItrInput => ({ ...emptyItrInput('2025-26'), ...over });

describe('income tax: regimes', () => {
  it('does not set a business loss off against salary (s.71(2A), review Y10), only against non-salary heads', () => {
    const salaryAndLoss = computeItr(input({ salary: 1_500_000, businessMode: 'ACTUAL', businessProfit: -500_000 }));
    expect(salaryAndLoss.new.grossTotalIncome).toBe(1_425_000);
    expect(salaryAndLoss.new.totalIncome).toBe(1_425_000);
    expect(salaryAndLoss.new.totalTax).toBeGreaterThan(0);
    expect(salaryAndLoss.old.grossTotalIncome).toBe(1_450_000);
    expect(salaryAndLoss.warnings.join(' ')).toMatch(/s\.71\(2A\)/);

    const withOtherIncome = computeItr(
      input({ salary: 1_500_000, businessMode: 'ACTUAL', businessProfit: -500_000, otherIncome: 300_000 }),
    );
    // 300k other income absorbed by -500k business loss; remaining -200k cannot touch salary (15L - 75k = 14.25L).
    expect(withOtherIncome.new.grossTotalIncome).toBe(1_425_000);
  });

  it('defaults filingDate to 31 August for business/profession cases and shows 2025 Act section references for FY 2026-27 (CO 20, 23)', () => {
    expect(defaultFilingDate('2026-27', 'NONE')).toBe('2027-07-31');
    expect(defaultFilingDate('2026-27', '44AD')).toBe('2027-08-31');
    expect(defaultFilingDate('2025-26', 'ACTUAL')).toBe('2026-08-31');

    const r26 = computeItr({
      ...emptyItrInput('2026-27'),
      businessMode: '44AD',
      turnoverDigital: 5_000_000,
      deductions: { ...emptyItrInput('2026-27').deductions, sec80C: 100_000 },
    });
    expect(r26.presumptive?.note).toMatch(/Section 58\(2\) Sl\. 1/);
    expect(r26.old.deductionLines[0].label).toMatch(/Schedule XV \(s\.123\)/);
  });
  it('gives zero tax to a salaried person earning Rs 12.75 lakh under the new regime', () => {
    const r = computeItr(input({ salary: 1_275_000 }));
    expect(r.new).toMatchObject({ standardDeduction: 75_000, totalIncome: 1_200_000, slabTax: 60_000, rebate87A: 60_000, totalTax: 0 });
    expect(r.old).toMatchObject({ standardDeduction: 50_000, totalIncome: 1_225_000, slabTax: 180_000, cess: 7_200, totalTax: 187_200 });
    expect(r.better).toBe('NEW');
    expect(r.saving).toBe(187_200);
    expect(r.advance.applicable).toBe(false);
  });

  it('applies marginal relief just above Rs 12 lakh (new regime)', () => {
    const just = computeItr(input({ businessMode: 'ACTUAL', businessProfit: 1_210_000 }));
    expect(just.new).toMatchObject({ slabTax: 61_500, rebate87A: 51_500, cess: 400, totalTax: 10_400 });
    const more = computeItr(input({ businessMode: 'ACTUAL', businessProfit: 1_300_000 }));
    expect(more.new).toMatchObject({ slabTax: 75_000, rebate87A: 0, totalTax: 78_000 });
  });

  it('allows Chapter VI-A deductions only in the old regime', () => {
    const r = computeItr(input({ salary: 1_000_000, deductions: { ...emptyItrInput().deductions, sec80C: 200_000, sec80DSelf: 25_000 } }));
    expect(r.old.deductionLines).toEqual([
      { label: '80C (PF, PPF, ELSS, LIC, tuition...)', amount: 150_000 },
      { label: '80D (health insurance: self & family)', amount: 25_000 },
    ]);
    expect(r.old).toMatchObject({ totalIncome: 775_000, slabTax: 67_500, totalTax: 70_200 });
    expect(r.new).toMatchObject({ deductions: 0, totalIncome: 925_000, totalTax: 0 });
    expect(r.better).toBe('NEW');
  });

  it('uses senior-citizen limits for 80D and 80TTB, and the old-regime rebate', () => {
    const r = computeItr(
      input({
        age: 'SENIOR',
        interestSavings: 5_000,
        interestDeposits: 70_000,
        otherIncome: 400_000,
        deductions: { ...emptyItrInput().deductions, sec80DSelf: 60_000, sec80DParents: 60_000, parentsSenior: true },
      }),
    );
    const amount = (label: string) => r.old.deductionLines.find((l) => l.label.startsWith(label))?.amount;
    expect(amount('80D (health insurance: self')).toBe(50_000);
    expect(amount('80D (health insurance: parents')).toBe(50_000);
    expect(amount('80TTB')).toBe(50_000);
    expect(amount('80TTA')).toBeUndefined();
    expect(r.old.totalIncome).toBe(325_000);
    expect(r.old.rebate87A).toBe(1_250);
    expect(r.old.totalTax).toBe(0);
    expect(r.advance.reason).toMatch(/senior citizens/);
  });

  it('charges surcharge with marginal relief and caps it at 25% in the new regime', () => {
    const sixty = computeItr(input({ businessMode: 'ACTUAL', businessProfit: 6_000_000 }));
    expect(sixty.new).toMatchObject({ slabTax: 1_380_000, surcharge: 138_000, surchargeRelief: 0, cess: 60_720, totalTax: 1_578_720 });
    const edge = computeItr(input({ businessMode: 'ACTUAL', businessProfit: 5_010_000 }));
    expect(edge.new).toMatchObject({ slabTax: 1_083_000, surchargeRelief: 101_300, surcharge: 7_000, totalTax: 1_133_600 });
    const rich = computeItr(input({ businessMode: 'ACTUAL', businessProfit: 60_000_000 }));
    expect(rich.old.surcharge).toBe(6_590_625);
    expect(rich.new.slabTax).toBe(17_580_000);
    expect(rich.new.surcharge).toBe(4_395_000);
  });

  it('limits house-property loss set-off and lists slab rows', () => {
    const r = computeItr(input({ salary: 2_000_000, houseProperty: -350_000 }));
    expect(r.old.grossTotalIncome).toBe(1_750_000);
    expect(r.new.grossTotalIncome).toBe(1_925_000);
    expect(r.warnings.join(' ')).toMatch(/Rs 2 lakh/);
    expect(slabTax(500_000, [[250_000, 0], [500_000, 5], [Infinity, 30]]).rows).toEqual([
      { from: 0, to: 250_000, rate: 0, tax: 0 },
      { from: 250_000, to: 500_000, rate: 5, tax: 12_500 },
      { from: 500_000, to: null, rate: 30, tax: 0 },
    ]);
  });
});

describe('income tax: presumptive income', () => {
  it('computes 44AD with digital and cash rates and the turnover limit', () => {
    expect(presumptiveIncome(input({ businessMode: '44AD', turnoverDigital: 5_000_000, turnoverCash: 1_000_000 }))).toMatchObject({
      minimum: 380_000,
      income: 380_000,
      eligible: true,
      limit: 20_000_000,
    });
    expect(presumptiveIncome(input({ businessMode: '44AD', turnoverDigital: 25_000_000 }))).toMatchObject({ limit: 30_000_000, eligible: true, minimum: 1_500_000 });
    const over = computeItr(input({ businessMode: '44AD', turnoverDigital: 25_000_000, turnoverCash: 5_000_000 }));
    expect(over.presumptive?.eligible).toBe(false);
    expect(over.warnings.join(' ')).toMatch(/above the section 44AD limit/);
    const declared = computeItr(input({ businessMode: '44AD', turnoverDigital: 5_000_000, turnoverCash: 1_000_000, declaredProfit: 500_000 }));
    expect(declared.businessIncome).toBe(500_000);
    const low = computeItr(input({ businessMode: '44AD', turnoverDigital: 5_000_000, declaredProfit: 100_000 }));
    expect(low.businessIncome).toBe(300_000);
    expect(low.warnings.join(' ')).toMatch(/below the presumptive minimum/);
  });

  it('computes 44ADA and 44AE', () => {
    expect(presumptiveIncome(input({ businessMode: '44ADA', grossReceipts: 4_000_000 }))).toMatchObject({ minimum: 2_000_000, limit: 7_500_000, eligible: true });
    const trucks = presumptiveIncome(
      input({
        businessMode: '44AE',
        vehicles: [
          { kind: 'HEAVY', tons: 15, months: 12 },
          { kind: 'HEAVY', tons: 15, months: 12 },
          { kind: 'OTHER', tons: 0, months: 12.5 },
        ],
      }),
    );
    expect(trucks).toMatchObject({ minimum: 450_000, eligible: true });
    const fleet = computeItr(input({ businessMode: '44AE', vehicles: Array.from({ length: 11 }, () => ({ kind: 'OTHER' as const, tons: 0, months: 1 })) }));
    expect(fleet.warnings.join(' ')).toMatch(/at most 10/);
    expect(presumptiveIncome(input())).toBeNull();
  });
});

describe('income tax: advance tax, 234B and 234C', () => {
  const base = input({ fy: '2026-27', businessMode: 'ACTUAL', businessProfit: 2_000_000, filingDate: '2027-07-31' });
  const regime = { ...computeItr(base).new, totalTax: 100_000 };

  it('charges 234C on each short instalment and 234B when less than 90% is paid', () => {
    const r = advanceTax({ ...base, advancePaid: { jun: 10_000, sep: 20_000, dec: 30_000, mar: 25_000 } }, regime, false);
    expect(r.instalments.map((i) => [i.due, i.shortfall, i.interest])).toEqual([
      ['2026-06-15', 5_000, 150],
      ['2026-09-15', 15_000, 450],
      ['2026-12-15', 15_000, 450],
      ['2027-03-15', 15_000, 150],
    ]);
    expect(r.interest234C).toBe(1_200);
    expect(r.months234B).toBe(4);
    expect(r.interest234B).toBe(600);
    expect(r.balancePayable).toBe(16_800);
  });

  it('respects the 12% / 36% safe harbour and rounds down to Rs 100', () => {
    const safe = advanceTax({ ...base, advancePaid: { jun: 12_500, sep: 24_000, dec: 40_000, mar: 25_000 } }, regime, false);
    expect(safe.instalments[0].interest).toBe(0);
    expect(safe.instalments[1].interest).toBe(0);
    expect(safe.interest234B).toBe(0);
    const odd = advanceTax({ ...base, advancePaid: { jun: 9_950, sep: 0, dec: 0, mar: 0 } }, regime, false);
    expect(odd.instalments[0]).toMatchObject({ shortfall: 5_050, interest: 150 });
  });

  it('uses a single March instalment for presumptive income and skips small liabilities', () => {
    const pres = advanceTax({ ...base, advancePaid: { jun: 0, sep: 0, dec: 0, mar: 85_000 } }, regime, true);
    expect(pres.instalments).toHaveLength(1);
    expect(pres.instalments[0]).toMatchObject({ due: '2027-03-15', shortfall: 15_000, interest: 150 });
    expect(pres.interest234B).toBe(600);
    const small = advanceTax(base, { ...regime, totalTax: 9_000 }, false);
    expect(small.applicable).toBe(false);
    expect(small.reason).toMatch(/Rs 10,000/);
    const pro = computeItr(input({ fy: '2026-27', businessMode: '44ADA', grossReceipts: 6_000_000 }));
    expect(pro.advance.instalments).toHaveLength(1);
    expect(pro.advance.taxDue).toBeGreaterThan(0);
  });
});
