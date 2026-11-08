import { create } from 'zustand';
import type { CollectionData, CollectionName, DatabaseSnapshot } from '../core/model';
import { emptyCollections } from '../core/schema';
import type { Batch, BackupInfo, BackupReason, StorageAdapter } from '../data/adapter';
import { ConflictError, versionOf } from '../data/adapter';
import { applyBatch, recordLookup } from '../data/apply';
import { openStorage } from '../data/open';
import { StaleDataError } from './errors';

export type BootState = 'loading' | 'ready' | 'error';

export interface StoreState {
  boot: BootState;
  bootError: string;
  adapter: StorageAdapter | null;
  data: CollectionData;
  /** False while a PIN is set and the user has not unlocked this session. */
  unlocked: boolean;
  /** Writes in flight (shows a saving indicator). */
  saving: number;
}

export const useStore = create<StoreState>(() => ({
  boot: 'loading',
  bootError: '',
  adapter: null,
  data: emptyCollections(),
  unlocked: false,
  saving: 0,
}));

let queue: Promise<unknown> = Promise.resolve();

/** Run storage writes one at a time so they reach the disk in order. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const p = queue.then(task, task);
  queue = p.catch(() => undefined);
  return p;
}

function requireAdapter(): StorageAdapter {
  const a = useStore.getState().adapter;
  if (!a) throw new Error('Storage is not ready yet.');
  return a;
}

/** Mark every write with the version this tab last loaded, so storage refuses it if another tab saved since. */
function withBases(batch: Batch, data: CollectionData): Batch {
  const find = recordLookup(data);
  const base = (collection: CollectionName, id: string) => {
    const r = find(collection, id);
    return r ? versionOf(r) : null;
  };
  return {
    puts: batch.puts.map((p) => ({ ...p, base: base(p.collection, (p.record as { id: string }).id) })),
    removes: batch.removes.map((r) => ({ ...r, base: base(r.collection, r.id) })),
  };
}

/**
 * Save a batch atomically. Memory is updated only after storage confirms, so
 * the screen never shows data that was not saved. When another tab or window
 * saved first, nothing is written, this tab loads the latest data and the user
 * is asked to save again (review R2).
 */
export function commit(batch: Batch): Promise<void> {
  // Versions are taken now, from the data the batch was built from: a batch queued behind
  // another save, or behind a reload, must not pass as based on data it never saw.
  const based = withBases(batch, useStore.getState().data);
  return serial(async () => {
    if (!batch.puts.length && !batch.removes.length) return;
    const adapter = requireAdapter();
    useStore.setState((s) => ({ saving: s.saving + 1 }));
    try {
      await adapter.commit(based);
      useStore.setState((s) => ({ data: applyBatch(s.data, batch) }));
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      const latest = await adapter.loadAll().catch(() => null);
      if (latest) useStore.setState({ data: latest });
      throw new StaleDataError();
    } finally {
      useStore.setState((s) => ({ saving: s.saving - 1 }));
    }
  });
}

export async function boot(): Promise<void> {
  try {
    const adapter = await openStorage();
    const data = await adapter.loadAll();
    const pin = data.settings.find((s) => s.id === 'app')?.pin;
    useStore.setState({ adapter, data, boot: 'ready', bootError: '', unlocked: !pin });
  } catch (e) {
    useStore.setState({ boot: 'error', bootError: e instanceof Error ? e.message : String(e) });
  }
}

/** Replace every record with a validated snapshot (restore). A pre-restore backup is kept first. */
export function replaceAll(snapshot: DatabaseSnapshot): Promise<void> {
  return serial(async () => {
    const adapter = requireAdapter();
    if (adapter.kind === 'browser') await adapter.createBackup('pre-restore');
    await adapter.replaceAll(snapshot);
    const data = await adapter.loadAll();
    useStore.setState({ data });
  });
}

export function createBackup(reason: BackupReason): Promise<BackupInfo> {
  return serial(() => requireAdapter().createBackup(reason));
}

export function listBackups(): Promise<BackupInfo[]> {
  return requireAdapter().listBackups();
}

export function readBackup(id: string): Promise<DatabaseSnapshot> {
  return requireAdapter().readBackup(id);
}

/** Restore one of the listed backups where it is stored, so a large backup never has to be uploaded (review Y11). */
export function restoreBackup(id: string): Promise<void> {
  return serial(async () => {
    const adapter = requireAdapter();
    await adapter.restoreBackup(id);
    const data = await adapter.loadAll();
    useStore.setState({ data });
  });
}

export function setUnlocked(unlocked: boolean): void {
  useStore.setState({ unlocked });
}
