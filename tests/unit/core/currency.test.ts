import { describe, expect, it } from 'vitest';
import { COUNTRIES, CURRENCIES, currencyDecimals, getCountry, getCurrency, taxLabelFor } from '../../../src/core/currency/countries';
import { formatMoney, formatNumber, formatQty, formatRate } from '../../../src/core/currency/format';
import { amountInWords, numberToWordsIndian, numberToWordsInternational } from '../../../src/core/currency/words';

describe('countries and currencies', () => {
  it('has 22 countries and 22 currencies with tax labels', () => {
    expect(COUNTRIES).toHaveLength(22);
    expect(CURRENCIES).toHaveLength(22);
    expect(taxLabelFor('IN')).toBe('GST');
    expect(taxLabelFor('AE')).toBe('VAT');
    expect(taxLabelFor('DE')).toBe('MwSt');
    expect(taxLabelFor('FR')).toBe('TVA');
    expect(taxLabelFor('MY')).toBe('SST');
    expect(taxLabelFor('XX')).toBe('Tax');
    expect(getCountry('GB')?.currency).toBe('GBP');
    expect(getCurrency('ZZZ').code).toBe('INR');
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('KWD')).toBe(3);
    for (const k of COUNTRIES) expect(CURRENCIES.some((cur) => cur.code === k.currency)).toBe(true);
  });
});

describe('formatting', () => {
  it('uses Indian grouping for INR', () => {
    expect(formatMoney(1234567.5, 'INR')).toBe('₹12,34,567.50');
    expect(formatMoney(1234567.5, 'INR', { symbol: false })).toBe('12,34,567.50');
    expect(formatMoney(Number.NaN)).toBe('₹0.00');
  });

  it('formats international currencies', () => {
    expect(formatMoney(1234567.5, 'USD')).toBe('$1,234,567.50');
    expect(formatMoney(1234.5, 'JPY')).toMatch(/1,235/);
    expect(formatMoney(1.2346, 'KWD', { symbol: false })).toBe('1.235');
    expect(formatMoney(10, 'INR', { decimals: 0 })).toBe('₹10');
  });

  it('formats numbers, quantities and rates', () => {
    expect(formatNumber(1234567.891)).toBe('12,34,567.89');
    expect(formatNumber(Number.NaN, 0)).toBe('0');
    expect(formatQty(10)).toBe('10');
    expect(formatQty(2.5)).toBe('2.5');
    expect(formatQty(Number.NaN)).toBe('0');
    expect(formatRate(18)).toBe('18%');
    expect(formatRate(0.25)).toBe('0.25%');
  });
});

describe('amount in words', () => {
  it('uses lakh and crore for Indian numbers', () => {
    expect(numberToWordsIndian(0)).toBe('Zero');
    expect(numberToWordsIndian(21)).toBe('Twenty One');
    expect(numberToWordsIndian(105)).toBe('One Hundred Five');
    expect(numberToWordsIndian(100)).toBe('One Hundred');
    expect(numberToWordsIndian(1234567)).toBe('Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven');
    expect(numberToWordsIndian(1_000_000_000)).toBe('One Hundred Crore');
    expect(numberToWordsIndian(10_00_00_001)).toBe('Ten Crore One');
  });

  it('uses million and billion internationally', () => {
    expect(numberToWordsInternational(0)).toBe('Zero');
    expect(numberToWordsInternational(1234567)).toBe('One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven');
    expect(numberToWordsInternational(2_000_000_000)).toBe('Two Billion');
    expect(numberToWordsInternational(3e15)).toBe('Three Quadrillion');
  });

  it('prints INR amounts with paise', () => {
    expect(amountInWords(11800.5)).toBe('Rupees Eleven Thousand Eight Hundred and Fifty Paise Only');
    expect(amountInWords(1)).toBe('Rupees One Only');
    expect(amountInWords(10.01)).toBe('Rupees Ten and One Paisa Only');
    expect(amountInWords(-5)).toBe('Minus Rupees Five Only');
  });

  it('prints foreign amounts with their sub-units', () => {
    expect(amountInWords(1250.5, 'USD')).toBe('One Thousand Two Hundred Fifty US Dollars and Fifty Cents Only');
    expect(amountInWords(1, 'GBP')).toBe('One Pound Only');
    expect(amountInWords(1000, 'JPY')).toBe('One Thousand Yen Only');
    expect(amountInWords(12.345, 'KWD')).toBe('Twelve Kuwaiti Dinars and Three Hundred Forty Five Fils Only');
  });
});
