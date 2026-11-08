import { z } from 'zod';
import { ID_PATTERN } from './ids';
import type { CollectionData, CollectionName, DatabaseSnapshot } from './model';
import { APP_ID, COLLECTIONS, SCHEMA_VERSION } from './model';

// Structural checks for backup files. Objects are "loose": unknown fields are
// kept, so a backup from a newer minor version is not silently trimmed.

const id = z.string().regex(ID_PATTERN, 'invalid id');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const stamps = { createdAt: z.string(), updatedAt: z.string() };
const owned = { id, businessId: id, ...stamps };

const lineItem = z.looseObject({
  id: z.string(),
  name: z.string(),
  hsn: z.string(),
  qty: z.number(),
  unit: z.string(),
  rate: z.number(),
  discountPct: z.number(),
  gstRate: z.number(),
  cessRate: z.number(),
  taxable: z.number(),
  cgst: z.number(),
  sgst: z.number(),
  utgst: z.number(),
  igst: z.number(),
  cess: z.number(),
  total: z.number(),
});

const totals = z.looseObject({ taxable: z.number(), tax: z.number(), total: z.number(), net: z.number() });

export const RECORD_SCHEMAS = {
  businesses: z.looseObject({
    id,
    ...stamps,
    name: z.string().min(1),
    countryCode: z.string(),
    currency: z.string(),
    stateCode: z.string(),
    series: z.record(z.string(), z.looseObject({ prefix: z.string(), nextNumber: z.number() })),
    print: z.looseObject({ template: z.string() }),
    bankAccounts: z.array(z.looseObject({ id: z.string() })),
    upiAccounts: z.array(z.looseObject({ id: z.string() })),
  }),
  clients: z.looseObject({
    ...owned,
    name: z.string(),
    kind: z.enum(['CUSTOMER', 'SUPPLIER', 'BOTH']),
    billing: z.looseObject({}),
  }),
  products: z.looseObject({
    ...owned,
    name: z.string(),
    hsn: z.string(),
    unit: z.string(),
    gstRate: z.number(),
    sellingPrice: z.number(),
    purchasePrice: z.number(),
    openingStock: z.number(),
  }),
  godowns: z.looseObject({ ...owned, name: z.string() }),
  invoices: z.looseObject({
    ...owned,
    docType: z.enum(['TAX_INVOICE', 'BILL_OF_SUPPLY', 'QUOTATION', 'PROFORMA', 'CREDIT_NOTE', 'DEBIT_NOTE', 'DELIVERY_CHALLAN']),
    status: z.enum(['DRAFT', 'FINAL', 'CANCELLED']),
    number: z.string(),
    date: isoDate,
    items: z.array(lineItem),
    totals,
    party: z.looseObject({ name: z.string() }),
  }),
  purchases: z.looseObject({
    ...owned,
    status: z.enum(['FINAL', 'CANCELLED']),
    billNo: z.string(),
    billDate: isoDate,
    items: z.array(lineItem),
    totals,
  }),
  expenses: z.looseObject({ ...owned, date: isoDate, ledgerId: z.string(), total: z.number() }),
  receipts: z.looseObject({
    ...owned,
    direction: z.enum(['IN', 'OUT']),
    date: isoDate,
    amount: z.number(),
    // Missing on payments saved before 2026-11-07 (review R1).
    currency: z.string().regex(/^[A-Z]{3}$/, 'expected a currency code such as INR').optional(),
    exchangeRate: z.number().positive().optional(),
  }),
  vouchers: z.looseObject({
    ...owned,
    type: z.enum(['PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL']),
    date: isoDate,
    lines: z.array(z.looseObject({ ledgerId: z.string(), dr: z.number(), cr: z.number() })),
  }),
  ledgers: z.looseObject({ ...owned, name: z.string(), group: z.string() }),
  settings: z.looseObject({ id: z.literal('app'), setupComplete: z.boolean(), activeBusinessId: z.string() }),
  trash: z.looseObject({ id, collection: z.string(), recordId: z.string(), deletedAt: z.string(), record: z.unknown() }),
} satisfies Record<CollectionName, z.ZodType>;

export function emptyCollections(): CollectionData {
  const out = {} as Record<CollectionName, unknown[]>;
  for (const name of COLLECTIONS) out[name] = [];
  return out as CollectionData;
}

export function makeSnapshot(collections: CollectionData): DatabaseSnapshot {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), collections };
}

export type SnapshotResult = { ok: true; snapshot: DatabaseSnapshot } | { ok: false; errors: string[] };

/** Validate one record against its collection schema; returns an error message or ''. */
export function validateRecord(collection: CollectionName, record: unknown): string {
  const r = RECORD_SCHEMAS[collection].safeParse(record);
  if (r.success) return '';
  const issue = r.error.issues[0];
  return issue ? `${issue.path.join('.') || 'record'}: ${issue.message}` : 'invalid record';
}

/**
 * Full integrity check of a backup before it may replace live data:
 * file identity, version, every record's shape, unique ids and references.
 */
export function validateSnapshot(input: unknown, maxErrors = 50): SnapshotResult {
  const errors: string[] = [];
  const push = (m: string) => {
    if (errors.length < maxErrors) errors.push(m);
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['This file is not a backup (expected a JSON object).'] };
  }
  const root = input as Record<string, unknown>;
  if (root.app !== APP_ID) push('This file is not a Free GST Billing backup.');
  const version = root.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) push('Backup version is missing.');
  else if (version > SCHEMA_VERSION) push(`Backup is from a newer app version (schema ${version}); update the app first.`);
  const cols = root.collections;
  if (!cols || typeof cols !== 'object' || Array.isArray(cols)) {
    push('Backup has no data collections.');
    return { ok: false, errors };
  }
  const data = emptyCollections() as Record<CollectionName, unknown[]>;
  for (const name of COLLECTIONS) {
    const raw = (cols as Record<string, unknown>)[name];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      push(`${name}: expected a list of records.`);
      continue;
    }
    const seen = new Set<string>();
    raw.forEach((rec, i) => {
      const msg = validateRecord(name, rec);
      if (msg) {
        push(`${name}[${i}] ${msg}`);
        return;
      }
      const rid = (rec as { id: string }).id;
      if (seen.has(rid)) push(`${name}: duplicate id "${rid}".`);
      seen.add(rid);
    });
    data[name] = raw;
  }
  const typed = data as CollectionData;
  const bizIds = new Set(typed.businesses.map((b) => b.id));
  for (const name of COLLECTIONS) {
    if (name === 'businesses' || name === 'settings' || name === 'trash') continue;
    (data[name] as { businessId?: string }[]).forEach((rec, i) => {
      if (rec.businessId && !bizIds.has(rec.businessId)) push(`${name}[${i}]: refers to a business that is not in the backup.`);
    });
  }
  if (typed.settings.length > 1) push('settings: more than one settings record.');
  const active = typed.settings[0]?.activeBusinessId;
  if (active && !bizIds.has(active)) push('settings: the active business is not in the backup.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    snapshot: {
      app: APP_ID,
      schemaVersion: version as number,
      exportedAt: typeof root.exportedAt === 'string' ? root.exportedAt : new Date().toISOString(),
      collections: typed,
    },
  };
}
