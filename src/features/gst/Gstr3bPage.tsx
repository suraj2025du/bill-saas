import { FileJson, FileSpreadsheet, FileText, FileUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Cell } from '../../core/export/csv';
import { toCsv } from '../../core/export/csv';
import { XLSX_MIME, buildXlsx } from '../../core/export/xlsx';
import { normalizeGstin } from '../../core/gst/gstin';
import { stateLabel } from '../../core/gst/states';
import { parse2b } from '../../core/gst/returns/gstr2b';
import type { Parsed2b } from '../../core/gst/returns/gstr2b';
import { buildGstr3b, gstr3bJson } from '../../core/gst/returns/gstr3b';
import type { Heads, TaxAmounts } from '../../core/gst/returns/gstr3b';
import { roundTo } from '../../core/money';
import { useBusiness, useMine, useToday } from '../../store/hooks';
import { toast } from '../../ui/feedback';
import { downloadBlob, downloadCsv, downloadJson, pickFile } from '../../ui/files';
import { Alert, Badge, Button, Card, PageHeader } from '../../ui/kit';
import type { Tone } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { PeriodPicker, choiceToPeriod, defaultChoice } from './PeriodPicker';

function TaxRow({ label, t, money, showTax = true }: { label: ReactNode; t: Partial<TaxAmounts>; money: (n: number) => string; showTax?: boolean }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{t.txval !== undefined ? money(t.txval) : ''}</td>
      <td className="num">{showTax && t.iamt !== undefined ? money(t.iamt) : ''}</td>
      <td className="num">{showTax && t.camt !== undefined ? money(t.camt) : ''}</td>
      <td className="num">{showTax && t.samt !== undefined ? money(t.samt) : ''}</td>
      <td className="num">{showTax && t.csamt !== undefined ? money(t.csamt) : ''}</td>
    </tr>
  );
}

const Head = ({ first = 'Nature of supplies' }: { first?: string }) => (
  <thead>
    <tr>
      <th>{first}</th>
      <th className="num">Taxable value</th>
      <th className="num">IGST</th>
      <th className="num">CGST</th>
      <th className="num">SGST/UTGST</th>
      <th className="num">Cess</th>
    </tr>
  </thead>
);

const HEADS: (keyof Heads)[] = ['igst', 'cgst', 'sgst', 'cess'];
const HEAD_LABEL: Record<keyof Heads, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST/UTGST', cess: 'Cess' };

export function Gstr3bPage() {
  const biz = useBusiness();
  const invoices = useMine('invoices');
  const purchases = useMine('purchases');
  const expenses = useMine('expenses');
  const today = useToday();
  const money = useMoney();
  const [choice, setChoice] = useState(() => defaultChoice(today, biz.gstFiling, biz.fyStartMonth));
  const period = useMemo(() => choiceToPeriod(choice, biz.fyStartMonth), [choice, biz.fyStartMonth]);
  // Compliance row 1: Table 4(A)(5) comes from the GSTR-2B of the period once it is opened here.
  const [twoB, setTwoB] = useState<{ file: string; data: Parsed2b } | null>(null);
  const twoBForPeriod = twoB && (!twoB.data.period || twoB.data.period === period.fp) ? twoB.data : null;
  const r = useMemo(() => buildGstr3b(biz, { invoices, purchases, expenses }, period, twoBForPeriod), [biz, invoices, purchases, expenses, period, twoBForPeriod]);
  const s = r.setOff;
  const nl = r.negativeLiability;
  const cashTotal = HEADS.reduce((t, h) => t + s.cashTotal[h], 0);
  const headList = (x: Heads) => HEADS.map((h) => `${HEAD_LABEL[h]} ${money(x[h])}`).join(', ');

  const open2b = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    let p: Parsed2b;
    try {
      p = parse2b(JSON.parse(await file.text()));
    } catch {
      toast.error('This file is not valid JSON. Download GSTR-2B as JSON from the GST portal.');
      return;
    }
    if (p.errors.length && !p.docs.length) {
      toast.error(p.errors[0]);
      return;
    }
    if (p.gstin && biz.gstin && normalizeGstin(p.gstin) !== normalizeGstin(biz.gstin)) {
      toast.error(`This GSTR-2B is for GSTIN ${p.gstin}, not ${biz.gstin}.`);
      return;
    }
    const fp = p.period;
    if (/^\d{6}$/.test(fp)) setChoice((c) => (c.kind === 'MONTH' ? { ...c, month: `${fp.slice(2)}-${fp.slice(0, 2)}` } : c));
    setTwoB({ file: file.name, data: p });
    toast.success(`${p.docs.length} supplier documents read from GSTR-2B`);
  };

  // The GSTR-2B check: documents behind the 4(A)(5) figure that need a look.
  const checkRows: { tone: Tone; status: string; effect: string; party: string; gstin: string; number: string; date: string; tax: number; href: string }[] = r.itc2b
    ? [
        ...r.itc2b.notInBooks.map((p) => ({ tone: 'red' as Tone, status: 'Not in your books', effect: 'Reversed in 4(B)(2)', party: p.supplierName, gstin: p.supplierGstin, number: p.number, date: p.date, tax: roundTo(p.igst + p.cgst + p.sgst + p.cess), href: '' })),
        ...r.itc2b.notIn2b.map((g) => ({ tone: 'blue' as Tone, status: 'Not in GSTR-2B', effect: 'Not claimed', party: g.party, gstin: g.gstin, number: g.number || '-', date: g.date, tax: g.tax, href: g.source === 'PURCHASE' ? `/purchases/${g.id}` : '/expenses' })),
        ...r.itc2b.differs.map((p) => ({ tone: 'amber' as Tone, status: 'Values differ', effect: 'GSTR-2B values used', party: p.supplierName, gstin: p.supplierGstin, number: p.number, date: p.date, tax: roundTo(p.igst + p.cgst + p.sgst + p.cess), href: '' })),
      ]
    : [];

  // The same tables feed the Excel workbook (one sheet each) and the CSV (one block each).
  const tables = (): { name: string; rows: Cell[][] }[] => {
    const t = (label: string, x: Partial<TaxAmounts>) => [label, x.txval ?? '', x.iamt ?? '', x.camt ?? '', x.samt ?? '', x.csamt ?? ''];
    return [
      {
        name: '3.1 Outward',
        rows: [
          ['Nature of supplies', 'Taxable value', 'IGST', 'CGST', 'SGST/UTGST', 'Cess'],
          t('(a) Outward taxable supplies', r.outward),
          t('(b) Zero rated', r.zeroRated),
          t('(c) Nil rated, exempted', { txval: r.nilExempt }),
          t('(d) Inward supplies (reverse charge)', r.inwardRcm),
          t('(e) Non-GST outward', { txval: r.nonGst }),
        ],
      },
      { name: '3.2 Inter-state', rows: [['Place of supply', 'Unregistered taxable', 'Unregistered IGST'], ...r.unregistered.map((x) => [stateLabel(x.pos), x.txval, x.iamt])] },
      {
        name: '4 ITC',
        rows: [
          ['Details', 'IGST', 'CGST', 'SGST/UTGST', 'Cess'],
          ...r.itcAvailable.map((x) => [`(A) ${x.label}`, x.iamt, x.camt, x.samt, x.csamt]),
          ...r.itcReversed.map((x) => [`(B) ${x.label}`, x.iamt, x.camt, x.samt, x.csamt]),
          ['(C) Net ITC', r.itcNet.iamt, r.itcNet.camt, r.itcNet.samt, r.itcNet.csamt],
          ...r.itcIneligible.map((x) => [`(D) ${x.label}`, x.iamt, x.camt, x.samt, x.csamt]),
        ],
      },
      {
        name: '6.1 Payment',
        rows: [
          ['Head', 'Tax payable', 'Paid by IGST credit', 'Paid by CGST credit', 'Paid by SGST credit', 'Paid by cess credit', 'Cash (forward charge)', 'Cash (reverse charge)', 'Negative liability set off'],
          ...HEADS.map((h) => [HEAD_LABEL[h], s.liability[h] + s.rcm[h], s.used.igst[h], s.used.cgst[h], s.used.sgst[h], s.used.cess[h], s.cash[h], s.rcm[h], nl.used[h]]),
        ],
      },
    ];
  };

  const exportXlsx = async () => {
    const bytes = await buildXlsx(tables());
    downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), `GSTR-3B ${biz.gstin} ${period.fp}.xlsx`);
  };

  const exportCsv = () => {
    const rows = tables().flatMap((tb, i): Cell[][] => [...(i ? [[]] : []), [tb.name], ...tb.rows]);
    downloadCsv(toCsv(rows), `GSTR-3B ${biz.gstin} ${period.fp}.csv`);
    toast.success('GSTR-3B CSV downloaded');
  };

  return (
    <div>
      <PageHeader
        title="GSTR-3B"
        subtitle={`${period.label} | cash to pay ${money(cashTotal)}`}
        actions={
          <>
            <Button icon={<FileUp className="h-4 w-4" />} onClick={() => void open2b().catch(toast.fromError)}>
              Open GSTR-2B
            </Button>
            <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => void exportXlsx().catch(toast.fromError)}>
              Excel
            </Button>
            <Button icon={<FileText className="h-4 w-4" />} onClick={exportCsv}>
              CSV
            </Button>
            <Button
              variant="primary"
              icon={<FileJson className="h-4 w-4" />}
              disabled={!biz.gstin}
              onClick={() => {
                downloadJson(gstr3bJson(r), `GSTR3B_${biz.gstin}_${period.fp}.json`);
                toast.success('GSTR-3B JSON downloaded');
              }}
            >
              JSON
            </Button>
          </>
        }
      />
      <div className="mb-3">
        <PeriodPicker value={choice} onChange={setChoice} />
      </div>
      {twoB && !twoBForPeriod && (
        <div className="mb-3">
          <Alert tone="amber">
            The GSTR-2B open ({twoB.file}) is for period {twoB.data.period.slice(0, 2)}/{twoB.data.period.slice(2)}, not {period.label}, so Table 4 is taken from your books. Choose that period, or open the GSTR-2B of {period.label}.
          </Alert>
        </div>
      )}
      {r.notes.length > 0 && (
        <div className="mb-3">
          <Alert tone="blue">
            {r.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </Alert>
        </div>
      )}
      <div className="space-y-4">
        <Card title="3.1 Outward and reverse-charge inward supplies" bodyClassName="overflow-x-auto p-0">
          <table className="data-table">
            <Head />
            <tbody>
              <TaxRow label="(a) Outward taxable supplies (other than zero rated, nil rated and exempted)" t={r.outward} money={money} />
              <TaxRow label="(b) Outward taxable supplies (zero rated)" t={{ txval: r.zeroRated.txval, iamt: r.zeroRated.iamt, csamt: r.zeroRated.csamt }} money={money} />
              <TaxRow label="(c) Other outward supplies (nil rated, exempted)" t={{ txval: r.nilExempt }} money={money} />
              <TaxRow label="(d) Inward supplies (liable to reverse charge)" t={r.inwardRcm} money={money} />
              <TaxRow label="(e) Non-GST outward supplies" t={{ txval: r.nonGst }} money={money} />
            </tbody>
          </table>
        </Card>
        <Card title="3.2 Inter-state supplies to unregistered persons, composition dealers and UIN holders" bodyClassName="overflow-x-auto p-0">
          {r.unregistered.length + r.composition.length + r.uin.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">None in this period.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Recipients</th>
                  <th>Place of supply</th>
                  <th className="num">Taxable value</th>
                  <th className="num">IGST</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Unregistered', r.unregistered],
                    ['Composition', r.composition],
                    ['UIN holders', r.uin],
                  ] as const
                ).flatMap(([who, rows]) =>
                  rows.map((x) => (
                    <tr key={who + x.pos}>
                      <td>{who}</td>
                      <td>{stateLabel(x.pos)}</td>
                      <td className="num">{money(x.txval)}</td>
                      <td className="num">{money(x.iamt)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </Card>
        <Card
          title="4 Eligible ITC"
          bodyClassName="overflow-x-auto p-0"
          actions={
            twoB && twoBForPeriod ? (
              <>
                <span className="text-xs text-slate-500">4(A)(5) from {twoB.file}</span>
                <Button size="sm" variant="ghost" onClick={() => setTwoB(null)}>
                  Close GSTR-2B
                </Button>
              </>
            ) : (
              <span className="text-xs text-slate-500">4(A)(5) from your books (no GSTR-2B open)</span>
            )
          }
        >
          <table className="data-table">
            <Head first="Details" />
            <tbody>
              <tr className="bg-slate-50">
                <td colSpan={6} className="font-medium">
                  (A) ITC available
                </td>
              </tr>
              {r.itcAvailable.map((x) => (
                <TaxRow key={x.ty} label={x.label} t={x} money={money} />
              ))}
              <tr className="bg-slate-50">
                <td colSpan={6} className="font-medium">
                  (B) ITC reversed
                </td>
              </tr>
              {r.itcReversed.map((x) => (
                <TaxRow key={x.ty} label={x.label} t={x} money={money} />
              ))}
              <tr className="font-semibold">
                <td>(C) Net ITC available (A) - (B)</td>
                <td />
                <td className="num">{money(r.itcNet.iamt)}</td>
                <td className="num">{money(r.itcNet.camt)}</td>
                <td className="num">{money(r.itcNet.samt)}</td>
                <td className="num">{money(r.itcNet.csamt)}</td>
              </tr>
              <tr className="bg-slate-50">
                <td colSpan={6} className="font-medium">
                  (D) Other details
                </td>
              </tr>
              {r.itcIneligible.map((x) => (
                <TaxRow key={x.ty} label={x.label} t={x} money={money} />
              ))}
            </tbody>
          </table>
        </Card>
        {checkRows.length > 0 && (
          <Card title="GSTR-2B check for Table 4" bodyClassName="overflow-x-auto p-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Supplier</th>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th className="num">Tax</th>
                  <th>In this return</th>
                </tr>
              </thead>
              <tbody>
                {checkRows.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <Badge tone={x.tone}>{x.status}</Badge>
                    </td>
                    <td>
                      {x.party || '-'}
                      <div className="font-mono text-xs text-slate-500">{x.gstin}</div>
                    </td>
                    <td>
                      {x.href ? (
                        <Link className="text-brand-700 hover:underline" to={x.href}>
                          {x.number}
                        </Link>
                      ) : (
                        x.number
                      )}
                    </td>
                    <td>{fdate(x.date)}</td>
                    <td className="num">{money(x.tax)}</td>
                    <td className="text-xs text-slate-600">{x.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <Card title="5 Exempt, nil-rated and non-GST inward supplies" bodyClassName="overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nature of supplies</th>
                <th className="num">Inter-state</th>
                <th className="num">Intra-state</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>From a composition supplier, exempt and nil rated</td>
                <td className="num">{money(r.inwardExempt.inter)}</td>
                <td className="num">{money(r.inwardExempt.intra)}</td>
              </tr>
              <tr>
                <td>Non-GST supplies</td>
                <td className="num">{money(r.inwardNonGst.inter)}</td>
                <td className="num">{money(r.inwardNonGst.intra)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="6.1 Payment of tax: ITC set-off (s.49, 49A, 49B, rule 88A)" bodyClassName="overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Head</th>
                <th className="num">Tax payable</th>
                <th className="num">By IGST credit</th>
                <th className="num">By CGST credit</th>
                <th className="num">By SGST credit</th>
                <th className="num">By cess credit</th>
                <th className="num">Cash (forward)</th>
                <th className="num">Cash (reverse charge)</th>
              </tr>
            </thead>
            <tbody>
              {HEADS.map((h) => (
                <tr key={h}>
                  <td className="font-medium">{HEAD_LABEL[h]}</td>
                  <td className="num">{money(s.liability[h] + s.rcm[h])}</td>
                  <td className="num">{money(s.used.igst[h])}</td>
                  <td className="num">{money(s.used.cgst[h])}</td>
                  <td className="num">{money(s.used.sgst[h])}</td>
                  <td className="num">{money(s.used.cess[h])}</td>
                  <td className="num">{money(s.cash[h])}</td>
                  <td className="num">{money(s.rcm[h])}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={6}>Total cash payable</td>
                <td className="num" colSpan={2}>
                  {money(cashTotal)}
                </td>
              </tr>
            </tbody>
          </table>
          {HEADS.some((h) => nl.opening[h] || nl.added[h]) && (
            <p className="px-4 pt-2 text-xs text-slate-500">
              Negative liability statement: set off from earlier returns {headList(nl.used)}; carried to the next return {headList(nl.closing)}.
            </p>
          )}
          <p className="px-4 py-2 text-xs text-slate-500">
            Credit carried forward: IGST {money(s.carryForward.igst)}, CGST {money(s.carryForward.cgst)}, SGST/UTGST {money(s.carryForward.sgst)}, cess {money(s.carryForward.cess)}. Interest and late fee are not included.
          </p>
        </Card>
      </div>
    </div>
  );
}
