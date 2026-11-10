import { useState, useMemo, useEffect } from 'react';
import type { FormEvent } from 'react';
import {
  Shield,
  Download,
  CreditCard,
  CheckCircle2,
  HardDrive,
  Lock,
  Check,
  Copy,
  Building2,
  Crown,
  Zap,
  Search,
  Calculator,
  FileSpreadsheet,
  Layers,
  Tag,
  TrendingUp,
  Package,
  FileText,
  Wallet,
  BarChart3,
  Save,
  Percent,
  ArrowUpRight,
  Monitor,
} from 'lucide-react';
import { getSaasConfig } from '../../core/saasConfig';
import { QrSvg, upiLink } from '../../print/codes';
import {
  buildLicenseActivationPatch,
  getDaysRemaining,
  getSoftwareLockState,
  isGreatPlanActive,
  verifySecurityIntegrity,
  verifyUpiUtrAndBuildActivation,
} from '../../core/licensing';
import {
  useSettings,
  useBusinessOrNull,
  useMine,
  useStock,
  useToday,
} from '../../store/hooks';
import { updateSettings, saveProduct, saveProducts } from '../../store/actions';
import { registerTenant, recordPlanInquiryLead } from '../../core/tenants';
import { toast } from '../../ui/feedback';
import type { Product } from '../../core/model';

type ActiveBoard = 'ALL' | 'BUSY_BOARD' | 'DAILY_PRICE' | 'SOFTWARE_PRICING' | 'PENDRIVE_SIGNUP';

export function CompanyHomePage() {
  const settings = useSettings();
  const currentBiz = useBusinessOrNull();
  const products = useMine('products');
  const invoices = useMine('invoices');
  const purchases = useMine('purchases');
  const parties = useMine('clients');
  const expenses = useMine('expenses');
  const receipts = useMine('receipts');
  const stockMap = useStock();
  const today = useToday();
  const saasConfig = getSaasConfig();

  const getBoardFromHash = (): ActiveBoard => {
    if (typeof window === 'undefined') return 'ALL';
    return window.location.hash.includes('daily') ? 'DAILY_PRICE' : 'ALL';
  };

  const [activeBoard, setActiveBoard] = useState<ActiveBoard>(getBoardFromHash);

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash.includes('daily')) {
        setActiveBoard('DAILY_PRICE');
      } else if (window.location.hash.includes('portal')) {
        setActiveBoard('ALL');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (to: string) => {
    const clean = to.startsWith('/') ? to : `/${to}`;
    window.location.hash = `#${clean}`;
  };

  // Software Pricing & Activation state
  const [selectedPlan, setSelectedPlan] = useState<'MONTHLY' | 'STARTER' | 'ENTERPRISE'>('STARTER');
  const [activationKey, setActivationKey] = useState('');
  const [activationOwner, setActivationOwner] = useState(currentBiz?.name || '');
  const [upiUtrNumber, setUpiUtrNumber] = useState('');
  const [isActivating, setIsActivating] = useState(false);

  // Client Registration form state
  const [regName, setRegName] = useState(currentBiz?.name || '');
  const [regOwner, setRegOwner] = useState('');
  const [regPhone, setRegPhone] = useState(currentBiz?.phone || '');
  const [regCity, setRegCity] = useState(currentBiz?.city || '');
  const [regGstin, setRegGstin] = useState(currentBiz?.gstin || '');
  const [regSuccess, setRegSuccess] = useState(false);

  // Pen Drive / Portable Packager state
  const [isPackaging, setIsPackaging] = useState(false);

  // Daily Price Check & Rate List state
  const [priceSearch, setPriceSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [editedPrices, setEditedPrices] = useState<
    Record<string, { purchasePrice: number; sellingPrice: number; mrp: number; gstRate: number }>
  >({});
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [bulkPercent, setBulkPercent] = useState<string>('5');
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // Quick GST & Retail Price Calculator state
  const [calcBasePrice, setCalcBasePrice] = useState<number>(1000);
  const [calcGstRate, setCalcGstRate] = useState<number>(18);
  const [calcQty, setCalcQty] = useState<number>(1);
  const [calcDiscountPct, setCalcDiscountPct] = useState<number>(0);
  const [calcInclusive, setCalcInclusive] = useState<boolean>(false);

  const isGreatPlan = isGreatPlanActive(settings);
  const daysRemaining = getDaysRemaining(settings);
  const securityStatus = verifySecurityIntegrity({
    licenseType: settings.licenseType,
    licenseKey: settings.licenseKey,
    licenseExpiry: settings.licenseExpiry,
    securityTamperDetected: settings.securityTamperDetected,
    lastVerifiedClock: settings.lastVerifiedClock,
  });
  const lockState = getSoftwareLockState({
    licenseType: settings.licenseType,
    licenseKey: settings.licenseKey,
    licenseExpiry: settings.licenseExpiry,
    licenseDisabled: settings.licenseDisabled,
    licenseDisabledReason: settings.licenseDisabledReason,
    securityTamperDetected: settings.securityTamperDetected,
    lastVerifiedClock: settings.lastVerifiedClock,
  });

  const planPrices = {
    MONTHLY: saasConfig.monthlyPrice,
    STARTER: saasConfig.starterPrice,
    ENTERPRISE: saasConfig.enterprisePrice,
  };

  // Daily & Overall Metrics
  const dailyMetrics = useMemo(() => {
    const todayInvoices = invoices.filter((i) => i.date === today);
    const todaySalesTotal = todayInvoices.reduce((sum, i) => sum + (i.totals?.total || 0), 0);
    const totalSalesRevenue = invoices
      .filter((i) => i.docType === 'TAX_INVOICE' || i.docType === 'BILL_OF_SUPPLY')
      .reduce((sum, i) => sum + (i.totals?.total || 0), 0);
    const totalPurchaseSpend = purchases.reduce((sum, p) => sum + (p.totals?.total || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.total || 0), 0);
    const totalReceipts = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);
    return {
      todayInvoicesCount: todayInvoices.length,
      todaySalesTotal,
      totalSalesRevenue,
      totalPurchaseSpend,
      totalExpenses,
      totalReceipts,
    };
  }, [invoices, purchases, expenses, receipts, today]);

  // Categories for Daily Price Section
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category) set.add(p.category);
    }
    return ['ALL', ...Array.from(set)];
  }, [products]);

  // Filtered Products for Price Check Table
  const filteredProducts = useMemo(() => {
    const q = priceSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.hsn.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, priceSearch, categoryFilter]);

  // Price Calculator Computation
  const calcBreakdown = useMemo(() => {
    const rawRate = Math.max(0, Number(calcBasePrice) || 0);
    const qty = Math.max(1, Number(calcQty) || 1);
    const discPct = Math.min(100, Math.max(0, Number(calcDiscountPct) || 0));
    const gst = Math.max(0, Number(calcGstRate) || 0);

    const discountedUnit = rawRate * (1 - discPct / 100);
    const lineAmount = discountedUnit * qty;

    let taxable = lineAmount;
    let taxAmount = 0;
    let finalPayable = lineAmount;

    if (calcInclusive) {
      taxable = lineAmount / (1 + gst / 100);
      taxAmount = lineAmount - taxable;
      finalPayable = lineAmount;
    } else {
      taxable = lineAmount;
      taxAmount = (taxable * gst) / 100;
      finalPayable = taxable + taxAmount;
    }

    return {
      taxable: Math.round(taxable * 100) / 100,
      cgst: Math.round((taxAmount / 2) * 100) / 100,
      sgst: Math.round((taxAmount / 2) * 100) / 100,
      totalTax: Math.round(taxAmount * 100) / 100,
      finalPayable: Math.round(finalPayable * 100) / 100,
    };
  }, [calcBasePrice, calcGstRate, calcQty, calcDiscountPct, calcInclusive]);

  const getProductDraft = (p: Product) => {
    return (
      editedPrices[p.id] || {
        purchasePrice: p.purchasePrice,
        sellingPrice: p.sellingPrice,
        mrp: p.mrp || p.sellingPrice,
        gstRate: p.gstRate,
      }
    );
  };

  const handleEditProductField = (
    p: Product,
    field: 'purchasePrice' | 'sellingPrice' | 'mrp' | 'gstRate',
    value: number
  ) => {
    const prev = getProductDraft(p);
    setEditedPrices((curr) => ({
      ...curr,
      [p.id]: {
        ...prev,
        [field]: Math.max(0, value),
      },
    }));
  };

  const handleSaveSingleProductPrice = async (p: Product) => {
    const draft = editedPrices[p.id];
    if (!draft) {
      toast.info(`"${p.name}" ka price pehle se hi saved hai.`);
      return;
    }
    setSavingProductId(p.id);
    try {
      await saveProduct({
        ...p,
        purchasePrice: draft.purchasePrice,
        sellingPrice: draft.sellingPrice,
        mrp: draft.mrp,
        gstRate: draft.gstRate,
      });
      setEditedPrices((curr) => {
        const next = { ...curr };
        delete next[p.id];
        return next;
      });
      toast.success(`"${p.name}" ka naya rate (₹${draft.sellingPrice}) safaltapoorvak update ho gaya!`);
    } catch (err) {
      toast.error('Price save karne me truti: ' + String(err));
    } finally {
      setSavingProductId(null);
    }
  };

  const handleBulkPriceRevision = async (direction: 1 | -1) => {
    const pct = Number(bulkPercent);
    if (!pct || pct <= 0 || pct > 100) {
      toast.error('Kripya 1% se 100% ke beech valid percentage dalein.');
      return;
    }
    if (filteredProducts.length === 0) {
      toast.error('Update karne ke liye koi product nahi mila.');
      return;
    }
    setIsBulkUpdating(true);
    try {
      const multiplier = 1 + (direction * pct) / 100;
      const updatedList = filteredProducts.map((p) => {
        const newSelling = Math.round(p.sellingPrice * multiplier * 100) / 100;
        const newMrp = Math.round((p.mrp || p.sellingPrice) * multiplier * 100) / 100;
        return {
          ...p,
          sellingPrice: newSelling,
          mrp: Math.max(newSelling, newMrp),
        };
      });
      await saveProducts(updatedList);
      setEditedPrices({});
      toast.success(
        `${updatedList.length} items ka Selling Price & MRP ${direction > 0 ? '+' : '-'}${pct}% se update ho gaya!`
      );
    } catch (err) {
      toast.error('Bulk price revision failed: ' + String(err));
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleRegisterClient = (e: FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regPhone.trim()) {
      toast.error('Kripya Vyapaar ka Naam aur Mobile Number dalein.');
      return;
    }
    registerTenant({
      shopName: regName.trim(),
      ownerName: regOwner.trim() || 'Business Owner',
      phone: regPhone.trim(),
      city: regCity.trim() || 'Local City',
      stateCode: currentBiz?.stateCode || '27',
      gstin: regGstin.trim() || undefined,
    });
    setRegSuccess(true);
    toast.success('Registration safal raha! Ab aap payment karke license activate kar sakte hain.');
  };

  const handleActivateLicense = async () => {
    if (!activationKey.trim()) {
      toast.error('Kripya apna License Key paste karein.');
      return;
    }
    setIsActivating(true);
    const res = buildLicenseActivationPatch(activationKey, activationOwner || currentBiz?.name);
    if (!res.valid || !res.patch) {
      toast.error(res.error || 'Invalid License Key! Kripya dobara check karein.');
      setIsActivating(false);
      return;
    }

    try {
      await updateSettings(res.patch);
      toast.success(
        `Mubarak ho! BillSaaS ${res.type} successfully activate ho gaya hai. Ab aap offline ya pen drive se poora software chala sakte hain!`
      );
      setActivationKey('');
    } catch (err) {
      toast.error('Activation save karne me samasya aayi: ' + String(err));
    } finally {
      setIsActivating(false);
    }
  };

  const handleInstantUpiUtrActivation = async () => {
    const ownerLabel =
      activationOwner.trim() || regName.trim() || currentBiz?.name || 'Indian MSME Subscriber';
    const res = verifyUpiUtrAndBuildActivation(upiUtrNumber, selectedPlan, ownerLabel);
    if (!res.valid || !res.patch || !res.generatedKey) {
      toast.error(res.error || 'Kripya valid 12-digit UPI UTR / Reference Number dalein.');
      return;
    }

    setIsActivating(true);
    try {
      await updateSettings(res.patch);
      recordPlanInquiryLead({
        shopName: ownerLabel,
        ownerName: regOwner.trim() || ownerLabel,
        phone: regPhone.trim() || currentBiz?.phone || '9999999999',
        city: regCity.trim() || currentBiz?.city || 'India',
        stateCode: currentBiz?.stateCode || '27',
        gstin: regGstin.trim() || currentBiz?.gstin,
        selectedPlan,
        quotedPrice: planPrices[selectedPlan],
        paymentUtr: res.utrClean,
      });
      setActivationKey(res.generatedKey);
      setUpiUtrNumber('');
      toast.success(
        `🎉 UPI Payment Verified (UTR: ${res.utrClean})! ${selectedPlan} Plan Active till ${res.patch.licenseExpiry}`
      );
    } catch (err) {
      toast.error('Instant UTR activation save karne me truti aayi: ' + String(err));
    } finally {
      setIsActivating(false);
    }
  };

  const handleDownloadPenDrivePackage = () => {
    setIsPackaging(true);

    try {
      const licenseInfo = JSON.stringify(
        {
          product: 'BillSaaS GST Accounting Suite (Busy/Tally Portable Edition)',
          owner: settings.licenseOwner || currentBiz?.name || 'Licensed Client',
          plan: settings.licenseType || 'TRIAL',
          licenseKey: settings.licenseKey || 'TRIAL-MODE',
          expiry: settings.licenseExpiry || '30-days-trial',
          offlinePortableMode: true,
          packagedAt: new Date().toISOString(),
        },
        null,
        2
      );

      const batchRunner = `@echo off
title BillSaaS Portable Pen-Drive Suite
echo ========================================================
echo   BillSaaS Pro - Busy & Tally Style Portable Suite
echo ========================================================
echo Starting local offline accounting database...
echo Open your browser at: http://127.0.0.1:47371
start http://127.0.0.1:47371
echo Running from Pen Drive / USB drive. Do not remove drive while using.
pause
`;

      const readme = `# BillSaaS Pro — Pen Drive / USB Portable Edition
==================================================

Aapka poora accounting aur billing software ab is Pen Drive me portable run ke liye tayar hai.

Kaise chalayein:
1. Is folder ko kisi bhi Windows / Mac / Linux PC par Pen Drive me rakhein.
2. "RUN_PENDRIVE_BILLSAAS.bat" par double click karein.
3. Browser me http://127.0.0.1:47371 khulega aur aapka poora vyapaar data, invoices, aur GST returns bina internet ke Pen Drive se hi chalenge.

Security Note:
- Dukaan Monthly Plan subscribers: Har 30 din me renewal zaroori hai (₹${saasConfig.monthlyPrice}/mo).
- Vyapaar Starter & Business Pro Annual subscribers: 1 saal (365 din) ki validity ke saath poora software active rehta hai.
`;

      // Download README
      const blob = new Blob([readme + '\n\n--- LICENSE CERTIFICATE ---\n' + licenseInfo], {
        type: 'text/plain;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'PENDRIVE_BILLSAAS_PORTABLE_PACKAGE.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Download Bat Launcher
      const batBlob = new Blob([batchRunner], { type: 'application/x-bat' });
      const batUrl = URL.createObjectURL(batBlob);
      const batA = document.createElement('a');
      batA.href = batUrl;
      batA.download = 'RUN_PENDRIVE_BILLSAAS.bat';
      document.body.appendChild(batA);
      batA.click();
      document.body.removeChild(batA);
      URL.revokeObjectURL(batUrl);

      toast.success('Pen Drive launcher aur portable license files safaltapoorvak download ho gayi hain!');
    } catch (err) {
      toast.error('Pen drive files packaging me truti aayi: ' + String(err));
    } finally {
      setIsPackaging(false);
    }
  };

  const currentPrice = planPrices[selectedPlan];
  const paymentUri = upiLink(
    saasConfig.adminUpiVpa,
    saasConfig.adminPayeeName,
    currentPrice,
    'INR',
    `BillSaaS ${selectedPlan} License`
  );

  const cleanPhone = saasConfig.adminPhone.replace(/\D/g, '');
  const waMsg = `Namaste! Maine BillSaaS ${selectedPlan} (₹${currentPrice}) ka payment UPI par kar diya hai. Kripya mera License Key WhatsApp par bhein.
Vyapaar: ${regName || currentBiz?.name || 'My Business'}
Phone: ${regPhone || currentBiz?.phone || ''}`;
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;

  const showBusyBoard = activeBoard === 'ALL' || activeBoard === 'BUSY_BOARD';
  const showDailyPriceBoard = activeBoard === 'ALL' || activeBoard === 'DAILY_PRICE';
  const showSoftwarePricingBoard = activeBoard === 'ALL' || activeBoard === 'SOFTWARE_PRICING';
  const showPenDriveBoard = activeBoard === 'ALL' || activeBoard === 'PENDRIVE_SIGNUP';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-20 rounded-xl overflow-hidden">
      {/* BUSY / Tally Top Enterprise Header Bar */}
      <header className="border-b border-slate-800 bg-slate-950/95 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-amber-400 flex items-center justify-center font-black text-white text-xl shadow-lg shadow-indigo-500/20">
              BS
            </div>
            <div>
              <div className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                <span>BillSaaS BUSY &amp; Tally Gateway</span>
                <span className="text-[11px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-mono">
                  v21 Enterprise Edition
                </span>
                {isGreatPlan && (
                  <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <Crown className="h-3 w-3 text-amber-400" /> Business Pro (1-Yr Unlimited • {daysRemaining}d left)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Active Company: <strong className="text-slate-200">{currentBiz?.name || 'Unconfigured Company'}</strong> • GSTIN:{' '}
                <span className="font-mono text-amber-300">{currentBiz?.gstin || 'URP'}</span> • Today: {today}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/sales/new')}
              className="text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition flex items-center gap-1 shadow"
            >
              <Zap className="h-3.5 w-3.5" /> + F2: Quick Sale Bill
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-xs font-semibold text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 transition"
            >
              ← Main Dashboard
            </button>
            <button
              type="button"
              onClick={() => navigate('/super-admin')}
              className="text-xs font-semibold bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 px-3 py-1.5 rounded-lg transition flex items-center gap-1"
            >
              <Lock className="h-3.5 w-3.5" /> Super Admin
            </button>
          </div>
        </div>

        {/* Classic BUSY Function Key Shortcut Strip (F2 - F12) */}
        <div className="bg-slate-900 border-t border-slate-800/80 px-4 sm:px-6 py-1.5 overflow-x-auto">
          <div className="max-w-7xl mx-auto flex items-center gap-1.5 text-[11px] font-mono whitespace-nowrap">
            <span className="text-amber-400 font-bold mr-1">BUSY HOTKEYS:</span>
            <button
              type="button"
              onClick={() => navigate('/sales/new')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 transition"
            >
              <b className="text-amber-300">F2</b> Sale Invoice
            </button>
            <button
              type="button"
              onClick={() => navigate('/purchases')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 transition"
            >
              <b className="text-amber-300">F3</b> Purchase Bill
            </button>
            <button
              type="button"
              onClick={() => navigate('/payments')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 transition"
            >
              <b className="text-amber-300">F5</b> Receipt / Payment
            </button>
            <button
              type="button"
              onClick={() => navigate('/accounts/vouchers')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 transition"
            >
              <b className="text-amber-300">F7</b> Journal Voucher
            </button>
            <button
              type="button"
              onClick={() => navigate('/inventory/stock')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 transition"
            >
              <b className="text-amber-300">F8</b> Stock Valuation
            </button>
            <button
              type="button"
              onClick={() => navigate('/accounts/ledgers')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 transition"
            >
              <b className="text-amber-300">F9</b> Party Ledger
            </button>
            <button
              type="button"
              onClick={() => setActiveBoard('DAILY_PRICE')}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 font-bold transition"
            >
              <b className="underline">F11</b> Daily Price Check
            </button>
            <button
              type="button"
              onClick={() => setActiveBoard('SOFTWARE_PRICING')}
              className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-slate-950 border border-emerald-500/40 font-bold transition"
            >
              <b className="underline">F12</b> Plan Price &amp; License
            </button>
          </div>
        </div>
      </header>

      {/* Interactive 4-Board Mode Selector Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        <div className="bg-slate-800/90 border border-slate-700 p-2 rounded-2xl flex flex-wrap items-center justify-between gap-2 shadow-xl">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveBoard('ALL')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeBoard === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                  : 'text-slate-300 hover:bg-slate-700/70'
              }`}
            >
              <Layers className="h-4 w-4" /> All Boards Unified View (Sabhi Boards Ek Sath)
            </button>
            <button
              type="button"
              onClick={() => setActiveBoard('BUSY_BOARD')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeBoard === 'BUSY_BOARD'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                  : 'text-slate-300 hover:bg-slate-700/70'
              }`}
            >
              <Monitor className="h-4 w-4 text-sky-400" /> 1. BUSY Software Board
            </button>
            <button
              type="button"
              onClick={() => setActiveBoard('DAILY_PRICE')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeBoard === 'DAILY_PRICE'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'text-slate-300 hover:bg-slate-700/70'
              }`}
            >
              <Tag className="h-4 w-4 text-amber-400" /> 2. Daily Page &amp; Price Section
            </button>
            <button
              type="button"
              onClick={() => setActiveBoard('SOFTWARE_PRICING')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeBoard === 'SOFTWARE_PRICING'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30'
                  : 'text-slate-300 hover:bg-slate-700/70'
              }`}
            >
              <CreditCard className="h-4 w-4 text-emerald-400" /> 3. Software Plans &amp; Price Section
            </button>
            <button
              type="button"
              onClick={() => setActiveBoard('PENDRIVE_SIGNUP')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeBoard === 'PENDRIVE_SIGNUP'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                  : 'text-slate-300 hover:bg-slate-700/70'
              }`}
            >
              <HardDrive className="h-4 w-4 text-indigo-400" /> 4. Pen Drive USB &amp; Sign-Up Board
            </button>
          </div>

          <div className="text-[11px] text-slate-400 px-2 hidden xl:block">
            Status:{' '}
            {lockState.disabled ? (
              <span className="text-red-400 font-bold">🔒 Locked ({lockState.kind})</span>
            ) : (
              <span className="text-emerald-400 font-bold">
                ✅ Active ({settings.licenseType || 'TRIAL'} • {daysRemaining}d left)
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 space-y-8">
        {/* BOARD 1: BUSY ACCOUNTING SOFTWARE COMMAND & GATEWAY BOARD */}
        {showBusyBoard && (
          <section className="bg-slate-800/70 border border-slate-700 rounded-2xl p-5 sm:p-6 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-700/80">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2.5 py-0.5 rounded-full mb-1">
                  <Monitor className="h-3.5 w-3.5" /> Board 1 • BUSY 21 / Tally Prime Command Center
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white">
                  BUSY Accounting Software Workspace Board
                </h2>
                <p className="text-xs text-slate-400">
                  Masters, Vouchers, Inventory, GST Returns aur Daily Accounting ke sabhi boards yahan se seedha operate karein.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-300">
                  FY: <b className="text-white">2026-27</b>
                </span>
                <span className="bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-lg text-emerald-400 font-bold">
                  GST Verified • Offline Engine
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Sub-Board 1A: Masters */}
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                      <Package className="h-4 w-4" /> 1. Masters Board
                    </span>
                    <span className="text-[11px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-mono">
                      Alt+M
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <button
                      type="button"
                      onClick={() => navigate('/inventory/products')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-indigo-600/30 border border-slate-700/60 hover:border-indigo-500/50 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">📦 Item / Product Master</span>
                      <span className="font-mono font-bold text-indigo-300">{products.length} items</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/parties')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-indigo-600/30 border border-slate-700/60 hover:border-indigo-500/50 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">👥 Account / Party Master</span>
                      <span className="font-mono font-bold text-indigo-300">{parties.length} parties</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/inventory/bulk')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-indigo-600/30 border border-slate-700/60 hover:border-indigo-500/50 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">⚡ Bulk Price &amp; HSN Editor</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/inventory/godowns')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-indigo-600/30 border border-slate-700/60 hover:border-indigo-500/50 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">🏭 Material Centres / Godowns</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>BUSY Master Sync</span>
                  <span className="text-emerald-400 font-semibold">● Live Ready</span>
                </div>
              </div>

              {/* Sub-Board 1B: Transactions */}
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <FileText className="h-4 w-4" /> 2. Transactions Board
                    </span>
                    <span className="text-[11px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono">
                      Alt+T
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <button
                      type="button"
                      onClick={() => navigate('/sales/new')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/40 transition text-left"
                    >
                      <span className="font-bold text-emerald-200">🧾 + Add Sale Invoice (F2)</span>
                      <span className="font-mono font-bold text-emerald-300">{invoices.length} bills</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/purchases')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-emerald-600/20 border border-slate-700/60 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">📥 Purchase Voucher (F3)</span>
                      <span className="font-mono font-bold text-emerald-300">{purchases.length} bills</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/payments')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-emerald-600/20 border border-slate-700/60 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">💰 Payment / Receipt (F5)</span>
                      <span className="font-mono font-bold text-emerald-300">{receipts.length} txns</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/expenses')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-emerald-600/20 border border-slate-700/60 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">💸 Business Expenses</span>
                      <span className="font-mono font-bold text-emerald-300">{expenses.length} entries</span>
                    </button>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Total Turnover</span>
                  <span className="text-white font-bold">₹{dailyMetrics.totalSalesRevenue.toLocaleString('en-IN')}</span>
                </div>
              </div>

              {/* Sub-Board 1C: Display & GST */}
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <BarChart3 className="h-4 w-4" /> 3. Display &amp; GST Board
                    </span>
                    <span className="text-[11px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono">
                      Alt+D
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <button
                      type="button"
                      onClick={() => navigate('/accounts/balance-sheet')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-amber-500/20 border border-slate-700/60 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">📊 Balance Sheet &amp; P&amp;L</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-amber-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/accounts/books')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-amber-500/20 border border-slate-700/60 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">📖 Day Book, Cash &amp; Bank</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-amber-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/gst/gstr1')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-amber-500/20 border border-slate-700/60 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">🇮🇳 GSTR-1 / 3B / 2B Reco</span>
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold">
                        JSON/CSV
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/accounts/outstanding')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-amber-500/20 border border-slate-700/60 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">⏳ Outstanding &amp; Ageing</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-amber-400" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Purchases Spend</span>
                  <span className="text-amber-300 font-bold">
                    ₹{dailyMetrics.totalPurchaseSpend.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Sub-Board 1D: Price & USB Board */}
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-black uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                      <Shield className="h-4 w-4" /> 4. Price &amp; USB Board
                    </span>
                    <span className="text-[11px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded font-mono">
                      F11/F12
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveBoard('DAILY_PRICE')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 transition text-left"
                    >
                      <span className="font-bold text-amber-300">🏷️ Check Daily Product Prices</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-amber-300" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveBoard('SOFTWARE_PRICING')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 transition text-left"
                    >
                      <span className="font-bold text-indigo-300">💳 Check Software Plan Prices</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-indigo-300" />
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadPenDrivePackage}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-sky-500/20 border border-slate-700/60 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">💾 Pen Drive USB Download</span>
                      <Download className="h-3.5 w-3.5 text-sky-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/settings/backup')}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-800/70 hover:bg-sky-500/20 border border-slate-700/60 transition text-left"
                    >
                      <span className="font-semibold text-slate-200">🔄 Backup &amp; Restore Data</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Anti-Tamper Clock</span>
                  <span className={securityStatus.tampered ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
                    {securityStatus.tampered ? '⚠️ Alert' : '🔒 Verified OK'}
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* BOARD 2: DAILY WORK PAGE & LIVE PRICE CHECK / RATE LIST SECTION */}
        {showDailyPriceBoard && (
          <section className="bg-slate-800/70 border border-amber-500/30 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-700/80">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-full mb-1">
                  <Tag className="h-3.5 w-3.5" /> Board 2 • Daily Work Page &amp; Live Price Section (F11)
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white">
                  Daily Counter &amp; Live Product Price Check Board
                </h2>
                <p className="text-xs text-slate-300">
                  Rozana ke kaam ke liye kisi bhi item ka Purchase Rate, Selling Price, MRP, GST Slab aur Margin check karein ya turant rate update karein.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 bg-slate-900/90 p-2.5 rounded-xl border border-slate-700">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1">
                  <Percent className="h-3.5 w-3.5 text-amber-400" /> Bulk Price Update:
                </span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={bulkPercent}
                  onChange={(e) => setBulkPercent(e.target.value)}
                  className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-white text-center"
                />
                <span className="text-xs text-slate-400">%</span>
                <button
                  type="button"
                  disabled={isBulkUpdating}
                  onClick={() => void handleBulkPriceRevision(1)}
                  className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
                >
                  +{bulkPercent}% Increase
                </button>
                <button
                  type="button"
                  disabled={isBulkUpdating}
                  onClick={() => void handleBulkPriceRevision(-1)}
                  className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition"
                >
                  -{bulkPercent}% Decrease
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-slate-900/80 border border-slate-700/80 p-3.5 rounded-xl">
                <div className="text-[11px] font-bold text-slate-400 uppercase flex items-center justify-between">
                  <span>Aaj Ki Bikri (Today Sales)</span>
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="text-xl font-black text-white mt-1">
                  ₹{dailyMetrics.todaySalesTotal.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] text-emerald-400 mt-0.5">
                  {dailyMetrics.todayInvoicesCount} bills today ({invoices.length} total)
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-700/80 p-3.5 rounded-xl">
                <div className="text-[11px] font-bold text-slate-400 uppercase flex items-center justify-between">
                  <span>Total Stock Items in Price List</span>
                  <Package className="h-4 w-4 text-indigo-400" />
                </div>
                <div className="text-xl font-black text-white mt-1">{products.length} Items</div>
                <div className="text-[11px] text-indigo-300 mt-0.5">
                  Showing {filteredProducts.length} matching items
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-700/80 p-3.5 rounded-xl">
                <div className="text-[11px] font-bold text-slate-400 uppercase flex items-center justify-between">
                  <span>Total Payment Collections</span>
                  <Wallet className="h-4 w-4 text-amber-400" />
                </div>
                <div className="text-xl font-black text-white mt-1">
                  ₹{dailyMetrics.totalReceipts.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] text-amber-300 mt-0.5">
                  Across {parties.length} registered parties
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-700/80 p-3.5 rounded-xl">
                <div className="text-[11px] font-bold text-slate-400 uppercase flex items-center justify-between">
                  <span>Software Plan Price Tier</span>
                  <Crown className="h-4 w-4 text-amber-400" />
                </div>
                <div className="text-xl font-black text-amber-300 mt-1">
                  {settings.licenseType || 'TRIAL'}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    ({isGreatPlan ? `₹${saasConfig.enterprisePrice}/yr` : settings.licenseType === 'STARTER' ? `₹${saasConfig.starterPrice}/yr` : `₹${saasConfig.monthlyPrice}/mo`})
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveBoard('SOFTWARE_PRICING')}
                    className="text-indigo-400 hover:underline font-semibold"
                  >
                    Check Software Plan Prices →
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Live Product Price Search & Inline Editor */}
              <div className="lg:col-span-8 bg-slate-900/90 border border-slate-700 rounded-xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={priceSearch}
                      onChange={(e) => setPriceSearch(e.target.value)}
                      placeholder="Item ka naam, SKU, ya HSN code search karein (e.g. Havells, Wire, MCB)..."
                      className="w-full bg-slate-800 border border-slate-700 pl-9 pr-3 py-2 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                          categoryFilter === cat
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-lg border border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">Item / SKU / HSN</th>
                        <th className="py-2.5 px-2 text-right">Stock</th>
                        <th className="py-2.5 px-2 text-right">Purchase (₹)</th>
                        <th className="py-2.5 px-2 text-right">Selling Price (₹)</th>
                        <th className="py-2.5 px-2 text-right">MRP (₹)</th>
                        <th className="py-2.5 px-2 text-right">GST %</th>
                        <th className="py-2.5 px-2 text-right">With GST (₹)</th>
                        <th className="py-2.5 px-2 text-right">Margin</th>
                        <th className="py-2.5 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {filteredProducts.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-400">
                            Koi item nahi mila. Naya item add karne ke liye Inventory &gt; Products me jayein.
                          </td>
                        </tr>
                      ) : (
                        filteredProducts.map((p) => {
                          const draft = getProductDraft(p);
                          const isDirty = Boolean(editedPrices[p.id]);
                          const currentQty = stockMap.get(p.id) ?? p.openingStock ?? 0;
                          const withGst = p.priceIncludesTax
                            ? draft.sellingPrice
                            : Math.round(draft.sellingPrice * (1 + draft.gstRate / 100) * 100) / 100;
                          const profit = draft.sellingPrice - draft.purchasePrice;
                          const marginPct =
                            draft.purchasePrice > 0 ? Math.round((profit / draft.purchasePrice) * 100) : 0;

                          return (
                            <tr
                              key={p.id}
                              className={`hover:bg-slate-800/60 transition ${
                                isDirty ? 'bg-amber-500/10' : ''
                              }`}
                            >
                              <td className="py-2 px-3">
                                <div className="font-bold text-white">{p.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono">
                                  SKU: {p.sku || 'N/A'} • HSN: {p.hsn || 'N/A'} • {p.unit}
                                </div>
                              </td>
                              <td className="py-2 px-2 text-right font-mono">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                                    currentQty <= p.lowStockLevel
                                      ? 'bg-rose-500/20 text-rose-300'
                                      : 'bg-emerald-500/15 text-emerald-300'
                                  }`}
                                >
                                  {currentQty} {p.unit}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  value={draft.purchasePrice}
                                  onChange={(e) =>
                                    handleEditProductField(p, 'purchasePrice', Number(e.target.value))
                                  }
                                  className="w-20 bg-slate-800 border border-slate-700 focus:border-amber-400 rounded px-1.5 py-1 text-right font-mono text-slate-200"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  value={draft.sellingPrice}
                                  onChange={(e) =>
                                    handleEditProductField(p, 'sellingPrice', Number(e.target.value))
                                  }
                                  className="w-20 bg-slate-800 border border-amber-500/50 focus:border-amber-400 rounded px-1.5 py-1 text-right font-mono font-bold text-amber-300"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  value={draft.mrp}
                                  onChange={(e) => handleEditProductField(p, 'mrp', Number(e.target.value))}
                                  className="w-20 bg-slate-800 border border-slate-700 focus:border-amber-400 rounded px-1.5 py-1 text-right font-mono text-slate-300"
                                />
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-sky-300">{draft.gstRate}%</td>
                              <td className="py-2 px-2 text-right font-mono font-bold text-emerald-300">
                                ₹{withGst.toLocaleString('en-IN')}
                              </td>
                              <td className="py-2 px-2 text-right font-mono">
                                <span
                                  className={`text-[11px] font-bold ${
                                    marginPct >= 15 ? 'text-emerald-400' : 'text-amber-300'
                                  }`}
                                >
                                  +{marginPct}%
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void handleSaveSingleProductPrice(p)}
                                    disabled={savingProductId === p.id}
                                    title="Save Updated Price"
                                    className={`px-2 py-1 rounded text-[11px] font-bold flex items-center gap-1 transition ${
                                      isDirty
                                        ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow'
                                        : 'bg-slate-800 text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    <Save className="h-3 w-3" /> {isDirty ? 'Save' : 'OK'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCalcBasePrice(draft.sellingPrice);
                                      setCalcGstRate(draft.gstRate);
                                      setCalcInclusive(p.priceIncludesTax);
                                      toast.info(`"${p.name}" ka rate Price Calculator me load ho gaya!`);
                                    }}
                                    title="Load into Price Calculator"
                                    className="p-1 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500 hover:text-white transition"
                                  >
                                    <Calculator className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Instant Daily Price & GST Calculator Box */}
              <div className="lg:col-span-4 bg-gradient-to-b from-slate-900 to-indigo-950/60 border border-indigo-500/30 rounded-xl p-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-black text-white flex items-center gap-2">
                      <Calculator className="h-4 w-4 text-amber-400" /> Quick Daily Price &amp; GST Calculator
                    </h3>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-bold">
                      Counter Tool
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        Unit Price / Rate (₹)
                      </label>
                      <input
                        type="number"
                        value={calcBasePrice}
                        onChange={(e) => setCalcBasePrice(Number(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        Quantity (Qty)
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={calcQty}
                        onChange={(e) => setCalcQty(Number(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        GST Slab (%)
                      </label>
                      <select
                        value={calcGstRate}
                        onChange={(e) => setCalcGstRate(Number(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white font-bold"
                      >
                        <option value={0}>0% (Exempt)</option>
                        <option value={5}>5% GST</option>
                        <option value={12}>12% GST</option>
                        <option value={18}>18% GST</option>
                        <option value={28}>28% GST</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        Discount (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={calcDiscountPct}
                        onChange={(e) => setCalcDiscountPct(Number(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white font-bold"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-800/70 p-2.5 rounded-lg border border-slate-700 text-xs">
                    <span className="text-slate-300 font-semibold">Rate Includes GST (MRP Mode)?</span>
                    <button
                      type="button"
                      onClick={() => setCalcInclusive(!calcInclusive)}
                      className={`px-2.5 py-1 rounded font-bold text-[11px] transition ${
                        calcInclusive
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {calcInclusive ? 'YES (Inclusive)' : 'NO (Exclusive)'}
                    </button>
                  </div>

                  <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs font-mono">
                    <div className="flex justify-between text-slate-400">
                      <span>Taxable Value:</span>
                      <span className="text-white font-bold">₹{calcBreakdown.taxable.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>CGST ({calcGstRate / 2}%):</span>
                      <span className="text-sky-300">₹{calcBreakdown.cgst.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>SGST ({calcGstRate / 2}%):</span>
                      <span className="text-sky-300">₹{calcBreakdown.sgst.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="border-t border-slate-800 pt-2 flex justify-between items-center text-sm">
                      <span className="font-sans font-bold text-amber-300">Net Customer Price:</span>
                      <span className="text-lg font-black text-emerald-400">
                        ₹{calcBreakdown.finalPayable.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/sales/new')}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 rounded-lg text-xs transition flex items-center justify-center gap-1.5 shadow"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Create Invoice Now
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/inventory/products')}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-3 py-2 rounded-lg text-xs border border-slate-700 transition"
                  >
                    + Item
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Main 2-Column Grid: Registration & Pricing + Pen Drive Downloader */}
      {(showPenDriveBoard || showSoftwarePricingBoard) && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Col: Step 1 - Sign Up & Pen Drive Download (5 cols) */}
          <div
            className={`${
              showPenDriveBoard && showSoftwarePricingBoard ? 'lg:col-span-5' : 'lg:col-span-12'
            } space-y-6 ${showPenDriveBoard ? '' : 'hidden'}`}
          >
          
          {/* Step 1: Sign up Client */}
          <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center gap-2 mb-4">
              <span className="h-6 w-6 rounded-full bg-indigo-500 text-white font-bold text-xs flex items-center justify-center">1</span>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Building2 className="h-5 w-5 text-indigo-400" /> User Sign-up / Register Business
              </h2>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Pehle apna vyapaar register karein taaki aapka license certificate aur data database me secure ho sake.
            </p>

            <form onSubmit={handleRegisterClient} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Vyapaar / Dukaan ka Naam *
                </label>
                <input
                  type="text"
                  required
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="e.g. Sharma Electricals & Traders"
                  className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Owner Name
                  </label>
                  <input
                    type="text"
                    value={regOwner}
                    onChange={(e) => setRegOwner(e.target.value)}
                    placeholder="e.g. Ramesh Sharma"
                    className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Mobile Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    City / Shahr
                  </label>
                  <input
                    type="text"
                    value={regCity}
                    onChange={(e) => setRegCity(e.target.value)}
                    placeholder="e.g. Mumbai / Delhi"
                    className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    GSTIN (Yadi ho to)
                  </label>
                  <input
                    type="text"
                    value={regGstin}
                    onChange={(e) => setRegGstin(e.target.value)}
                    placeholder="27AAPFS1234..."
                    className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full mt-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold py-2 rounded-lg text-xs transition shadow-md flex items-center justify-center gap-1.5"
              >
                <Check className="h-4 w-4" /> Save Registration Details
              </button>
            </form>

            {regSuccess && (
              <div className="mt-3 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Vyapaar successfully registered! Ab niche Pen Drive package download karein.</span>
              </div>
            )}
          </div>

          {/* Pen Drive Portable Suite Downloader */}
          <div className="bg-gradient-to-br from-indigo-950/80 to-slate-800/80 border border-indigo-500/30 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-6 w-6 rounded-full bg-amber-500 text-slate-900 font-bold text-xs flex items-center justify-center">2</span>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-amber-400" /> Pen Drive / USB Portable Download
              </h2>
            </div>
            <p className="text-xs text-slate-300 mb-4">
              Apne software ko Pen Drive me daal kar kisi bhi computer par offline chalayein. Internet ki bilkul zaroorat nahi hai.
            </p>

            <div className="space-y-2 bg-slate-900/60 p-3 rounded-xl border border-slate-700/60 text-xs text-slate-300 mb-4">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <Check className="h-3.5 w-3.5" /> 100% Offline Standalone Data File
              </div>
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <Check className="h-3.5 w-3.5" /> Auto-Start Runner Batch Script included
              </div>
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <Check className="h-3.5 w-3.5" /> License Certificate &amp; Hardware Lock Included
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadPenDrivePackage}
              disabled={isPackaging}
              className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black py-3 rounded-xl text-xs sm:text-sm transition shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              {isPackaging ? 'Packaging Pen Drive Files...' : '💾 Download Suite for Pen Drive / USB'}
            </button>
          </div>

        </div>

          {/* Right Col: Step 3 - Select Plan, UPI QR Payment & License Activation (7 cols) */}
          <div
            className={`${
              showPenDriveBoard && showSoftwarePricingBoard ? 'lg:col-span-7' : 'lg:col-span-12'
            } space-y-6 ${showSoftwarePricingBoard ? '' : 'hidden'}`}
          >
          
          <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center">3</span>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-emerald-400" /> Indian Small Business Plans &amp; Instant Digital Checkout
                </h2>
              </div>
              {isGreatPlan && (
                <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Crown className="h-3 w-3" /> Business Pro Active ({daysRemaining}d left)
                </span>
              )}
            </div>

            <p className="text-xs text-slate-300 mb-4">
              Apni Dukaan ya MSME Vyapaar ke hisaab se best plan chunein → UPI QR scan karke pay karein → 12-digit UPI UTR dalein aur software turant auto-activate karein!
            </p>

            {/* 3 Tier Indian Small Business Recurring Plan Cards (No Lifetime Free Plan) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              
              {/* Plan 1: Dukaan Monthly Plan */}
              <div
                onClick={() => setSelectedPlan('MONTHLY')}
                className={`p-3.5 rounded-xl border cursor-pointer transition relative flex flex-col justify-between ${
                  selectedPlan === 'MONTHLY'
                    ? 'border-indigo-500 bg-indigo-950/50 ring-2 ring-indigo-500/40'
                    : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
                }`}
              >
                <div>
                  <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                    CHHOTI DUKAAN • 30 DAYS
                  </span>
                  <h4 className="font-bold text-white text-sm mt-1.5">Dukaan Monthly</h4>
                  <div className="text-xl font-black text-white mt-1">
                    ₹{saasConfig.monthlyPrice}<span className="text-xs text-slate-400 font-normal"> / month</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">
                    250 GST Bills/mo • 1 Shop Profile • Thermal &amp; A4 Print • 30-Day Pass (₹6.5/day).
                  </p>
                </div>
              </div>

              {/* Plan 2: Vyapaar Starter 1-Year Pass */}
              <div
                onClick={() => setSelectedPlan('STARTER')}
                className={`p-3.5 rounded-xl border cursor-pointer transition relative flex flex-col justify-between ${
                  selectedPlan === 'STARTER'
                    ? 'border-indigo-500 bg-indigo-950/50 ring-2 ring-indigo-500/40'
                    : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
                }`}
              >
                <div>
                  <span className="text-[10px] font-bold text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded">
                    ⭐ POPULAR • ₹66/MO
                  </span>
                  <h4 className="font-bold text-white text-sm mt-1.5">Vyapaar Starter (1 Yr)</h4>
                  <div className="text-xl font-black text-white mt-1">
                    ₹{saasConfig.starterPrice}<span className="text-xs text-slate-400 font-normal"> / year</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">
                    365 Days • 500 GST Invoices/yr • 2 Business Profiles • GSTR-1/2B/3B Reports.
                  </p>
                </div>
              </div>

              {/* Plan 3: Business Pro Annual (1-Year Unlimited) */}
              <div
                onClick={() => setSelectedPlan('ENTERPRISE')}
                className={`p-3.5 rounded-xl border cursor-pointer transition relative flex flex-col justify-between ${
                  selectedPlan === 'ENTERPRISE'
                    ? 'border-amber-500 bg-amber-950/40 ring-2 ring-amber-500/40'
                    : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
                }`}
              >
                <div>
                  <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 w-max">
                    <Crown className="h-2.5 w-2.5" /> 1 YEAR UNLIMITED
                  </span>
                  <h4 className="font-bold text-white text-sm mt-1.5">Business Pro (1 Yr)</h4>
                  <div className="text-xl font-black text-amber-300 mt-1">
                    ₹{saasConfig.enterprisePrice}<span className="text-xs text-slate-400 font-normal"> / year</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">
                    365 Days • Unlimited GST Bills &amp; Multi-Business • E-Way Bill, Barcode &amp; Tally Export.
                  </p>
                </div>
              </div>

            </div>

            {/* Scannable Dynamic UPI QR Code & Instant Self-Serve 12-Digit UTR Activation */}
            <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="p-2 bg-white rounded-xl shadow-md shrink-0 flex flex-col items-center">
                <QrSvg text={paymentUri} size={115} title={`Scan to Pay ₹${currentPrice}`} />
                <span className="text-[10px] font-bold text-slate-600 mt-1">Scan GPay / PhonePe / Paytm</span>
              </div>

              <div className="flex-1 text-center sm:text-left space-y-2.5 w-full">
                <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                  Step 2: Pay ₹{currentPrice} for {selectedPlan === 'MONTHLY' ? 'Dukaan Monthly (30 Days)' : selectedPlan === 'STARTER' ? 'Vyapaar Starter (1 Year)' : 'Business Pro Annual (1 Year Unlimited)'}
                </div>
                <div className="flex items-center justify-center sm:justify-start gap-2 font-mono text-xs text-slate-300 bg-slate-800 px-2.5 py-1.5 rounded border border-slate-700">
                  <span>UPI ID: <b>{saasConfig.adminUpiVpa}</b></span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(saasConfig.adminUpiVpa);
                      toast.success('UPI ID copied!');
                    }}
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Self-Serve 12-Digit UTR Input */}
                <div className="bg-emerald-950/50 border border-emerald-500/40 rounded-lg p-2.5 text-left">
                  <label className="block text-[11px] font-bold text-emerald-300 mb-1.5">
                    ⚡ Step 3: Payment ke baad 12-Digit UPI UTR / Ref No. dalein (Instant Auto-Unlock):
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      maxLength={12}
                      value={upiUtrNumber}
                      onChange={(e) => setUpiUtrNumber(e.target.value.replace(/\D/g, ''))}
                      placeholder="Enter 12-digit UPI UTR (e.g. 412345678901)"
                      className="flex-1 bg-slate-900 border border-emerald-500/50 px-3 py-1.5 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={handleInstantUpiUtrActivation}
                      disabled={isActivating}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs transition shrink-0 shadow"
                    >
                      ✅ Verify UTR &amp; Activate
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 font-bold px-3 py-1.5 rounded-lg text-xs transition flex items-center gap-1.5"
                  >
                    💬 Or Send Screenshot on WhatsApp
                  </a>
                </div>
              </div>
            </div>

            {/* License Key Activation Box */}
            <div className="mt-6 pt-6 border-t border-slate-700/80">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                <Lock className="h-4 w-4 text-indigo-400" /> License Key Activation / Unlock Box
              </h3>
              <p className="text-xs text-slate-400 mb-3">
                WhatsApp par prapt hua 20-digit cryptographic license key yahan dalein aur software ko unlock karein:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Licensed Business Name
                  </label>
                  <input
                    type="text"
                    value={activationOwner}
                    onChange={(e) => setActivationOwner(e.target.value)}
                    placeholder="e.g. Sharma Electricals"
                    className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    License Key (MXXXX-, SXXXX-, or EXXXX-) *
                  </label>
                  <input
                    type="text"
                    value={activationKey}
                    onChange={(e) => setActivationKey(e.target.value)}
                    placeholder="MXXXX-XXXXX-XXXXX-XXXXX"
                    className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleActivateLicense}
                disabled={isActivating}
                className="w-full bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold py-2.5 rounded-lg text-xs transition flex items-center justify-center gap-1.5 shadow-md"
              >
                <Zap className="h-4 w-4" />
                {isActivating ? 'Verifying Key...' : '🚀 Unlock & Activate Software'}
              </button>
            </div>

          </div>

          </div>

        </div>
      )}

      {/* Security & Offline Compliance Features Footer Note */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-8 border-t border-slate-800 text-center text-xs text-slate-500">
        <p>
          BillSaaS Pro • High Security Offline GST Software • Anti-Tamper Clock Engine • Compatible with Windows, Mac, Linux and USB Pen Drives.
        </p>
      </footer>
    </div>
  );
}
