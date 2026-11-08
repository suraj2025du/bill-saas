import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  dmyToISO,
  endOfMonth,
  formatDate,
  fyForStartYear,
  fyFromLabel,
  fyOf,
  gstPeriod,
  inRange,
  isValidISODate,
  listMonths,
  monthLabel,
  monthRange,
  quarterOf,
  startOfMonth,
  toISODate,
  todayISO,
} from '../../../src/core/dates';
import { moneyEquals, pct, roundTo, sumMoney, toNumber } from '../../../src/core/money';

describe('money', () => {
  it('rounds half away from zero without float artefacts', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(2.675, 2)).toBe(2.68);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(-0.001, 2)).toBe(0);
    expect(Object.is(roundTo(-0.001, 2), -0)).toBe(false);
    expect(roundTo(1234.5, 0)).toBe(1235);
    expect(roundTo(Number.NaN)).toBe(0);
    expect(roundTo(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('sums money safely', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([1, Number.NaN, 2])).toBe(3);
  });

  it('parses user input', () => {
    expect(toNumber('1,234.50')).toBe(1234.5);
    expect(toNumber(' 12 ')).toBe(12);
    expect(toNumber('')).toBe(0);
    expect(toNumber('abc', 7)).toBe(7);
    expect(toNumber(Number.NaN, 3)).toBe(3);
    expect(toNumber(null, 5)).toBe(5);
    expect(toNumber(42)).toBe(42);
  });

  it('computes percentages and compares amounts', () => {
    expect(pct(10000, 18)).toBe(1800);
    expect(moneyEquals(10, 10.004)).toBe(true);
    expect(moneyEquals(10, 10.01)).toBe(false);
  });
});

describe('dates', () => {
  it('handles financial years starting in April', () => {
    const fy = fyOf('2026-10-29');
    expect(fy).toMatchObject({ label: '2026-27', short: '26-27', start: '2026-04-01', end: '2027-03-31', startYear: 2026 });
    expect(fyOf('2027-02-10').label).toBe('2026-27');
    expect(fyOf('2026-03-31').label).toBe('2025-26');
    expect(fyFromLabel('2025-26').start).toBe('2025-04-01');
    expect(() => fyFromLabel('abcd')).toThrow();
  });

  it('handles calendar-year FYs', () => {
    const fy = fyForStartYear(2026, 1);
    expect(fy).toMatchObject({ label: '2026', short: '26', start: '2026-01-01', end: '2026-12-31' });
    expect(fyOf('2026-06-01', 1).label).toBe('2026');
  });

  it('computes quarters of the Indian FY', () => {
    expect(quarterOf('2026-10-29')).toMatchObject({ q: 3, start: '2026-10-01', end: '2026-12-31' });
    expect(quarterOf('2027-01-15').q).toBe(4);
    expect(quarterOf('2026-04-01').q).toBe(1);
    expect(quarterOf('2026-04-01').label).toBe('Q1 (Apr-Jun 2026)');
  });

  it('adds days and months with month-end clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-29')).toBe(28);
    expect(daysBetween('2026-10-29', '2026-10-01')).toBe(-28);
  });

  it('validates and formats dates', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-1-01')).toBe(false);
    expect(isValidISODate(20260101)).toBe(false);
    expect(formatDate('2026-10-29')).toBe('29-10-2026');
    expect(formatDate('2026-10-29', 'DMY_SLASH')).toBe('29/10/2026');
    expect(formatDate('2026-10-29', 'D_MON_Y')).toBe('29 Oct 2026');
    expect(formatDate('')).toBe('');
    expect(dmyToISO('29/10/2026')).toBe('2026-10-29');
    expect(dmyToISO('1-2-2026')).toBe('2026-02-01');
    expect(dmyToISO('31-02-2026')).toBeNull();
    expect(dmyToISO('2026-10-29')).toBeNull();
    expect(() => addDays('bad', 1)).toThrow();
  });

  it('builds month helpers and GST periods', () => {
    expect(gstPeriod('2026-10-29')).toBe('102026');
    expect(gstPeriod('2026-04')).toBe('042026');
    expect(listMonths('2026-04-15', '2026-07-01')).toEqual(['2026-04', '2026-05', '2026-06', '2026-07']);
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(startOfMonth('2026-10-29')).toBe('2026-10-01');
    expect(endOfMonth('2026-10-29')).toBe('2026-10-31');
    expect(monthLabel('2026-10')).toBe('Oct 2026');
    expect(inRange('2026-10-29', '2026-10-01', '2026-10-31')).toBe(true);
    expect(inRange('2026-11-01', '2026-10-01', '2026-10-31')).toBe(false);
    expect(toISODate(new Date(2026, 9, 5))).toBe('2026-10-05');
    expect(todayISO(new Date(2026, 0, 2))).toBe('2026-01-02');
  });
});
