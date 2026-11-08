import { describe, expect, it } from 'vitest';
import { buildPaymentIndex } from '../../../src/core/docs/payments';
import { gstDeadlines } from '../../../src/core/gst/dueDates';
import { computeNotifications } from '../../../src/core/notifications';
import type { NotificationInput } from '../../../src/core/notifications';
import { sampleBusiness, sampleDoc, sampleParty, sampleProduct } from '../../fixtures/sample';

describe('GST deadlines', () => {
  it('lists monthly GSTR-1 / GSTR-3B dates inside the horizon', () => {
    expect(gstDeadlines('2026-11-05', 'MONTHLY', '27')).toEqual([
      { id: 'gstr1-2026-10', form: 'GSTR-1', period: 'Oct 2026', due: '2026-11-11', daysLeft: 6 },
    ]);
    const later = gstDeadlines('2026-11-15', 'MONTHLY', '27');
    expect(later.map((d) => [d.form, d.due, d.daysLeft])).toEqual([
      ['GSTR-1', '2026-11-11', -4],
      ['GSTR-3B', '2026-11-20', 5],
    ]);
  });

  it('uses the QRMP dates (13th, and 22nd or 24th by state) after each quarter', () => {
    const mh = gstDeadlines('2027-01-15', 'QUARTERLY', '27');
    expect(mh.map((d) => [d.id, d.due])).toEqual([
      ['gstr1-2026-27-q3', '2027-01-13'],
      ['gstr3b-2026-27-q3', '2027-01-22'],
    ]);
    expect(gstDeadlines('2027-01-15', 'QUARTERLY', '09').map((d) => d.due)).toEqual(['2027-01-13', '2027-01-24']);
    expect(gstDeadlines('2026-11-05', 'QUARTERLY', '27')).toEqual([]);
  });
});

describe('notification bell', () => {
  const business = sampleBusiness();
  const party = sampleParty(business.id);
  const product = sampleProduct(business.id, { lowStockLevel: 10 });
  const empty = sampleProduct(business.id, { name: 'Tube Light', lowStockLevel: 5 });
  const overdue = sampleDoc(business, party, [{ qty: 1, rate: 1_000 }], { dueDate: '2026-10-01', date: '2026-09-01' });
  const recent = sampleDoc(business, party, [{ qty: 1, rate: 500 }], { number: 'INV/26-27/0002', dueDate: '2026-11-01', date: '2026-10-25' });
  const base = (over: Partial<NotificationInput> = {}): NotificationInput => ({
    today: '2026-11-05',
    business,
    invoices: [overdue, recent],
    products: [product, empty],
    stock: new Map([
      [product.id, 5],
      [empty.id, 0],
    ]),
    payments: buildPaymentIndex([], [], [overdue, recent], [], business),
    lastBackup: '',
    dismissed: [],
    ...over,
  });

  it('shows overdue invoices, low stock, GST dates and backup reminders, most urgent first', () => {
    const list = computeNotifications(base());
    expect(list.map((n) => n.kind)).toEqual(['OVERDUE', 'LOW_STOCK', 'OVERDUE', 'LOW_STOCK', 'BACKUP', 'GST_DUE']);
    expect(list[0]).toMatchObject({ severity: 'danger', title: 'INV/26-27/0001 overdue by 35 days', href: `/sales/${overdue.id}` });
    expect(list[1]).toMatchObject({ severity: 'danger', title: 'Low stock: Tube Light' });
    expect(list[2].title).toBe('INV/26-27/0002 overdue by 4 days');
    expect(list.find((n) => n.kind === 'GST_DUE')?.title).toBe('GSTR-1 for Oct 2026 due in 6 days');
    expect(list.find((n) => n.kind === 'BACKUP')?.title).toBe('No backup yet');
  });

  it('respects dismissals, a recent backup, the inventory switch and the registration type', () => {
    const all = computeNotifications(base());
    const dismissed = computeNotifications(base({ dismissed: [all[0].id], lastBackup: '2026-11-01' }));
    expect(dismissed.find((n) => n.id === all[0].id)).toBeUndefined();
    expect(dismissed.find((n) => n.kind === 'BACKUP')).toBeUndefined();
    const old = computeNotifications(base({ lastBackup: '2026-10-01' }));
    expect(old.find((n) => n.kind === 'BACKUP')?.title).toBe('Last backup was 35 days ago');
    const noInventory = computeNotifications(base({ business: { ...business, features: { ...business.features, inventory: false } } }));
    expect(noInventory.some((n) => n.kind === 'LOW_STOCK')).toBe(false);
    const composition = computeNotifications(base({ business: { ...business, gstRegistration: 'COMPOSITION' } }));
    expect(composition.some((n) => n.kind === 'GST_DUE')).toBe(false);
    const due = computeNotifications(base({ today: '2026-11-11' }));
    expect(due.find((n) => n.kind === 'GST_DUE')).toMatchObject({ title: 'GSTR-1 for Oct 2026 is due today', severity: 'danger' });
    const late = computeNotifications(base({ today: '2026-11-13' }));
    expect(late.find((n) => n.id === 'gst-gstr1-2026-10')?.title).toBe('GSTR-1 for Oct 2026 was due 2 days ago');
  });
});
