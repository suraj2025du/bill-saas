import { daysBetween } from './dates';
import { DOC_TYPES } from './docs/docTypes';
import type { PaymentIndex } from './docs/payments';
import { salesPaymentSummary } from './docs/payments';
import { gstDeadlines } from './gst/dueDates';
import { lowStockProducts } from './inventory/stock';
import type { Business, ISODate, Product, SalesDocument } from './model';

export type NotificationKind = 'OVERDUE' | 'LOW_STOCK' | 'GST_DUE' | 'BACKUP' | 'UPDATE' | 'ERROR' | 'INFO';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  severity: 'info' | 'warning' | 'danger';
  title: string;
  detail: string;
  /** In-app route to open. */
  href: string;
}

export interface NotificationInput {
  today: ISODate;
  business: Business;
  invoices: readonly SalesDocument[];
  products: readonly Product[];
  stock: ReadonlyMap<string, number>;
  payments: PaymentIndex;
  lastBackup: ISODate | '';
  dismissed: readonly string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Everything the notification bell should show, most urgent first. */
export function computeNotifications(input: NotificationInput): AppNotification[] {
  const out: AppNotification[] = [];
  const { business, today } = input;

  for (const doc of input.invoices) {
    if (doc.businessId !== business.id || !DOC_TYPES[doc.docType].payable) continue;
    const s = salesPaymentSummary(doc, input.payments, today);
    if (s.overdueDays > 0 && s.balance > 0) {
      out.push({
        id: `overdue-${doc.id}`,
        kind: 'OVERDUE',
        severity: s.overdueDays > 30 ? 'danger' : 'warning',
        title: `${doc.number} overdue by ${plural(s.overdueDays, 'day')}`,
        detail: `${doc.party.name}: balance ${s.balance.toFixed(2)} ${doc.currency}`,
        href: `/sales/${doc.id}`,
      });
    }
  }

  if (business.features.inventory) {
    for (const { product, qty } of lowStockProducts(input.products.filter((p) => p.businessId === business.id), input.stock)) {
      out.push({
        id: `lowstock-${product.id}-${qty}`,
        kind: 'LOW_STOCK',
        severity: qty <= 0 ? 'danger' : 'warning',
        title: `Low stock: ${product.name}`,
        detail: `${qty} ${product.unit} left (alert at ${product.lowStockLevel})`,
        href: `/inventory/products/${product.id}`,
      });
    }
  }

  if (business.countryCode === 'IN' && business.gstRegistration === 'REGULAR') {
    for (const d of gstDeadlines(today, business.gstFiling, business.stateCode)) {
      const when = d.daysLeft < 0 ? `was due ${plural(-d.daysLeft, 'day')} ago` : d.daysLeft === 0 ? 'is due today' : `due in ${plural(d.daysLeft, 'day')}`;
      out.push({
        id: `gst-${d.id}`,
        kind: 'GST_DUE',
        severity: d.daysLeft <= 2 ? 'danger' : 'info',
        title: `${d.form} for ${d.period} ${when}`,
        detail: `Due date ${d.due}`,
        href: d.form === 'GSTR-1' ? '/gst/gstr1' : '/gst/gstr3b',
      });
    }
  }

  const backupAge = input.lastBackup ? daysBetween(input.lastBackup, today) : Infinity;
  if (backupAge > 7) {
    out.push({
      id: `backup-${today}`,
      kind: 'BACKUP',
      severity: 'warning',
      title: input.lastBackup ? `Last backup was ${plural(backupAge, 'day')} ago` : 'No backup yet',
      detail: 'Download a backup file and keep it outside this computer.',
      href: '/settings/backup',
    });
  }

  const rank = { danger: 0, warning: 1, info: 2 } as const;
  return out.filter((n) => !input.dismissed.includes(n.id)).sort((a, b) => rank[a.severity] - rank[b.severity]);
}
