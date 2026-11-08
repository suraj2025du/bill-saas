import type { CollectionData, CollectionMap, CollectionName, DatabaseSnapshot } from '../core/model';

export interface PutOp<K extends CollectionName = CollectionName> {
  collection: K;
  record: CollectionMap[K];
  /** Version the writer last saw (see `versionOf`), or null if it saw no such record. Omitted: not checked. */
  base?: string | null;
}

export interface RemoveOp {
  collection: CollectionName;
  id: string;
  /** As PutOp.base. */
  base?: string | null;
}

/**
 * A set of writes applied all-or-nothing. Storage refuses the whole batch with a
 * ConflictError when any `base` no longer matches the stored record, so a tab or
 * window working from an old copy of the data cannot overwrite newer records.
 */
export interface Batch {
  puts: PutOp[];
  removes: RemoveOp[];
}

/** Version of a stored record: its `updatedAt`. Trash entries have none, so only their presence counts. */
export function versionOf(record: unknown): string {
  const v = (record as { updatedAt?: unknown }).updatedAt;
  return typeof v === 'string' ? v : '';
}

/** Another tab or window changed what a batch was based on. Nothing was saved. */
export class ConflictError extends Error {
  readonly status = 409;
  constructor(
    message = 'Another tab or window changed this data first, so nothing was saved.',
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * "collection id" of each write whose `base` does not match the record stored now.
 * `stored` returns the stored record or undefined; it may return a promise (IndexedDB).
 */
export async function findConflicts(batch: Batch, stored: (collection: CollectionName, id: string) => unknown): Promise<string[]> {
  const ops = [
    ...batch.puts.map((p) => ({ collection: p.collection, id: (p.record as { id: string }).id, base: p.base })),
    ...batch.removes.map((r) => ({ collection: r.collection, id: r.id, base: r.base })),
  ].filter((op) => op.base !== undefined);
  const current = await Promise.all(ops.map((op) => stored(op.collection, op.id)));
  return ops.filter((op, i) => (current[i] === undefined ? null : versionOf(current[i])) !== op.base).map((op) => `${op.collection} ${op.id}`);
}

export type BackupReason = 'auto' | 'manual' | 'pre-restore';

export interface BackupInfo {
  id: string;
  createdAt: string;
  reason: BackupReason;
  sizeBytes: number;
}

/**
 * Where data lives. The browser adapter uses IndexedDB (works inside Google AI
 * Studio's preview and any static host); the server adapter talks to
 * server.js, which stores JSON files in _system/data.
 */
export interface StorageAdapter {
  readonly kind: 'server' | 'browser';
  /** Human description shown in Settings, e.g. the data folder path. */
  readonly location: string;
  loadAll(): Promise<CollectionData>;
  /** Apply puts and removes atomically. */
  commit(batch: Batch): Promise<void>;
  /** Replace ALL data with a validated snapshot; rolls back on any failure. */
  replaceAll(snapshot: DatabaseSnapshot): Promise<void>;
  listBackups(): Promise<BackupInfo[]>;
  createBackup(reason: BackupReason): Promise<BackupInfo>;
  readBackup(id: string): Promise<DatabaseSnapshot>;
  /** Restore one of the listed backups where it is stored (no upload, so its size does not matter); keeps a pre-restore backup. */
  restoreBackup(id: string): Promise<void>;
}

export function emptyBatch(): Batch {
  return { puts: [], removes: [] };
}

export function putOp<K extends CollectionName>(collection: K, record: CollectionMap[K]): PutOp {
  return { collection, record } as PutOp;
}
