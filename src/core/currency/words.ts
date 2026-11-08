import { roundTo } from '../money';
import { getCurrency } from './countries';

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t} ${ONES[n % 10]}` : t;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return belowHundred(r);
  return r ? `${ONES[h]} Hundred ${belowHundred(r)}` : `${ONES[h]} Hundred`;
}

/** 1234567 -> "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven". */
export function numberToWordsIndian(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  if (crore) parts.push(`${numberToWordsIndian(crore)} Crore`);
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

/** 1234567 -> "One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven". */
export function numberToWordsInternational(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(SCALES[scale] ? `${belowThousand(chunk)} ${SCALES[scale]}` : belowThousand(chunk));
    n = Math.floor(n / 1000);
    scale++;
  }
  if (n > 0) parts.unshift(`${numberToWordsInternational(n)} Quadrillion`);
  return parts.join(' ');
}

/**
 * Amount in words as printed on invoices.
 * INR: "Rupees Eleven Thousand Eight Hundred and Fifty Paise Only".
 * Others: "One Thousand Two Hundred US Dollars and Fifty Cents Only".
 */
export function amountInWords(amount: number, currency = 'INR'): string {
  const cur = getCurrency(currency);
  const negative = amount < 0;
  const value = roundTo(Math.abs(amount), cur.decimals);
  const major = Math.floor(value);
  const minorFactor = 10 ** cur.decimals;
  const minor = cur.minor ? Math.round((value - major) * minorFactor) : 0;
  const words = cur.code === 'INR' ? numberToWordsIndian : numberToWordsInternational;
  const sign = negative ? 'Minus ' : '';
  const minorText = minor && cur.minor ? ` and ${words(minor)} ${minor === 1 ? cur.minor[0] : cur.minor[1]}` : '';
  if (cur.code === 'INR') {
    // Indian invoices conventionally read "Rupees One Only", "Rupees Ten Only".
    return `${sign}${cur.major[1]} ${words(major)}${minorText} Only`;
  }
  const name = major === 1 ? cur.major[0] : cur.major[1];
  return `${sign}${words(major)} ${name}${minorText} Only`;
}
