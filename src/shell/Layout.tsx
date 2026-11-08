import { Building2, ChevronDown, CircleHelp, Loader2, Lock, Menu, Plus, Search, X, Sparkles, Star, Crown, QrCode } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { switchBusiness, updateSettings } from '../store/actions';
import { useBusiness, useSettings } from '../store/hooks';
import { setUnlocked, useStore } from '../store/store';
import { attempt, toast } from '../ui/feedback';
import { validateLicenseKey } from '../core/licensing';
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
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [activationKey, setActivationKey] = useState('');
  const [activationOwner, setActivationOwner] = useState('');

  const handleActivateLicense = () => {
    if (!activationKey.trim()) {
      toast.error('Kripya apna License Key paste karein.');
      return;
    }
    const res = validateLicenseKey(activationKey);
    if (!res.valid) {
      toast.error(res.error || 'Invalid License Key! Dobara check karein.');
      return;
    }

    const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const expiryDate = res.type === 'STARTER' ? thirtyDaysLater : '2099-12-31';

    void attempt(
      () =>
        updateSettings({
          licenseType: res.type!,
          licenseKey: activationKey.trim().toUpperCase(),
          licenseOwner: activationOwner.trim() || 'Premium SaaS Subscriber',
          licenseExpiry: expiryDate,
          licenseActivatedAt: new Date().toISOString().split('T')[0],
        }),
      `Mubarak ho! Aapka BillSaaS ${res.type} Plan successfully activate ho gaya hai.`
    );
    setUpgradeOpen(false);
    setActivationKey('');
  };

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

            {/* SaaS Pricing Plan Status Pill & Upgrade CTA */}
            <div className="flex items-center gap-1.5 mr-2">
              {settings.licenseType === 'ENTERPRISE' ? (
                <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-bold">
                  <Crown className="h-3.5 w-3.5 text-emerald-600 animate-pulse" /> Unlimited Enterprise
                </span>
              ) : settings.licenseType === 'STARTER' ? (
                <div className="flex items-center gap-1">
                  <span className="flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full text-xs font-bold">
                    <Star className="h-3.5 w-3.5 text-blue-600" /> Starter Plan
                  </span>
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    className="flex items-center gap-1 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white hover:from-indigo-600 hover:to-indigo-700 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm transition"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Upgrade
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full text-xs font-bold animate-pulse">
                    ⭐ Free Trial
                  </span>
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    className="flex items-center gap-1 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white hover:from-indigo-600 hover:to-indigo-700 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm transition"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Upgrade Plan
                  </button>
                </div>
              )}
            </div>

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

      {/* SaaS Premium Upgrade Modal */}
      {upgradeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-indigo-900 to-slate-900 p-6 text-white relative">
              <button
                type="button"
                onClick={() => setUpgradeOpen(false)}
                className="absolute top-4 right-4 text-slate-300 hover:text-white p-1 hover:bg-white/10 rounded-full transition"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold uppercase tracking-wider mb-1">
                <Sparkles className="h-4 w-4" /> Commercial SaaS Licensing
              </div>
              <h3 className="text-xl sm:text-2xl font-black">
                Upgrade to Premium Plans
              </h3>
              <p className="text-slate-300 text-xs sm:text-sm mt-1">
                Apne business ko grow karein unlimited invoicing aur multi-device backups ke sath!
              </p>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-700">
              
              {/* Plan Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Starter Plan Card */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 relative hover:shadow-md transition">
                  <div className="absolute top-3 right-3 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold">
                    POPULAR
                  </div>
                  <h4 className="font-bold text-slate-800 flex items-center gap-1">
                    <Star className="h-4 w-4 text-indigo-500 fill-indigo-500" /> Starter Plan
                  </h4>
                  <div className="text-2xl font-black text-slate-900 mt-2">
                    ₹999<span className="text-xs text-slate-400 font-normal"> / year</span>
                  </div>
                  <ul className="text-xs text-slate-500 space-y-1.5 mt-3">
                    <li className="flex items-center gap-1">✅ Max 500 Tax Invoices</li>
                    <li className="flex items-center gap-1">✅ A4 &amp; Thermal Printing</li>
                    <li className="flex items-center gap-1">✅ GSTR-1 &amp; GSTR-3B Reports</li>
                    <li className="flex items-center gap-1">✅ Custom GST Rates &amp; HSN</li>
                  </ul>
                </div>

                {/* Enterprise Plan Card */}
                <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50/20 relative hover:shadow-md transition">
                  <div className="absolute top-3 right-3 bg-indigo-600 text-white px-2 py-0.5 rounded text-[10px] font-bold">
                    RECOMMENDED
                  </div>
                  <h4 className="font-bold text-slate-800 flex items-center gap-1">
                    <Crown className="h-4 w-4 text-amber-500 fill-amber-500 animate-pulse" /> Enterprise Unlimited
                  </h4>
                  <div className="text-2xl font-black text-slate-900 mt-2">
                    ₹2,999<span className="text-xs text-slate-400 font-normal"> / lifetime</span>
                  </div>
                  <ul className="text-xs text-slate-500 space-y-1.5 mt-3">
                    <li className="flex items-center gap-1 text-slate-700 font-semibold">💎 Unlimited Tax Invoices</li>
                    <li className="flex items-center gap-1 text-slate-700 font-semibold">💎 Multi-Device Cloud Sync</li>
                    <li className="flex items-center gap-1">✅ Barcode Scanning &amp; Billing</li>
                    <li className="flex items-center gap-1">✅ Unlimited Businesses / Tenants</li>
                  </ul>
                </div>

              </div>

              {/* Activation Section */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1">
                  <Lock className="h-4 w-4 text-indigo-600" /> Have a Premium License Key? Activate Now
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Business Owner Name
                    </label>
                    <input
                      type="text"
                      value={activationOwner}
                      onChange={(e) => setActivationOwner(e.target.value)}
                      placeholder="e.g. Sharma General Store"
                      className="w-full bg-white border border-slate-300 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-indigo-500 text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Enter License Key *
                    </label>
                    <input
                      type="text"
                      value={activationKey}
                      onChange={(e) => setActivationKey(e.target.value)}
                      placeholder="SXXXX-XXXXX-XXXXX-XXXXX"
                      className="w-full bg-white border border-slate-300 px-3 py-2 rounded-lg font-mono text-sm focus:outline-none focus:border-indigo-500 text-slate-800"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleActivateLicense}
                  className="w-full bg-indigo-600 text-white font-bold py-2.5 rounded-lg text-sm hover:bg-indigo-700 transition flex items-center justify-center gap-1.5"
                >
                  🚀 Activate License Key
                </button>
              </div>

              {/* Purchase Details */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 bg-amber-50/50 p-4 rounded-xl border border-amber-200/50">
                <div className="w-24 h-24 shrink-0 bg-white border border-amber-200 rounded-lg p-1.5 flex items-center justify-center">
                  <QrCode className="h-full w-full text-slate-800" />
                </div>
                <div className="flex-1">
                  <h5 className="font-bold text-slate-800 text-xs sm:text-sm">
                    How to Get a License Key?
                  </h5>
                  <p className="text-xs text-slate-500 mt-1">
                    Scan above QR to pay securely via any UPI App (GPay, PhonePe, Paytm). Payment complete hone ke baad WhatsApp button par click karein aur apna payment screenshot share karke instantly license key activate karwayein!
                  </p>
                  <div className="flex gap-2 mt-3">
                    <a
                      href="https://wa.me/919999999999?text=Hi%20Suraj%20ji,%20I%20have%20paid%20for%20BillSaaS%20Premium.%20Please%20generate%20my%20Premium%20License%20Key."
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                    >
                      💬 Chat on WhatsApp for Key
                    </a>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
