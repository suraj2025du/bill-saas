import { describe, expect, it } from 'vitest';
import { barcodeSvgMarkup, code128Bars, qrSvgMarkup, upiLink } from '../../src/print/codes';

describe('barcodes and QR codes', () => {
  it('encodes CODE-128 bars for a document number', () => {
    const bars = code128Bars('INV/26-27/0001');
    expect(bars).toMatch(/^[01]+$/);
    expect(bars).toHaveLength(178);
    expect(bars.startsWith('11010010000')).toBe(true); // start code B
    expect(bars.endsWith('1100011101011')).toBe(true); // stop pattern
    expect(code128Bars('')).toBe('');
    expect(code128Bars('बिल')).toBe(''); // CODE-128 cannot encode Devanagari
  });

  it('draws the barcode with one unit per module and no style attributes', () => {
    const svg = barcodeSvgMarkup('INV/26-27/0001', 28);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="178" height="28" viewBox="0 0 178 28"')).toBe(true);
    expect(svg).not.toContain('style=');
    const width = [...svg.matchAll(/<rect x="\d+" width="(\d+)"/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(width).toBe([...code128Bars('INV/26-27/0001')].filter((b) => b === '1').length);
    expect(barcodeSvgMarkup('', 28)).toBe('');
  });

  it('draws QR codes as SVG paths with a quiet zone and explicit dimension attributes', () => {
    const svg = qrSvgMarkup(upiLink('sharma@hdfcbank', 'Sharma Traders', 590, 'INR', 'INV/26-27/0001'), 88);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="88" height="88" viewBox="0 0 (\d+) \1"/);
    expect(svg).toContain('<path d="M');
    expect(svg).not.toContain('style=');
    expect(qrSvgMarkup('x'.repeat(5000))).toBe(''); // too long for a QR code
  });

  it('builds UPI links with the amount only for rupees', () => {
    expect(upiLink('a@b', 'Shop & Co', 590, 'INR', 'INV/1')).toBe('upi://pay?pa=a%40b&pn=Shop%20%26%20Co&am=590.00&cu=INR&tn=INV%2F1');
    expect(upiLink('a@b', 'Shop', 10, 'USD', '')).toBe('upi://pay?pa=a%40b&pn=Shop&cu=INR');
  });
});
