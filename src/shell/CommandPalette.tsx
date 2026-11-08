import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { DOC_TYPES, DOC_TYPE_LIST } from '../core/docs/docTypes';
import { useBusiness, useMine } from '../store/hooks';
import { fdate, useMoney } from '../ui/money';
import { cx } from '../ui/kit';
import { SETTINGS_SECTIONS, visibleNav } from './nav';

interface Entry {
  id: string;
  group: string;
  label: string;
  hint: string;
  to: string;
  text: string;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const biz = useBusiness();
  const invoices = useMine('invoices');
  const parties = useMine('clients');
  const products = useMine('products');
  const vouchers = useMine('vouchers');
  const purchases = useMine('purchases');
  const money = useMoney();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const g of visibleNav(biz)) {
      for (const n of g.items) out.push({ id: `nav${n.to}`, group: 'Go to', label: n.label, hint: g.label, to: n.to, text: `${n.label} ${n.keywords ?? ''}` });
    }
    for (const s of SETTINGS_SECTIONS) out.push({ id: `set${s.to}`, group: 'Settings', label: s.label, hint: 'Settings', to: s.to, text: `${s.label} ${s.keywords}` });
    for (const t of DOC_TYPE_LIST) {
      out.push({ id: `new${t}`, group: 'Create', label: `New ${DOC_TYPES[t].label}`, hint: 'Sales', to: `/sales/new?type=${t}`, text: `new create ${DOC_TYPES[t].label}` });
    }
    out.push({ id: 'newpur', group: 'Create', label: 'New purchase bill', hint: 'Purchases', to: '/purchases/new', text: 'new purchase bill supplier' });
    out.push({ id: 'newparty', group: 'Create', label: 'New party', hint: 'Customers & suppliers', to: '/parties/new', text: 'new customer supplier party client' });
    out.push({ id: 'newprod', group: 'Create', label: 'New product', hint: 'Inventory', to: '/inventory/products/new', text: 'new product item service' });
    for (const [type, key] of [
      ['CONTRA', 'F4'],
      ['PAYMENT', 'F5'],
      ['RECEIPT', 'F6'],
      ['JOURNAL', 'F7'],
    ] as const) {
      out.push({ id: `v${type}`, group: 'Create', label: `${type.charAt(0)}${type.slice(1).toLowerCase()} voucher (${key})`, hint: 'Accounts', to: `/accounts/vouchers/new?type=${type}`, text: `voucher ${type} ${key}` });
    }
    const docs = [...invoices].sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const d of docs) {
      out.push({
        id: d.id,
        group: 'Documents',
        label: `${d.number || 'Draft'} - ${d.party.name || 'No customer'}`,
        hint: `${DOC_TYPES[d.docType].shortLabel} | ${fdate(d.date)} | ${money(d.totals.total, d.currency)}${d.status === 'CANCELLED' ? ' | Cancelled' : ''}`,
        to: `/sales/${d.id}`,
        text: `${d.number} ${d.party.name} ${d.party.gstin} ${DOC_TYPES[d.docType].label}`,
      });
    }
    for (const p of parties) {
      out.push({ id: p.id, group: 'Parties', label: p.name, hint: [p.gstin, p.phone, p.billing.city].filter(Boolean).join(' | '), to: `/parties/${p.id}`, text: `${p.name} ${p.gstin} ${p.phone} ${p.email}` });
    }
    for (const p of products) {
      out.push({ id: p.id, group: 'Products', label: p.name, hint: [p.sku, p.hsn && `HSN ${p.hsn}`, money(p.sellingPrice)].filter(Boolean).join(' | '), to: `/inventory/products/${p.id}`, text: `${p.name} ${p.sku} ${p.hsn} ${p.barcode}` });
    }
    for (const b of purchases) {
      out.push({ id: b.id, group: 'Purchases', label: `${b.billNo} - ${b.supplier.name}`, hint: `${fdate(b.billDate)} | ${money(b.totals.total, b.currency)}`, to: `/purchases/${b.id}`, text: `${b.billNo} ${b.supplier.name} ${b.supplier.gstin}` });
    }
    for (const v of vouchers) {
      out.push({ id: v.id, group: 'Vouchers', label: `${v.number} - ${v.type.toLowerCase()}`, hint: `${fdate(v.date)} | ${v.narration}`, to: `/accounts/vouchers/${v.id}`, text: `${v.number} ${v.narration} ${v.type}` });
    }
    return out;
  }, [biz, invoices, parties, products, vouchers, purchases, money]);

  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      return [...entries.filter((e) => e.group === 'Go to' || e.group === 'Create').slice(0, 24), ...entries.filter((e) => e.group === 'Documents').slice(0, 8)];
    }
    return entries.filter((e) => words.every((w) => `${e.label} ${e.hint} ${e.text}`.toLowerCase().includes(w))).slice(0, 40);
  }, [entries, q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  if (!open) return null;
  const go = (e: Entry | undefined) => {
    if (!e) return;
    onClose();
    navigate(e.to);
  };
  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="card w-full max-w-xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus
            aria-label="Search"
            className="w-full py-3 text-sm outline-none"
            placeholder="Type an invoice number, party, product or screen..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(results[active]);
              } else if (e.key === 'Escape') onClose();
            }}
          />
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No matches.</li>}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : '';
            lastGroup = r.group;
            return (
              <li key={r.id + r.group}>
                {header && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{header}</p>}
                <button
                  type="button"
                  aria-current={i === active ? 'true' : undefined}
                  className={cx('flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm', i === active ? 'bg-brand-50' : 'hover:bg-slate-50')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{r.label}</span>
                    {r.hint && <span className="block truncate text-xs text-slate-600">{r.hint}</span>}
                  </span>
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-slate-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
