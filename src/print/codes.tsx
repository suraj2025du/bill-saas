import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { useMemo } from 'react';

/**
 * QR codes and barcodes are drawn as SVG and shown as <img src="data:image/svg+xml,...">.
 * As images they print sharply, need no inline style (the CSP allows none) and the PDF
 * renderer draws them directly instead of re-serialising inline SVG.
 */
const svgImage = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** SVG markup of a QR code with a 2-module quiet zone, or '' when the text does not fit. */
export function qrSvgMarkup(text: string, size?: number): string {
  try {
    const code = QRCode.create(text || ' ', { errorCorrectionLevel: 'M' });
    const n = code.modules.size;
    const data = code.modules.data;
    const quiet = 2;
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) if (data[y * n + x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
    const s = n + quiet * 2;
    const dim = size ?? s;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
  } catch {
    return '';
  }
}

/** QR code image, built synchronously so it is ready the moment we print. */
export function QrSvg({ text, size = 88, className, title }: { text: string; size?: number; className?: string; title?: string }) {
  const svg = useMemo(() => qrSvgMarkup(text, size), [text, size]);
  if (!svg) return null;
  // React applies `style` through the CSSOM, which the CSP allows; it keeps the exact size.
  return <img src={svgImage(svg)} width={size} height={size} style={{ width: size, height: size }} className={className} alt={title ?? 'QR code'} />;
}

/**
 * CODE-128 modules for `value` as a string of 1 (bar) and 0 (space), or '' when the text
 * cannot be encoded. JsBarcode's object renderer only encodes; it never touches the DOM.
 */
export function code128Bars(value: string): string {
  if (!value) return '';
  try {
    const out: { encodings?: { data: string }[] } = {};
    JsBarcode(out, value, { format: 'CODE128' });
    return (out.encodings ?? []).map((e) => e.data).join('');
  } catch {
    return '';
  }
}

/** SVG markup of a CODE-128 barcode (one unit per module, `height` units tall), or ''. */
export function barcodeSvgMarkup(value: string, height: number, widthPx?: number): string {
  const bars = code128Bars(value);
  if (!bars) return '';
  let rects = '';
  for (let i = 0; i < bars.length; ) {
    if (bars[i] !== '1') {
      i++;
      continue;
    }
    let j = i;
    while (bars[j] === '1') j++;
    rects += `<rect x="${i}" width="${j - i}" height="${height}"/>`;
    i = j;
  }
  const w = widthPx ?? bars.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${bars.length} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${bars.length}" height="${height}" fill="#ffffff"/><g fill="#000000">${rects}</g></svg>`;
}

/**
 * Barcode image (JsBarcode's own SVG renderer writes inline style attributes, which the
 * CSP blocks, so the bars are drawn here). `width` is the width of one module in px.
 */
export function Barcode({ value, height = 34, width = 1.3, className }: { value: string; height?: number; width?: number; className?: string }) {
  const bars = useMemo(() => code128Bars(value), [value]);
  const w = Math.round(bars.length * width);
  const svg = useMemo(() => barcodeSvgMarkup(value, height, w), [value, height, w]);
  if (!svg) return null;
  return <img src={svgImage(svg)} width={w} height={height} style={{ width: w, height, maxWidth: 'none' }} className={className} alt={`Barcode ${value}`} />;
}

/** UPI deep link understood by every UPI app (amount only for INR). */
export function upiLink(vpa: string, payee: string, amount: number, currency: string, note: string): string {
  const p = new URLSearchParams({ pa: vpa, pn: payee });
  if (currency === 'INR' && amount > 0) p.set('am', amount.toFixed(2));
  p.set('cu', 'INR');
  if (note) p.set('tn', note.slice(0, 50));
  return `upi://pay?${p.toString().replace(/\+/g, '%20')}`;
}
