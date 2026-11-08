import { openDB } from 'idb';
import type { IDBPDatabase, IDBPTransaction } from 'idb';
import { newId } from '../core/ids';
import type { CollectionData, CollectionName, DatabaseSnapshot } from '../core/model';
import { COLLECTIONS } from '../core/model';
import { emptyCollections, makeSnapshot, validateSnapshot } from '../core/schema';
import type { BackupInfo, BackupReason, Batch, StorageAdapter } from './adapter';
import { ConflictError, findConflicts } from './adapter';

export const IDB_NAME = 'free-gst-billing';
const IDB_VERSION = 1;
const BACKUP_STORE = '_backups';
/** Browser storage is limited, so keep fewer snapshots than the server does. */
export const MAX_BROWSER_BACKUPS = 10;

interface StoredBackup extends BackupInfo {
  snapshot: DatabaseSnapshot;
}

export class IndexedDbAdapter implements StorageAdapter {
  readonly kind = 'browser' as const;
  readonly location = 'This browser (IndexedDB)';

  private constructor(private readonly db: IDBPDatabase) {}

  static async open(name = IDB_NAME): Promise<IndexedDbAdapter> {
    const db = await openDB(name, IDB_VERSION, {
      upgrade(upgradeDb) {
        for (const c of COLLECTIONS) {
          if (!upgradeDb.objectStoreNames.contains(c)) upgradeDb.createObjectStore(c, { keyPath: 'id' });
        }
        if (!upgradeDb.objectStoreNames.contains(BACKUP_STORE)) upgradeDb.createObjectStore(BACKUP_STORE, { keyPath: 'id' });
      },
    });
    return new IndexedDbAdapter(db);
  }

  close(): void {
    this.db.close();
  }

  async loadAll(): Promise<CollectionData> {
    const tx = this.db.transaction([...COLLECTIONS], 'readonly');
    const out = emptyCollections() as Record<CollectionName, unknown[]>;
    await Promise.all(
      COLLECTIONS.map(async (c) => {
        out[c] = await tx.objectStore(c).getAll();
      }),
    );
    await tx.done;
    return out as CollectionData;
  }

  /**
   * Queue every request in one transaction. A request that throws while being
   * queued (e.g. DataCloneError) would otherwise let the transaction
   * auto-commit the requests queued before it, so abort explicitly.
   * `queue` may first await reads made in the same transaction (and nothing else).
   */
  private async runInTransaction(
    stores: string[],
    queue: (tx: IDBPTransaction<unknown, string[], 'readwrite'>, ops: Promise<unknown>[]) => void | Promise<void>,
  ): Promise<void> {
    const tx = this.db.transaction(stores, 'readwrite');
    const ops: Promise<unknown>[] = [];
    try {
      await queue(tx, ops);
    } catch (e) {
      tx.abort();
      await Promise.allSettled([...ops, tx.done]);
      throw e;
    }
    await Promise.all([...ops, tx.done]);
  }

  /**
   * The `base` check reads the stored records in the same read-write transaction as the
   * writes, and IndexedDB runs such transactions one at a time across every tab of the
   * browser, so checking and writing are one step (review R2).
   */
  async commit(batch: Batch): Promise<void> {
    const stores = [...new Set([...batch.puts.map((p) => p.collection), ...batch.removes.map((r) => r.collection)])];
    if (!stores.length) return;
    await this.runInTransaction(stores, async (tx, ops) => {
      const conflicts = await findConflicts(batch, (c, id) => tx.objectStore(c).get(id));
      if (conflicts.length) throw new ConflictError(undefined, conflicts.slice(0, 20));
      for (const p of batch.puts) ops.push(tx.objectStore(p.collection).put(p.record));
      for (const r of batch.removes) ops.push(tx.objectStore(r.collection).delete(r.id));
    });
  }

  async replaceAll(snapshot: DatabaseSnapshot): Promise<void> {
    await this.runInTransaction([...COLLECTIONS], (tx, ops) => {
      for (const c of COLLECTIONS) {
        const store = tx.objectStore(c);
        ops.push(store.clear());
        for (const rec of snapshot.collections[c] ?? []) ops.push(store.put(rec));
      }
    });
  }

  async listBackups(): Promise<BackupInfo[]> {
    const all = (await this.db.getAll(BACKUP_STORE)) as StoredBackup[];
    return all
      .map(({ id, createdAt, reason, sizeBytes }) => ({ id, createdAt, reason, sizeBytes }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async createBackup(reason: BackupReason): Promise<BackupInfo> {
    const snapshot = makeSnapshot(await this.loadAll());
    const info: BackupInfo = {
      id: newId('backup'),
      createdAt: new Date().toISOString(),
      reason,
      sizeBytes: JSON.stringify(snapshot).length,
    };
    await this.db.put(BACKUP_STORE, { ...info, snapshot } satisfies StoredBackup);
    const list = await this.listBackups();
    for (const old of list.slice(MAX_BROWSER_BACKUPS)) await this.db.delete(BACKUP_STORE, old.id);
    return info;
  }

  async readBackup(id: string): Promise<DatabaseSnapshot> {
    const rec = (await this.db.get(BACKUP_STORE, id)) as StoredBackup | undefined;
    if (!rec) throw new Error('Backup not found.');
    return rec.snapshot;
  }

  async restoreBackup(id: string): Promise<void> {
    const v = validateSnapshot(await this.readBackup(id));
    if (!v.ok) throw new Error('The backup failed the integrity check; your current data was not changed.');
    await this.createBackup('pre-restore');
    await this.replaceAll(v.snapshot);
  }
}
