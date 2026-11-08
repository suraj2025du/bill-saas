import type { CSSProperties } from 'react';
import type { ThermalWidth } from '../core/model';
import { Barcode, QrSvg } from './codes';
import type { InvoiceView } from './view';

/** Printable width of common thermal rolls (paper width minus the printer's margins). */
export const THERMAL_PRINTABLE: Record<ThermalWidth, number> = { 58: 48, 76: 68, 80: 72, 112: 104 };
const FONT_PT: Record<ThermalWidth, number> = { 58: 7.4, 76: 8.2, 80: 8.6, 112: 9.6 };

/** Direct vector receipt for 58 / 76 / 80 / 112 mm thermal printers. */
export function ThermalDocument({ view }: { view: InvoiceView }) {
  const s = view.settings;
  const width = s.thermalWidth;
  const printable = THERMAL_PRINTABLE[width];
  const side = (width - printable) / 2;
  const d = view.doc;
  const b = view.business;
  const L = view.labels;
  const narrow = width === 58;
  const style: CSSProperties = {
    width: `${width}mm`,
    padding: `3mm ${side}mm 4mm`,
    fontSize: `${FONT_PT[width] * (s.fontScale || 1)}pt`,
    lineHeight: 1.3,
    color: '#000',
    fontFamily: "'Segoe UI', 'Nirmala UI', Arial, sans-serif",
  };
  const rule = <div style={{ borderTop: '1px dashed #000', margin: '1.5mm 0' }} />;
  const row = (k: string, v: string, bold = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 700 : 400 }}>
      <span>{k}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
  return (
    <div className="print-sheet print-page" data-page="THERMAL" data-width={width} style={style}>
      <div style={{ textAlign: 'center' }}>
        {s.show.logo && b.logoDataUrl && <img src={b.logoDataUrl} alt="" style={{ maxHeight: '14mm', maxWidth: '60%', filter: 'grayscale(1)' }} />}
        <div style={{ fontWeight: 800, fontSize: '1.3em' }}>{b.legalName || b.name}</div>
        {[b.address1, b.address2, [b.city, b.pincode].filter(Boolean).join(' - ')].filter(Boolean).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        {b.phone && <div>Ph: {b.phone}</div>}
        {b.gstin && <div>GSTIN: {b.gstin}</div>}
        {rule}
        <div style={{ fontWeight: 800 }}>{view.title.toUpperCase()}</div>
        {view.watermark && <div style={{ fontWeight: 800, border: '1px solid #000', display: 'inline-block', padding: '0 2mm' }}>{view.watermark}</div>}
      </div>
      {row(view.numberLabel, d.number || 'DRAFT')}
      {row(L.date, view.date(d.date))}
      {d.party.name && <div>{L.billTo}: <b>{d.party.name}</b></div>}
      {d.party.address && (
        <div>
          {[d.party.address.line1, d.party.address.line2, [d.party.address.city, d.party.address.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', ')}
        </div>
      )}
      {d.party.gstin && <div>GSTIN: {d.party.gstin}</div>}
      {d.party.phone && <div>Ph: {d.party.phone}</div>}
      {view.placeOfSupply && (d.party.gstin || !view.intra) && (
        <div>{L.placeOfSupply}: {view.placeOfSupply}</div>
      )}
      {rule}
      <div style={{ display: 'flex', fontWeight: 700 }}>
        <span style={{ flex: 1 }}>Item</span>
        {!narrow && <span style={{ width: '12mm', textAlign: 'right' }}>{L.qty}</span>}
        <span style={{ width: narrow ? '16mm' : '18mm', textAlign: 'right' }}>{L.amount}</span>
      </div>
      {view.rows.map((r) => (
        <div key={r.sr} className="avoid-break" style={{ marginTop: '0.8mm' }}>
          <div style={{ display: 'flex' }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{r.name}</span>
            {!narrow && <span style={{ width: '12mm', textAlign: 'right' }}>{r.qty}</span>}
            <span style={{ width: narrow ? '16mm' : '18mm', textAlign: 'right' }}>{r.total}</span>
          </div>
          <div style={{ fontSize: '0.85em' }}>
            {narrow ? `${r.qty} ${r.unit} x ${r.rate}` : `${r.unit} @ ${r.rate}`}
            {r.discount && ` (-${r.discount})`}
            {view.taxed && r.gstRate && ` | ${view.taxLabel} ${r.gstRate}`}
            {r.hsn && ` | ${r.hsn}`}
          </div>
        </div>
      ))}
      {rule}
      {view.taxed && row(L.taxable, view.num(d.totals.taxable))}
      {view.taxLines.map((x) => (
        <div key={`${x.label}${x.rate}`}>{row(`${x.label} ${x.rate}%`, view.num(x.amount))}</div>
      ))}
      {d.totals.roundOff !== 0 && row(L.roundOff, view.num(d.totals.roundOff))}
      <div style={{ fontSize: '1.25em' }}>{row(L.grandTotal, view.money(d.totals.total), true)}</div>
      {d.totals.tcs > 0 && row(`TCS ${d.tcs?.section}`, view.num(d.totals.tcs))}
      {d.totals.tds > 0 && row(`TDS ${d.tds?.section}`, `-${view.num(d.totals.tds)}`)}
      {(d.totals.tcs > 0 || d.totals.tds > 0) && row(L.netPayable, view.money(d.totals.net), true)}
      {view.payment && view.payment.status !== 'NOT_APPLICABLE' && view.payment.paid > 0 && (
        <>
          {row(L.paid, view.num(view.payment.paid))}
          {row(L.balanceDue, view.money(view.payment.balance), true)}
        </>
      )}
      {s.show.amountInWords && <div style={{ fontSize: '0.85em', marginTop: '1mm' }}>{view.amountInWords}</div>}
      {view.supplyNote && <div style={{ fontSize: '0.85em' }}>{view.supplyNote}</div>}
      {s.show.upiQr && view.upiUri && (
        <div className="avoid-break" style={{ textAlign: 'center', marginTop: '2mm' }}>
          <QrSvg text={view.upiUri} size={narrow ? 96 : 120} title="UPI payment QR" />
          <div>
            {L.scanToPay}: {view.upi?.vpa}
          </div>
        </div>
      )}
      {s.show.terms && d.terms.trim() && <div style={{ fontSize: '0.8em', whiteSpace: 'pre-line', marginTop: '1.5mm' }}>{d.terms}</div>}
      {rule}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 600 }}>{L.thankYou}</div>
        {s.show.barcode && d.number && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1mm' }}>
            <Barcode value={d.number} height={26} width={narrow ? 1 : 1.2} />
          </div>
        )}
        {s.show.feedbackQr && b.googleReviewUrl && (
          <div style={{ marginTop: '1mm' }}>
            <QrSvg text={b.googleReviewUrl} size={70} title="Review us" />
            <div style={{ fontSize: '0.8em' }}>Review us on Google</div>
          </div>
        )}
      </div>
    </div>
  );
}
