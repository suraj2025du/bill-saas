/** Save a blob as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function downloadJson(value: unknown, filename: string): void {
  downloadText(JSON.stringify(value, null, 2), filename, 'application/json');
}

export function downloadCsv(csv: string, filename: string): void {
  downloadText(csv, filename, 'text/csv;charset=utf-8');
}

/** Several text files (e.g. one CSV per GSTR-1 table) in one ZIP download. */
export async function downloadZip(files: readonly { name: string; text: string }[], filename: string): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const f of files) zip.file(safeFileName(f.name), f.text);
  downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), filename);
}

/** File name without characters Windows refuses (\ / : * ? " < > |). */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'download';
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}

export function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

/** Ask the user for a file (returns null when the picker is closed). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Shrink an image (logo / signature / bill photo) to keep backups small. */
export async function imageToDataUrl(file: File, maxSide = 600, quality = 0.85): Promise<string> {
  const src = await readFileDataUrl(file);
  if (file.type === 'image/svg+xml') return src;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('This file is not an image the browser can read.'));
    i.src = src;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
}
