import { Package, Pencil, Plus, Save, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useBlocker } from 'react-router';
import { formatQty } from '../../core/currency/format';
import { recordsToCsv } from '../../core/export/csv';
import { newGodown, newProduct } from '../../core/factories';
import { checkHsn } from '../../core/gst/hsn';
import { rateOptions } from '../../core/gst/rates';
import { stockByLocation, stockMovements } from '../../core/inventory/stock';
import type { Godown, Product } from '../../core/model';
import { roundTo } from '../../core/money';
import { deleteGodown, moveToTrash, saveGodown, saveProduct, saveProducts } from '../../store/actions';
import { useBusiness, useMine, useStock, useToday } from '../../store/hooks';
import { useStore } from '../../store/store';
import { attempt, confirmDialog, promptDialog, toast } from '../../ui/feedback';
import { downloadCsv } from '../../ui/files';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, NumberInput, PageHeader, Select, Tabs, TextInput, Textarea } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { UnitSelect } from '../settings/UnitSelect';

export function ProductList() {
  const products = useMine('products');
  const stock = useStock();
  const money = useMoney();
  const today = useToday();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'ALL' | 'GOODS' | 'SERVICE' | 'LOW'>('ALL');

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return products
      .filter((p) => {
        if (kind === 'LOW') return p.kind === 'GOODS' && p.trackStock && p.lowStockLevel > 0 && (stock.get(p.id) ?? 0) <= p.lowStockLevel;
        return kind === 'ALL' || p.kind === kind;
      })
      .filter((p) => words.every((w) => `${p.name} ${p.sku} ${p.barcode} ${p.hsn} ${p.category}`.toLowerCase().includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, kind, q, stock]);

  const exportCsv = () =>
    downloadCsv(
      recordsToCsv(rows, [
        { header: 'Name', value: (p) => p.name },
        { header: 'Type', value: (p) => p.kind },
        { header: 'SKU', value: (p) => p.sku },
        { header: 'Barcode', value: (p) => p.barcode },
        { header: 'HSN/SAC', value: (p) => p.hsn },
        { header: 'Unit', value: (p) => p.unit },
        { header: 'GST %', value: (p) => p.gstRate },
        { header: 'Selling price', value: (p) => p.sellingPrice },
        { header: 'Purchase price', value: (p) => p.purchasePrice },
        { header: 'MRP', value: (p) => p.mrp },
        { header: 'Stock', value: (p) => (p.trackStock && p.kind === 'GOODS' ? (stock.get(p.id) ?? 0) : '') },
        { header: 'Low stock level', value: (p) => p.lowStockLevel },
        { header: 'Category', value: (p) => p.category },
      ]),
      `products-${today}.csv`,
    );

  const lowCount = products.filter((p) => p.kind === 'GOODS' && p.trackStock && p.lowStockLevel > 0 && (stock.get(p.id) ?? 0) <= p.lowStockLevel).length;
  return (
    <div>
      <PageHeader
        title="Products & services"
        subtitle={`${products.length} items`}
        actions={
          <>
            <Button onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </Button>
            <Button onClick={() => navigate('/inventory/bulk')}>Bulk edit</Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/inventory/products/new')}>
              New product
            </Button>
          </>
        }
      />
      <Tabs
        value={kind}
        onValue={setKind}
        tabs={[
          { value: 'ALL', label: 'All', count: products.length },
          { value: 'GOODS', label: 'Goods', count: products.filter((p) => p.kind === 'GOODS').length },
          { value: 'SERVICE', label: 'Services', count: products.filter((p) => p.kind === 'SERVICE').length },
          { value: 'LOW', label: 'Low stock', count: lowCount },
        ]}
      />
      <div className="my-3">
        <Input className="max-w-xs" placeholder="Search name, SKU, barcode, HSN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<Package className="h-10 w-10" />} title="No products" action={<Button variant="primary" onClick={() => navigate('/inventory/products/new')}>Add a product</Button>} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>HSN/SAC</th>
                <th className="num">GST</th>
                <th className="num">Selling</th>
                <th className="num">Purchase</th>
                <th className="num">Stock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const qty = stock.get(p.id) ?? 0;
                const tracked = p.kind === 'GOODS' && p.trackStock;
                const low = tracked && p.lowStockLevel > 0 && qty <= p.lowStockLevel;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link className="font-medium text-brand-700 hover:underline" to={`/inventory/products/${p.id}`}>
                        {p.name}
                      </Link>
                      <div className="text-xs text-slate-500">{[p.sku, p.category].filter(Boolean).join(' | ')}</div>
                    </td>
                    <td className="font-mono text-xs">{p.hsn || '-'}</td>
                    <td className="num">{p.gstRate}%</td>
                    <td className="num">{money(p.sellingPrice)}</td>
                    <td className="num">{money(p.purchasePrice)}</td>
                    <td className="num">
                      {tracked ? (
                        <span className={low ? 'font-semibold text-red-700' : ''}>
                          {formatQty(qty)} {p.unit}
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                      {low && (
                        <div>
                          <Badge tone="red">Low</Badge>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function ProductEditor() {
  const { id } = useParams();
  const biz = useBusiness();
  const godowns = useMine('godowns');
  const data = useStore((s) => s.data);
  const existing = data.products.find((p) => p.id === id);
  const navigate = useNavigate();
  const money = useMoney();
  const today = useToday();
  const [p, setP] = useState<Product>(() => existing ?? newProduct(biz.id, { gstRate: biz.countryCode === 'IN' ? 18 : 0, godownId: godowns.find((g) => g.isDefault)?.id ?? '' }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Product>) => {
    setP((x) => ({ ...x, ...patch }));
    setDirty(true);
  };

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !busy && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('You have unsaved changes. Leave without saving?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const hsn = p.hsn ? checkHsn(p.hsn, biz.turnoverAbove5Cr) : null;
  const indian = biz.countryCode === 'IN';
  const moves = useMemo(
    () => (existing ? stockMovements({ products: data.products, invoices: data.invoices, purchases: data.purchases }, biz.id).filter((m) => m.productId === existing.id) : []),
    [existing, data.products, data.invoices, data.purchases, biz.id],
  );

  const submit = async () => {
    setBusy(true);
    try {
      const saved = await saveProduct(p);
      setDirty(false);
      toast.success('Product saved');
      navigate(`/inventory/products/${saved.id}`, { replace: true });
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (await confirmDialog({ title: `Delete ${existing.name}?`, message: 'Old invoices keep their item details. The product moves to the Trash bin for 30 days.', danger: true, confirmLabel: 'Delete' })) {
      if (await attempt(() => moveToTrash('products', existing), 'Moved to Trash')) navigate('/inventory/products');
    }
  };

  let running = 0;
  return (
    <div className="max-w-5xl">
      <PageHeader
        back="/inventory/products"
        title={existing ? existing.name : 'New product'}
        actions={
          <>
            {existing && (
              <Button variant="ghost" aria-label="Delete" onClick={() => void remove()}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
            <Button variant="primary" icon={<Save className="h-4 w-4" />} busy={busy} onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <Card title="Basic details" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Type">
            <Select
              value={p.kind}
              onValue={(v) => set({ kind: v, trackStock: v === 'GOODS' ? p.trackStock : false, unit: v === 'SERVICE' && p.unit === 'NOS' ? 'HRS' : p.unit })}
              options={[
                { value: 'GOODS', label: 'Goods' },
                { value: 'SERVICE', label: 'Service' },
              ]}
            />
          </Field>
          <Field label="Name" className="sm:col-span-2 lg:col-span-3">
            <TextInput value={p.name} onValue={(v) => set({ name: v })} autoFocus />
          </Field>
          {indian && (
            <Field label={p.kind === 'SERVICE' ? 'SAC' : 'HSN code'} error={hsn?.errors[0]} hint={hsn?.warnings[0]}>
              <TextInput value={p.hsn} maxLength={8} onValue={(v) => set({ hsn: v.replace(/\D/g, '') })} />
            </Field>
          )}
          <Field label="Unit">
            <UnitSelect value={p.unit} onValue={(v) => set({ unit: v })} format={(u) => `${u.code} - ${u.name}`} />
          </Field>
          <Field label="SKU / item code">
            <TextInput value={p.sku} onValue={(v) => set({ sku: v })} />
          </Field>
          <Field label="Barcode">
            <TextInput value={p.barcode} onValue={(v) => set({ barcode: v })} />
          </Field>
          <Field label="Category">
            <TextInput value={p.category} onValue={(v) => set({ category: v })} list="product-categories" />
            <datalist id="product-categories">
              {[...new Set(data.products.filter((x) => x.businessId === biz.id).map((x) => x.category).filter(Boolean))].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Description (printed on invoices)" className="sm:col-span-2 lg:col-span-3">
            <Textarea rows={2} value={p.description} onValue={(v) => set({ description: v })} />
          </Field>
        </Card>
        <Card title="Prices and tax" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Selling price">
            <NumberInput value={p.sellingPrice} onValue={(n) => set({ sellingPrice: n })} />
          </Field>
          <Field label="Purchase price">
            <NumberInput value={p.purchasePrice} onValue={(n) => set({ purchasePrice: n })} />
          </Field>
          <Field label="MRP">
            <NumberInput value={p.mrp} emptyZero onValue={(n) => set({ mrp: n })} />
          </Field>
          <Field label={indian ? 'GST rate' : 'Tax rate %'}>
            {indian ? (
              <Select
                value={String(p.gstRate)}
                onValue={(v) => set({ gstRate: Number(v) })}
                options={[...new Set([...rateOptions(today), p.gstRate])].sort((a, b) => a - b).map((r) => ({ value: String(r), label: `${r}%` }))}
              />
            ) : (
              <NumberInput value={p.gstRate} onValue={(n) => set({ gstRate: n })} />
            )}
          </Field>
          {indian && (
            <Field label="Cess %">
              <NumberInput value={p.cessRate} emptyZero onValue={(n) => set({ cessRate: n })} />
            </Field>
          )}
          <Checkbox className="self-end" checked={p.priceIncludesTax} onValue={(v) => set({ priceIncludesTax: v })} label="Selling price includes tax" />
          {p.sellingPrice > 0 && (
            <p className="self-end text-xs text-slate-500 sm:col-span-2">
              {p.priceIncludesTax
                ? `Before tax: ${money(roundTo(p.sellingPrice / (1 + (p.gstRate + p.cessRate) / 100)))}`
                : `With tax: ${money(roundTo(p.sellingPrice * (1 + (p.gstRate + p.cessRate) / 100)))}`}
              {p.purchasePrice > 0 && ` | margin ${roundTo(((p.sellingPrice / (p.priceIncludesTax ? 1 + p.gstRate / 100 : 1) - p.purchasePrice) / p.purchasePrice) * 100, 1)}%`}
            </p>
          )}
        </Card>
        {p.kind === 'GOODS' && biz.features.inventory && (
          <Card title="Stock" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Checkbox className="sm:col-span-2 lg:col-span-4" checked={p.trackStock} onValue={(v) => set({ trackStock: v })} label="Track stock for this item" />
            {p.trackStock && (
              <>
                <Field label="Opening stock">
                  <NumberInput value={p.openingStock} emptyZero onValue={(n) => set({ openingStock: n })} />
                </Field>
                <Field label="Opening stock rate (cost)">
                  <NumberInput value={p.openingStockRate} emptyZero onValue={(n) => set({ openingStockRate: n })} />
                </Field>
                <Field label="Low-stock alert at">
                  <NumberInput value={p.lowStockLevel} emptyZero onValue={(n) => set({ lowStockLevel: Math.max(0, n) })} />
                </Field>
                {biz.features.godowns && (
                  <Field label="Default godown">
                    <Select value={p.godownId} placeholder="None" onValue={(v) => set({ godownId: v })} options={godowns.map((g) => ({ value: g.id, label: g.name }))} />
                  </Field>
                )}
                {biz.features.batches && (
                  <>
                    <Field label="Batch no. (opening stock)">
                      <TextInput value={p.batchNo} onValue={(v) => set({ batchNo: v })} />
                    </Field>
                    <Field label="Expiry date">
                      <Input type="date" value={p.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} />
                    </Field>
                  </>
                )}
              </>
            )}
          </Card>
        )}
        {existing && moves.length > 0 && (
          <Card title="Stock movements" bodyClassName="overflow-x-auto p-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Document</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m, i) => {
                  running = roundTo(running + m.qty, 4);
                  return (
                    <tr key={i}>
                      <td>{m.source === 'OPENING' ? 'Opening' : fdate(m.date)}</td>
                      <td>{m.source.replace('_', ' ').toLowerCase()}</td>
                      <td>
                        {m.docId ? (
                          <Link className="text-brand-700 hover:underline" to={m.source === 'PURCHASE' ? `/purchases/${m.docId}` : `/sales/${m.docId}`}>
                            {m.docNumber}
                          </Link>
                        ) : (
                          m.docNumber
                        )}
                      </td>
                      <td className="num">{m.qty > 0 ? formatQty(m.qty) : ''}</td>
                      <td className="num">{m.qty < 0 ? formatQty(-m.qty) : ''}</td>
                      <td className="num font-medium">{formatQty(running)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

type BulkRow = Pick<Product, 'id' | 'name' | 'hsn' | 'unit' | 'gstRate' | 'sellingPrice' | 'purchasePrice' | 'mrp' | 'lowStockLevel' | 'category'>;

export function BulkEdit() {
  const products = useMine('products');
  const today = useToday();
  const navigate = useNavigate();
  const [edits, setEdits] = useState<Record<string, Partial<BulkRow>>>({});
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const value = <K extends keyof BulkRow>(p: Product, k: K): BulkRow[K] => (edits[p.id]?.[k] ?? p[k]) as BulkRow[K];
  const set = (id: string, patch: Partial<BulkRow>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const changed = Object.keys(edits).length;

  const applyPct = () => {
    if (!pct) return;
    setEdits((e) => {
      const next = { ...e };
      for (const p of rows) next[p.id] = { ...next[p.id], sellingPrice: roundTo(((next[p.id]?.sellingPrice ?? p.sellingPrice) * (100 + pct)) / 100) };
      return next;
    });
  };

  const saveAll = async () => {
    setBusy(true);
    try {
      const list = rows.filter((p) => edits[p.id]).map((p) => ({ ...p, ...edits[p.id] }));
      await saveProducts(list);
      setEdits({});
      toast.success(`${list.length} product(s) updated`);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const rates = rateOptions(today);
  return (
    <div>
      <PageHeader
        back="/inventory/products"
        title="Bulk edit products"
        subtitle={changed ? `${changed} product(s) changed, not saved yet` : 'Edit many products at once, then save'}
        actions={
          <>
            <div className="flex items-center gap-1">
              <NumberInput className="w-20" value={pct} onValue={setPct} aria-label="Percent change" />
              <Button onClick={applyPct}>% to all selling prices</Button>
            </div>
            <Button disabled={!changed} onClick={() => setEdits({})}>
              Discard
            </Button>
            <Button variant="primary" busy={busy} disabled={!changed} onClick={() => void saveAll()}>
              Save {changed || ''}
            </Button>
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No products yet" action={<Button onClick={() => navigate('/inventory/products/new')}>Add a product</Button>} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="min-w-[14rem]">Name</th>
                <th>HSN</th>
                <th>Unit</th>
                <th>GST %</th>
                <th>Selling</th>
                <th>Purchase</th>
                <th>MRP</th>
                <th>Low at</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={edits[p.id] ? 'bg-amber-50' : ''}>
                  <td>
                    <Input className="py-1" value={value(p, 'name')} onChange={(e) => set(p.id, { name: e.target.value })} aria-label="Name" />
                  </td>
                  <td>
                    <Input className="w-24 py-1" value={value(p, 'hsn')} onChange={(e) => set(p.id, { hsn: e.target.value.replace(/\D/g, '').slice(0, 8) })} aria-label="HSN" />
                  </td>
                  <td>
                    <UnitSelect className="w-24 py-1" ariaLabel="Unit" value={value(p, 'unit')} onValue={(v) => set(p.id, { unit: v })} />
                  </td>
                  <td>
                    <Select
                      className="w-20 py-1"
                      value={String(value(p, 'gstRate'))}
                      onValue={(v) => set(p.id, { gstRate: Number(v) })}
                      options={[...new Set([...rates, value(p, 'gstRate')])].sort((a, b) => a - b).map((r) => ({ value: String(r), label: `${r}` }))}
                      aria-label="GST rate"
                    />
                  </td>
                  <td>
                    <NumberInput className="w-24 py-1" value={value(p, 'sellingPrice')} onValue={(n) => set(p.id, { sellingPrice: n })} aria-label="Selling price" />
                  </td>
                  <td>
                    <NumberInput className="w-24 py-1" value={value(p, 'purchasePrice')} onValue={(n) => set(p.id, { purchasePrice: n })} aria-label="Purchase price" />
                  </td>
                  <td>
                    <NumberInput className="w-24 py-1" value={value(p, 'mrp')} emptyZero onValue={(n) => set(p.id, { mrp: n })} aria-label="MRP" />
                  </td>
                  <td>
                    <NumberInput className="w-20 py-1" value={value(p, 'lowStockLevel')} emptyZero onValue={(n) => set(p.id, { lowStockLevel: n })} aria-label="Low stock level" />
                  </td>
                  <td>
                    <Input className="w-32 py-1" value={value(p, 'category')} onChange={(e) => set(p.id, { category: e.target.value })} aria-label="Category" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Godowns() {
  const biz = useBusiness();
  const godowns = useMine('godowns');
  const products = useMine('products');
  const data = useStore((s) => s.data);
  const byLoc = useMemo(() => stockByLocation(stockMovements({ products: data.products, invoices: data.invoices, purchases: data.purchases }, biz.id)), [data.products, data.invoices, data.purchases, biz.id]);

  const qtyIn = (g: Godown) => {
    let items = 0;
    for (const [key, qty] of byLoc) if (key.split('|')[1] === g.id && qty > 0) items += 1;
    return items;
  };

  const add = async () => {
    const name = await promptDialog({ title: 'New godown', label: 'Name', required: true, confirmLabel: 'Add' });
    if (name) await attempt(() => saveGodown(newGodown(biz.id, name, godowns.length === 0)), 'Godown added');
  };
  const rename = async (g: Godown) => {
    const name = await promptDialog({ title: 'Rename godown', label: 'Name', initial: g.name, required: true, confirmLabel: 'Save' });
    if (name) await attempt(() => saveGodown({ ...g, name }), 'Saved');
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Godowns / warehouses"
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => void add()}>
            Add godown
          </Button>
        }
      />
      {!biz.features.godowns && <Alert tone="blue">Godown tracking is off. Turn it on in Settings &gt; Features to pick a godown on each invoice line.</Alert>}
      <div className="card mt-3">
        {godowns.length === 0 ? (
          <EmptyState title="No godowns yet" text="Add your shop, warehouse or factory store." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {godowns.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1">
                  <p className="font-medium">
                    {g.name} {g.isDefault && <Badge tone="brand">Default</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {qtyIn(g)} item(s) in stock | {products.filter((p) => p.godownId === g.id).length} product(s) assigned
                  </p>
                </div>
                {!g.isDefault && (
                  <Button size="sm" icon={<Star className="h-3.5 w-3.5" />} onClick={() => void attempt(() => saveGodown({ ...g, isDefault: true }), 'Default godown changed')}>
                    Make default
                  </Button>
                )}
                <Button size="sm" variant="ghost" aria-label="Rename" onClick={() => void rename(g)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Delete"
                  onClick={async () => {
                    if (await confirmDialog({ title: `Delete ${g.name}?`, danger: true, confirmLabel: 'Delete' })) await attempt(() => deleteGodown(g), 'Deleted');
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
