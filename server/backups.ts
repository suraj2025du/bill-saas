import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSnapshot } from '../src/core/model';
import type { BackupInfo, BackupReason } from '../src/data/adapter';
import { writeFileAtomic } from './atomic';
import { BadRequestError } from './fileStore';

export const BACKUP_ID_RE = /^backup-(\d{8})-(\d{6})-(auto|manual|pre-restore)-[a-f0-9]{6}$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local time stamp YYYYMMDD-HHmmss. */
export function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export class NotFoundError extends Error {
  readonly status = 404;
}

export class BackupStore {
  constructor(
    readonly dir: string,
    readonly keepAuto = 30,
    readonly keepOther = 20,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<BackupInfo[]> {
    if (!existsSync(this.dir)) return [];
    const out: BackupInfo[] = [];
    for (const file of await readdir(this.dir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      const m = BACKUP_ID_RE.exec(id);
      if (!m) continue;
      const s = await stat(join(this.dir, file));
      const [d, t] = [m[1]!, m[2]!];
      const createdAt = new Date(
        Number(d.slice(0, 4)),
        Number(d.slice(4, 6)) - 1,
        Number(d.slice(6, 8)),
        Number(t.slice(0, 2)),
        Number(t.slice(2, 4)),
        Number(t.slice(4, 6)),
      ).toISOString();
      out.push({ id, createdAt, reason: m[3] as BackupReason, sizeBytes: s.size });
    }
    return out.sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  async create(snapshot: DatabaseSnapshot, reason: BackupReason, now = new Date()): Promise<BackupInfo> {
    await this.init();
    const id = `backup-${stamp(now)}-${reason}-${randomBytes(3).toString('hex')}`;
    const body = JSON.stringify(snapshot);
    await writeFileAtomic(join(this.dir, `${id}.json`), body);
    await this.prune();
    return { id, createdAt: now.toISOString(), reason, sizeBytes: Buffer.byteLength(body) };
  }

  async read(id: string): Promise<DatabaseSnapshot> {
    if (!BACKUP_ID_RE.test(id)) throw new BadRequestError('Invalid backup id.');
    const file = join(this.dir, `${id}.json`);
    if (!existsSync(file)) throw new NotFoundError('Backup not found.');
    return JSON.parse(await readFile(file, 'utf8')) as DatabaseSnapshot;
  }

  /** Keep the newest 30 automatic and 20 manual / pre-restore backups. */
  async prune(): Promise<void> {
    const list = await this.list();
    const auto = list.filter((b) => b.reason === 'auto');
    const other = list.filter((b) => b.reason !== 'auto');
    for (const b of [...auto.slice(this.keepAuto), ...other.slice(this.keepOther)]) {
      await rm(join(this.dir, `${b.id}.json`), { force: true });
    }
  }

  /** One automatic backup per calendar day. Returns the new backup, or null if today's exists. */
  async ensureDaily(getSnapshot: () => DatabaseSnapshot, now = new Date()): Promise<BackupInfo | null> {
    const day = stamp(now).slice(0, 8);
    const list = await this.list();
    if (list.some((b) => b.reason === 'auto' && b.id.startsWith(`backup-${day}-`))) return null;
    return this.create(getSnapshot(), 'auto', now);
  }
}
