// Writes release/Free-GST-Billing-<version>.zip: the built app, the bundled server and the
// launcher. It runs with Node.js alone (no npm install). Run "npm run build" first.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

for (const f of ['dist/index.html', 'dist-server/server.mjs']) {
  if (!existsSync(join(root, f))) {
    console.error(`Missing ${f}: run "npm run build" first.`);
    process.exit(1);
  }
}

const name = `Free-GST-Billing-${pkg.version}`;
const zip = new JSZip();
const folder = zip.folder(name);
const add = (rel) => {
  const abs = join(root, rel);
  if (statSync(abs).isDirectory()) for (const entry of readdirSync(abs)) add(join(rel, entry));
  else folder.file(rel.split(sep).join('/'), readFileSync(abs));
};
for (const rel of ['dist', 'dist-server', 'server.js', 'Start-GST-Billing.cmd', 'README.md', '.env.example']) add(rel);

// The release needs no dependencies or build scripts: only what server.js reads (name, version).
const releasePkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  private: true,
  type: pkg.type,
  license: pkg.license,
  engines: pkg.engines,
  scripts: { start: 'node server.js' },
};
folder.file('package.json', `${JSON.stringify(releasePkg, null, 2)}\n`);

mkdirSync(join(root, 'release'), { recursive: true });
const out = join(root, 'release', `${name}.zip`);
writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.info(`Wrote ${relative(root, out)}`);
