import { FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { endOfMonth, fyOf, listMonths, monthLabel } from '../../core/dates';
import { formatQty } from '../../core/currency/format';
import { recordsToCsv } from '../../core/export/csv';
import { XLSX_MIME, buildXlsx } from '../../core/export/xlsx';
import { stockByLocation, stockMovements } from '../../core/inventory/stock';
import { closingStockValue, valueStock } from '../../core/inventory/valuation';
import type { ValuationMethod } from '../../core/inventory/valuation';
import { ReportDocument } from '../../print/SimpleDocuments';
import { nodeToPdf, pageSpec, printNode } from '../../print/printing';
import { useBusiness, useMine, useToday } from '../../store/hooks';
import { useStore } from '../../store/store';
import { toast } from '../../ui/feedback';
import { downloadBlob, downloadCsv } from '../../ui/files';
import { Button, Card, Field, Input, PageHeader, Select, Tabs } from '../../ui/kit';
import { useMoney } from '../../ui/money';

const METHODS: { value: ValuationMethod; label: string }[] = [
  { value: 'WEIGHTED_AVERAGE', label: 'Weighted average cost' },
  { value: 'LAST_PURCHASE', label: 'Last purchase price' },
  { value: 'STANDARD_COST', label: 'Standard cost (purchase price in master)' },
];

export function StockReport() {
  const biz = useBusiness();
  const today = useToday();
  const money = useMoney();
  const godowns = useMine('godowns');
  const data = useStore((s) => s.data);
  const [asOf, setAsOf] = useState(today);
  const [method, setMethod] = useState<ValuationMethod>('WEIGHTED_AVERAGE');
  const [tab, setTab] = useState<'SUMMARY' | 'LOCATION' | 'MONTHLY'>('SUMMARY');
  const [busy, setBusy] = useState(false);
  const stockData = useMemo(() => ({ products: data.products, invoices: data.invoices, purchases: data.purchases }), [data.products, data.invoices, data.purchases]);
  const valuation = useMemo(() => valueStock(stockData, biz.id, asOf, method), [stockData, biz.id, asOf, method]);
  const locations = useMemo(() => {
    const map = stockByLocation(stockMovements(stockData, biz.id, asOf));
    const names = new Map(data.products.map((p) => [p.id, p]));
    return [...map]
      .filter(([, qty]) => qty !== 0)
      .map(([key, qty]) => {
        const [productId, godownId, batchNo] = key.split('|');
        const p = names.get(productId);
        return { name: p?.name ?? productId, unit: p?.unit ?? '', godown: godowns.find((g) => g.id === godownId)?.name ?? (godownId ? 'Deleted godown' : 'Unassigned'), batchNo, qty };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.godown.localeCompare(b.godown));
  }, [stockData, biz.id, asOf, data.products, godowns]);
  const monthly = useMemo(() => {
    const fy = fyOf(asOf, biz.fyStartMonth);
    return listMonths(fy.start, asOf).map((m) => {
      const end = endOfMonth(`${m}-01`);
      const on = end < asOf ? end : asOf;
      return { month: m, date: on, value: closingStockValue(stockData, biz.id, on, method) };
    });
  }, [asOf, biz.fyStartMonth, biz.id, stockData, method]);

  const lines = valuation.lines.filter((l) => l.qty !== 0 || l.value !== 0);
  const methodLabel = METHODS.find((m) => m.value === method)?.label ?? method;
  const report = (
    <ReportDocument
      business={biz}
      title="Closing Stock Valuation"
      subtitle={`As on ${asOf} | ${methodLabel}`}
      columns={[
        { header: 'Item' },
        { header: 'HSN', width: '20mm' },
        { header: 'Qty', align: 'right', width: '22mm' },
        { header: 'Unit', width: '14mm' },
        { header: 'Rate', align: 'right', width: '24mm' },
        { header: 'Value', align: 'right', width: '28mm' },
      ]}
      rows={lines.map((l) => [l.name, l.hsn, formatQty(l.qty), l.unit, l.rate, l.value])}
      footer={[['Total', '', '', '', '', valuation.total]]}
    />
  );

  const exportXlsx = async () => {
    const bytes = await buildXlsx([
      { name: 'Closing stock', rows: [['Item', 'HSN', 'Qty', 'Unit', 'Rate', 'Value'], ...lines.map((l) => [l.name, l.hsn, l.qty, l.unit, l.rate, l.value]), ['Total', '', '', '', '', valuation.total]] },
      { name: 'By godown & batch', rows: [['Item', 'Godown', 'Batch', 'Qty', 'Unit'], ...locations.map((l) => [l.name, l.godown, l.batchNo, l.qty, l.unit])] },
      { name: 'Monthly valuation', rows: [['Month', 'As on', 'Closing value'], ...monthly.map((m) => [monthLabel(m.month), m.date, m.value])] },
    ]);
    downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), `Stock valuation ${asOf}.xlsx`);
  };

  return (
    <div>
      <PageHeader
        title="Stock & valuation"
        subtitle={`Closing stock ${money(valuation.total)} on ${asOf}`}
        actions={
          <>
            <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => void exportXlsx().catch(toast.fromError)}>
              Excel
            </Button>
            <Button
              onClick={() =>
                downloadCsv(
                  recordsToCsv(lines, [
                    { header: 'Item', value: (l) => l.name },
                    { header: 'HSN', value: (l) => l.hsn },
                    { header: 'Qty', value: (l) => l.qty },
                    { header: 'Unit', value: (l) => l.unit },
                    { header: 'Rate', value: (l) => l.rate },
                    { header: 'Value', value: (l) => l.value },
                  ]),
                  `stock-${asOf}.csv`,
                )
              }
            >
              CSV
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} onClick={() => void printNode(report, pageSpec(biz.print, 'A4'))}>
              Print
            </Button>
            <Button
              icon={<FileDown className="h-4 w-4" />}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  downloadBlob(await nodeToPdf(report, pageSpec(biz.print, 'A4')), `Stock valuation ${asOf}.pdf`);
                } catch (e) {
                  toast.fromError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              PDF
            </Button>
          </>
        }
      />
      <Card bodyClassName="flex flex-wrap gap-3 p-3">
        <Field label="As on">
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today)} />
        </Field>
        <Field label="Valuation method">
          <Select value={method} onValue={setMethod} options={METHODS} />
        </Field>
      </Card>
      <Tabs
        className="mt-4"
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'SUMMARY', label: 'Item-wise' },
          { value: 'LOCATION', label: 'Godown & batch' },
          { value: 'MONTHLY', label: 'Monthly closing value' },
        ]}
      />
      <div className="card mt-3 overflow-x-auto">
        {tab === 'SUMMARY' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>HSN</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.productId}>
                  <td className="font-medium">{l.name}</td>
                  <td className="font-mono text-xs">{l.hsn}</td>
                  <td className={`num ${l.qty < 0 ? 'text-red-700' : ''}`}>
                    {formatQty(l.qty)} {l.unit}
                  </td>
                  <td className="num">{money(l.rate)}</td>
                  <td className="num font-medium">{money(l.value)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={4}>Total</td>
                <td className="num">{money(valuation.total)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {tab === 'LOCATION' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Godown</th>
                <th>Batch</th>
                <th className="num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l, i) => (
                <tr key={i}>
                  <td className="font-medium">{l.name}</td>
                  <td>{l.godown}</td>
                  <td>{l.batchNo || '-'}</td>
                  <td className={`num ${l.qty < 0 ? 'text-red-700' : ''}`}>
                    {formatQty(l.qty)} {l.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'MONTHLY' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>As on</th>
                <th className="num">Closing stock value</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td className="font-medium">{monthLabel(m.month)}</td>
                  <td>{m.date}</td>
                  <td className="num">{money(m.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'SUMMARY' && lines.some((l) => l.qty < 0) && (
          <p className="px-4 py-2 text-xs text-red-700">Negative stock means items were sold before their purchase was entered. Negative quantities are valued at zero.</p>
        )}
      </div>
    </div>
  );
}
