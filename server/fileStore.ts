import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isValidId } from '../src/core/ids';
import type { CollectionData, CollectionName, DatabaseSnapshot } from '../src/core/model';
import { COLLECTIONS } from '../src/core/model';
import { emptyCollections, makeSnapshot, validateRecord } from '../src/core/schema';
import type { Batch, PutOp, RemoveOp } from '../src/data/adapter';
import { ConflictError, findConflicts } from '../src/data/adapter';
import { applyBatch, recordLookup } from '../src/data/apply';
import { retry, writeFileAtomic } from './atomic';

export const JOURNAL_FILE = 'journal.json';
export const MAX_BATCH_OPS = 5000;

/** Client sent something invalid (HTTP 400). */
export class BadRequestError extends Error {
  readonly status = 400;
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'BadRequestError';
  }
}

const isCollection = (c: unknown): c is CollectionName => typeof c === 'string' && (COLLECTIONS as readonly string[]).includes(c);
/** A base version is an updatedAt timestamp, '' (trash entries) or null (record not seen). */
const isBase = (b: unknown) => b === undefined || b === null || (typeof b === 'string' && b.length <= 64);

/** Validate an untrusted batch from the network; throws BadRequestError. */
export function validateBatch(input: unknown): Batch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestError('Batch must be an object.');
  const raw = input as { puts?: unknown; removes?: unknown };
  const puts = raw.puts ?? [];
  const removes = raw.removes ?? [];
  if (!Array.isArray(puts) || !Array.isArray(removes)) throw new BadRequestError('puts and removes must be lists.');
  if (puts.length + removes.length > MAX_BATCH_OPS) throw new BadRequestError(`At most ${MAX_BATCH_OPS} changes per save.`);
  const errors: string[] = [];
  puts.forEach((p: Partial<PutOp>, i) => {
    if (!p || !isCollection(p.collection)) errors.push(`puts[${i}]: unknown collection`);
    else if (!p.record || typeof p.record !== 'object' || !isValidId((p.record as { id?: unknown }).id)) errors.push(`puts[${i}]: invalid record id`);
    else if (!isBase(p.base)) errors.push(`puts[${i}]: invalid base version`);
    else {
      const msg = validateRecord(p.collection, p.record);
      if (msg) errors.push(`puts[${i}] ${p.collection}: ${msg}`);
    }
  });
  removes.forEach((r: Partial<RemoveOp>, i) => {
    if (!r || !isCollection(r.collection)) errors.push(`removes[${i}]: unknown collection`);
    else if (!isValidId(r.id)) errors.push(`removes[${i}]: invalid id`);
    else if (!isBase(r.base)) errors.push(`removes[${i}]: invalid base version`);
  });
  if (errors.length) throw new BadRequestError('Some changes are invalid; nothing was saved.', errors.slice(0, 20));
  return { puts: puts as PutOp[], removes: removes as RemoveOp[] };
}

/**
 * Data lives in `<dir>/<collection>.json` (one JSON array per collection) and
 * in memory. Every save writes a journal first, so an interrupted save is
 * completed on the next start; every file is replaced atomically.
 */
export class FileStore {
  private data: CollectionData = emptyCollections();
  /** A saved batch still only in the journal, because one of its data files could not be replaced. */
  private pending: Batch | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string) {}

  async init(): Promise<void> {
    await this.recoverInterruptedRestore();
    await mkdir(this.dir, { recursive: true });
    const next = emptyCollections() as Record<CollectionName, unknown[]>;
    for (const c of COLLECTIONS) next[c] = await this.readCollection(c);
    this.data = next as CollectionData;
    const journal = join(this.dir, JOURNAL_FILE);
    if (existsSync(journal)) {
      const batch = validateBatch(JSON.parse(await readFile(journal, 'utf8')));
      this.data = applyBatch(this.data, batch);
      await this.persist(batch);
      await rm(journal, { force: true });
    }
  }

  /** If a restore was cut off between its two renames, put the previous data back. */
  private async recoverInterruptedRestore(): Promise<void> {
    const parent = dirname(this.dir);
    const name = basename(this.dir);
    if (!existsSync(parent)) return;
    const entries = await readdir(parent);
    const rollbacks = entries.filter((e) => e.startsWith(`${name}.rollback-`)).sort();
    if (!existsSync(this.dir) && rollbacks.length) {
      await retry(() => rename(join(parent, rollbacks[rollbacks.length - 1]!), this.dir));
    }
    for (const e of entries) {
      if (e.startsWith(`${name}.staging-`)) await rm(join(parent, e), { recursive: true, force: true });
    }
  }

  private async readCollection(c: CollectionName): Promise<unknown[]> {
    const file = join(this.dir, `${c}.json`);
    if (!existsSync(file)) return [];
    const parsed: unknown = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    if (!Array.isArray(parsed)) throw new Error(`${file} is not a JSON array.`);
    return parsed;
  }

  getAll(): CollectionData {
    return this.data;
  }

  snapshot(): DatabaseSnapshot {
    return makeSnapshot(this.data);
  }

  /**
   * The journal is the commit point: once it is on disk the batch is saved, and only
   * then does memory change. If a data file cannot be replaced afterwards (a file lock,
   * a full disk), the batch waits in the journal: the next save writes it first and is
   * refused while that still fails, and the next start replays it. A journal is never
   * replaced before its batch is in the data files.
   * Throws ConflictError, changing nothing, when a `base` no longer matches (review R2).
   */
  commit(batch: Batch): Promise<void> {
    return this.serialize(async () => {
      const journal = join(this.dir, JOURNAL_FILE);
      if (this.pending) {
        await this.persist(this.pending);
        this.pending = null;
        await this.removeJournal(journal);
      }
      const conflicts = await findConflicts(batch, recordLookup(this.data));
      if (conflicts.length) throw new ConflictError(undefined, conflicts.slice(0, 20));
      await writeFileAtomic(journal, JSON.stringify(batch));
      this.data = applyBatch(this.data, batch);
      try {
        await this.persist(batch);
      } catch (e) {
        this.pending = batch;
        console.error('[store] The change is saved in the journal, but a data file could not be written yet:', e);
        return;
      }
      await this.removeJournal(journal);
    });
  }

  /** A journal left behind holds a batch already in the data files; replaying it again is harmless. */
  private async removeJournal(journal: string): Promise<void> {
    await rm(journal, { force: true }).catch((e: unknown) => console.error('[store] Could not remove the journal:', e));
  }

  private async persist(batch: Batch): Promise<void> {
    const touched = new Set<CollectionName>([...batch.puts.map((p) => p.collection), ...batch.removes.map((r) => r.collection)]);
    for (const c of touched) await writeFileAtomic(join(this.dir, `${c}.json`), JSON.stringify(this.data[c]));
  }

  /**
   * Replace everything with a validated snapshot: write a staging folder,
   * swap it in with two renames and keep the old folder until the swap worked.
   */
  replaceAll(snapshot: DatabaseSnapshot): Promise<void> {
    return this.serialize(async () => {
      const stamp = `${Date.now()}`;
      const parent = dirname(this.dir);
      const name = basename(this.dir);
      const staging = join(parent, `${name}.staging-${stamp}`);
      const rollback = join(parent, `${name}.rollback-${stamp}`);
      await mkdir(staging, { recursive: true });
      try {
        for (const c of COLLECTIONS) await writeFile(join(staging, `${c}.json`), JSON.stringify(snapshot.collections[c] ?? []));
      } catch (e) {
        await rm(staging, { recursive: true, force: true });
        throw e;
      }
      await retry(() => rename(this.dir, rollback));
      try {
        await retry(() => rename(staging, this.dir));
      } catch (e) {
        await retry(() => rename(rollback, this.dir));
        await rm(staging, { recursive: true, force: true });
        throw e;
      }
      const next = emptyCollections() as Record<CollectionName, unknown[]>;
      for (const c of COLLECTIONS) next[c] = [...(snapshot.collections[c] ?? [])];
      this.data = next as CollectionData;
      // The data folder that held a waiting journal was replaced as a whole.
      this.pending = null;
      await rm(rollback, { recursive: true, force: true });
    });
  }

  /** Resolves when every queued write has finished. */
  flush(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
