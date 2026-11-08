import type { CollectionData, DatabaseSnapshot } from '../core/model';
import { APP_ID } from '../core/model';
import type { BackupInfo, BackupReason, Batch, StorageAdapter } from './adapter';
import { ConflictError } from './adapter';

/** Header every API call carries; the server rejects requests without it (CSRF guard). */
export const CLIENT_HEADER = 'X-GST-Client';

/** Largest request body the server accepts, except a backup file uploaded to restore. */
export const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
/**
 * Largest backup file that can be uploaded to restore. A JavaScript engine holds JSON
 * text as one string of at most about 512 MB, so every backup this app writes fits.
 */
export const MAX_RESTORE_BYTES = 500 * 1024 * 1024;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class HttpAdapter implements StorageAdapter {
  readonly kind = 'server' as const;

  constructor(
    readonly location: string,
    private readonly base = '',
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', [CLIENT_HEADER]: '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) {
      let message = `Server error ${res.status}`;
      let details: string[] = [];
      try {
        const j = (await res.json()) as { error?: string; details?: string[] };
        message = j.error ?? message;
        details = j.details ?? [];
      } catch {
        // non-JSON error body
      }
      if (res.status === 409) throw new ConflictError(message, details);
      throw new ApiError(message, res.status, details);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async loadAll(): Promise<CollectionData> {
    const r = await this.request<{ collections: CollectionData }>('GET', '/api/db');
    return r.collections;
  }

  commit(batch: Batch): Promise<void> {
    if (!batch.puts.length && !batch.removes.length) return Promise.resolve();
    return this.request<void>('POST', '/api/commit', batch);
  }

  replaceAll(snapshot: DatabaseSnapshot): Promise<void> {
    return this.request<void>('POST', '/api/restore', snapshot);
  }

  listBackups(): Promise<BackupInfo[]> {
    return this.request<BackupInfo[]>('GET', '/api/backups');
  }

  createBackup(reason: BackupReason): Promise<BackupInfo> {
    return this.request<BackupInfo>('POST', '/api/backups', { reason });
  }

  readBackup(id: string): Promise<DatabaseSnapshot> {
    return this.request<DatabaseSnapshot>('GET', `/api/backups/${encodeURIComponent(id)}`);
  }

  restoreBackup(id: string): Promise<void> {
    return this.request<void>('POST', `/api/backups/${encodeURIComponent(id)}/restore`, {});
  }
}

export interface ServerProbe {
  ok: boolean;
  dataDir: string;
  version: string;
}

/** Is server.js serving this page? Fails fast (AI Studio preview, static hosting, dev). */
export async function probeServer(base = '', timeoutMs = 1500): Promise<ServerProbe> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/health`, { headers: { [CLIENT_HEADER]: '1' }, cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return { ok: false, dataDir: '', version: '' };
    const j = (await res.json()) as { app?: string; dataDir?: string; version?: string };
    if (j.app !== APP_ID) return { ok: false, dataDir: '', version: '' };
    return { ok: true, dataDir: j.dataDir ?? '', version: j.version ?? '' };
  } catch {
    return { ok: false, dataDir: '', version: '' };
  } finally {
    clearTimeout(timer);
  }
}
