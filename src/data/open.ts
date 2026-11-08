import type { StorageAdapter } from './adapter';
import { HttpAdapter, probeServer } from './http';
import { IndexedDbAdapter } from './indexeddb';

/**
 * Use the local server (JSON files in _system/data) when this page is served
 * by server.js; otherwise keep data in this browser's IndexedDB, which is what
 * happens inside Google AI Studio's preview or on any static host.
 */
export async function openStorage(): Promise<StorageAdapter> {
  const probe = await probeServer();
  if (probe.ok) return new HttpAdapter(probe.dataDir || 'Local server');
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    // Ask the browser not to evict our data under storage pressure.
    void navigator.storage.persist().catch(() => false);
  }
  return IndexedDbAdapter.open();
}
