import 'fake-indexeddb/auto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBooks, ledgerStatement, trialBalance } from '../../src/core/accounting/reports';
import { DOC_TYPES } from '../../src/core/docs/docTypes';
import { buildPaymentIndex, purchasePaymentSummary, salesPaymentSummary } from '../../src/core/docs/payments';
import { newPayment } from '../../src/core/factories';
import type { CollectionData } from '../../src/core/model';
import { COLLECTIONS } from '../../src/core/model';
import { validateSnapshot } from '../../src/core/schema';
import type { StorageAdapter } from '../../src/data/adapter';
import { IndexedDbAdapter } from '../../src/data/indexeddb';
import { savePayment } from '../../src/store/actions';
import { StaleDataError } from '../../src/store/errors';
import { useStore } from '../../src/store/store';
import { createApp } from '../../server/app';
import { BackupStore } from '../../server/backups';
import { FileStore } from '../../server/fileStore';

// A backup written by the app BEFORE payments had a currency (review R1): sample data plus dollar
// payments recorded through the old payment dialog, saved by the real local server and backed up by
// it (generated 2026-11-07, before the batch-02 fixes). `.expected.json` holds the payment statuses
// that version showed. The data must still open and restore everywhere, and show the same statuses.
const FIXTURE = fileURLToPath(new URL('../fixtures/backup-v1-2026-11-07.json', import.meta.url));
const EXPECTED = fileURLToPath(new URL('../fixtures/backup-v1-2026-11-07.expected.json', import.meta.url));
const TODAY = '2026-11-07';
const H = { Host: '127.0.0.1:47371', 'X-GST-Client': '1' };

let backup: unknown;
let expected: { documents: unknown[] };
let dir: string;

beforeEach(async () => {
  backup = JSON.parse(await readFile(FIXTURE, 'utf8'));
  const file = JSON.parse(await readFile(EXPECTED, 'utf8')) as { documents: { id: string }[] };
  expected = { documents: byId(file.documents) };
  dir = await mkdtemp(join(tmpdir(), 'gst-old-data-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Payment status of every final invoice and bill, as the old version recorded them (by id: storage may reorder). */
function statuses(data: CollectionData) {
  const business = data.businesses[0]!;
  const index = buildPaymentIndex(data.receipts, data.vouchers, data.invoices, data.purchases, business);
  return byId([
    ...data.invoices
      .filter((d) => d.status === 'FINAL' && DOC_TYPES[d.docType].payable)
      .map((d) => ({ kind: 'invoice', id: d.id, number: d.number, currency: d.currency, ...pick(salesPaymentSummary(d, index, TODAY)) })),
    ...data.purchases
      .filter((b) => b.status === 'FINAL')
      .map((b) => ({ kind: 'bill', id: b.id, number: b.billNo, currency: b.currency, ...pick(purchasePaymentSummary(b, index, TODAY)) })),
  ]);
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

function pick(s: { status: string; total: number; paid: number; balance: number }) {
  return { status: s.status, total: s.total, paid: s.paid, balance: s.balance };
}

function snapshot() {
  const v = validateSnapshot(backup);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.snapshot;
}

function booksOf(data: CollectionData) {
  const business = data.businesses[0]!;
  return buildBooks({ ...data, business, parties: data.clients });
}

async function serverApp() {
  const store = new FileStore(join(dir, 'data'));
  await store.init();
  const backups = new BackupStore(join(dir, 'backups'));
  await backups.init();
  return { store, backups, app: createApp({ store, backups, port: 47371, version: 'test' }) };
}

describe('data saved before payments had a currency (review R1)', () => {
  it('passes the backup integrity check and shows the same payment statuses as before', () => {
    const data = snapshot().collections;
    expect(data.receipts.every((r) => r.currency === undefined && r.exchangeRate === undefined)).toBe(true);
    expect(statuses(data)).toEqual(expected.documents);
  });

  it('restores into browser storage, also from a stored backup, with the same statuses', async () => {
    const db = await IndexedDbAdapter.open(`old-data-${Math.random().toString(36).slice(2)}`);
    await db.replaceAll(snapshot());
    expect(statuses(await db.loadAll())).toEqual(expected.documents);
    const kept = await db.createBackup('manual');
    await db.replaceAll({ ...snapshot(), collections: { ...snapshot().collections, receipts: [] } });
    await db.restoreBackup(kept.id);
    expect(statuses(await db.loadAll())).toEqual(expected.documents);
    db.close();
  });

  it('restores on the local server from a file and from its backup folder, with the same statuses', async () => {
    const { store, backups, app } = await serverApp();
    const fromFile = await request(app).post('/api/restore').set(H).send(backup as object);
    expect(fromFile.status, JSON.stringify(fromFile.body)).toBe(204);
    expect(statuses(store.getAll())).toEqual(expected.documents);

    const id = 'backup-20261107-050000-manual-0a1b2c';
    await copyFile(FIXTURE, join(backups.dir, `${id}.json`));
    await store.replaceAll({ ...snapshot(), collections: { ...snapshot().collections, receipts: [] } });
    const inPlace = await request(app).post(`/api/backups/${id}/restore`).set(H).send({});
    expect(inPlace.status, JSON.stringify(inPlace.body)).toBe(204);
    expect(statuses(store.getAll())).toEqual(expected.documents);
  });

  it('opens as the live data folder of the local server, with the same statuses', async () => {
    const data = snapshot().collections;
    await mkdir(join(dir, 'live'), { recursive: true });
    for (const c of COLLECTIONS) await writeFile(join(dir, 'live', `${c}.json`), JSON.stringify(data[c]));
    const store = new FileStore(join(dir, 'live'));
    await store.init();
    expect(statuses(store.getAll())).toEqual(expected.documents);
  });

  it('posts the old dollar payments at their invoice rates: no exchange difference, and the ledger shows the dollar balance due', () => {
    const data = snapshot().collections;
    const books = booksOf(data);
    const gulf = data.invoices.find((d) => d.number === 'INV/26-27/0005')!;
    // INV/26-27/0005: USD 3,900 at 84.25, USD 1,500 received; INV/26-27/0008: USD 3,900 at 83.50, paid in full.
    expect(ledgerStatement(books, `party:${gulf.partyId}`, '2026-04-01', TODAY).closing).toBe(2_400 * 84.25);
    expect(books.journal.some((e) => e.lines.some((l) => l.ledgerId === 'sys:fx-gain-loss'))).toBe(false);
    const tb = trialBalance(books, TODAY);
    expect(tb.totalDr).toBe(tb.totalCr);
  });

  it('saves a new dollar payment on restored data with its currency and rate, and still refuses a stale copy (review R2)', async () => {
    const name = `old-data-tabs-${Math.random().toString(36).slice(2)}`;
    const first = await IndexedDbAdapter.open(name);
    await first.replaceAll(snapshot());
    const tabA = { adapter: (await IndexedDbAdapter.open(name)) as StorageAdapter, data: await first.loadAll() };
    const tabB = { adapter: (await IndexedDbAdapter.open(name)) as StorageAdapter, data: await first.loadAll() };
    const inTab = async <T>(tab: typeof tabA, action: () => Promise<T>) => {
      useStore.setState({ adapter: tab.adapter, data: tab.data, boot: 'ready', unlocked: true });
      try {
        return await action();
      } finally {
        tab.data = useStore.getState().data;
      }
    };
    const gulf = tabA.data.invoices.find((d) => d.number === 'INV/26-27/0005')!;
    const bank = tabA.data.businesses[0]!.bankAccounts[0]!.id;
    const pay = () =>
      newPayment(gulf.businessId, 'IN', { docId: gulf.id, partyId: gulf.partyId, partyName: gulf.party.name, amount: 2_400, currency: 'USD', exchangeRate: 84.5, date: TODAY, mode: 'BANK', bankAccountId: bank });

    const saved = await inTab(tabA, () => savePayment(pay()));
    expect(saved).toMatchObject({ number: 'RCT/26-27/0006', currency: 'USD', exchangeRate: 84.5 });
    await expect(inTab(tabB, () => savePayment(pay()))).rejects.toThrow(StaleDataError);

    const data = await first.loadAll();
    expect(statuses(data).find((d) => d.number === 'INV/26-27/0005')).toMatchObject({ status: 'PAID', balance: 0 });
    const books = booksOf(data);
    expect(ledgerStatement(books, `party:${gulf.partyId}`, '2026-04-01', TODAY).closing).toBe(0);
    expect(ledgerStatement(books, 'sys:fx-gain-loss', '2026-04-01', TODAY).closing).toBe(-600);
    first.close();
  });
});
