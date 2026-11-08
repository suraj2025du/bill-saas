import type { CollectionData, CollectionName } from '../core/model';
import type { Batch } from './adapter';

/** Find records by collection and id; each collection is indexed on first use. */
export function recordLookup(data: CollectionData): (collection: CollectionName, id: string) => { id: string } | undefined {
  const index = new Map<CollectionName, Map<string, { id: string }>>();
  return (collection, id) => {
    let byId = index.get(collection);
    if (!byId) {
      byId = new Map((data[collection] as { id: string }[]).map((r) => [r.id, r]));
      index.set(collection, byId);
    }
    return byId.get(id);
  };
}

/**
 * Apply a batch to in-memory data immutably: only touched collections get new
 * arrays, so React components that read other collections do not re-render.
 */
export function applyBatch(data: CollectionData, batch: Batch): CollectionData {
  const next = { ...data } as Record<CollectionName, { id: string }[]>;
  const touched = new Set<CollectionName>();
  const ensure = (c: CollectionName) => {
    if (!touched.has(c)) {
      next[c] = [...next[c]];
      touched.add(c);
    }
    return next[c];
  };
  for (const p of batch.puts) {
    const list = ensure(p.collection);
    const rec = p.record as { id: string };
    const i = list.findIndex((r) => r.id === rec.id);
    if (i >= 0) list[i] = rec;
    else list.push(rec);
  }
  for (const r of batch.removes) {
    const list = ensure(r.collection);
    const i = list.findIndex((x) => x.id === r.id);
    if (i >= 0) list.splice(i, 1);
  }
  return next as CollectionData;
}
