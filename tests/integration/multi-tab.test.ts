import 'fake-indexeddb/auto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/core/factories';
import type { CollectionData, SalesDocument } from '../../src/core/model';
import type { StorageAdapter } from '../../src/data/adapter';
import { putOp } from '../../src/data/adapter';
import { HttpAdapter } from '../../src/data/http';
import { IndexedDbAdapter } from '../../src/data/indexeddb';
import { runRecurring, runStartupTasks, saveBusiness, saveParty, saveSalesDocument } from '../../src/store/actions';
import { StaleDataError } from '../../src/store/errors';
import { useStore } from '../../src/store/store';
import { createApp } from '../../server/app';
import { BackupStore } from '../../server/backups';
import { FileStore } from '../../server/fileStore';
import { sampleBusiness, sampleDoc, sampleParty } from '../fixtures/sample';

// R2 (code review 2026-11-07): a second tab or window works from the copy of the data it
// loaded at start. These tests open two "tabs" on the same storage, let one of them save,
// and check that the other one can neither reuse a document number nor overwrite a newer record.

/** One open tab or window: its own storage connection and its own copy of the data. */
interface Tab {
  adapter: StorageAdapter;
  data: CollectionData;
}

interface Backend {
  /** A new connection to the same storage, as a newly opened tab would make. */
  open(): Promise<StorageAdapter>;
  close(): Promise<void>;
}

async function indexedDbBackend(): Promise<Backend> {
  const name = `multi-tab-${Math.random().toString(36).slice(2)}`;
  const opened: IndexedDbAdapter[] = [];
  return {
    async open() {
      const a = await IndexedDbAdapter.open(name);
      opened.push(a);
      return a;
    },
    async close() {
      for (const a of opened) a.close();
    },
  };
}

async function serverBackend(): Promise<Backend> {
  const dir = await mkdtemp(join(tmpdir(), 'gst-tabs-'));
  const store = new FileStore(join(dir, 'data'));
  await store.init();
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  server.on('request', createApp({ store, backups: new BackupStore(join(dir, 'backups')), port, version: 'test' }));
  return {
    open: async () => new HttpAdapter('test', `http://127.0.0.1:${port}`),
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function openTab(backend: Backend): Promise<Tab> {
  const adapter = await backend.open();
  return { adapter, data: await adapter.loadAll() };
}

/** Run an action as `tab`. The app has one store per tab; here the singleton store is switched between them. */
async function inTab<T>(tab: Tab, action: () => Promise<T>): Promise<T> {
  useStore.setState({ adapter: tab.adapter, data: tab.data, boot: 'ready', unlocked: true });
  try {
    return await action();
  } finally {
    tab.data = useStore.getState().data;
  }
}

describe.each([
  ['browser storage (IndexedDB)', indexedDbBackend],
  ['local server (JSON files)', serverBackend],
] as const)('two tabs on %s', (_label, makeBackend) => {
  let backend: Backend;
  let draft: (overrides?: Partial<SalesDocument>) => SalesDocument;

  beforeEach(async () => {
    backend = await makeBackend();
    const biz = sampleBusiness();
    const party = sampleParty(biz.id);
    const settings = { ...defaultSettings(), activeBusinessId: biz.id, setupComplete: true };
    const first = await backend.open();
    await first.commit({ puts: [putOp('businesses', biz), putOp('clients', party), putOp('settings', settings)], removes: [] });
    draft = (overrides = {}) => sampleDoc(biz, party, [{ qty: 1, rate: 100 }], { status: 'DRAFT', number: '', ...overrides });
  });

  afterEach(async () => {
    await backend.close();
  });

  const stored = async () => (await backend.open()).loadAll();

  it('a stale tab cannot issue an invoice number another tab already issued', async () => {
    const a = await openTab(backend);
    const b = await openTab(backend);
    const first = await inTab(a, () => saveSalesDocument(draft(), true));
    expect(first.number).toBe('INV/26-27/0001');

    const second = draft();
    await expect(inTab(b, () => saveSalesDocument(second, true))).rejects.toThrow(StaleDataError);
    // The refusal loaded the latest data into tab B, so saving again takes the next number.
    const retry = await inTab(b, () => saveSalesDocument(second, true));
    expect(retry.number).toBe('INV/26-27/0002');
    expect((await stored()).invoices.map((d) => d.number).sort()).toEqual(['INV/26-27/0001', 'INV/26-27/0002']);
  });

  it('a save queued behind a refused save is refused too, not passed as based on the reloaded data', async () => {
    const a = await openTab(backend);
    const b = await openTab(backend);
    await inTab(a, () => saveSalesDocument(draft(), true));
    const [first, second] = await inTab(b, async () => {
      // Both saves are built from tab B's old copy before either reaches storage.
      const queued = [saveSalesDocument(draft(), true), saveSalesDocument(draft(), true)];
      return Promise.allSettled(queued);
    });
    expect(first.status === 'rejected' && first.reason).toBeInstanceOf(StaleDataError);
    expect(second.status === 'rejected' && second.reason).toBeInstanceOf(StaleDataError);
    expect((await stored()).invoices.map((d) => d.number)).toEqual(['INV/26-27/0001']);
  });

  it('two finalizes started together in one tab cannot take the same number', async () => {
    const a = await openTab(backend);
    const [first, second] = await inTab(a, () => Promise.allSettled([saveSalesDocument(draft(), true), saveSalesDocument(draft(), true)]));
    expect(first.status === 'fulfilled' && first.value.number).toBe('INV/26-27/0001');
    expect(second.status === 'rejected' && second.reason).toBeInstanceOf(StaleDataError);
    expect((await stored()).invoices.map((d) => d.number)).toEqual(['INV/26-27/0001']);
  });

  it('a number typed in one tab is not issued again by a stale tab', async () => {
    const a = await openTab(backend);
    const b = await openTab(backend);
    await inTab(a, () => saveSalesDocument(draft({ number: 'INV/26-27/0001' }), true));

    const second = draft();
    await expect(inTab(b, () => saveSalesDocument(second, true))).rejects.toThrow(StaleDataError);
    expect((await inTab(b, () => saveSalesDocument(second, true))).number).toBe('INV/26-27/0002');
    expect((await stored()).invoices.map((d) => d.number).sort()).toEqual(['INV/26-27/0001', 'INV/26-27/0002']);
  });

  it('a stale tab does not undo business settings saved in another tab', async () => {
    const a = await openTab(backend);
    const b = await openTab(backend);
    await inTab(a, () => saveBusiness({ ...a.data.businesses[0]!, phone: '9876543210' }));

    const doc = draft();
    await expect(inTab(b, () => saveSalesDocument(doc, true))).rejects.toThrow(StaleDataError);
    await inTab(b, () => saveSalesDocument(doc, true));
    const biz = (await stored()).businesses[0]!;
    expect(biz.phone).toBe('9876543210');
    expect(biz.series.TAX_INVOICE.nextNumber).toBe(2);
  });

  it('an editor opened before another tab saved the same record cannot overwrite it', async () => {
    const a = await openTab(backend);
    const b = await openTab(backend);
    const openedInB = b.data.clients[0]!;
    await inTab(a, () => saveParty({ ...a.data.clients[0]!, name: 'Name saved in tab A' }));

    const edited = { ...openedInB, phone: '1111111111' };
    await expect(inTab(b, () => saveParty(edited))).rejects.toThrow(StaleDataError);
    // Tab B has the latest data now, but the editor still holds the old copy: saving it again is refused too.
    await expect(inTab(b, () => saveParty(edited))).rejects.toThrow(/This record changed after you opened it/);
    const party = (await stored()).clients[0]!;
    expect(party.name).toBe('Name saved in tab A');
    expect(party.phone).not.toBe('1111111111');
  });

  it('recurring invoices due when two tabs start are created once', async () => {
    const source = draft({ status: 'FINAL', number: 'INV/26-27/0001', recurring: { enabled: true, frequency: 'MONTHLY', nextDate: '2026-11-01', endDate: '' } });
    await (await backend.open()).commit({ puts: [putOp('invoices', source)], removes: [] });
    const a = await openTab(backend);
    const b = await openTab(backend);
    expect(await inTab(a, () => runRecurring('2026-11-07'))).toBe(1);

    await expect(inTab(b, () => runRecurring('2026-11-07'))).rejects.toThrow(StaleDataError);
    expect(await inTab(b, () => runRecurring('2026-11-07'))).toBe(0);
    const copies = (await stored()).invoices.filter((d) => d.recurringSourceId === source.id);
    expect(copies.map((d) => d.number)).toEqual(['INV/26-27/0002']);
  });

  it('start-up housekeeping already done by another tab is skipped quietly', async () => {
    const party = (await stored()).clients[0]!;
    const expired = { id: 'trash_old', collection: 'clients' as const, recordId: 'pty_gone', businessId: party.businessId, label: 'Party Gone', record: party, deletedAt: '2020-01-01T00:00:00.000Z' };
    await (await backend.open()).commit({ puts: [putOp('trash', expired)], removes: [] });
    const a = await openTab(backend);
    const b = await openTab(backend);
    expect(await inTab(a, () => runStartupTasks())).toEqual(['1 item(s) older than 30 days were removed from the Trash.']);
    expect(await inTab(b, () => runStartupTasks())).toEqual([]);
    expect((await stored()).trash).toEqual([]);
  });
});
