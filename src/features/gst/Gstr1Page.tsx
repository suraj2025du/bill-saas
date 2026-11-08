import { FileArchive, FileJson, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Cell } from '../../core/export/csv';
import { XLSX_MIME, buildXlsx } from '../../core/export/xlsx';
import { stateLabel } from '../../core/gst/states';
import { NIL_LABELS, buildGstr1, ecoTcsRate, gstr1Json } from '../../core/gst/returns/gstr1';
import type { Gstr1DocRow, HsnRow } from '../../core/gst/returns/gstr1';
import { gstr1CsvFiles } from '../../core/gst/returns/gstr1Csv';
import { roundTo } from '../../core/money';
import { useBusiness, useMine, useSettings, useToday } from '../../store/hooks';
import { toast } from '../../ui/feedback';
import { downloadBlob, downloadJson, downloadZip } from '../../ui/files';
import { Alert, Button, EmptyState, PageHeader, Tabs } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { PeriodPicker, choiceToPeriod, defaultChoice } from './PeriodPicker';

type Tab = 'summary' | 'b2b' | 'b2cl' | 'b2cs' | 'exp' | 'cdnr' | 'cdnur' | 'nil' | 'hsn' | 'docs' | 'eco';

function DocTable({ rows, showGstin = true }: { rows: Gstr1DocRow[]; showGstin?: boolean }) {
  const money = useMoney();
  if (!rows.length) return <EmptyState title="Nothing in this table for the period" />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Number</th>
          <th>Date</th>
          {showGstin && <th>GSTIN</th>}
          <th>Party</th>
          <th>POS</th>
          <th>Type</th>
          <th className="num">Value</th>
          <th className="num">Taxable</th>
          <th className="num">IGST</th>
          <th className="num">CGST</th>
          <th className="num">SGST/UT</th>
          <th className="num">Cess</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.docId}>
            <td>
              <Link className="text-brand-700 hover:underline" to={`/sales/${r.docId}`}>
                {r.number}
              </Link>
            </td>
            <td>{fdate(r.date)}</td>
            {showGstin && <td className="font-mono text-xs">{r.gstin}</td>}
            <td>{r.party}</td>
            <td>{r.pos}</td>
            <td>
              {r.noteType && `${r.noteType === 'C' ? 'Credit' : 'Debit'} | `}
              {r.type}
              {r.reverseCharge && ' | RCM'}
            </td>
            <td className="num">{money(r.value)}</td>
            <td className="num">{money(r.taxable)}</td>
            <td className="num">{money(r.igst)}</td>
            <td className="num">{money(r.cgst)}</td>
            <td className="num">{money(r.sgst)}</td>
            <td className="num">{money(r.cess)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HsnTable({ rows }: { rows: HsnRow[] }) {
  const money = useMoney();
  if (!rows.length) return <p className="px-4 py-3 text-sm text-slate-500">No rows.</p>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>HSN/SAC</th>
          <th>Description</th>
          <th>UQC</th>
          <th className="num">Qty</th>
          <th className="num">Rate</th>
          <th className="num">Taxable</th>
          <th className="num">IGST</th>
          <th className="num">CGST</th>
          <th className="num">SGST/UT</th>
          <th className="num">Cess</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h, i) => (
          <tr key={i}>
            <td className="font-mono">{h.hsn || '-'}</td>
            <td>{h.description}</td>
            <td>{h.uqc}</td>
            <td className="num">{h.qty}</td>
            <td className="num">{h.rate}%</td>
            <td className="num">{money(h.taxable)}</td>
            <td className="num">{money(h.igst)}</td>
            <td className="num">{money(h.cgst)}</td>
            <td className="num">{money(h.sgst)}</td>
            <td className="num">{money(h.cess)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Gstr1Page() {
  const biz = useBusiness();
  const settings = useSettings();
  const invoices = useMine('invoices');
  const today = useToday();
  const money = useMoney();
  const [choice, setChoice] = useState(() => defaultChoice(today, biz.gstFiling, biz.fyStartMonth));
  const [tab, setTab] = useState<Tab>('summary');
  const period = useMemo(() => choiceToPeriod(choice, biz.fyStartMonth), [choice, biz.fyStartMonth]);
  const report = useMemo(() => buildGstr1(biz, invoices, period, { customUnits: settings.customUnits }), [biz, invoices, period, settings.customUnits]);
  const tcsRate = ecoTcsRate(period.end);

  const exportXlsx = async () => {
    const doc = (rows: Gstr1DocRow[], gstin = true): Cell[][] => [
      ['Number', 'Date', ...(gstin ? ['GSTIN'] : []), 'Party', 'POS', 'Type', 'Value', 'Rate', 'Taxable', 'IGST', 'CGST', 'SGST/UTGST', 'Cess'],
      ...rows.flatMap((r) => r.rates.map((x) => [r.number, fdate(r.date), ...(gstin ? [r.gstin] : []), r.party, r.pos, r.type, r.value, x.rt, x.txval, x.iamt, x.camt, x.samt, x.csamt])),
    ];
    const hsn = (rows: HsnRow[]): Cell[][] => [['HSN', 'Description', 'UQC', 'Qty', 'Rate', 'Taxable', 'IGST', 'CGST', 'SGST/UTGST', 'Cess', 'Total value'], ...rows.map((h) => [h.hsn, h.description, h.uqc, h.qty, h.rate, h.taxable, h.igst, h.cgst, h.sgst, h.cess, h.value])];
    const bytes = await buildXlsx([
      { name: 'Summary', rows: [['Section', 'Count', 'Taxable', 'IGST', 'CGST', 'SGST/UTGST', 'Cess'], ...report.summary.map((s) => [s.label, s.count, s.taxable, s.igst, s.cgst, s.sgst, s.cess])] },
      { name: 'b2b', rows: doc(report.b2b) },
      { name: 'b2cl', rows: doc(report.b2cl, false) },
      { name: 'b2cs', rows: [['Type', 'POS', 'Rate', 'Taxable', 'IGST', 'CGST', 'SGST/UTGST', 'Cess'], ...report.b2cs.map((r) => [r.supplyType, r.pos, r.rate, r.taxable, r.igst, r.cgst, r.sgst, r.cess])] },
      { name: 'exp', rows: doc(report.exp, false) },
      { name: 'cdnr', rows: doc(report.cdnr) },
      { name: 'cdnur', rows: doc(report.cdnur, false) },
      { name: 'nil', rows: [['Description', 'Nil rated', 'Exempted', 'Non-GST'], ...report.nil.map((n) => [NIL_LABELS[n.supplyType], n.nil, n.exempt, n.nonGst])] },
      { name: 'hsn(b2b)', rows: hsn(report.hsnB2b) },
      { name: 'hsn(b2c)', rows: hsn(report.hsnB2c) },
      { name: 'docs', rows: [['Nature of document', 'From', 'To', 'Total', 'Cancelled', 'Net issued'], ...report.docs.map((d) => [d.label, d.from, d.to, d.total, d.cancelled, d.net])] },
      { name: 'eco', rows: [['E-commerce operator GSTIN', 'Documents', 'Net value', 'IGST', 'CGST', 'SGST/UTGST', 'Cess'], ...report.eco.map((e) => [e.etin, e.count, e.value, e.igst, e.cgst, e.sgst, e.cess])] },
    ]);
    downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), `GSTR-1 ${biz.gstin} ${period.fp}.xlsx`);
  };

  const exportCsv = async () => {
    const files = gstr1CsvFiles(report);
    if (!files.length) return toast.info('Nothing to export for this period.');
    await downloadZip(files, `GSTR-1 ${biz.gstin} ${period.fp} CSV.zip`);
    toast.success(`${files.length} CSV file(s) downloaded`);
  };

  const count = (t: Tab) => {
    switch (t) {
      case 'b2b':
        return report.b2b.length;
      case 'b2cl':
        return report.b2cl.length;
      case 'b2cs':
        return report.b2cs.length;
      case 'exp':
        return report.exp.length;
      case 'cdnr':
        return report.cdnr.length;
      case 'cdnur':
        return report.cdnur.length;
      case 'nil':
        return report.nil.length;
      case 'hsn':
        return report.hsnB2b.length + report.hsnB2c.length;
      case 'docs':
        return report.docs.length;
      case 'eco':
        return report.eco.length;
      default:
        return undefined;
    }
  };
  const tabs: { value: Tab; label: string }[] = [
    { value: 'summary', label: 'Summary' },
    { value: 'b2b', label: '4 B2B' },
    { value: 'b2cl', label: '5 B2CL' },
    { value: 'exp', label: '6A Exports' },
    { value: 'b2cs', label: '7 B2CS' },
    { value: 'nil', label: '8 Nil/Exempt' },
    { value: 'cdnr', label: '9B CDNR' },
    { value: 'cdnur', label: '9B CDNUR' },
    { value: 'hsn', label: '12 HSN' },
    { value: 'docs', label: '13 Documents' },
    { value: 'eco', label: '14 E-commerce' },
  ];

  return (
    <div>
      <PageHeader
        title="GSTR-1"
        subtitle={`${period.label} | return period ${period.fp} | GSTIN ${biz.gstin || 'not set'}`}
        actions={
          <>
            <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => void exportXlsx().catch(toast.fromError)}>
              Excel
            </Button>
            <Button icon={<FileArchive className="h-4 w-4" />} onClick={() => void exportCsv().catch(toast.fromError)}>
              CSV (ZIP)
            </Button>
            <Button
              variant="primary"
              icon={<FileJson className="h-4 w-4" />}
              disabled={!biz.gstin}
              onClick={() => {
                downloadJson(gstr1Json(report), `GSTR1_${biz.gstin}_${period.fp}.json`);
                toast.success('GSTR-1 JSON downloaded');
              }}
            >
              Portal JSON
            </Button>
          </>
        }
      />
      <div className="mb-3">
        <PeriodPicker value={choice} onChange={setChoice} />
      </div>
      {report.warnings.length > 0 && (
        <div className="mb-3">
          <Alert tone="amber" title="Check before filing">
            <ul className="list-disc pl-5">
              {report.warnings.slice(0, 15).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {report.warnings.length > 15 && <li>...and {report.warnings.length - 15} more</li>}
            </ul>
          </Alert>
        </div>
      )}
      <Tabs tabs={tabs.map((t) => ({ ...t, count: count(t.value) }))} value={tab} onValue={setTab} />
      <div className="card mt-3 overflow-x-auto">
        {tab === 'summary' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Table</th>
                <th className="num">Records</th>
                <th className="num">Taxable value</th>
                <th className="num">IGST</th>
                <th className="num">CGST</th>
                <th className="num">SGST/UTGST</th>
                <th className="num">Cess</th>
              </tr>
            </thead>
            <tbody>
              {report.summary.map((s) => (
                <tr key={s.key}>
                  <td className="font-medium">{s.label}</td>
                  <td className="num">{s.count}</td>
                  <td className="num">{money(s.taxable)}</td>
                  <td className="num">{money(s.igst)}</td>
                  <td className="num">{money(s.cgst)}</td>
                  <td className="num">{money(s.sgst)}</td>
                  <td className="num">{money(s.cess)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'b2b' && <DocTable rows={report.b2b} />}
        {tab === 'b2cl' && <DocTable rows={report.b2cl} showGstin={false} />}
        {tab === 'exp' && <DocTable rows={report.exp} showGstin={false} />}
        {tab === 'cdnr' && <DocTable rows={report.cdnr} />}
        {tab === 'cdnur' && <DocTable rows={report.cdnur} showGstin={false} />}
        {tab === 'b2cs' &&
          (report.b2cs.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Place of supply</th>
                  <th className="num">Rate</th>
                  <th className="num">Taxable</th>
                  <th className="num">IGST</th>
                  <th className="num">CGST</th>
                  <th className="num">SGST/UT</th>
                  <th className="num">Cess</th>
                </tr>
              </thead>
              <tbody>
                {report.b2cs.map((r, i) => (
                  <tr key={i}>
                    <td>{r.supplyType === 'INTRA' ? 'Intra-state' : 'Inter-state'}</td>
                    <td>{stateLabel(r.pos)}</td>
                    <td className="num">{r.rate}%</td>
                    <td className="num">{money(r.taxable)}</td>
                    <td className="num">{money(r.igst)}</td>
                    <td className="num">{money(r.cgst)}</td>
                    <td className="num">{money(r.sgst)}</td>
                    <td className="num">{money(r.cess)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No B2C (Others) supplies" />
          ))}
        {tab === 'nil' &&
          (report.nil.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num">Nil rated</th>
                  <th className="num">Exempted</th>
                  <th className="num">Non-GST</th>
                </tr>
              </thead>
              <tbody>
                {report.nil.map((n) => (
                  <tr key={n.supplyType}>
                    <td>{NIL_LABELS[n.supplyType]}</td>
                    <td className="num">{money(n.nil)}</td>
                    <td className="num">{money(n.exempt)}</td>
                    <td className="num">{money(n.nonGst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No nil-rated or exempt supplies" />
          ))}
        {tab === 'hsn' && (
          <div>
            {report.hsnSplit ? (
              <>
                <h3 className="px-4 pt-3 text-sm font-semibold">B2B (supplies to registered persons)</h3>
                <HsnTable rows={report.hsnB2b} />
                <h3 className="px-4 pt-4 text-sm font-semibold">B2C (supplies to unregistered persons)</h3>
                <HsnTable rows={report.hsnB2c} />
              </>
            ) : (
              <HsnTable rows={[...report.hsnB2b, ...report.hsnB2c]} />
            )}
          </div>
        )}
        {tab === 'docs' &&
          (report.docs.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nature of document</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Total</th>
                  <th className="num">Cancelled</th>
                  <th className="num">Net issued</th>
                </tr>
              </thead>
              <tbody>
                {report.docs.map((d, i) => (
                  <tr key={i}>
                    <td>
                      {d.nature}. {d.label}
                    </td>
                    <td>{d.from}</td>
                    <td>{d.to}</td>
                    <td className="num">{d.total}</td>
                    <td className="num">{d.cancelled}</td>
                    <td className="num">{d.net}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No documents issued in this period" />
          ))}
        {tab === 'eco' &&
          (report.eco.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>E-commerce operator GSTIN</th>
                  <th className="num">Documents</th>
                  <th className="num">Net value of supplies</th>
                  <th className="num">IGST</th>
                  <th className="num">CGST</th>
                  <th className="num">SGST/UT</th>
                  <th className="num">Cess</th>
                  <th className="num">TCS u/s 52 at {tcsRate}%</th>
                </tr>
              </thead>
              <tbody>
                {report.eco.map((e) => (
                  <tr key={e.etin}>
                    <td className="font-mono">{e.etin}</td>
                    <td className="num">{e.count}</td>
                    <td className="num">{money(e.value)}</td>
                    <td className="num">{money(e.igst)}</td>
                    <td className="num">{money(e.cgst)}</td>
                    <td className="num">{money(e.sgst)}</td>
                    <td className="num">{money(e.cess)}</td>
                    <td className="num">{money(roundTo((e.value * tcsRate) / 100))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No sales through e-commerce operators" text="To report a sale here, enter the operator's GSTIN on the invoice under 'Sold through an e-commerce operator'." />
          ))}
      </div>
      {tab === 'eco' && report.eco.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          These sales are also in the B2B / B2C tables. The operator deducts the TCS from your payout and files GSTR-8; the credit then shows in your electronic cash ledger. Compare the TCS column with the operator&apos;s statement.
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Upload the JSON at gst.gov.in &gt; Returns Dashboard &gt; GSTR-1 &gt; Prepare Offline &gt; Upload. Table 12 uses separate B2B and B2C tabs from the May 2025 return period.
      </p>
    </div>
  );
}
