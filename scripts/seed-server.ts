import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSampleData } from '../src/data/seed';
import { COLLECTIONS, type CollectionName } from '../src/core/model';

const dataDir = resolve(process.cwd(), '_system', 'data');
mkdirSync(dataDir, { recursive: true });

const sampleData = buildSampleData();

for (const col of COLLECTIONS) {
  const filePath = resolve(dataDir, `${col}.json`);
  const items = sampleData[col as CollectionName] || [];
  writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');
}

console.log(`Successfully seeded ${COLLECTIONS.length} collections into ${dataDir}`);
