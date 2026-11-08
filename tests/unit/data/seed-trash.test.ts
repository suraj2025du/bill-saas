import { describe, expect, it } from 'vitest';
import { DOC_TYPE_LIST } from '../../../src/core/docs/docTypes';
import { newExpense, newGodown, newLedger, newPayment, newVoucher } from '../../../src/core/factories';
import { isValidGstin } from '../../../src/core/gst/gstin';
import type { TrashableCollection } from '../../../src/core/model';
import { makeSnapshot, validateSnapshot } from '../../../src/core/schema';
import { buildSampleData } from '../../../src/data/seed';
import { TRASH_DAYS, daysLeft, expiredTrash, restoreBatch, trashBatch, trashLabel } from '../../../src/data/trash';

describe('sample data', () => {
  it('is a valid backup with every document type except debit note', () => {
    const data = buildSampleData('2026-10-29');
    expect(validateSnapshot(JSON.parse(JSON.stringify(makeSnapshot(data)))).ok).toBe(true);
    const types = new Set(data.invoices.map((d) => d.docType));
    for (const t of DOC_TYPE_LIST) if (t !== 'DEBIT_NOTE' && t !== 'BILL_OF_SUPPLY' && t !== 'PROFORMA') expect(types.has(t)).toBe(true);
    const exp = data.invoices.find((d) => d.supplyKind === 'EXPORT')!;
    expect(exp.totals.tax).toBe(0);
    expect(exp.currency).toBe('USD');
    const sez = data.invoices.find((d) => d.supplyKind === 'SEZ')!;
    expect(sez.totals.tax).toBe(0);
    const b2cl = data.invoices.find((d) => d.party.name === 'Anita Desai')!;
    expect(b2cl.supplyKind).toBe('INTER_STATE');
    expect(b2cl.totals.total).toBeGreaterThan(100000);
    expect(data.invoices.some((d) => d.status === 'DRAFT' && d.number === '')).toBe(true);
    expect(data.invoices.some((d) => d.recurring?.enabled)).toBe(true);
    expect(data.settings[0]!.customUnits[0]!.code).toBe('COIL');
    // Review Y7: a sample expense claims credit only with a valid vendor GSTIN, as the app requires.
    const claims = data.expenses.filter((e) => e.itcEligible);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.filter((e) => !isValidGstin(e.vendorGstin))).toEqual([]);
  });

  it('never repeats a document number, even across a financial-year boundary', () => {
    for (const today of ['2026-10-29', '2026-04-03', '2026-05-01', '2027-01-01']) {
      const data = buildSampleData(today);
      const seen = new Set<string>();
      for (const d of data.invoices) {
        if (!d.number) continue;
        const key = `${d.docType}|${d.number}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(d.date <= today).toBe(true);
      }
    }
  });
});

describe('trash', () => {
  const data = buildSampleData('2026-10-29');

  it('labels every kind of record', () => {
    const samples: [TrashableCollection, unknown][] = [
      ['invoices', data.invoices[0]],
      ['invoices', { ...data.invoices[0]!, number: '', party: { ...data.invoices[0]!.party, name: '' } }],
      ['purchases', data.purchases[0]],
      ['expenses', data.expenses[0]],
      ['expenses', newExpense('b', { description: '', vendorName: '', date: '2026-01-01' })],
      ['receipts', data.receipts[0]],
      ['receipts', newPayment('b', 'OUT', { number: 'PAY/1', partyName: 'X' })],
      ['vouchers', newVoucher('b', 'CONTRA', { number: 'CV/1' })],
      ['clients', data.clients[0]],
      ['products', data.products[0]],
      ['godowns', newGodown('b', 'Main')],
      ['ledgers', newLedger('b', 'Loan', 'LOANS')],
      ['businesses', data.businesses[0]],
    ];
    const labels = samples.map(([c, r]) => trashLabel(c, r as never));
    expect(labels[0]).toMatch(/^Tax Invoice INV\//);
    expect(labels[1]).toMatch(/\(draft\) - no party/);
    expect(labels[4]).toBe('Expense 2026-01-01');
    expect(labels[6]).toBe('Payment PAY/1 - X');
    expect(labels[7]).toBe('Contra voucher CV/1');
    expect(labels[12]).toMatch(/^Business /);
  });

  it('moves records to the trash and back in atomic batches', () => {
    const inv = data.invoices[0]!;
    const now = new Date('2026-10-01T10:00:00Z');
    const b = trashBatch('invoices', inv, now);
    expect(b.removes).toEqual([{ collection: 'invoices', id: inv.id }]);
    const entry = b.puts[0]!.record as never as Parameters<typeof restoreBatch>[0];
    expect(entry).toMatchObject({ collection: 'invoices', recordId: inv.id, businessId: inv.businessId });
    const back = restoreBatch(entry);
    expect(back.puts[0]!.record).toEqual(inv);
    expect(back.removes[0]).toEqual({ collection: 'trash', id: entry.id });
    expect(trashBatch('businesses', data.businesses[0]!).puts[0]!.record).toMatchObject({ businessId: data.businesses[0]!.id });
  });

  it('expires entries after 30 days', () => {
    const entry = trashBatch('godowns', newGodown('b', 'Old'), new Date(2026, 8, 1, 12)).puts[0]!.record as never as Parameters<typeof daysLeft>[0];
    expect(daysLeft(entry, new Date(2026, 8, 11, 12))).toBe(TRASH_DAYS - 10);
    expect(expiredTrash([entry], new Date(2026, 8, 20, 12))).toEqual([]);
    expect(expiredTrash([entry], new Date(2026, 9, 2, 12))).toEqual([entry]);
  });
});
