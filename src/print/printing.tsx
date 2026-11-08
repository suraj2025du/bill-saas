import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import type { PrintSettings, ThermalWidth } from '../core/model';

export interface PageSpec {
  size: 'A4' | 'A5' | 'THERMAL';
  marginsMm: PrintSettings['marginsMm'];
  thermalWidth: ThermalWidth;
}

const MM_PER_PX = 25.4 / 96;
const PAGE: Record<'A4' | 'A5', { w: number; h: number }> = { A4: { w: 210, h: 297 }, A5: { w: 148, h: 210 } };

export function pageSpec(settings: PrintSettings, size: PageSpec['size']): PageSpec {
  return { size, marginsMm: settings.marginsMm, thermalWidth: settings.thermalWidth };
}

// ---------------------------------------------------------------- browser printing

interface PrintJob {
  id: number;
  node: ReactNode;
  page: PageSpec;
}

const usePrintJob = create<{ job: PrintJob | null }>(() => ({ job: null }));
let jobSeq = 0;

async function settle(root: ParentNode): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
}

function pageRule(page: PageSpec, root: HTMLElement): string {
  if (page.size === 'THERMAL') {
    const sheet = root.querySelector<HTMLElement>('.print-sheet');
    const h = sheet ? Math.ceil(sheet.scrollHeight * MM_PER_PX) + 4 : 297;
    return `@page { size: ${page.thermalWidth}mm ${h}mm; margin: 0; }`;
  }
  const m = page.marginsMm;
  return [
    `@page { size: ${page.size} portrait; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`,
    // The browser applies the margins on every page, so the sheet itself drops its padding.
    `@media print { #print-root .print-sheet[data-page="${page.size}"] { padding: 0 !important; width: auto !important; min-height: 0 !important; } }`,
  ].join('\n');
}

/**
 * Add the @page rules for one print job; returns a function that removes them. A constructed
 * stylesheet is used because the Content-Security-Policy blocks inline <style> elements.
 */
function addPageStyle(css: string): () => void {
  if ('adoptedStyleSheets' in document && typeof CSSStyleSheet.prototype.replaceSync === 'function') {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  }
  // Older browsers: an inline <style> (works when the app is not served with the strict CSP).
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return () => style.remove();
}

/** Print with the browser's dialog (Save as PDF is available there too). */
export async function printNode(node: ReactNode, page: PageSpec): Promise<void> {
  const id = ++jobSeq;
  usePrintJob.setState({ job: { id, node, page } });
  const root = document.getElementById('print-root');
  if (!root) throw new Error('Print area is missing.');
  await settle(root);
  const removeStyle = addPageStyle(pageRule(page, root));
  const cleanup = () => {
    removeStyle();
    if (usePrintJob.getState().job?.id === id) usePrintJob.setState({ job: null });
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  // Some browsers do not fire afterprint; clean up anyway once print() returns.
  window.setTimeout(cleanup, 1500);
}

/** Mount once: renders the current print job into #print-root. */
export function PrintHost() {
  const job = usePrintJob((s) => s.job);
  const target = typeof document !== 'undefined' ? document.getElementById('print-root') : null;
  if (!job || !target) return null;
  return createPortal(<div key={job.id}>{job.node}</div>, target);
}

// ---------------------------------------------------------------- on-screen preview

/** Shows print sheets (real mm sizes) scaled down to fit the available width. */
export function ScaledPreview({ children, maxScale = 1 }: { children: ReactNode; maxScale?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const update = () => {
      const w = i.scrollWidth || 1;
      const scale = Math.min(maxScale, o.clientWidth / w);
      setBox({ scale, height: i.scrollHeight * scale });
    };
    const ro = new ResizeObserver(update);
    ro.observe(o);
    ro.observe(i);
    update();
    return () => ro.disconnect();
  }, [maxScale]);
  return (
    <div ref={outer} className="w-full overflow-hidden" style={{ height: box.height || undefined }}>
      <div ref={inner} className="preview-stack" style={{ transform: `scale(${box.scale})`, transformOrigin: 'top left', width: 'max-content' }}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- PDF

/** Render a node off-screen, wait for it to paint, run `fn`, then clean up. */
async function withOffscreen<T>(node: ReactNode, fn: (el: HTMLElement) => Promise<T>): Promise<T> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;background:#fff;z-index:-1;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<>{node}</>);
    await settle(host);
    await new Promise((r) => setTimeout(r, 30));
    return await fn(host);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Row / block bottoms (in sheet pixels) where a page may break without cutting content. */
function safeBreaks(sheet: HTMLElement): number[] {
  const top = sheet.getBoundingClientRect().top;
  const marks = new Set<number>();
  sheet.querySelectorAll('tr, .avoid-break').forEach((el) => {
    const r = el.getBoundingClientRect();
    marks.add(Math.round(r.bottom - top));
  });
  return [...marks].sort((a, b) => a - b);
}

async function sheetPages(sheet: HTMLElement, page: PageSpec): Promise<{ images: string[]; wMm: number; hMm: number }> {
  const { default: html2canvas } = await import('html2canvas-pro');
  const scale = 2;
  const canvas = await html2canvas(sheet, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
  if (page.size === 'THERMAL') {
    const wMm = page.thermalWidth;
    return { images: [canvas.toDataURL('image/jpeg', 0.92)], wMm, hMm: (canvas.height / canvas.width) * wMm };
  }
  const size = PAGE[page.size];
  const pxPerMm = canvas.width / size.w;
  const pageH = Math.floor(size.h * pxPerMm);
  const mt = Math.round(page.marginsMm.top * pxPerMm);
  const mb = Math.round(page.marginsMm.bottom * pxPerMm);
  if (canvas.height <= pageH + 2) return { images: [canvas.toDataURL('image/jpeg', 0.92)], wMm: size.w, hMm: size.h };
  const breaks = safeBreaks(sheet).map((b) => b * scale);
  const images: string[] = [];
  let start = 0;
  let first = true;
  while (start < canvas.height - 2) {
    const room = pageH - mb - (first ? 0 : mt);
    let end = Math.min(canvas.height, start + room);
    if (end < canvas.height) {
      const fit = breaks.filter((b) => b > start + room * 0.3 && b <= end);
      if (fit.length) end = fit[fit.length - 1];
    }
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = pageH;
    const ctx = out.getContext('2d');
    if (!ctx) break;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, start, canvas.width, end - start, 0, first ? 0 : mt, canvas.width, end - start);
    images.push(out.toDataURL('image/jpeg', 0.92));
    start = end;
    first = false;
  }
  return { images, wMm: size.w, hMm: size.h };
}

/** PDF of every sheet in a node (all Rule 48 copies; long invoices split between rows). */
export async function nodeToPdf(node: ReactNode, page: PageSpec): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  return withOffscreen(node, async (host) => {
    const sheets = Array.from(host.querySelectorAll<HTMLElement>('.print-sheet'));
    if (!sheets.length) throw new Error('Nothing to export.');
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const sheet of sheets) {
      const { images, wMm, hMm } = await sheetPages(sheet, page);
      for (const img of images) {
        if (!pdf) pdf = new jsPDF({ unit: 'mm', format: [wMm, hMm], orientation: wMm > hMm ? 'landscape' : 'portrait', compress: true });
        else pdf.addPage([wMm, hMm], wMm > hMm ? 'landscape' : 'portrait');
        pdf.addImage(img, 'JPEG', 0, 0, wMm, hMm, undefined, 'FAST');
      }
    }
    return pdf!.output('blob');
  });
}

export interface BulkItem {
  name: string;
  node: ReactNode;
  page: PageSpec;
}

/** Many PDFs into one ZIP with progress; stops early when `signal` aborts. */
export async function bulkPdfZip(items: readonly BulkItem[], onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<Blob | null> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) return null;
    const it = items[i];
    let name = `${it.name.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
    for (let n = 2; used.has(name); n++) name = `${it.name}-${n}.pdf`;
    used.add(name);
    zip.file(name, await nodeToPdf(it.node, it.page));
    onProgress(i + 1, items.length);
  }
  if (signal.aborted) return null;
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
