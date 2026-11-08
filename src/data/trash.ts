import { daysBetween, toISODate } from '../core/dates';
import { DOC_TYPES } from '../core/docs/docTypes';
import { newId } from '../core/ids';
import type { CollectionMap, TrashEntry, TrashableCollection } from '../core/model';
import type { Batch } from './adapter';

export const TRASH_DAYS = 30;

/** Human label for a record shown in the Trash bin. */
export function trashLabel<K extends TrashableCollection>(collection: K, record: CollectionMap[K]): string {
  switch (collection) {
    case 'invoices': {
      const d = record as CollectionMap['invoices'];
      return `${DOC_TYPES[d.docType].label} ${d.number || '(draft)'} - ${d.party.name || 'no party'}`;
    }
    case 'purchases': {
      const p = record as CollectionMap['purchases'];
      return `Purchase bill ${p.billNo} - ${p.supplier.name}`;
    }
    case 'expenses': {
      const e = record as CollectionMap['expenses'];
      return `Expense ${e.description || e.vendorName || e.date}`;
    }
    case 'receipts': {
      const r = record as CollectionMap['receipts'];
      return `${r.direction === 'IN' ? 'Receipt' : 'Payment'} ${r.number} - ${r.partyName}`;
    }
    case 'vouchers': {
      const v = record as CollectionMap['vouchers'];
      return `${v.type.charAt(0)}${v.type.slice(1).toLowerCase()} voucher ${v.number}`;
    }
    case 'clients':
      return `Party ${(record as CollectionMap['clients']).name}`;
    case 'products':
      return `Product ${(record as CollectionMap['products']).name}`;
    case 'godowns':
      return `Godown ${(record as CollectionMap['godowns']).name}`;
    case 'ledgers':
      return `Ledger ${(record as CollectionMap['ledgers']).name}`;
    default:
      return `Business ${(record as CollectionMap['businesses']).name}`;
  }
}

/** Move a record to the trash in one atomic batch. */
export function trashBatch<K extends TrashableCollection>(collection: K, record: CollectionMap[K], now = new Date()): Batch {
  const entry: TrashEntry = {
    id: newId('trash'),
    collection,
    recordId: record.id,
    businessId: 'businessId' in record ? String(record.businessId) : record.id,
    label: trashLabel(collection, record),
    record,
    deletedAt: now.toISOString(),
  };
  return { puts: [{ collection: 'trash', record: entry }], removes: [{ collection, id: record.id }] };
}

/** Put the record back and drop the trash entry. */
export function restoreBatch(entry: TrashEntry): Batch {
  return {
    puts: [{ collection: entry.collection, record: entry.record as CollectionMap[TrashableCollection] }],
    removes: [{ collection: 'trash', id: entry.id }],
  };
}

export function daysLeft(entry: TrashEntry, now = new Date()): number {
  const age = daysBetween(toISODate(new Date(entry.deletedAt)), toISODate(now));
  return Math.max(0, TRASH_DAYS - age);
}

/** Entries older than 30 days (purged automatically at start-up). */
export function expiredTrash(entries: readonly TrashEntry[], now = new Date()): TrashEntry[] {
  return entries.filter((e) => daysLeft(e, now) === 0);
}
