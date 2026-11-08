import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newGodown } from '../../src/core/factories';
import { makeSnapshot } from '../../src/core/schema';
import { IndexedDbAdapter, MAX_BROWSER_BACKUPS } from '../../src/data/indexeddb';
import { ApiError, HttpAdapter, probeServer } from '../../src/data/http';
import { buildSampleData } from '../../src/data/seed';
import { ConflictError, emptyBatch, putOp } from '../../src/data/adapter';
import { createApp } from '../../server/app';
import { BackupStore } from '../../server/backups';
import { FileStore } from '../../server/fileStore';

describe('IndexedDbAdapter', () => {
  it('commits, loads and removes records atomically', async () => {
    const db = await IndexedDbAdapter.open('test-commit');
    expect(db.kind).toBe('browser');
    expect((await db.loadAll()).invoices).toEqual([]);
    const g = newGodown('biz_1', 'Main');
    await db.commit({ puts: [putOp('godowns', g)], removes: [] });
    expect((await db.loadAll()).godowns).toHaveLength(1);
    await db.commit({ puts: [], removes: [{ collection: 'godowns', id: g.id }] });
    expect((await db.loadAll()).godowns).toHaveLength(0);
    await db.commit(emptyBatch());
    const keep = newGodown('biz_1', 'Keep');
    await db.commit({ puts: [putOp('godowns', keep)], removes: [] });
    const failing = db.commit({
      puts: [putOp('godowns', { ...keep, name: 'Changed' }), putOp('godowns', { ...newGodown('biz_1', 'Bad'), fn: () => 1 } as never)],
      removes: [],
    });
    await expect(failing).rejects.toThrow();
    expect((await db.loadAll()).godowns.map((x) => x.name)).toEqual(['Keep']);
    db.close();
  });

  it('restores a snapshot and rolls back when any record fails', async () => {
    const db = await IndexedDbAdapter.open('test-restore');
    const data = buildSampleData('2026-10-29');
    await db.replaceAll(makeSnapshot(data));
    expect((await db.loadAll()).invoices).toHaveLength(data.invoices.length);
    const bad = makeSnapshot({ ...data, products: [{ ...data.products[0]!, oops: () => 1 } as never] });
    await expect(db.replaceAll(bad)).rejects.toThrow();
    const after = await db.loadAll();
    expect(after.invoices).toHaveLength(data.invoices.length);
    expect(after.products).toHaveLength(data.products.length);
    db.close();
  });

  it('refuses a whole batch written from an old copy, as a second tab would send (review R2)', async () => {
    const tabA = await IndexedDbAdapter.open('test-conflict');
    const tabB = await IndexedDbAdapter.open('test-conflict');
    const g = newGodown('biz_1', 'Main');
    await tabA.commit({ puts: [putOp('godowns', g)], removes: [] });
    const seenByB = (await tabB.loadAll()).godowns[0]!;
    const newer = { ...g, name: 'Renamed in A', updatedAt: '2099-01-01T00:00:00.000Z' };
    await tabA.commit({ puts: [{ ...putOp('godowns', newer), base: seenByB.updatedAt }], removes: [] });

    const other = newGodown('biz_1', 'Other');
    const stale = tabB.commit({
      puts: [{ ...putOp('godowns', other), base: null }, { ...putOp('godowns', { ...seenByB, name: 'Renamed in B' }), base: seenByB.updatedAt }],
      removes: [],
    });
    await expect(stale).rejects.toBeInstanceOf(ConflictError);
    await expect(tabB.commit({ puts: [], removes: [{ collection: 'godowns', id: g.id, base: seenByB.updatedAt }] })).rejects.toThrow(ConflictError);
    await expect(tabB.commit({ puts: [{ ...putOp('godowns', newer), base: null }], removes: [] })).rejects.toThrow(/nothing was saved/);
    expect((await tabB.loadAll()).godowns.map((x) => x.name)).toEqual(['Renamed in A']);
    // With the version it has now, tab B can save.
    await tabB.commit({ puts: [{ ...putOp('godowns', { ...newer, name: 'Renamed in B' }), base: newer.updatedAt }], removes: [] });
    expect((await tabA.loadAll()).godowns.map((x) => x.name)).toEqual(['Renamed in B']);
    tabA.close();
    tabB.close();
  });

  it('restores a local backup in place and keeps a pre-restore backup', async () => {
    const db = await IndexedDbAdapter.open('test-restore-backup');
    const data = buildSampleData('2026-10-29');
    await db.replaceAll(makeSnapshot(data));
    const backup = await db.createBackup('manual');
    await db.commit({ puts: [putOp('godowns', newGodown(data.businesses[0]!.id, 'After the backup'))], removes: [] });
    await db.restoreBackup(backup.id);
    expect((await db.loadAll()).godowns.map((g) => g.name)).not.toContain('After the backup');
    expect((await db.listBackups()).map((b) => b.reason)).toContain('pre-restore');
    await expect(db.restoreBackup('backup_missing')).rejects.toThrow(/not found/);
    const raw = await openDB('test-restore-backup');
    await raw.put('_backups', { id: 'backup_damaged', createdAt: new Date().toISOString(), reason: 'manual', sizeBytes: 1, snapshot: { app: 'something-else' } });
    raw.close();
    await expect(db.restoreBackup('backup_damaged')).rejects.toThrow(/integrity check/);
    expect((await db.loadAll()).invoices).toHaveLength(data.invoices.length);
    db.close();
  });

  it('keeps a bounded list of local backups', async () => {
    const db = await IndexedDbAdapter.open('test-backups');
    await db.commit({ puts: [putOp('godowns', newGodown('biz_1', 'Main'))], removes: [] });
    let last = await db.createBackup('manual');
    for (let i = 0; i < MAX_BROWSER_BACKUPS + 1; i++) last = await db.createBackup('auto');
    const list = await db.listBackups();
    expect(list).toHaveLength(MAX_BROWSER_BACKUPS);
    const snap = await db.readBackup(last.id);
    expect(snap.collections.godowns).toHaveLength(1);
    await expect(db.readBackup('backup_missing')).rejects.toThrow(/not found/);
    db.close();
  });
});

describe('HttpAdapter against the real server', () => {
  let dir: string;
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gst-http-'));
    const store = new FileStore(join(dir, 'data'));
    await store.init();
    const backups = new BackupStore(join(dir, 'backups'));
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    server.on('request', createApp({ store, backups, port, version: '9.9.9' }));
    base = `http://127.0.0.1:${port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });

  afterAll(async () => {
    await close();
    await rm(dir, { recursive: true, force: true });
  });

  it('detects the server', async () => {
    expect(await probeServer(base)).toMatchObject({ ok: true, version: '9.9.9' });
    expect((await probeServer('http://127.0.0.1:9', 300)).ok).toBe(false);
  });

  it('round-trips data, restores and backs up', async () => {
    const api = new HttpAdapter('test', base);
    expect(api.kind).toBe('server');
    await api.commit(emptyBatch());
    await api.commit({ puts: [putOp('godowns', newGodown('biz_1', 'Main'))], removes: [] });
    expect((await api.loadAll()).godowns).toHaveLength(1);
    const data = buildSampleData('2026-10-29');
    await api.replaceAll(makeSnapshot(data));
    expect((await api.loadAll()).invoices).toHaveLength(data.invoices.length);
    const b = await api.createBackup('manual');
    expect((await api.listBackups()).map((x) => x.id)).toContain(b.id);
    expect((await api.readBackup(b.id)).collections.invoices).toHaveLength(data.invoices.length);
  });

  it('surfaces server validation errors', async () => {
    const api = new HttpAdapter('test', base);
    const err = await api.commit({ puts: [{ collection: 'nope' as never, record: { id: 'x' } as never }], removes: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).details.length).toBe(1);
    const bad = await api.replaceAll({ app: 'x' } as never).catch((e) => e);
    expect((bad as ApiError).message).toMatch(/integrity check/);
    const missing = await api.readBackup('backup-20260101-000000-auto-abcdef').catch((e) => e);
    expect((missing as ApiError).status).toBe(404);
  });

  it('reports a write from an old copy as a ConflictError naming the record (review R2)', async () => {
    const api = new HttpAdapter('test', base);
    const g = newGodown('biz_1', 'Shared');
    await api.commit({ puts: [{ ...putOp('godowns', g), base: null }], removes: [] });
    const err = await api.commit({ puts: [{ ...putOp('godowns', { ...g, name: 'Again' }), base: null }], removes: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).details).toEqual([`godowns ${g.id}`]);
    expect((await api.loadAll()).godowns.find((x) => x.id === g.id)!.name).toBe('Shared');
  });

  it('restores a server backup in place (review Y11)', async () => {
    const api = new HttpAdapter('test', base);
    const data = buildSampleData('2026-10-29');
    await api.replaceAll(makeSnapshot(data));
    const b = await api.createBackup('manual');
    await api.commit({ puts: [putOp('godowns', newGodown(data.businesses[0]!.id, 'After the backup'))], removes: [] });
    await api.restoreBackup(b.id);
    const after = await api.loadAll();
    expect(after.godowns.map((g) => g.name)).not.toContain('After the backup');
    expect(after.invoices).toHaveLength(data.invoices.length);
    expect((await api.listBackups()).map((x) => x.reason)).toContain('pre-restore');
  });
});
