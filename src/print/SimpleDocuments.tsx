import type { CSSProperties, ReactNode } from 'react';
import { paymentFx } from '../core/accounting/postings';
import { formatMoney, formatNumber } from '../core/currency/format';
import { amountInWords } from '../core/currency/words';
import { formatDate, todayISO } from '../core/dates';
import type { Business, PaymentRecord, SalesDocument } from '../core/model';
import { labelsFor } from './labels';
import { Watermark } from './InvoiceDocument';

function Frame({ business, children, title, size = 'A4' }: { business: Business; children: ReactNode; title: string; size?: 'A4' | 'A5' }) {
  const s = business.print;
  const style: CSSProperties = {
    width: size === 'A4' ? '210mm' : '148mm',
    minHeight: size === 'A4' ? '297mm' : '210mm',
    padding: `${s.marginsMm.top}mm ${s.marginsMm.right}mm ${s.marginsMm.bottom}mm ${s.marginsMm.left}mm`,
    fontSize: `${9.2 * (s.fontScale || 1)}pt`,
    color: s.colors.bodyText,
    fontFamily: "'Segoe UI', 'Nirmala UI', Arial, sans-serif",
    lineHeight: 1.35,
  };
  return (
    <div className="print-sheet print-page" data-page={size} style={style}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `2px solid ${s.colors.accent}`, paddingBottom: '2mm', marginBottom: '3mm' }}>
        <div style={{ display: 'flex', gap: '3mm' }}>
          {business.logoDataUrl && s.show.logo && <img src={business.logoDataUrl} alt="" style={{ height: '14mm' }} />}
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.4em' }}>{business.legalName || business.name}</div>
            <div>{[business.address1, business.address2, business.city, business.pincode].filter(Boolean).join(', ')}</div>
            {business.gstin && <div>GSTIN: {business.gstin}</div>}
            {(business.phone || business.email) && <div>{[business.phone, business.email].filter(Boolean).join(' | ')}</div>}
          </div>
        </div>
        <div style={{ fontSize: '1.5em', fontWeight: 800, color: s.colors.accent, textAlign: 'right' }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

/** Payment receipt (money received) or payment voucher (money paid). */
export function ReceiptDocument({ business, payment, doc }: { business: Business; payment: PaymentRecord; doc?: SalesDocument | null }) {
  const L = labelsFor(business.print.language, business.print.bilingual);
  const cur = paymentFx(payment, doc ?? undefined, business).currency;
  const bank = business.bankAccounts.find((b) => b.id === payment.bankAccountId);
  const inbound = payment.direction === 'IN';
  const rows: [string, string][] = [
    ['Receipt No.', payment.number],
    [L.date, formatDate(payment.date)],
    [inbound ? L.receivedFrom : 'Paid To', payment.partyName],
    [L.paymentMode, `${payment.mode}${bank ? ` (${bank.bankName} ...${bank.accountNumber.slice(-4)})` : ''}`],
    ['Reference', payment.reference],
    [L.againstInvoice, doc ? `${doc.number} dated ${formatDate(doc.date)}` : 'On account / advance'],
    ['Notes', payment.notes],
  ].filter((r): r is [string, string] => !!r[1]);
  return (
    <Frame business={business} title={inbound ? L.receipt : 'Payment Voucher'} size="A5">
      <table style={{ width: '100%' }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: '1mm 2mm 1mm 0', opacity: 0.75, width: '40%' }}>{k}</td>
              <td style={{ padding: '1mm 0', fontWeight: 600 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '4mm', border: `1.5px solid ${business.print.colors.accent}`, padding: '3mm', textAlign: 'center' }}>
        <div style={{ fontSize: '0.85em', opacity: 0.75 }}>{L.amount}</div>
        <div style={{ fontSize: '1.8em', fontWeight: 800 }}>{formatMoney(payment.amount, cur)}</div>
        <div style={{ fontStyle: 'italic' }}>{amountInWords(payment.amount, cur)}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14mm' }}>
        <div style={{ textAlign: 'center', borderTop: '1px solid #9ca3af', paddingTop: '1mm', minWidth: '50mm' }}>{L.signatory}</div>
      </div>
    </Frame>
  );
}

export interface ReportColumn {
  header: string;
  align?: 'left' | 'right';
  width?: string;
}

/** Generic printable report (statements, books, registers). */
export function ReportDocument({
  business,
  title,
  subtitle,
  columns,
  rows,
  footer,
  watermark,
}: {
  business: Business;
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: (string | number)[][];
  footer?: (string | number)[][];
  watermark?: string;
}) {
  const c = business.print.colors;
  const cell = (align: 'left' | 'right' = 'left', bold = false): CSSProperties => ({
    border: `1px solid ${c.border}`,
    padding: '1mm 1.5mm',
    textAlign: align,
    fontWeight: bold ? 700 : 400,
    fontVariantNumeric: 'tabular-nums',
  });
  const fmt = (v: string | number) => (typeof v === 'number' ? formatNumber(v, 2) : v);
  return (
    <Frame business={business} title={title}>
      <Watermark text={watermark ?? ''} opacity={0.08} position="DIAGONAL" color={c.accent} />
      {subtitle && <div style={{ marginBottom: '2mm', fontWeight: 600 }}>{subtitle}</div>}
      <table style={{ width: '100%' }}>
        <thead style={{ display: 'table-header-group' }}>
          <tr>
            {columns.map((col) => (
              <th key={col.header} style={{ ...cell(col.align, true), background: c.headerBg, color: c.headerText, width: col.width }}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} style={cell(columns[j]?.align)}>
                  {fmt(v)}
                </td>
              ))}
            </tr>
          ))}
          {footer?.map((r, i) => (
            <tr key={`f${i}`}>
              {r.map((v, j) => (
                <td key={j} style={cell(columns[j]?.align, true)}>
                  {fmt(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '3mm', fontSize: '0.8em', opacity: 0.7 }}>Generated on {formatDate(todayISO())}</div>
    </Frame>
  );
}
