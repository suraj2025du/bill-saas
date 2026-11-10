import type { CSSProperties, ReactNode } from 'react';
import { DOC_TYPES } from '../core/docs/docTypes';
import type { TemplateId } from '../core/model';
import { Barcode, QrSvg } from './codes';
import { ThermalDocument } from './ThermalDocument';
import type { InvoiceView } from './view';
import { PAGE_MM, addressLines, pageOf } from './view';

/** Every copy (Rule 48) of a sales document, one sheet each. */
export function InvoiceDocument({ view }: { view: InvoiceView }) {
  const page = pageOf(view.template);
  if (page === 'THERMAL') return <ThermalDocument view={view} />;
  return (
    <>
      {view.copies.map((copy, i) => (
        <Sheet key={i} view={view} copy={copy} page={page} />
      ))}
    </>
  );
}

export function Watermark({ text, opacity, position, color }: { text: string; opacity: number; position: 'DIAGONAL' | 'HEADER'; color: string }) {
  if (!text) return null;
  const strong = text === 'CANCELLED';
  const style: CSSProperties =
    position === 'HEADER'
      ? { position: 'absolute', top: '4mm', right: '8mm', fontSize: '20pt', border: `2px solid ${color}`, padding: '1mm 4mm', transform: 'rotate(-6deg)' }
      : { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '64pt', transform: 'rotate(-30deg)' };
  return (
    <div
      aria-hidden
      style={{
        ...style,
        color: strong ? '#dc2626' : color,
        opacity: strong ? Math.max(opacity, 0.18) : opacity,
        fontWeight: 800,
        letterSpacing: '0.1em',
        pointerEvents: 'none',
        zIndex: 5,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  );
}

function Sheet({ view, copy, page }: { view: InvoiceView; copy: string; page: 'A4' | 'A5' }) {
  const s = view.settings;
  const size = PAGE_MM[page];
  const base = (page === 'A5' ? 8 : 9.2) * (s.fontScale || 1);
  const style: CSSProperties = {
    width: `${size.w}mm`,
    minHeight: `${size.h}mm`,
    padding: `${s.marginsMm.top}mm ${s.marginsMm.right}mm ${s.marginsMm.bottom}mm ${s.marginsMm.left}mm`,
    fontSize: `${base}pt`,
    color: s.colors.bodyText,
    lineHeight: 1.35,
    fontFamily: "'Segoe UI', 'Nirmala UI', 'Noto Sans', Arial, sans-serif",
  };
  return (
    <div className="print-sheet print-page" data-page={page} style={style}>
      <Watermark text={view.watermark} opacity={s.watermark.opacity} position={s.watermark.position} color={s.colors.accent} />
      {view.template === 'TALLY' ? <TallyLayout view={view} copy={copy} /> : <StandardLayout view={view} copy={copy} variant={view.template} />}
      {view.isTrial && (
        <div style={{ marginTop: '4mm', paddingTop: '2mm', borderTop: '1px dashed #cbd5e1', textAlign: 'center', fontSize: '7.5pt', color: '#64748b' }}>
          Printed using BillSaaS Pro • Free Trial Edition • To remove this footer, upgrade at bill-saas.com
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- shared bits

const cell = (border: string, extra: CSSProperties = {}): CSSProperties => ({ border: `1px solid ${border}`, padding: '1.2mm 1.6mm', verticalAlign: 'top', ...extra });
const right: CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function PartyBlock({ view, title, kind }: { view: InvoiceView; title: string; kind: 'bill' | 'ship' }) {
  const d = view.doc;
  const ship = kind === 'ship' ? d.shipTo : null;
  const name = ship?.name || d.party.name;
  const addr = ship?.address ?? d.party.address;
  const gstin = ship ? ship.gstin : d.party.gstin;
  return (
    <div>
      <div style={{ fontSize: '0.8em', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>{title}</div>
      <div style={{ fontWeight: 700 }}>{name || '-'}</div>
      {addressLines(addr).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      {gstin && <div>GSTIN/UIN: <b>{gstin}</b></div>}
      {kind === 'bill' && d.party.pan && !gstin && <div>PAN: {d.party.pan}</div>}
      {kind === 'bill' && (d.party.phone || d.party.email) && <div>{[d.party.phone, d.party.email].filter(Boolean).join(' | ')}</div>}
    </div>
  );
}

function SellerLines({ view, compact }: { view: InvoiceView; compact?: boolean }) {
  const b = view.business;
  const lines = [b.address1, b.address2, [b.city, b.pincode].filter(Boolean).join(' - ')].filter(Boolean);
  return (
    <>
      {!compact && b.tagline && <div style={{ fontStyle: 'italic' }}>{b.tagline}</div>}
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      {b.gstin && (
        <div>
          GSTIN: <b>{b.gstin}</b>
          {b.stateCode && view.placeOfSupply ? ` | State code ${b.stateCode}` : ''}
        </div>
      )}
      {!b.gstin && b.countryCode !== 'IN' && b.tan && <div>Tax ID: {b.tan}</div>}
      {(b.phone || b.email) && <div>{[b.phone, b.email].filter(Boolean).join(' | ')}</div>}
      {b.website && !compact && <div>{b.website}</div>}
    </>
  );
}

function Logo({ view, height }: { view: InvoiceView; height: string }) {
  if (!view.settings.show.logo || !view.business.logoDataUrl) return null;
  return <img src={view.business.logoDataUrl} alt="" style={{ height, maxWidth: '40mm', objectFit: 'contain' }} />;
}

function Signature({ view, border }: { view: InvoiceView; border: string }) {
  if (!view.settings.show.signature) return null;
  return (
    <div className="avoid-break" style={{ textAlign: 'right', minWidth: '55mm' }}>
      <div style={{ fontWeight: 600 }}>
        {view.labels.for} {view.business.legalName || view.business.name}
      </div>
      <div style={{ height: '16mm', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
        {view.business.signatureDataUrl && <img src={view.business.signatureDataUrl} alt="" style={{ maxHeight: '15mm', maxWidth: '50mm' }} />}
      </div>
      <div style={{ borderTop: `1px solid ${border}`, paddingTop: '1mm' }}>{view.labels.signatory}</div>
    </div>
  );
}

function CustomerSeal({ view, border }: { view: InvoiceView; border: string }) {
  if (!view.settings.show.customerSeal) return null;
  return (
    <div className="avoid-break" style={{ minWidth: '50mm' }}>
      <div style={{ height: '16mm' }} />
      <div style={{ borderTop: `1px solid ${border}`, paddingTop: '1mm' }}>{view.labels.customerSeal}</div>
    </div>
  );
}

function BankBlock({ view }: { view: InvoiceView }) {
  const b = view.bank;
  if (!view.settings.show.bankDetails || !b) return null;
  return (
    <div className="avoid-break">
      <div style={{ fontWeight: 700 }}>{view.labels.bankDetails}</div>
      <div>{b.accountHolder || view.business.name}</div>
      <div>{b.bankName}</div>
      <div>
        {view.labels.accountNo} <b>{b.accountNumber}</b>
      </div>
      {b.ifsc && <div>IFSC: {b.ifsc}{b.branch ? `, ${b.branch}` : ''}</div>}
      {b.swift && <div>SWIFT: {b.swift}</div>}
    </div>
  );
}

function UpiBlock({ view, size = 74 }: { view: InvoiceView; size?: number }) {
  if (!view.settings.show.upiQr || !view.upiUri) return null;
  return (
    <div className="avoid-break" style={{ textAlign: 'center' }}>
      <QrSvg text={view.upiUri} size={size} title="UPI payment QR" />
      <div style={{ fontSize: '0.8em' }}>{view.labels.scanToPay}</div>
      <div style={{ fontSize: '0.75em' }}>{view.upi?.vpa}</div>
    </div>
  );
}

function CodesRow({ view }: { view: InvoiceView }) {
  const s = view.settings.show;
  const fb = s.feedbackQr && view.business.googleReviewUrl;
  if (!(s.barcode && view.doc.number) && !s.invoiceQr && !fb) return null;
  return (
    <div className="avoid-break" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '4mm', marginTop: '3mm' }}>
      <div>{s.barcode && view.doc.number && <Barcode value={view.doc.number} height={28} />}</div>
      <div style={{ display: 'flex', gap: '4mm', alignItems: 'flex-end' }}>
        {s.invoiceQr && (
          <div style={{ textAlign: 'center', fontSize: '0.7em' }}>
            <QrSvg text={view.qrText} size={58} title="Invoice QR" />
            <div>Invoice QR</div>
          </div>
        )}
        {fb && (
          <div style={{ textAlign: 'center', fontSize: '0.7em' }}>
            <QrSvg text={view.business.googleReviewUrl} size={58} title="Review us" />
            <div>Review us on Google</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TermsBlock({ view }: { view: InvoiceView }) {
  const terms = view.doc.terms.trim();
  const s = view.settings.show;
  return (
    <>
      {view.doc.notes.trim() && (
        <div className="avoid-break" style={{ marginTop: '2mm', whiteSpace: 'pre-line' }}>
          <b>Notes:</b> {view.doc.notes}
        </div>
      )}
      {s.terms && terms && (
        <div className="avoid-break" style={{ marginTop: '2mm', whiteSpace: 'pre-line' }}>
          <div style={{ fontWeight: 700 }}>{view.labels.terms}</div>
          <div style={{ fontSize: '0.9em' }}>{terms}</div>
        </div>
      )}
      {s.declaration && view.business.declaration.trim() && DOC_TYPES[view.doc.docType].payable && (
        <div className="avoid-break" style={{ marginTop: '2mm' }}>
          <div style={{ fontWeight: 700 }}>{view.labels.declaration}</div>
          <div style={{ fontSize: '0.9em' }}>{view.business.declaration}</div>
        </div>
      )}
    </>
  );
}

function DispatchGrid({ view, border }: { view: InvoiceView; border: string }) {
  const d = view.doc.dispatch;
  const L = view.labels;
  const items: [string, string][] = [
    [L.buyerOrder, [d.buyerOrderNo, d.buyerOrderDate && view.date(d.buyerOrderDate)].filter(Boolean).join(' / ')],
    [L.dispatchDoc, d.dispatchDocNo],
    [L.dispatchedThrough, [d.dispatchedThrough, d.transporterName].filter(Boolean).join(', ')],
    [L.destination, d.destination],
    [L.vehicleNo, d.vehicleNo],
    [L.ewayBill, d.ewayBillNo],
    [L.termsOfDelivery, d.termsOfDelivery],
  ].filter((x): x is [string, string] => !!x[1]);
  if (!view.settings.show.dispatchDetails || !items.length) return null;
  return (
    <div className="avoid-break" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1mm 4mm', border: `1px solid ${border}`, padding: '1.5mm', marginTop: '2mm', fontSize: '0.9em' }}>
      {items.map(([k, v]) => (
        <div key={k}>
          <span style={{ opacity: 0.7 }}>{k}: </span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

/** Totals box: taxable, each tax line, round off, total, TCS/TDS, net and payment status. */
function Totals({ view, border, accent, boxed }: { view: InvoiceView; border: string; accent: string; boxed: boolean }) {
  const t = view.doc.totals;
  const L = view.labels;
  const row = (label: ReactNode, value: string, strong = false, color?: string) => (
    <tr>
      <td style={{ padding: '0.8mm 2mm', fontWeight: strong ? 700 : 400, color }}>{label}</td>
      <td style={{ padding: '0.8mm 2mm', ...right, fontWeight: strong ? 700 : 400, color }}>{value}</td>
    </tr>
  );
  return (
    <table className="avoid-break" style={{ width: '100%', border: boxed ? `1px solid ${border}` : undefined }}>
      <tbody>
        {t.discount > 0 && row('Gross', view.num(t.gross))}
        {t.discount > 0 && row(L.discount, `- ${view.num(t.discount)}`)}
        {view.taxed && row(L.taxable, view.num(t.taxable))}
        {view.taxLines.map((x) => row(`${x.label} @ ${x.rate}%`, view.num(x.amount)))}
        {t.roundOff !== 0 && row(L.roundOff, view.num(t.roundOff))}
        <tr>
          <td colSpan={2} style={{ borderTop: `1.5px solid ${accent}` }} />
        </tr>
        {row(L.grandTotal, view.money(t.total), true, accent)}
        {t.tcs > 0 && row(`TCS u/s ${view.doc.tcs?.section} @ ${view.doc.tcs?.rate}%`, `+ ${view.num(t.tcs)}`)}
        {t.tds > 0 && row(`TDS u/s ${view.doc.tds?.section} @ ${view.doc.tds?.rate}%`, `- ${view.num(t.tds)}`)}
        {(t.tcs > 0 || t.tds > 0) && row(L.netPayable, view.money(t.net), true)}
        {view.payment && view.payment.status !== 'NOT_APPLICABLE' && view.payment.paid + view.payment.adjusted > 0 && (
          <>
            {row(L.paid, view.num(view.payment.paid + view.payment.adjusted))}
            {row(L.balanceDue, view.money(view.payment.balance), true)}
          </>
        )}
      </tbody>
    </table>
  );
}

function HsnTable({ view, border, headerBg }: { view: InvoiceView; border: string; headerBg: string }) {
  if (!view.settings.show.hsnSummary || !view.hsn.length) return null;
  const L = view.labels;
  const intra = view.intra;
  const th = cell(border, { background: headerBg, fontWeight: 700, textAlign: 'center', fontSize: '0.85em' });
  const td = cell(border, { ...right, fontSize: '0.85em' });
  const sum = (k: 'taxable' | 'cgst' | 'sgst' | 'utgst' | 'igst' | 'tax') => view.hsn.reduce((s, r) => s + r[k], 0);
  return (
    <table className="avoid-break" style={{ width: '100%', marginTop: '2mm' }}>
      <thead>
        <tr>
          <th style={th} rowSpan={2}>HSN/SAC</th>
          <th style={th} rowSpan={2}>{L.taxable}</th>
          {intra ? (
            <>
              <th style={th} colSpan={2}>Central Tax</th>
              <th style={th} colSpan={2}>{view.ut ? 'UT Tax' : 'State Tax'}</th>
            </>
          ) : (
            <th style={th} colSpan={2}>Integrated Tax</th>
          )}
          <th style={th} rowSpan={2}>{L.totalTax}</th>
        </tr>
        <tr>
          <th style={th}>Rate</th>
          <th style={th}>{L.amount}</th>
          {intra && (
            <>
              <th style={th}>Rate</th>
              <th style={th}>{L.amount}</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {view.hsn.map((r, i) => (
          <tr key={i}>
            <td style={{ ...td, textAlign: 'left' }}>{r.hsn || '-'}</td>
            <td style={td}>{view.num(r.taxable)}</td>
            {intra ? (
              <>
                <td style={td}>{r.gstRate / 2}%</td>
                <td style={td}>{view.num(r.cgst)}</td>
                <td style={td}>{r.gstRate / 2}%</td>
                <td style={td}>{view.num(r.sgst + r.utgst)}</td>
              </>
            ) : (
              <>
                <td style={td}>{r.gstRate}%</td>
                <td style={td}>{view.num(r.igst)}</td>
              </>
            )}
            <td style={td}>{view.num(r.tax)}</td>
          </tr>
        ))}
        <tr style={{ fontWeight: 700 }}>
          <td style={{ ...td, textAlign: 'left' }}>{L.total}</td>
          <td style={td}>{view.num(sum('taxable'))}</td>
          {intra ? (
            <>
              <td style={td} />
              <td style={td}>{view.num(sum('cgst'))}</td>
              <td style={td} />
              <td style={td}>{view.num(sum('sgst') + sum('utgst'))}</td>
            </>
          ) : (
            <>
              <td style={td} />
              <td style={td}>{view.num(sum('igst'))}</td>
            </>
          )}
          <td style={td}>{view.num(sum('tax'))}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Words({ view }: { view: InvoiceView }) {
  const s = view.settings.show;
  return (
    <div className="avoid-break" style={{ marginTop: '2mm' }}>
      {s.amountInWords && (
        <div>
          <span style={{ opacity: 0.75 }}>{view.labels.amountInWords}: </span>
          <b>{view.amountInWords}</b>
        </div>
      )}
      {s.taxInWords && view.taxInWords && (
        <div>
          <span style={{ opacity: 0.75 }}>{view.labels.taxInWords}: </span>
          {view.taxInWords}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Tally style

function TallyLayout({ view, copy }: { view: InvoiceView; copy: string }) {
  const s = view.settings;
  const b = s.colors.border;
  const d = view.doc;
  const L = view.labels;
  const box = cell(b);
  const meta: [string, string][] = [
    [view.numberLabel, d.number || 'DRAFT'],
    [L.date, view.date(d.date)],
    [L.dueDate, d.dueDate ? view.date(d.dueDate) : ''],
    [L.placeOfSupply, view.placeOfSupply],
    ...(s.show.dispatchDetails
      ? ([
          [L.buyerOrder, d.dispatch.buyerOrderNo],
          ['Order Date', d.dispatch.buyerOrderDate ? view.date(d.dispatch.buyerOrderDate) : ''],
          [L.dispatchDoc, d.dispatch.dispatchDocNo],
          ['Delivery Note Date', d.dispatch.deliveryNoteDate ? view.date(d.dispatch.deliveryNoteDate) : ''],
          [L.dispatchedThrough, d.dispatch.dispatchedThrough || d.dispatch.transporterName],
          [L.destination, d.dispatch.destination],
          [L.vehicleNo, d.dispatch.vehicleNo],
          [L.ewayBill, d.dispatch.ewayBillNo],
        ] as [string, string][])
      : []),
    ...(d.refDocNumber ? ([['Ref. Invoice', `${d.refDocNumber}${d.refDocDate ? ` / ${view.date(d.refDocDate)}` : ''}`]] as [string, string][]) : []),
  ];
  const pairs: [string, string][][] = [];
  for (let i = 0; i < meta.length; i += 2) pairs.push(meta.slice(i, i + 2));
  const th = cell(b, { background: s.colors.headerBg, color: s.colors.headerText, fontWeight: 700, textAlign: 'center' });
  const td = cell(b, { borderTop: 'none', borderBottom: 'none' });
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1mm' }}>
        <span style={{ fontSize: '0.8em' }}>{view.supplyNote}</span>
        <span style={{ fontSize: '1.35em', fontWeight: 800, letterSpacing: '0.04em', color: s.colors.accent }}>{view.title.toUpperCase()}</span>
        <span style={{ fontSize: '0.8em', fontStyle: 'italic' }}>{copy}</span>
      </div>
      <table style={{ width: '100%' }}>
        <tbody>
          <tr>
            <td style={{ ...box, width: '52%' }} rowSpan={Math.max(1, pairs.length)}>
              <div style={{ display: 'flex', gap: '2mm' }}>
                <Logo view={view} height="14mm" />
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.2em' }}>{view.business.legalName || view.business.name}</div>
                  <SellerLines view={view} compact />
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${b}`, margin: '1.5mm -1.6mm', padding: '1.5mm 1.6mm 0' }}>
                <PartyBlock view={view} title={`${L.billTo} (Buyer)`} kind="bill" />
              </div>
              {d.shipTo && s.show.shipTo && (
                <div style={{ borderTop: `1px solid ${b}`, margin: '1.5mm -1.6mm 0', padding: '1.5mm 1.6mm 0' }}>
                  <PartyBlock view={view} title={`${L.shipTo} (Consignee)`} kind="ship" />
                </div>
              )}
            </td>
            {pairs[0]?.map(([k, v]) => (
              <td key={k} style={box}>
                <div style={{ fontSize: '0.8em', opacity: 0.75 }}>{k}</div>
                <div style={{ fontWeight: 700 }}>{v || '-'}</div>
              </td>
            ))}
          </tr>
          {pairs.slice(1).map((p, i) => (
            <tr key={i}>
              {p.map(([k, v]) => (
                <td key={k} style={box} colSpan={p.length === 1 ? 2 : 1}>
                  <div style={{ fontSize: '0.8em', opacity: 0.75 }}>{k}</div>
                  <div style={{ fontWeight: 700 }}>{v || '-'}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <table style={{ width: '100%', marginTop: '-1px' }}>
        <thead style={{ display: 'table-header-group' }}>
          <tr>
            <th style={{ ...th, width: '6mm' }}>{L.sr}</th>
            <th style={th}>{L.description}</th>
            <th style={th}>HSN/SAC</th>
            <th style={th}>{L.qty}</th>
            <th style={th}>{L.rate}</th>
            <th style={th}>per</th>
            <th style={th}>{L.discount}</th>
            {view.taxed && <th style={th}>GST</th>}
            <th style={th}>{L.amount}</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.sr}>
              <td style={{ ...td, textAlign: 'center' }}>{r.sr}</td>
              <td style={td}>
                <b>{r.name}</b>
                {r.description && <div style={{ fontSize: '0.85em', fontStyle: 'italic' }}>{r.description}</div>}
              </td>
              <td style={td}>{r.hsn}</td>
              <td style={{ ...td, ...right }}>
                <b>{r.qty}</b>
              </td>
              <td style={{ ...td, ...right }}>{r.rate}</td>
              <td style={td}>{r.unit}</td>
              <td style={{ ...td, ...right }}>{r.discount}</td>
              {view.taxed && <td style={{ ...td, ...right }}>{r.gstRate}</td>}
              <td style={{ ...td, ...right }}>
                <b>{r.taxable}</b>
              </td>
            </tr>
          ))}
          {view.taxLines.map((x) => (
            <tr key={`${x.label}${x.rate}`}>
              <td style={td} />
              <td style={{ ...td, ...right, fontWeight: 700, fontStyle: 'italic' }}>
                {x.label} @ {x.rate}%
              </td>
              <td style={td} colSpan={view.taxed ? 6 : 5} />
              <td style={{ ...td, ...right, fontWeight: 700 }}>{view.num(x.amount)}</td>
            </tr>
          ))}
          {d.totals.roundOff !== 0 && (
            <tr>
              <td style={td} />
              <td style={{ ...td, ...right, fontStyle: 'italic' }}>{L.roundOff}</td>
              <td style={td} colSpan={view.taxed ? 6 : 5} />
              <td style={{ ...td, ...right }}>{view.num(d.totals.roundOff)}</td>
            </tr>
          )}
          <tr style={{ fontWeight: 800 }}>
            <td style={box} />
            <td style={{ ...box, ...right }}>{L.total}</td>
            <td style={box} />
            <td style={{ ...box, ...right }}>{view.totalQty}</td>
            <td style={box} colSpan={view.taxed ? 4 : 3} />
            <td style={{ ...box, ...right }}>{view.money(d.totals.total)}</td>
          </tr>
        </tbody>
      </table>
      <div className="avoid-break" style={{ ...box, borderTop: 'none', display: 'flex', justifyContent: 'space-between' }}>
        <div>
          {s.show.amountInWords && (
            <>
              <span style={{ fontSize: '0.85em' }}>{L.amountInWords}:</span>
              <div style={{ fontWeight: 700 }}>{view.amountInWords}</div>
            </>
          )}
        </div>
        <div style={{ fontStyle: 'italic', fontSize: '0.85em' }}>E. &amp; O.E</div>
      </div>
      {(d.totals.tcs > 0 || d.totals.tds > 0) && (
        <div className="avoid-break" style={{ ...box, borderTop: 'none', ...right }}>
          {d.totals.tcs > 0 && <div>TCS u/s {d.tcs?.section}: + {view.num(d.totals.tcs)}</div>}
          {d.totals.tds > 0 && <div>TDS u/s {d.tds?.section}: - {view.num(d.totals.tds)}</div>}
          <b>
            {L.netPayable}: {view.money(d.totals.net)}
          </b>
        </div>
      )}
      <HsnTable view={view} border={b} headerBg={s.colors.headerBg} />
      {s.show.taxInWords && view.taxInWords && (
        <div className="avoid-break" style={{ marginTop: '1mm' }}>
          {L.taxInWords}: <b>{view.taxInWords}</b>
        </div>
      )}
      <table className="avoid-break" style={{ width: '100%', marginTop: '2mm' }}>
        <tbody>
          <tr>
            <td style={{ ...box, width: '52%' }}>
              <TermsBlock view={view} />
              <div style={{ marginTop: '3mm' }}>
                <CustomerSeal view={view} border={b} />
              </div>
            </td>
            <td style={box}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2mm' }}>
                <BankBlock view={view} />
                <UpiBlock view={view} size={64} />
              </div>
              <div style={{ marginTop: '2mm' }}>
                <Signature view={view} border={b} />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <CodesRow view={view} />
      <div style={{ textAlign: 'center', fontSize: '0.75em', marginTop: '1.5mm', opacity: 0.7 }}>This is a computer generated document.</div>
    </div>
  );
}

// ---------------------------------------------------------------- other designs

interface Look {
  ruled: boolean;
  zebra: boolean;
  header: 'band' | 'dark' | 'center' | 'plain' | 'boxed';
  hideQty: boolean;
}

function lookOf(t: TemplateId, view: InvoiceView): Look {
  const serviceOnly = view.allServices && view.doc.items.every((i) => i.qty === 1);
  switch (t) {
    case 'MODERN':
      return { ruled: false, zebra: true, header: 'band', hideQty: false };
    case 'EXECUTIVE':
      return { ruled: false, zebra: false, header: 'dark', hideQty: false };
    case 'RETAIL':
      return { ruled: false, zebra: true, header: 'center', hideQty: false };
    case 'MINIMAL':
      return { ruled: false, zebra: false, header: 'plain', hideQty: false };
    case 'SERVICE':
      return { ruled: false, zebra: true, header: 'band', hideQty: serviceOnly };
    case 'COMPACT_A5':
    case 'BOXED':
    default:
      return { ruled: true, zebra: false, header: 'boxed', hideQty: false };
  }
}

function MetaList({ view }: { view: InvoiceView }) {
  const d = view.doc;
  const L = view.labels;
  const items: [string, string][] = [
    [view.numberLabel, d.number || 'DRAFT'],
    [L.date, view.date(d.date)],
    [L.dueDate, d.dueDate ? view.date(d.dueDate) : ''],
    [L.placeOfSupply, view.placeOfSupply],
    ['Ref.', d.refDocNumber ? `${d.refDocNumber}${d.refDocDate ? ` (${view.date(d.refDocDate)})` : ''}` : ''],
    ['Currency', d.currency !== view.business.currency ? `${d.currency} @ ${d.exchangeRate}` : ''],
  ].filter((x): x is [string, string] => !!x[1]);
  return (
    <table style={{ marginLeft: 'auto' }}>
      <tbody>
        {items.map(([k, v]) => (
          <tr key={k}>
            <td style={{ padding: '0.3mm 2mm 0.3mm 0', opacity: 0.75, textAlign: 'right' }}>{k}</td>
            <td style={{ padding: '0.3mm 0', fontWeight: 700, textAlign: 'right' }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StandardHeader({ view, look, copy }: { view: InvoiceView; look: Look; copy: string }) {
  const s = view.settings;
  const c = s.colors;
  const name = view.business.legalName || view.business.name;
  const title = (
    <div style={{ fontSize: '1.6em', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase' }}>{view.title}</div>
  );
  const copyLine = copy && <div style={{ fontSize: '0.8em', fontStyle: 'italic' }}>{copy}</div>;
  if (look.header === 'center') {
    return (
      <div style={{ textAlign: 'center', borderBottom: `2px solid ${c.accent}`, paddingBottom: '2mm' }}>
        <Logo view={view} height="16mm" />
        <div style={{ fontSize: '1.8em', fontWeight: 800, color: c.accent }}>{name}</div>
        <SellerLines view={view} />
        <div style={{ marginTop: '1.5mm', display: 'inline-block', background: c.headerBg, color: c.headerText, padding: '0.6mm 4mm', fontWeight: 700, borderRadius: '1mm' }}>
          {view.title.toUpperCase()}
        </div>
        {copyLine}
      </div>
    );
  }
  const band = look.header === 'band' || look.header === 'dark';
  const bg = look.header === 'dark' ? c.headerText : band ? c.accent : 'transparent';
  const fg = band ? '#ffffff' : c.bodyText;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '4mm',
        background: bg,
        color: fg,
        padding: band ? '4mm' : look.header === 'boxed' ? '2mm' : 0,
        margin: band ? `-${s.marginsMm.top}mm -${s.marginsMm.right}mm 0 -${s.marginsMm.left}mm` : 0,
        border: look.header === 'boxed' ? `1px solid ${c.border}` : undefined,
        borderBottom: look.header === 'plain' ? `1px solid ${c.border}` : look.header === 'dark' ? `3mm solid ${c.accent}` : undefined,
        paddingBottom: look.header === 'plain' ? '2mm' : undefined,
      }}
    >
      <div style={{ display: 'flex', gap: '3mm' }}>
        <Logo view={view} height="18mm" />
        <div>
          <div style={{ fontSize: '1.5em', fontWeight: 800 }}>{name}</div>
          <SellerLines view={view} />
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {title}
        {copyLine}
        {view.supplyNote && <div style={{ fontSize: '0.8em' }}>{view.supplyNote}</div>}
        <div style={{ marginTop: '1.5mm' }}>
          <MetaList view={view} />
        </div>
      </div>
    </div>
  );
}

function StandardLayout({ view, copy, variant }: { view: InvoiceView; copy: string; variant: TemplateId }) {
  const s = view.settings;
  const c = s.colors;
  const look = lookOf(variant, view);
  const L = view.labels;
  const d = view.doc;
  const showShip = !!d.shipTo && s.show.shipTo;
  const headCell: CSSProperties = {
    padding: '1.4mm 1.6mm',
    background: look.header === 'plain' ? 'transparent' : c.headerBg,
    color: c.headerText,
    fontWeight: 700,
    fontSize: '0.85em',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    border: look.ruled ? `1px solid ${c.border}` : undefined,
    borderBottom: `1.5px solid ${look.ruled ? c.border : c.accent}`,
    textAlign: 'left',
  };
  const bodyCell = (i: number): CSSProperties => ({
    padding: '1.2mm 1.6mm',
    border: look.ruled ? `1px solid ${c.border}` : undefined,
    borderBottom: look.ruled ? undefined : `0.5px solid ${c.border}`,
    background: look.zebra && i % 2 === 1 ? '#f8fafc' : undefined,
    verticalAlign: 'top',
  });
  const cols = {
    qty: !look.hideQty,
    taxable: view.taxed,
    gst: view.taxed,
  };
  return (
    <div>
      <StandardHeader view={view} look={look} copy={copy} />
      {look.header === 'center' && (
        <div style={{ marginTop: '2mm' }}>
          <MetaList view={view} />
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: showShip ? '1fr 1fr' : '1fr',
          gap: '3mm',
          marginTop: '3mm',
          border: look.ruled ? `1px solid ${c.border}` : undefined,
          padding: look.ruled ? '2mm' : 0,
        }}
      >
        <PartyBlock view={view} title={L.billTo} kind="bill" />
        {showShip && <PartyBlock view={view} title={L.shipTo} kind="ship" />}
      </div>
      <DispatchGrid view={view} border={c.border} />
      <table style={{ width: '100%', marginTop: '3mm' }}>
        <thead style={{ display: 'table-header-group' }}>
          <tr>
            <th style={{ ...headCell, width: '6mm' }}>#</th>
            <th style={headCell}>{L.description}</th>
            <th style={headCell}>HSN/SAC</th>
            {cols.qty && <th style={{ ...headCell, ...right }}>{L.qty}</th>}
            {cols.qty && <th style={{ ...headCell, ...right }}>{L.rate}</th>}
            {d.items.some((i) => i.discountPct) && <th style={{ ...headCell, ...right }}>{L.discount}</th>}
            {cols.taxable && <th style={{ ...headCell, ...right }}>{L.taxable}</th>}
            {cols.gst && <th style={{ ...headCell, ...right }}>{view.taxLabel}</th>}
            <th style={{ ...headCell, ...right }}>{L.amount}</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r, i) => (
            <tr key={r.sr}>
              <td style={bodyCell(i)}>{r.sr}</td>
              <td style={bodyCell(i)}>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                {r.description && <div style={{ fontSize: '0.85em', opacity: 0.8 }}>{r.description}</div>}
              </td>
              <td style={bodyCell(i)}>{r.hsn}</td>
              {cols.qty && (
                <td style={{ ...bodyCell(i), ...right }}>
                  {r.qty} {r.unit}
                </td>
              )}
              {cols.qty && <td style={{ ...bodyCell(i), ...right }}>{r.rate}</td>}
              {d.items.some((x) => x.discountPct) && <td style={{ ...bodyCell(i), ...right }}>{r.discount}</td>}
              {cols.taxable && <td style={{ ...bodyCell(i), ...right }}>{r.taxable}</td>}
              {cols.gst && (
                <td style={{ ...bodyCell(i), ...right }}>
                  {r.tax}
                  <div style={{ fontSize: '0.8em', opacity: 0.75 }}>{r.gstRate}</div>
                </td>
              )}
              <td style={{ ...bodyCell(i), ...right, fontWeight: 600 }}>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: '4mm', marginTop: '3mm' }}>
        <div>
          <Words view={view} />
          <HsnTable view={view} border={c.border} headerBg={c.headerBg} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '3mm', marginTop: '3mm' }}>
            <BankBlock view={view} />
            <UpiBlock view={view} />
          </div>
        </div>
        <div>
          <Totals view={view} border={c.border} accent={c.accent} boxed={look.ruled} />
        </div>
      </div>
      <TermsBlock view={view} />
      <div className="avoid-break" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '6mm', gap: '6mm' }}>
        <CustomerSeal view={view} border={c.border} />
        <Signature view={view} border={c.border} />
      </div>
      <CodesRow view={view} />
      {variant === 'RETAIL' && <div style={{ textAlign: 'center', marginTop: '2mm', fontWeight: 600, color: c.accent }}>{L.thankYou}</div>}
    </div>
  );
}
