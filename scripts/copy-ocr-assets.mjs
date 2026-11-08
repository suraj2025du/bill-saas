// Copies the Tesseract OCR worker, WASM core and English language data from
// node_modules into public/ocr so the purchase-bill OCR helper works offline.
// Safe to run repeatedly; missing packages are reported, never fatal.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'ocr');
mkdirSync(out, { recursive: true });

const copied = [];
function copy(src, name) {
  cpSync(src, join(out, name));
  copied.push(name);
}

// 1. Worker script
const worker = join(nm, 'tesseract.js', 'dist', 'worker.min.js');
if (existsSync(worker)) copy(worker, 'worker.min.js');

// 2. WASM core (all SIMD / LSTM variants; tesseract.js picks one at runtime)
const coreDir = join(nm, 'tesseract.js-core');
if (existsSync(coreDir)) {
  for (const f of readdirSync(coreDir)) {
    if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copy(join(coreDir, f), f);
  }
}

// 3. English language data (prefer the smaller best_int model)
function findTrainedData(dir) {
  if (!existsSync(dir)) return null;
  const hits = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === 'eng.traineddata.gz') hits.push(p);
    }
  };
  walk(dir);
  return hits.find((p) => p.includes('best_int')) ?? hits[0] ?? null;
}
const lang = findTrainedData(join(nm, '@tesseract.js-data', 'eng'));
if (lang) copy(lang, 'eng.traineddata.gz');

if (copied.length === 0) {
  console.log('[copy-ocr-assets] OCR packages not installed yet; skipped.');
} else {
  console.log(`[copy-ocr-assets] copied ${copied.length} file(s) to public/ocr: ${copied.join(', ')}`);
}
