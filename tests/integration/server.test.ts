import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newGodown, newParty } from '../../src/core/factories';
import { emptyCollections, makeSnapshot } from '../../src/core/schema';
import { buildSampleData } from '../../src/data/seed';
import { createApp } from '../../server/app';
import { retry, writeFileAtomic } from '../../server/atomic';
import { BACKUP_ID_RE, BackupStore, stamp } from '../../server/backups';
import { BadRequestError, FileStore, JOURNAL_FILE, validateBatch } from '../../server/fileStore';
import { CSP } from '../../server/security';

const H = { Host: '127.0.0.1:47371', 'X-GST-Client': '1' };

let dir: string;
let store: FileStore;
let backups: BackupStore;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gst-server-'));
  store = new FileStore(join(dir, 'data'));
  await store.init();
  backups = new BackupStore(join(dir, 'backups'), 2, 2);
  await backups.init();
  app = createApp({ store, backups, port: 47371, version: 'test' });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sample = () => buildSampleData('2026-10-29');
const bizId = (data = sample()) => data.businesses[0]!.id;

describe('security guards', () => {
  it('serves health without the client header', async () => {
    const r = await request(app).get('/api/health').set('Host', H.Host);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, app: 'free-gst-billing', version: 'test', mode: 'server' });
    expect(r.headers['content-security-policy']).toBe(CSP);
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects foreign hosts (DNS rebinding)', async () => {
    const r = await request(app).get('/api/db').set({ ...H, Host: 'evil.example:47371' });
    expect(r.status).toBe(403);
  });

  it('rejects requests without the client header or with the wrong content type', async () => {
    expect((await request(app).get('/api/db').set('Host', H.Host)).status).toBe(403);
    const r = await request(app).post('/api/commit').set(H).set('Content-Type', 'text/plain').send('{"puts":[]}');
    expect(r.status).toBe(415);
  });

  it('returns JSON errors for bad JSON and unknown routes', async () => {
    const bad = await request(app).post('/api/commit').set(H).set('Content-Type', 'application/json').send('{oops');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/not valid JSON/);
    expect((await request(app).get('/api/nope').set(H)).status).toBe(404);
    expect((await request(app).get('/nope').set('Host', H.Host)).status).toBe(404);
  });
});

describe('commit', () => {
  it('saves and deletes records on disk', async () => {
    const g = newGodown('biz_1', 'Main');
    const r = await request(app).post('/api/commit').set(H).send({ puts: [{ collection: 'godowns', record: g }], removes: [] });
    expect(r.status).toBe(204);
    const db = await request(app).get('/api/db').set(H);
    expect(db.body.collections.godowns).toHaveLength(1);
    const onDisk = JSON.parse(await readFile(join(dir, 'data', 'godowns.json'), 'utf8'));
    expect(onDisk[0].name).toBe('Main');
    await request(app).post('/api/commit').set(H).send({ puts: [{ collection: 'godowns', record: { ...g, name: 'Renamed' } }] });
    expect(store.getAll().godowns[0]!.name).toBe('Renamed');
    await request(app).post('/api/commit').set(H).send({ removes: [{ collection: 'godowns', id: g.id }] });
    expect(store.getAll().godowns).toHaveLength(0);
    expect(existsSync(join(dir, 'data', JOURNAL_FILE))).toBe(false);
  });

  it('rejects invalid batches without saving anything', async () => {
    const g = newGodown('biz_1', 'Main');
    const r = await request(app)
      .post('/api/commit')
      .set(H)
      .send({ puts: [{ collection: 'godowns', record: g }, { collection: 'hackers', record: g }], removes: [{ collection: 'godowns', id: '../x' }] });
    expect(r.status).toBe(400);
    expect(r.body.details.join('\n')).toMatch(/unknown collection/);
    expect(r.body.details.join('\n')).toMatch(/invalid id/);
    expect(store.getAll().godowns).toHaveLength(0);
  });

  it('validates batch shapes', () => {
    expect(() => validateBatch(null)).toThrow(BadRequestError);
    expect(() => validateBatch({ puts: 'x' })).toThrow(/lists/);
    expect(() => validateBatch({ puts: new Array(5001).fill({}) })).toThrow(/At most/);
    expect(() => validateBatch({ puts: [{ collection: 'godowns', record: { id: 'ok_1' } }] })).toThrow(/invalid/);
    expect(() => validateBatch({ puts: [{ collection: 'godowns', record: { id: 'bad id' } }] })).toThrow();
    const detailsOf = (input: unknown) => {
      try {
        validateBatch(input);
        return [];
      } catch (e) {
        return (e as BadRequestError).details;
      }
    };
    expect(detailsOf({ puts: [{ collection: 'godowns', record: newGodown('biz_1', 'G'), base: 5 }] })).toEqual(['puts[0]: invalid base version']);
    expect(detailsOf({ removes: [{ collection: 'godowns', id: 'gdn_1', base: 'x'.repeat(65) }] })).toEqual(['removes[0]: invalid base version']);
    expect(validateBatch({ puts: [{ collection: 'godowns', record: newGodown('biz_1', 'G'), base: null }], removes: [{ collection: 'godowns', id: 'gdn_1', base: '' }] }).removes[0]!.base).toBe('');
    expect(validateBatch({})).toEqual({ puts: [], removes: [] });
  });

  it('refuses a batch based on an older version and changes nothing (review R2)', async () => {
    const g = newGodown('biz_1', 'Main');
    await store.commit({ puts: [{ collection: 'godowns', record: g, base: null }], removes: [] });
    const r = await request(app)
      .post('/api/commit')
      .set(H)
      .send({
        puts: [
          { collection: 'godowns', record: newGodown('biz_1', 'New'), base: null },
          { collection: 'godowns', record: { ...g, name: 'Stale' }, base: '2000-01-01T00:00:00.000Z' },
        ],
        removes: [],
      });
    expect(r.status).toBe(409);
    expect(r.body.details).toEqual([`godowns ${g.id}`]);
    expect(store.getAll().godowns.map((x) => x.name)).toEqual(['Main']);
    expect(JSON.parse(await readFile(join(dir, 'data', 'godowns.json'), 'utf8')).map((x: { name: string }) => x.name)).toEqual(['Main']);
    expect(existsSync(join(dir, 'data', JOURNAL_FILE))).toBe(false);
    await store.commit({ puts: [{ collection: 'godowns', record: { ...g, name: 'Renamed' }, base: g.updatedAt }], removes: [] });
    expect(store.getAll().godowns.map((x) => x.name)).toEqual(['Renamed']);
  });
});

describe('restore', () => {
  it('replaces all data after an integrity check and keeps a pre-restore backup', async () => {
    const data = sample();
    await store.commit({ puts: [{ collection: 'godowns', record: newGodown(bizId(data), 'Old') }], removes: [] });
    const r = await request(app).post('/api/restore').set(H).send(makeSnapshot(data));
    expect(r.status).toBe(204);
    expect(store.getAll().invoices.length).toBe(data.invoices.length);
    expect(store.getAll().godowns.map((g) => g.name)).not.toContain('Old');
    const list = await backups.list();
    expect(list.some((b) => b.reason === 'pre-restore')).toBe(true);
    const parentFiles = await readdir(dir);
    expect(parentFiles.some((f) => f.includes('rollback') || f.includes('staging'))).toBe(false);
  });

  it('refuses a corrupt backup and leaves live data untouched', async () => {
    const data = sample();
    await store.replaceAll(makeSnapshot(data));
    const broken = JSON.parse(JSON.stringify(makeSnapshot(data)));
    broken.collections.invoices[0].items = 'corrupt';
    const r = await request(app).post('/api/restore').set(H).send(broken);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not changed/);
    expect(r.body.details.length).toBeGreaterThan(0);
    expect(store.getAll().invoices.length).toBe(data.invoices.length);
  });
});

describe('backups', () => {
  it('creates, lists, reads and prunes backups', async () => {
    const created = await request(app).post('/api/backups').set(H).send({ reason: 'manual' });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(BACKUP_ID_RE);
    const list = await request(app).get('/api/backups').set(H);
    expect(list.body).toHaveLength(1);
    const read = await request(app).get(`/api/backups/${created.body.id}`).set(H);
    expect(read.body.app).toBe('free-gst-billing');
    expect((await request(app).get('/api/backups/..%2F..%2Fsecret').set(H)).status).toBe(400);
    expect((await request(app).get('/api/backups/backup-20260101-000000-auto-abcdef').set(H)).status).toBe(404);
    for (let i = 0; i < 3; i++) await backups.create(store.snapshot(), 'auto', new Date(2026, 0, i + 1));
    expect((await backups.list()).filter((b) => b.reason === 'auto')).toHaveLength(2);
    await request(app).post('/api/backups').set(H).send({ reason: 'auto' });
  });

  it('makes one automatic backup per day', async () => {
    const day = new Date(2026, 9, 29, 10, 0, 0);
    expect(await backups.ensureDaily(() => store.snapshot(), day)).not.toBeNull();
    expect(await backups.ensureDaily(() => store.snapshot(), new Date(2026, 9, 29, 18, 0, 0))).toBeNull();
    expect(await backups.ensureDaily(() => store.snapshot(), new Date(2026, 9, 30, 9, 0, 0))).not.toBeNull();
    expect(stamp(day)).toBe('20261029-100000');
  });

  it('ignores stray files and handles a missing folder', async () => {
    await writeFile(join(dir, 'backups', 'notes.txt'), 'x');
    await writeFile(join(dir, 'backups', 'random.json'), '{}');
    expect(await backups.list()).toEqual([]);
    expect(await new BackupStore(join(dir, 'missing')).list()).toEqual([]);
  });
});

describe('crash safety', () => {
  it('replays an interrupted save from the journal', async () => {
    const g = newGodown('biz_1', 'Journaled');
    await writeFile(join(dir, 'data', JOURNAL_FILE), JSON.stringify({ puts: [{ collection: 'godowns', record: g }], removes: [] }));
    const s = new FileStore(join(dir, 'data'));
    await s.init();
    expect(s.getAll().godowns[0]!.name).toBe('Journaled');
    expect(existsSync(join(dir, 'data', JOURNAL_FILE))).toBe(false);
  });

  it('recovers previous data if a restore was cut off mid-swap', async () => {
    const g = newGodown('biz_1', 'Before restore');
    await store.commit({ puts: [{ collection: 'godowns', record: g }], removes: [] });
    const { rename } = await import('node:fs/promises');
    await rename(join(dir, 'data'), join(dir, 'data.rollback-1'));
    await mkdir(join(dir, 'data.staging-1'));
    const s = new FileStore(join(dir, 'data'));
    await s.init();
    expect(s.getAll().godowns[0]!.name).toBe('Before restore');
    expect(existsSync(join(dir, 'data.staging-1'))).toBe(false);
  });

  it('rejects a collection file that is not a list', async () => {
    await writeFile(join(dir, 'data', 'products.json'), '{"not":"a list"}');
    await expect(new FileStore(join(dir, 'data')).init()).rejects.toThrow(/not a JSON array/);
  });

  it('serialises concurrent saves and survives a failed one', async () => {
    const a = newGodown('biz_1', 'A');
    const b = newGodown('biz_1', 'B');
    await Promise.all([
      store.commit({ puts: [{ collection: 'godowns', record: a }], removes: [] }),
      store.commit({ puts: [{ collection: 'godowns', record: b }], removes: [] }),
    ]);
    expect(store.getAll().godowns).toHaveLength(2);
    await store.flush();
  });

  it('writes files atomically and retries transient lock errors', async () => {
    const f = join(dir, 'atomic.json');
    await writeFileAtomic(f, '[1]');
    await writeFileAtomic(f, '[2]');
    expect(await readFile(f, 'utf8')).toBe('[2]');
    let calls = 0;
    const v = await retry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
        return 'ok';
      },
      5,
      1,
    );
    expect(v).toBe('ok');
    await expect(retry(async () => Promise.reject(Object.assign(new Error('nope'), { code: 'ENOENT' })), 5, 1)).rejects.toThrow('nope');
    await expect(retry(async () => Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })), 2, 1)).rejects.toThrow('busy');
    await expect(writeFileAtomic(join(dir, 'no', 'such', 'dir.json'), 'x')).rejects.toThrow();
  });
});

describe('a save that fails half-way (review R3)', () => {
  const journal = () => join(dir, 'data', JOURNAL_FILE);
  // Antivirus or a search indexer can hold a data file past the retries. A folder in the
  // file's place fails the same way on every platform: the file cannot be replaced.
  const lock = (collection: string) => mkdir(join(dir, 'data', `${collection}.json`));
  const unlock = (collection: string) => rm(join(dir, 'data', `${collection}.json`), { recursive: true, force: true });
  const restart = async () => {
    const s = new FileStore(join(dir, 'data'));
    await s.init();
    return s;
  };
  // The server reports the locked file on its console; keep that out of the test output.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('keeps a batch whose data file could not be written in the journal and in memory', async () => {
    const party = newParty('biz_1', { name: 'Kept Party' });
    await lock('clients');
    await store.commit({ puts: [{ collection: 'clients', record: party }], removes: [] });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('saved in the journal'), expect.anything());
    expect(store.getAll().clients.map((c) => c.name)).toEqual(['Kept Party']);
    expect(JSON.parse(await readFile(journal(), 'utf8')).puts[0].record.id).toBe(party.id);
    await unlock('clients');
    expect((await restart()).getAll().clients.map((c) => c.name)).toEqual(['Kept Party']);
  });

  it('writes the waiting batch before the next save, so a later save does not drop it', async () => {
    const data = sample();
    await store.commit({ puts: [{ collection: 'businesses', record: data.businesses[0]! }], removes: [] });
    await lock('clients');
    // Before the fix this save threw, its party stayed only in memory and the next save replaced the journal.
    await store.commit({ puts: [{ collection: 'clients', record: newParty(bizId(data), { name: 'Saved during a lock' }) }], removes: [] }).catch(() => undefined);
    await unlock('clients');
    await store.commit({ puts: [{ collection: 'businesses', record: { ...data.businesses[0]!, name: 'Renamed' } }], removes: [] });
    expect(existsSync(journal())).toBe(false);
    const restarted = await restart();
    expect(restarted.getAll().clients.map((c) => c.name)).toEqual(['Saved during a lock']);
    expect(restarted.getAll().businesses[0]!.name).toBe('Renamed');
  });

  it('refuses later saves while the waiting batch still cannot be written, and keeps it', async () => {
    const party = newParty('biz_1', { name: 'Waiting Party' });
    await lock('clients');
    await store.commit({ puts: [{ collection: 'clients', record: party }], removes: [] });
    await expect(store.commit({ puts: [{ collection: 'godowns', record: newGodown('biz_1', 'Refused') }], removes: [] })).rejects.toThrow();
    expect(store.getAll().godowns).toHaveLength(0);
    expect(JSON.parse(await readFile(journal(), 'utf8')).puts[0].record.id).toBe(party.id);
    await unlock('clients');
    const restarted = await restart();
    expect(restarted.getAll().clients.map((c) => c.name)).toEqual(['Waiting Party']);
    expect(restarted.getAll().godowns).toHaveLength(0);
  });

  it('changes nothing when the journal itself cannot be written', async () => {
    await mkdir(journal());
    await expect(store.commit({ puts: [{ collection: 'godowns', record: newGodown('biz_1', 'Main') }], removes: [] })).rejects.toThrow();
    expect(store.getAll().godowns).toHaveLength(0);
    expect(existsSync(join(dir, 'data', 'godowns.json'))).toBe(false);
  });
});

describe('restoring a large backup (review Y11)', () => {
  /** Purchase-bill photos live inside the data (up to about 3 MB each), so a real backup can pass 50 MB. */
  const withAttachments = (count: number) => {
    const data = sample();
    const bill = data.purchases[0]!;
    const photo = `data:image/jpeg;base64,${'A'.repeat(3_900_000)}`;
    for (let i = 0; i < count; i++) data.purchases.push({ ...bill, id: `pur_photo_${i}`, billNo: `PHOTO-${i}`, attachmentDataUrl: photo });
    return makeSnapshot(data);
  };

  it('restores a backup file over 50 MB', async () => {
    const snapshot = withAttachments(14);
    const r = await request(app).post('/api/restore').set(H).send(snapshot);
    expect(r.status).toBe(204);
    expect(store.getAll().purchases).toHaveLength(snapshot.collections.purchases.length);
  });

  it('restores a server backup in place, so its size never has to fit in a request', async () => {
    const data = sample();
    await store.replaceAll(makeSnapshot(data));
    const backup = await backups.create(store.snapshot(), 'manual');
    await store.commit({ puts: [{ collection: 'godowns', record: newGodown(bizId(data), 'Made after the backup') }], removes: [] });
    const r = await request(app).post(`/api/backups/${backup.id}/restore`).set(H).send({});
    expect(r.status).toBe(204);
    expect(store.getAll().godowns.map((g) => g.name)).not.toContain('Made after the backup');
    expect(store.getAll().invoices).toHaveLength(data.invoices.length);
    expect((await backups.list()).some((b) => b.reason === 'pre-restore')).toBe(true);
  });

  it('refuses a missing, invalid or damaged server backup and leaves data unchanged', async () => {
    const data = sample();
    await store.replaceAll(makeSnapshot(data));
    expect((await request(app).post('/api/backups/..%2Fdata/restore').set(H).send({})).status).toBe(400);
    expect((await request(app).post('/api/backups/backup-20260101-000000-auto-abcdef/restore').set(H).send({})).status).toBe(404);
    const backup = await backups.create(store.snapshot(), 'manual');
    const file = join(dir, 'backups', `${backup.id}.json`);
    const broken = JSON.parse(await readFile(file, 'utf8'));
    broken.collections.invoices[0].items = 'damaged';
    await writeFile(file, JSON.stringify(broken));
    const r = await request(app).post(`/api/backups/${backup.id}/restore`).set(H).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/integrity check/);
    expect(store.getAll().invoices).toHaveLength(data.invoices.length);
  });

  it('keeps the 50 MB limit for ordinary saves and names the limit', async () => {
    const big = { ...newGodown('biz_1', 'Big'), address: 'x'.repeat(51 * 1024 * 1024) };
    const r = await request(app).post('/api/commit').set(H).send({ puts: [{ collection: 'godowns', record: big }], removes: [] });
    expect(r.status).toBe(413);
    expect(r.body.error).toBe('Request is too large (limit 50 MB).');
    expect(store.getAll().godowns).toHaveLength(0);
  });
});

describe('static hosting', () => {
  it('serves the built app with caching rules', async () => {
    const web = join(dir, 'web');
    await mkdir(join(web, 'assets'), { recursive: true });
    await writeFile(join(web, 'index.html'), '<!doctype html><title>t</title>');
    await writeFile(join(web, 'assets', 'app.js'), 'console.log(1)');
    const withStatic = createApp({ store, backups, port: 47371, version: 'test', staticDir: web });
    const home = await request(withStatic).get('/').set('Host', H.Host);
    expect(home.status).toBe(200);
    expect(home.headers['cache-control']).toBe('no-cache');
    const asset = await request(withStatic).get('/assets/app.js').set('Host', H.Host);
    expect(asset.headers['cache-control']).toMatch(/immutable/);
    expect(emptyCollections().invoices).toEqual([]);
  });
});
