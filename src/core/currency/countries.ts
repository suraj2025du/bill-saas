export interface CurrencyDef {
  code: string;
  name: string;
  decimals: number;
  /** Locale used for number grouping and the currency symbol. */
  locale: string;
  major: [singular: string, plural: string];
  minor: [singular: string, plural: string] | null;
}

export interface CountryDef {
  code: string;
  name: string;
  currency: string;
  /** Name of the local consumption tax printed on invoices. */
  taxLabel: string;
  /** Label for the tax registration number. */
  taxIdLabel: string;
  /** Common standard rate (editable per item). */
  standardRate: number;
}

const c = (
  code: string,
  name: string,
  decimals: number,
  locale: string,
  major: [string, string],
  minor: [string, string] | null,
): CurrencyDef => ({ code, name, decimals, locale, major, minor });

export const CURRENCIES: readonly CurrencyDef[] = [
  c('INR', 'Indian Rupee', 2, 'en-IN', ['Rupee', 'Rupees'], ['Paisa', 'Paise']),
  c('USD', 'US Dollar', 2, 'en-US', ['US Dollar', 'US Dollars'], ['Cent', 'Cents']),
  c('EUR', 'Euro', 2, 'en-IE', ['Euro', 'Euros'], ['Cent', 'Cents']),
  c('GBP', 'Pound Sterling', 2, 'en-GB', ['Pound', 'Pounds'], ['Penny', 'Pence']),
  c('AED', 'UAE Dirham', 2, 'en-AE', ['Dirham', 'Dirhams'], ['Fils', 'Fils']),
  c('AUD', 'Australian Dollar', 2, 'en-AU', ['Australian Dollar', 'Australian Dollars'], ['Cent', 'Cents']),
  c('SGD', 'Singapore Dollar', 2, 'en-SG', ['Singapore Dollar', 'Singapore Dollars'], ['Cent', 'Cents']),
  c('CAD', 'Canadian Dollar', 2, 'en-CA', ['Canadian Dollar', 'Canadian Dollars'], ['Cent', 'Cents']),
  c('MYR', 'Malaysian Ringgit', 2, 'en-MY', ['Ringgit', 'Ringgit'], ['Sen', 'Sen']),
  c('ZAR', 'South African Rand', 2, 'en-ZA', ['Rand', 'Rand'], ['Cent', 'Cents']),
  c('SAR', 'Saudi Riyal', 2, 'en-SA', ['Saudi Riyal', 'Saudi Riyals'], ['Halala', 'Halalas']),
  c('NPR', 'Nepalese Rupee', 2, 'en-NP', ['Nepalese Rupee', 'Nepalese Rupees'], ['Paisa', 'Paisa']),
  c('BDT', 'Bangladeshi Taka', 2, 'en-BD', ['Taka', 'Taka'], ['Poisha', 'Poisha']),
  c('LKR', 'Sri Lankan Rupee', 2, 'en-LK', ['Sri Lankan Rupee', 'Sri Lankan Rupees'], ['Cent', 'Cents']),
  c('NZD', 'New Zealand Dollar', 2, 'en-NZ', ['New Zealand Dollar', 'New Zealand Dollars'], ['Cent', 'Cents']),
  c('JPY', 'Japanese Yen', 0, 'ja-JP', ['Yen', 'Yen'], null),
  c('CHF', 'Swiss Franc', 2, 'de-CH', ['Swiss Franc', 'Swiss Francs'], ['Centime', 'Centimes']),
  c('QAR', 'Qatari Riyal', 2, 'en-QA', ['Qatari Riyal', 'Qatari Riyals'], ['Dirham', 'Dirhams']),
  c('OMR', 'Omani Rial', 3, 'en-OM', ['Omani Rial', 'Omani Rials'], ['Baisa', 'Baisa']),
  c('BHD', 'Bahraini Dinar', 3, 'en-BH', ['Bahraini Dinar', 'Bahraini Dinars'], ['Fils', 'Fils']),
  c('KWD', 'Kuwaiti Dinar', 3, 'en-KW', ['Kuwaiti Dinar', 'Kuwaiti Dinars'], ['Fils', 'Fils']),
  c('CNY', 'Chinese Yuan', 2, 'zh-CN', ['Yuan', 'Yuan'], ['Fen', 'Fen']),
];

const k = (code: string, name: string, currency: string, taxLabel: string, taxIdLabel: string, standardRate: number): CountryDef => ({
  code,
  name,
  currency,
  taxLabel,
  taxIdLabel,
  standardRate,
});

export const COUNTRIES: readonly CountryDef[] = [
  k('IN', 'India', 'INR', 'GST', 'GSTIN', 18),
  k('AE', 'United Arab Emirates', 'AED', 'VAT', 'TRN', 5),
  k('GB', 'United Kingdom', 'GBP', 'VAT', 'VAT Reg. No.', 20),
  k('US', 'United States', 'USD', 'Sales Tax', 'EIN', 0),
  k('DE', 'Germany', 'EUR', 'MwSt', 'USt-IdNr.', 19),
  k('FR', 'France', 'EUR', 'TVA', 'N° TVA', 20),
  k('IE', 'Ireland', 'EUR', 'VAT', 'VAT No.', 23),
  k('AU', 'Australia', 'AUD', 'GST', 'ABN', 10),
  k('NZ', 'New Zealand', 'NZD', 'GST', 'GST No.', 15),
  k('SG', 'Singapore', 'SGD', 'GST', 'GST Reg. No.', 9),
  k('MY', 'Malaysia', 'MYR', 'SST', 'SST No.', 8),
  k('CA', 'Canada', 'CAD', 'GST/HST', 'GST/HST No.', 5),
  k('ZA', 'South Africa', 'ZAR', 'VAT', 'VAT No.', 15),
  k('SA', 'Saudi Arabia', 'SAR', 'VAT', 'VAT No.', 15),
  k('QA', 'Qatar', 'QAR', 'Tax', 'Tax ID', 0),
  k('OM', 'Oman', 'OMR', 'VAT', 'VATIN', 5),
  k('BH', 'Bahrain', 'BHD', 'VAT', 'VAT Account No.', 10),
  k('KW', 'Kuwait', 'KWD', 'Tax', 'Tax ID', 0),
  k('NP', 'Nepal', 'NPR', 'VAT', 'PAN/VAT No.', 13),
  k('BD', 'Bangladesh', 'BDT', 'VAT', 'BIN', 15),
  k('LK', 'Sri Lanka', 'LKR', 'VAT', 'VAT No.', 18),
  k('JP', 'Japan', 'JPY', 'Consumption Tax', 'Registration No.', 10),
];

const CURRENCY_BY_CODE = new Map(CURRENCIES.map((cur) => [cur.code, cur]));
const COUNTRY_BY_CODE = new Map(COUNTRIES.map((ctry) => [ctry.code, ctry]));

export function getCurrency(code: string): CurrencyDef {
  return CURRENCY_BY_CODE.get(code) ?? CURRENCY_BY_CODE.get('INR')!;
}

export function getCountry(code: string): CountryDef | undefined {
  return COUNTRY_BY_CODE.get(code);
}

export function currencyDecimals(code: string): number {
  return getCurrency(code).decimals;
}

/** Tax label for a business country ('GST' for India, 'VAT' for UAE, ...). */
export function taxLabelFor(countryCode: string): string {
  return getCountry(countryCode)?.taxLabel ?? 'Tax';
}
