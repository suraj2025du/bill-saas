import { Building2, ChevronDown, CircleHelp, Loader2, Lock, Menu, Plus, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { switchBusiness } from '../store/actions';
import { useBusiness, useSettings } from '../store/hooks';
import { setUnlocked, useStore } from '../store/store';
import { attempt } from '../ui/feedback';
import { Kbd, cx } from '../ui/kit';
import { useIdleLock } from './appState';
import { CommandPalette } from './CommandPalette';
import { HelpDrawer } from './HelpDrawer';
import { visibleNav } from './nav';
import { NotificationBell } from './NotificationBell';

function BusinessSwitcher() {
  const biz = useBusiness();
  const businesses = useStore((s) => s.data.businesses);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative px-3 pb-2 pt-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-2 text-left hover:bg-slate-700"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {biz.logoDataUrl ? <img src={biz.logoDataUrl} alt="" className="h-7 w-7 rounded bg-white object-contain" /> : <Building2 className="h-6 w-6 text-brand-300" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">{biz.name}</span>
          <span className="block truncate text-[11px] text-slate-400">{biz.gstin || biz.countryCode}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-3 right-3 z-40 mt-1 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg" role="listbox">
          {businesses.map((b) => (
            <button
              key={b.id}
              type="button"
              role="option"
              aria-selected={b.id === biz.id}
              className={cx('block w-full px-3 py-1.5 text-left hover:bg-slate-50', b.id === biz.id && 'font-semibold text-brand-700')}
              onClick={() => {
                setOpen(false);
                if (b.id !== biz.id) void attempt(() => switchBusiness(b.id), `Switched to ${b.name}`).then(() => navigate('/'));
              }}
            >
              <span className="block truncate">{b.name}</span>
              <span className="block truncate text-xs text-slate-500">{b.gstin || b.countryCode}</span>
            </button>
          ))}
          <button
            type="button"
            className="flex w-full items-center gap-1.5 border-t border-slate-100 px-3 py-1.5 text-left text-brand-700 hover:bg-slate-50"
            onClick={() => {
              setOpen(false);
              navigate('/settings/businesses');
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add or manage businesses
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const biz = useBusiness();
  const settings = useSettings();
  const saving = useStore((s) => s.saving);
  const adapter = useStore((s) => s.adapter);
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  useIdleLock(settings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault();
        setPalette(true);
      } else if (e.altKey && key === 'n') {
        e.preventDefault();
        navigate('/sales/new?type=TAX_INVOICE');
      } else if (e.key === 'F1') {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  useEffect(() => setNavOpen(false), [location.pathname]);

  const groups = visibleNav(biz);
  return (
    <div className="flex h-full">
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900 text-slate-300 transition-transform lg:static lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <BusinessSwitcher />
        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Main">
          {groups.map((g, gi) => (
            <div key={gi} className="mt-3">
              {g.label && <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>}
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cx('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm', isActive ? 'bg-brand-600 text-white' : 'hover:bg-slate-800 hover:text-white')
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-400" title={adapter?.location}>
          {adapter?.kind === 'server' ? 'Saved on this PC (local server)' : 'Saved in this browser (offline)'}
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setNavOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <button type="button" className="btn btn-ghost px-1.5 lg:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <button
            type="button"
            className="flex w-full max-w-md items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-white"
            onClick={() => setPalette(true)}
          >
            <Search className="h-4 w-4" />
            <span className="flex-1">Search invoices, parties, products or screens...</span>
            <Kbd>Ctrl K</Kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            {saving > 0 && (
              <span className="flex items-center gap-1 text-xs text-slate-500" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
              </span>
            )}
            <button type="button" className="btn btn-primary hidden sm:inline-flex" onClick={() => navigate('/sales/new?type=TAX_INVOICE')} title="New invoice (Alt+N)">
              <Plus className="h-4 w-4" /> New invoice
            </button>
            <NotificationBell />
            <button type="button" className="btn btn-ghost px-2" aria-label="Help (F1)" title="Help (F1)" onClick={() => setHelp(true)}>
              <CircleHelp className="h-5 w-5" />
            </button>
            {settings.pin && (
              <button type="button" className="btn btn-ghost px-2" aria-label="Lock" title="Lock now" onClick={() => setUnlocked(false)}>
                <Lock className="h-5 w-5" />
              </button>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <HelpDrawer open={help} onClose={() => setHelp(false)} path={location.pathname} />
    </div>
  );
}
