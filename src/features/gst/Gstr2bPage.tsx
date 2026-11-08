import { FileUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { recordsToCsv } from '../../core/export/csv';
import { monthPeriod } from '../../core/gst/returns/period';
import { parse2b, reconcile2b } from '../../core/gst/returns/gstr2b';
import type { Parsed2b, ReconStatus } from '../../core/gst/returns/gstr2b';
import { useBusiness, useMine, useToday } from '../../store/hooks';
import { toast } from '../../ui/feedback';
import { downloadCsv, pickFile } from '../../ui/files';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, NumberInput, PageHeader, Tabs } from '../../ui/kit';
import type { Tone } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';

const STATUS: Record<ReconStatus, { label: string; tone: Tone }> = {
  MATCHED: { label: 'Matched', tone: 'green' },
  MISMATCH: { label: 'Mismatch', tone: 'amber' },
  MISSING_IN_BOOKS: { label: 'Missing in books', tone: 'red' },
  MISSING_IN_2B: { label: 'Missing in 2B', tone: 'blue' },
};

export function Gstr2bPage() {
  const biz = useBusiness();
  const purchases = useMine('purchases');
  const today = useToday();
  const money = useMoney();
  const [parsed, setParsed] = useState<Parsed2b | null>(null);
  const [fileName, setFileName] = useState('');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [tolerance, setTolerance] = useState(1);
  const [tab, setTab] = useState<'ALL' | ReconStatus>('ALL');

  const period = monthPeriod(month);
  const result = useMemo(
    () => (parsed ? reconcile2b(parsed.docs, purchases, { businessId: biz.id, from: period.start, to: period.end, tolerance }) : null),
    [parsed, purchases, biz.id, period.start, period.end, tolerance],
  );

  const load = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const p = parse2b(JSON.parse(await file.text()));
      if (p.errors.length && !p.docs.length) {
        toast.error(p.errors[0]);
        return;
      }
      if (p.gstin && biz.gstin && p.gstin !== biz.gstin) toast.error(`This file is for GSTIN ${p.gstin}, not ${biz.gstin}.`);
      if (/^\d{6}$/.test(p.period)) setMonth(`${p.period.slice(2)}-${p.period.slice(0, 2)}`);
      setParsed(p);
      setFileName(file.name);
      toast.success(`${p.docs.length} supplier documents read`);
    } catch {
      toast.error('This file is not valid JSON. Download GSTR-2B as JSON from the GST portal.');
    }
  };

  const rows = result ? result.rows.filter((r) => tab === 'ALL' || r.status === tab) : [];
  return (
    <div>
      <PageHeader
        title="GSTR-2B reconciliation"
        subtitle={parsed ? `${fileName} | period ${parsed.period || month}` : 'Match the GST portal with your purchase bills'}
        actions={
          <>
            {result && (
              <Button
                onClick={() =>
                  downloadCsv(
                    recordsToCsv(result.rows, [
                      { header: 'Status', value: (r) => STATUS[r.status].label },
                      { header: 'Supplier GSTIN', value: (r) => r.supplierGstin },
                      { header: 'Supplier', value: (r) => r.supplierName },
                      { header: 'Invoice', value: (r) => r.number },
                      { header: 'Date', value: (r) => fdate(r.date) },
                      { header: 'Portal tax', value: (r) => (r.portal ? r.portal.igst + r.portal.cgst + r.portal.sgst + r.portal.cess : '') },
                      { header: 'Difference', value: (r) => r.taxDiff },
                      { header: 'Notes', value: (r) => r.differences.join('; ') },
                    ]),
                    `gstr2b-reconciliation-${month}.csv`,
                  )
                }
              >
                Export CSV
              </Button>
            )}
            <Button variant="primary" icon={<FileUp className="h-4 w-4" />} onClick={() => void load()}>
              Open GSTR-2B JSON
            </Button>
          </>
        }
      />
      {!parsed ? (
        <Card>
          <EmptyState
            icon={<FileUp className="h-10 w-10" />}
            title="Open your GSTR-2B file"
            text="On gst.gov.in go to Returns Dashboard > GSTR-2B > View > Download JSON, then open that file here. Nothing is uploaded anywhere."
            action={
              <Button variant="primary" onClick={() => void load()}>
                Choose file
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label="Bills expected for month">
              <Input type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </Field>
            <Field label="Tolerance (Rs)">
              <NumberInput className="w-24" value={tolerance} onValue={(n) => setTolerance(Math.max(0, n))} />
            </Field>
          </div>
          {parsed.skipped.length > 0 && (
            <div className="mb-3">
              <Alert tone="blue">Also in the file but not reconciled here: {parsed.skipped.join(', ')} (amendments, ISD and imports).</Alert>
            </div>
          )}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {result?.summary.map((s) => (
              <button key={s.status} type="button" className="card px-4 py-3 text-left hover:ring-2 hover:ring-brand-200" onClick={() => setTab(s.status)}>
                <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                <p className="mt-1 text-xl font-semibold">{s.count}</p>
                <p className="text-xs text-slate-500">
                  Portal tax {money(s.portalTax)} | books {money(s.booksTax)}
                </p>
              </button>
            ))}
          </div>
          <Tabs
            value={tab}
            onValue={setTab}
            tabs={[{ value: 'ALL', label: 'All', count: result?.rows.length }, ...(Object.keys(STATUS) as ReconStatus[]).map((k) => ({ value: k, label: STATUS[k].label, count: result?.rows.filter((r) => r.status === k).length }))]}
          />
          <div className="card mt-3 overflow-x-auto">
            {rows.length === 0 ? (
              <EmptyState title="Nothing here" />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Supplier</th>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th className="num">Portal tax</th>
                    <th className="num">Difference</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      </td>
                      <td>
                        {r.supplierName || '-'}
                        <div className="font-mono text-xs text-slate-500">{r.supplierGstin}</div>
                      </td>
                      <td>
                        {r.bill ? (
                          <Link className="text-brand-700 hover:underline" to={`/purchases/${r.bill.id}`}>
                            {r.number}
                          </Link>
                        ) : (
                          r.number
                        )}
                        {r.portal && r.portal.type !== 'INVOICE' && <div className="text-xs text-slate-500">{r.portal.type.replace('_', ' ').toLowerCase()}</div>}
                      </td>
                      <td>{fdate(r.date)}</td>
                      <td className="num">{r.portal ? money(r.portal.igst + r.portal.cgst + r.portal.sgst + r.portal.cess) : '-'}</td>
                      <td className={`num ${Math.abs(r.taxDiff) > tolerance ? 'font-medium text-red-700' : ''}`}>{money(r.taxDiff)}</td>
                      <td className="text-xs text-slate-600">{r.differences.join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
