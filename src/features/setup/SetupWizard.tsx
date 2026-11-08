import {
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  Lock,
  Printer,
  QrCode,
  Rocket,
  ShieldCheck,
  Sparkles,
  Store,
} from 'lucide-react';
import { useState } from 'react';
import { defaultFeatures, newBusiness } from '../../core/factories';
import { SELECTABLE_STATES } from '../../core/gst/states';
import type { Business, BusinessPreset } from '../../core/model';
import { makeSnapshot } from '../../core/schema';
import { registerTenant } from '../../core/tenants';
import { buildSampleData } from '../../data/seed';
import { completeSetup } from '../../store/actions';
import { replaceAll } from '../../store/store';
import { attempt, toast } from '../../ui/feedback';
import { Button, Card, Field, Select, TextInput } from '../../ui/kit';

export function SetupWizard() {
  const [activeTab, setActiveTab] = useState<'TRIAL' | 'DEMO'>('TRIAL');

  // Form State
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('09'); // Default: Uttar Pradesh
  const [gstin, setGstin] = useState('');
  const [preset, setPreset] = useState<BusinessPreset>('RETAIL');
  const [busy, setBusy] = useState(false);

  const handleStartTrial = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!shopName.trim()) {
      toast.error('Kripya apni Dukaan ya Company ka Naam likhein.');
      return;
    }
    if (!ownerName.trim()) {
      toast.error('Kripya apna Naam likhein.');
      return;
    }
    if (!phone.trim() || phone.replace(/\D/g, '').length < 10) {
      toast.error('Kripya 10-digit ka valid WhatsApp / Mobile Number likhein.');
      return;
    }

    setBusy(true);

    try {
      // 1. Capture customer lead into SaaS Tenant Registry
      registerTenant({
        shopName: shopName.trim(),
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        city: city.trim() || 'Local City',
        stateCode,
        gstin: gstin.trim().toUpperCase() || undefined,
      });

      // 2. Initialize the business in the local store
      const biz: Business = {
        ...newBusiness({
          name: shopName.trim(),
          countryCode: 'IN',
          preset,
        }),
        stateCode,
        gstin: gstin.trim().toUpperCase() || '',
        address1: city.trim() ? `${city.trim()}` : 'Main Road',
        address2: '',
        city: city.trim() || 'City',
        pincode: '',
        phone: phone.trim(),
        features: defaultFeatures(preset),
      };

      await attempt(
        () => completeSetup(biz),
        `Welcome to BillSaaS, ${ownerName.trim()}! Your 30-Day Free Trial is now active.`
      );
    } catch {
      toast.error('Setup complete karne me dikkat aayi. Kripya dobara try karein.');
    } finally {
      setBusy(false);
    }
  };

  const handleLoadDemo = async () => {
    setBusy(true);
    try {
      registerTenant({
        shopName: 'Demo Supermarket & Retailers',
        ownerName: 'Guest Explorer',
        phone: '9999999999',
        city: 'Delhi',
        stateCode: '07',
      });
      await attempt(
        () => replaceAll(makeSnapshot(buildSampleData())),
        'Live Demo Data Loaded! You can now explore all invoices, products, and reports.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-slate-100 flex flex-col justify-between py-8 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto w-full">
        {/* Top Branding Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full text-xs font-semibold mb-3">
            <Sparkles className="w-3.5 h-3.5" /> India&apos;s Smart GST Billing &amp; Invoicing Platform
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-2">
            BillSaaS <span className="text-indigo-400">Pro</span>
          </h1>
          <p className="text-slate-300 max-w-xl mx-auto text-sm sm:text-base">
            Professional GST Invoices, Thermal Printing, E-Way Bills &amp; Inventory Management for Traders, Retailers &amp; Wholesalers.
          </p>

          {/* Feature Highlights Pills */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-4 text-xs text-slate-300">
            <span className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> GST Compliant (GSTR-1/3B)
            </span>
            <span className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700">
              <Printer className="w-3.5 h-3.5 text-indigo-400" /> A4 &amp; 2-3&quot; Thermal Print
            </span>
            <span className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700">
              <QrCode className="w-3.5 h-3.5 text-amber-400" /> UPI QR on Invoices
            </span>
            <span className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" /> 100% Secure &amp; Fast
            </span>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex justify-center mb-6">
          <div className="bg-slate-800/90 p-1 rounded-xl border border-slate-700 flex max-w-md w-full">
            <button
              type="button"
              onClick={() => setActiveTab('TRIAL')}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${
                activeTab === 'TRIAL'
                  ? 'bg-indigo-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Rocket className="w-4 h-4" /> Start 30-Day Free Trial
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DEMO')}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${
                activeTab === 'DEMO'
                  ? 'bg-indigo-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" /> 1-Click Live Demo
            </button>
          </div>
        </div>

        {/* Tab 1: Free Trial Registration Form */}
        {activeTab === 'TRIAL' && (
          <Card className="bg-slate-800/90 border border-slate-700 shadow-2xl p-6 sm:p-8 rounded-2xl">
            <div className="mb-6 border-b border-slate-700 pb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Store className="w-5 h-5 text-indigo-400" />
                Dukaan / Business Details
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Apni dukaan ki details bharein aur turant billing shuru karein. Koi credit card nahi chahiye!
              </p>
            </div>

            <form onSubmit={(e) => { void handleStartTrial(e); }} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Shop / Business Name (Dukaan ka Naam) *" hint="Jaise: Sharma General Store">
                  <TextInput
                    value={shopName}
                    onValue={setShopName}
                    placeholder="Enter Shop or Company Name"
                    className="bg-slate-900 border-slate-700 text-white placeholder-slate-500"
                    required
                  />
                </Field>

                <Field label="Owner / Your Name (Aapka Naam) *" hint="Jaise: Rahul Sharma">
                  <TextInput
                    value={ownerName}
                    onValue={setOwnerName}
                    placeholder="Enter Your Full Name"
                    className="bg-slate-900 border-slate-700 text-white placeholder-slate-500"
                    required
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Mobile / WhatsApp Number *" hint="Updates aur Bill share karne ke liye">
                  <TextInput
                    value={phone}
                    onValue={setPhone}
                    placeholder="10-digit mobile number"
                    type="tel"
                    className="bg-slate-900 border-slate-700 text-white placeholder-slate-500"
                    required
                  />
                </Field>

                <Field label="City / Town (Shehar)">
                  <TextInput
                    value={city}
                    onValue={setCity}
                    placeholder="e.g. Kanpur, Surat, Delhi"
                    className="bg-slate-900 border-slate-700 text-white placeholder-slate-500"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="State (GST State Code) *" hint="Tax calculation ke liye zaroori">
                  <Select
                    value={stateCode}
                    onValue={setStateCode}
                    options={SELECTABLE_STATES.map((s) => ({
                      value: s.code,
                      label: `${s.code} - ${s.name}`,
                    }))}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </Field>

                <Field label="GSTIN (Optional)" hint="Agar GST number hai to yahan likhein">
                  <TextInput
                    value={gstin}
                    onValue={(v) => {
                      const clean = v.toUpperCase();
                      setGstin(clean);
                      if (clean.length >= 2) {
                        const code = clean.slice(0, 2);
                        if (SELECTABLE_STATES.some((s) => s.code === code)) {
                          setStateCode(code);
                        }
                      }
                    }}
                    placeholder="e.g. 09ABCDE1234F1Z5"
                    className="bg-slate-900 border-slate-700 text-white placeholder-slate-500"
                  />
                </Field>
              </div>

              <div className="pt-2">
                <Field label="Business Type">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { key: 'RETAIL', label: 'Retail Store' },
                      { key: 'WHOLESALE', label: 'Wholesale & B2B' },
                      { key: 'FREELANCER', label: 'Services / Agency' },
                      { key: 'GENERAL', label: 'General Trader' },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setPreset(item.key as BusinessPreset)}
                        className={`p-2.5 rounded-lg border text-xs font-semibold text-center transition \${
                          preset === item.key
                            ? 'border-indigo-500 bg-indigo-600/30 text-white font-bold'
                            : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <div className="pt-4">
                <Button
                  type="submit"
                  disabled={busy}
                  className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2"
                >
                  <Rocket className="w-5 h-5" />
                  {busy ? 'Account Create Ho Raha Hai...' : '🚀 Start 30-Day Free Trial (Instant Access)'}
                </Button>
                <p className="text-center text-xs text-slate-400 mt-2">
                  Instant Access • 50 Free Invoices • Full Accounting &amp; GST Features Included
                </p>
              </div>
            </form>
          </Card>
        )}

        {/* Tab 2: 1-Click Live Demo */}
        {activeTab === 'DEMO' && (
          <Card className="bg-slate-800/90 border border-slate-700 shadow-2xl p-6 sm:p-8 rounded-2xl text-center">
            <div className="w-16 h-16 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-indigo-500/30">
              <Building2 className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Explore Live Demo Store (Instant Access)
            </h2>
            <p className="text-slate-300 text-sm max-w-lg mx-auto mb-6">
              Bina koi form bhare, turant ready-made data ke sath software chala kar dekhein. Demo store me:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto mb-8 text-left text-xs text-slate-300">
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700">
                <span className="font-bold text-white block mb-0.5">🧾 10+ Invoices</span>
                GST Invoices, Proforma &amp; Delivery Challans
              </div>
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700">
                <span className="font-bold text-white block mb-0.5">📦 15+ Products</span>
                Items with Barcodes, HSN Codes &amp; Stock
              </div>
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700">
                <span className="font-bold text-white block mb-0.5">👥 10+ Customers</span>
                Ledgers, Outstanding Balances &amp; GSTIN
              </div>
            </div>

            <Button
              disabled={busy}
              onClick={() => { void handleLoadDemo(); }}
              className="w-full max-w-md mx-auto bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              {busy ? 'Demo Data Load Ho Raha Hai...' : '⚡ Explore Live Demo Now (No Sign Up)'}
            </Button>
          </Card>
        )}
      </div>

      {/* Footer Navigation with Super Admin Portal */}
      <footer className="mt-8 border-t border-slate-800 pt-4 text-center text-xs text-slate-500 flex flex-wrap items-center justify-between max-w-4xl mx-auto w-full">
        <div>&copy; {new Date().getFullYear()} BillSaaS Pro. Made for Indian Businesses.</div>
        <div className="flex items-center gap-4 mt-2 sm:mt-0">
          <a
            href="#/settings/super-admin"
            className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold transition"
          >
            <Lock className="w-3.5 h-3.5" />
            👑 Super Admin Portal
          </a>
        </div>
      </footer>
    </div>
  );
}
