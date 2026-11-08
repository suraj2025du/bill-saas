// Free GST Billing — local server launcher.
// Serves the app and its REST API on http://127.0.0.1:47371 and stores data
// as JSON files in _system/data. Build once with `npm run build`, then `npm start`.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, 'dist-server', 'server.mjs');

if (!existsSync(entry) || !existsSync(join(here, 'dist', 'index.html'))) {
  console.error('The app is not built yet. Run "npm run build" once, then "npm start".');
  process.exit(1);
}

await import(pathToFileURL(entry).href);
