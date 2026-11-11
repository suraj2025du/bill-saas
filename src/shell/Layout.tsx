import { Building2, ChevronDown, CircleHelp, Loader2, Lock, Menu, Plus, Search, X, Sparkles, Star, Crown, CheckCircle, Copy, Calendar, HardDrive } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { switchBusiness, updateSettings } from '../store/actions';
import { useBusiness, useSettings } from '../store/hooks';
import { setUnlocked, useStore } from '../store/store';
import { attempt, toast } from '../ui/feedback';
import { getBillingDocsCount, getDaysRemaining, buildLicenseActivationPatch, verifyUpiUtrAndBuildActivation, isGreatPlanActive } from '../core/licensing';
import { getSaasConfig } from '../core/saasConfig';
import { getActiveLanguage, setActiveLanguage, LANGUAGE_OPTIONS, t } from '../core/i18n';
import { registerReferralSale } from '../core/referrals';
import { QrSvg, upiLink } from '../print/codes';
import { Kbd, cx } from '../ui/kit';
import { useIdleLock } from './appState';
import { CommandPalette } from './CommandPalette';
import { HelpDrawer } from './HelpDrawer';
import { visibleNav } from './nav';
import { NotificationBell } from './NotificationBell';
import { SoftwareLockModal } from '../features/portal/SoftwareLockModal';

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
  const [upiUtrNumber, setUpiUtrNumber] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<'MONTHLY' | 'STARTER' | 'ENTERPRISE'>('STARTER');

  const getTranslatedLabel = (label: string) => {
    const map: Record<string, string> = {
      'Dashboard': 'dashboard',
      'Daily & Price Board': 'dailyBoard',
      'Sales': 'sales',
      'Invoices & documents': 'invoices',
      'Payments': 'payments',
      'Parties': 'parties',
      'Products': 'products',
      'Bulk edit': 'bulkEdit',
      'Stock & valuation': 'stockValuation',
      'Settings': 'settings'
    };
    const key = map[label];
    return key ? t(key) : label;
  };

  const invoices = useStore((s) => s.data.invoices);
  const billingDocsCount = getBillingDocsCount(invoices);
  const daysRemaining = getDaysRemaining(settings);
  const saasConfig = getSaasConfig();
  const isGreatPlan = isGreatPlanActive(settings);

  const handleActivateLicense = () => {
    if (!activationKey.trim()) {
      toast.error('Kripya apna License Key paste karein.');
      return;
    }
    const res = buildLicenseActivationPatch(
      activationKey,
      activationOwner.trim() || biz.name || 'Indian MSME Subscriber',
    );
    if (!res.valid || !res.patch) {
      toast.error(res.error || 'Invalid License Key! Dobara check karein.');
      return;
    }

    void attempt(
      () => updateSettings(res.patch!),
      `Mubarak ho! Aapka BillSaaS ${res.type} Plan (Valid till ${res.patch.licenseExpiry}) successfully activate ho gaya hai.`
    );
    setUpgradeOpen(false);
    setActivationKey('');
  };

  const handleInstantUpiUtrActivation = () => {
    const res = verifyUpiUtrAndBuildActivation(
      upiUtrNumber,
      selectedPlan,
      activationOwner.trim() || biz.name || 'Indian MSME Subscriber',
    );
    if (!res.valid || !res.patch) {
      toast.error(res.error || 'Invalid 12-digit UPI UTR Number.');
      return;
    }

    // Register CA Referral if entered
    if (referralCode.trim()) {
      try {
        const planPrice =
          selectedPlan === 'MONTHLY'
            ? saasConfig.monthlyPrice
            : selectedPlan === 'STARTER'
            ? saasConfig.starterPrice
            : saasConfig.enterprisePrice;
        
        const refLead = registerReferralSale({
          referralCode: referralCode.trim(),
          shopName: biz.name,
          ownerPhone: biz.phone || '',
          planPurchased: selectedPlan,
          amountPaid: planPrice,
        });
        
        if (refLead) {
          toast.success(`Referral Code ${referralCode.toUpperCase()} Applied! 20% partner commission credited.`);
        }
      } catch (err) {
        console.error('Referral registration error:', err);
      }
    }

    void attempt(
      () => updateSettings(res.patch!),
      `Payment Verified (UTR: ${res.utrClean})! Aapka Plan (${res.patch.licenseExpiry} tak) activate ho gaya hai.`
    );
    setUpgradeOpen(false);
    setUpiUtrNumber('');
    setReferralCode('');
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
                  {getTranslatedLabel(item.label)}
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
            {/* Language Switcher Dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-full mr-1 transition">
              <span className="font-semibold text-slate-500">🌐 Lang:</span>
              <select
                value={getActiveLanguage()}
                onChange={(e) => {
                  setActiveLanguage(e.target.value as any);
                  window.location.reload();
                }}
                className="bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer text-xs"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code} className="bg-white text-slate-800 font-bold">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {saving > 0 && (
              <span className="flex items-center gap-1 text-xs text-slate-500" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
              </span>
            )}

            {/* SaaS Pricing Plan Status Pill & Upgrade CTA */}
            <div className="flex items-center gap-1.5 mr-2">
              {isGreatPlan ? (
                <div className="flex items-center gap-1">
                  <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-bold">
                    <Crown className="h-3.5 w-3.5 text-emerald-600" /> Business Pro (Unlimited • {daysRemaining}d left)
                  </span>
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-full text-[11px] font-bold transition"
                  >
                    Plans
                  </button>
                </div>
              ) : settings.licenseType === 'MONTHLY' ? (
                <div className="flex items-center gap-1">
                  <span className="flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full text-xs font-bold">
                    <Calendar className="h-3.5 w-3.5 text-indigo-600" /> Dukaan Monthly ({Math.max(0, 250 - billingDocsCount)} left • {daysRemaining}d)
                  </span>
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    className="flex items-center gap-1 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white hover:from-indigo-600 hover:to-indigo-700 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm transition animate-pulse"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Renew / Upgrade
                  </button>
                </div>
              ) : settings.licenseType === 'STARTER' ? (
                <div className="flex items-center gap-1">
                  <span className="flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full text-xs font-bold">
                    <Star className="h-3.5 w-3.5 text-blue-600" /> Vyapaar Starter ({Math.max(0, 500 - billingDocsCount)} left • {daysRemaining}d)
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
                    ⭐ Free Trial ({Math.max(0, 50 - billingDocsCount)}/50 left • {daysRemaining}d)
                  </span>
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    className="flex items-center gap-1 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white hover:from-indigo-600 hover:to-indigo-700 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm transition"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Choose Plan
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
      <SoftwareLockModal />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <HelpDrawer open={help} onClose={() => setHelp(false)} path={location.pathname} />

      {/* SaaS Digital Subscription Plans & Instant Self-Serve Checkout Modal */}
      {upgradeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-indigo-900 to-slate-900 p-6 text-white relative">
              <button
                type="button"
                onClick={() => setUpgradeOpen(false)}
                className="absolute top-4 right-4 text-slate-300 hover:text-white p-1 hover:bg-white/10 rounded-full transition"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="flex items-center justify-between pr-8">
                <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold uppercase tracking-wider mb-1">
                  <Sparkles className="h-4 w-4" /> Indian Small Business (MSME) Plans • Digital Self-Serve Checkout
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setUpgradeOpen(false);
                    navigate('/portal');
                  }}
                  className="text-[11px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-400/40 px-2.5 py-1 rounded-full font-bold flex items-center gap-1 transition"
                >
                  <HardDrive className="h-3 w-3" /> Company Portal &amp; Pen Drive Download
                </button>
              </div>
              <h3 className="text-xl sm:text-2xl font-black">
                Apni Dukaan / Vyapaar Ke Liye Plan Chunein
              </h3>
              <p className="text-slate-300 text-xs sm:text-sm mt-1">
                1️⃣ Features Padhein → 2️⃣ Apna Plan Select Karein → 3️⃣ UPI Pay Karke 12-Digit UTR Dalein (Turant Auto-Activate!)
              </p>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-700">
              
              {/* Plan Grid (3 Recurring MSME Tiers — No Lifetime Free) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                
                {/* Plan 1: Dukaan Monthly Plan */}
                <div
                  onClick={() => setSelectedPlan('MONTHLY')}
                  className={cx(
                    'border rounded-xl p-4 cursor-pointer relative transition',
                    selectedPlan === 'MONTHLY' ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-500/30' : 'border-slate-200 bg-slate-50/50 hover:border-slate-300'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[10px] font-bold">
                      CHHOTI DUKAAN • 30 DAYS
                    </div>
                    {selectedPlan === 'MONTHLY' && <CheckCircle className="h-4 w-4 text-indigo-600" />}
                  </div>
                  <h4 className="font-bold text-slate-800 flex items-center gap-1 mt-2">
                    <Calendar className="h-4 w-4 text-amber-600" /> Dukaan Monthly
                  </h4>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    ₹{saasConfig.monthlyPrice}<span className="text-xs text-slate-400 font-normal"> / month (₹6.5/day)</span>
                  </div>
                  <ul className="text-xs text-slate-500 space-y-1.5 mt-3">
                    <li className="flex items-center gap-1">✅ 250 GST Bills / month</li>
                    <li className="flex items-center gap-1">✅ 1 Shop / Business Profile</li>
                    <li className="flex items-center gap-1">✅ Thermal POS + A4 Print</li>
                    <li className="flex items-center gap-1 text-amber-700 font-semibold">⚠️ Auto-pauses if unpaid on Day 30</li>
                  </ul>
                </div>

                {/* Plan 2: Vyapaar Starter Yearly (Most Popular) */}
                <div
                  onClick={() => setSelectedPlan('STARTER')}
                  className={cx(
                    'border rounded-xl p-4 cursor-pointer relative transition',
                    selectedPlan === 'STARTER' ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-500/30' : 'border-slate-200 bg-slate-50/50 hover:border-slate-300'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="bg-indigo-600 text-white px-2 py-0.5 rounded text-[10px] font-bold">
                      ⭐ POPULAR • ₹66/MO
                    </div>
                    {selectedPlan === 'STARTER' && <CheckCircle className="h-4 w-4 text-indigo-600" />}
                  </div>
                  <h4 className="font-bold text-slate-800 flex items-center gap-1 mt-2">
                    <Star className="h-4 w-4 text-indigo-500 fill-indigo-500" /> Vyapaar Starter (1 Yr)
                  </h4>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    ₹{saasConfig.starterPrice}<span className="text-xs text-slate-400 font-normal"> / year (365 Days)</span>
                  </div>
                  <ul className="text-xs text-slate-500 space-y-1.5 mt-3">
                    <li className="flex items-center gap-1">✅ 500 GST Invoices / year</li>
                    <li className="flex items-center gap-1">✅ 2 Business Profiles</li>
                    <li className="flex items-center gap-1">✅ No Watermark + Daily Price Check</li>
                    <li className="flex items-center gap-1">✅ GSTR-1, 2B &amp; 3B Reports</li>
                  </ul>
                </div>

                {/* Plan 3: Business Pro Annual (1 Year Unlimited) */}
                <div
                  onClick={() => setSelectedPlan('ENTERPRISE')}
                  className={cx(
                    'border rounded-xl p-4 cursor-pointer relative transition',
                    selectedPlan === 'ENTERPRISE' ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-500/30' : 'border-slate-200 bg-slate-50/50 hover:border-slate-300'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="bg-emerald-600 text-white px-2 py-0.5 rounded text-[10px] font-bold">
                      1 YEAR UNLIMITED PRO
                    </div>
                    {selectedPlan === 'ENTERPRISE' && <CheckCircle className="h-4 w-4 text-indigo-600" />}
                  </div>
                  <h4 className="font-bold text-slate-800 flex items-center gap-1 mt-2">
                    <Crown className="h-4 w-4 text-amber-500 fill-amber-500" /> Business Pro (1 Yr)
                  </h4>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    ₹{saasConfig.enterprisePrice}<span className="text-xs text-slate-400 font-normal"> / year (365 Days)</span>
                  </div>
                  <ul className="text-xs text-slate-500 space-y-1.5 mt-3">
                    <li className="flex items-center gap-1 text-slate-700 font-semibold">💎 Unlimited GST Bills (1 Year)</li>
                    <li className="flex items-center gap-1 text-slate-700 font-semibold">💎 Unlimited Businesses / Godowns</li>
                    <li className="flex items-center gap-1 text-emerald-700 font-semibold">✅ E-Way Bill, Barcode &amp; Tally Export</li>
                    <li className="flex items-center gap-1">✅ Annual Renewal • Priority Support</li>
                  </ul>
                </div>

              </div>

              {/* Purchase Details, Dynamic UPI QR & Self-Serve 12-Digit UTR Activation */}
              {(() => {
                const planPrice =
                  selectedPlan === 'MONTHLY'
                    ? saasConfig.monthlyPrice
                    : selectedPlan === 'STARTER'
                    ? saasConfig.starterPrice
                    : saasConfig.enterprisePrice;
                const uri = upiLink(saasConfig.adminUpiVpa, saasConfig.adminPayeeName, planPrice, 'INR', `BillSaaS ${selectedPlan}`);
                const waMsg = `Hi Suraj ji, I have paid ₹${planPrice} for BillSaaS ${selectedPlan}. Business: ${biz.name}, Phone: ${biz.phone || ''}. Please generate my Premium License Key.`;
                const cleanPhone = saasConfig.adminPhone.replace(/\D/g, '');
                const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;

                return (
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 bg-amber-50/60 p-4 rounded-xl border border-amber-200">
                    <div className="shrink-0 bg-white border border-amber-300 rounded-lg p-2 shadow-sm flex flex-col items-center">
                      <QrSvg text={uri} size={110} title={`Scan to Pay ₹${planPrice}`} />
                      <span className="text-[10px] font-bold text-slate-500 mt-1">Scan with GPay/PhonePe</span>
                    </div>
                    <div className="flex-1 min-w-[200px] space-y-2">
                      <div className="flex items-center justify-between">
                        <h5 className="font-bold text-slate-800 text-sm">
                          Step 2: Pay ₹{planPrice} for {selectedPlan === 'MONTHLY' ? 'Dukaan Monthly (30 Days)' : selectedPlan === 'STARTER' ? 'Vyapaar Starter (1 Year)' : 'Business Pro Annual (1 Year Unlimited)'}
                        </h5>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-600 bg-white px-2.5 py-1.5 rounded border border-slate-200 font-mono">
                        <span className="truncate">UPI ID: <b>{saasConfig.adminUpiVpa}</b></span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(saasConfig.adminUpiVpa);
                            toast.success('UPI ID copied to clipboard!');
                          }}
                          className="text-indigo-600 hover:text-indigo-800 shrink-0"
                          title="Copy UPI ID"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/* Step 3: Instant Self-Serve UTR Verification */}
                      <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-2.5 space-y-1.5">
                        <label className="block text-[11px] font-extrabold text-emerald-900">
                          ⚡ Step 3: Payment Karne Ke Baad 12-Digit UPI UTR / Ref No. Dalein (Instant Activate):
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            maxLength={12}
                            value={upiUtrNumber}
                            onChange={(e) => setUpiUtrNumber(e.target.value.replace(/\D/g, ''))}
                            placeholder="12-digit UPI UTR (e.g. 412345678901)"
                            className="flex-1 bg-white border border-emerald-400 px-3 py-1.5 rounded-lg font-mono text-xs text-slate-900 focus:outline-none"
                          />
                          <input
                            type="text"
                            value={referralCode}
                            onChange={(e) => setReferralCode(e.target.value)}
                            placeholder="CA Code (Optional)"
                            className="w-full sm:w-36 bg-white border border-emerald-300 px-2.5 py-1.5 rounded-lg font-mono text-xs text-slate-900 uppercase focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleInstantUpiUtrActivation}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition shadow-sm shrink-0"
                          >
                            ✅ Verify UTR &amp; Activate
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-sm"
                        >
                          💬 Or Send Screenshot on WhatsApp
                        </a>
                        <a
                          href={uri}
                          className="inline-flex sm:hidden items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                        >
                          ⚡ Open UPI App on Mobile
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })()}

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

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
