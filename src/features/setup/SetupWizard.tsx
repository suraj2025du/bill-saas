import { Briefcase, Building, Factory, Globe2, Landmark, Laptop, ShoppingBag, Sparkles, Store, Upload, Warehouse } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { PRESET_LABELS, defaultFeatures, defaultPrintSettings, newBusiness } from '../../core/factories';
import type { Business, BusinessPreset, Region } from '../../core/model';
import { makeSnapshot } from '../../core/schema';
import { buildSampleData } from '../../data/seed';
import { completeSetup, importSnapshot } from '../../store/actions';
import { replaceAll } from '../../store/store';
import { attempt, confirmDialog, toast } from '../../ui/feedback';
import { pickFile } from '../../ui/files';
import { Button, cx } from '../../ui/kit';
import { BusinessBasics } from '../settings/BusinessSettings';

const PRESET_ICONS: Record<BusinessPreset, ReactNode> = {
  RETAIL: <Store className="h-6 w-6" />,
  WHOLESALE: <Warehouse className="h-6 w-6" />,
  FREELANCER: <Laptop className="h-6 w-6" />,
  AGENCY: <Briefcase className="h-6 w-6" />,
  MANUFACTURING: <Factory className="h-6 w-6" />,
  GENERAL: <Building className="h-6 w-6" />,
};

const PRESET_NOTES: Record<BusinessPreset, string> = {
  RETAIL: 'Fast counter billing, barcode scan, thermal receipts, stock',
  WHOLESALE: 'Godowns, batches, dispatch details, Tally-style invoices, TDS/TCS',
  FREELANCER: 'Service invoices, multi-currency, recurring bills, TDS',
  AGENCY: 'Retainers, recurring invoices, multi-currency, TDS',
  MANUFACTURING: 'Inventory, godowns, batches, e-way bills, exports',
  GENERAL: 'A bit of everything; switch modules on or off later',
};

function Choice({ active, onClick, icon, title, note }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; note: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx('flex items-start gap-3 rounded-lg border p-4 text-left transition', active ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500' : 'border-slate-200 bg-white hover:border-brand-300')}
    >
      <span className={cx('rounded-md p-2', active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}>{icon}</span>
      <span>
        <span className="block font-semibold text-slate-800">{title}</span>
        <span className="block text-sm text-slate-600">{note}</span>
      </span>
    </button>
  );
}

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [region, setRegion] = useState<Region>('INDIA');
  const [biz, setBiz] = useState<Business>(() => newBusiness({ name: '', countryCode: 'IN', preset: 'GENERAL' }));
  const [busy, setBusy] = useState(false);

  const chooseRegion = (r: Region) => {
    setRegion(r);
    const countryCode = r === 'INTERNATIONAL' ? (biz.countryCode === 'IN' ? 'AE' : biz.countryCode) : 'IN';
    setBiz({ ...newBusiness({ name: biz.name, countryCode, preset: biz.preset }), id: biz.id });
  };
  const choosePreset = (preset: BusinessPreset) => setBiz((b) => ({ ...b, preset, features: defaultFeatures(preset), print: defaultPrintSettings(preset) }));

  const finish = async () => {
    setBusy(true);
    const features = region === 'BOTH' ? { ...biz.features, multiCurrency: true } : biz.features;
    await attempt(() => completeSetup({ ...biz, region, features }), `Welcome, ${biz.name}!`);
    setBusy(false);
  };

  const loadSample = async () => {
    if (!(await confirmDialog({ title: 'Explore with sample data?', message: 'A demo business with customers, products, invoices and purchases is created. You can add your own business later from Settings > Businesses, or restore a backup.', confirmLabel: 'Load sample data' }))) return;
    setBusy(true);
    await attempt(() => replaceAll(makeSnapshot(buildSampleData())), 'Sample data loaded');
    setBusy(false);
  };

  const restore = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const json: unknown = JSON.parse(await file.text());
      setBusy(true);
      await attempt(() => importSnapshot(json), 'Backup restored');
    } catch {
      toast.error('This is not a valid backup file.');
    } finally {
      setBusy(false);
    }
  };

  const canNext = step !== 2 || (biz.name.trim().length > 0 && (biz.countryCode !== 'IN' || !!biz.stateCode));
  return (
    <div className="min-h-full bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Landmark className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Free GST Billing</h1>
            <p className="text-sm text-slate-500">Billing, inventory and accounts. Free, offline, no sign-up.</p>
          </div>
        </div>
        <ol className="mb-6 flex gap-2 text-xs font-medium">
          {['Region', 'Business type', 'Details', 'Done'].map((s, i) => (
            <li key={s} className={cx('flex-1 rounded-full px-3 py-1 text-center', i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-brand-100 text-brand-800' : 'bg-slate-200 text-slate-600')}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
        <div className="card p-6">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Where do you do business?</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <Choice active={region === 'INDIA'} onClick={() => chooseRegion('INDIA')} icon={<Landmark className="h-6 w-6" />} title="India only" note="GST invoices, GSTR-1/3B, e-way bills" />
                <Choice active={region === 'INTERNATIONAL'} onClick={() => chooseRegion('INTERNATIONAL')} icon={<Globe2 className="h-6 w-6" />} title="Outside India" note="VAT / sales tax, local currency" />
                <Choice active={region === 'BOTH'} onClick={() => chooseRegion('BOTH')} icon={<ShoppingBag className="h-6 w-6" />} title="Both" note="Indian GST plus export billing in 22 currencies" />
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <Button icon={<Sparkles className="h-4 w-4" />} busy={busy} onClick={() => void loadSample()}>
                  Explore with sample data
                </Button>
                <Button icon={<Upload className="h-4 w-4" />} busy={busy} onClick={() => void restore()}>
                  Restore a backup file
                </Button>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">What kind of business is it?</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(PRESET_LABELS) as BusinessPreset[]).map((p) => (
                  <Choice key={p} active={biz.preset === p} onClick={() => choosePreset(p)} icon={PRESET_ICONS[p]} title={PRESET_LABELS[p]} note={PRESET_NOTES[p]} />
                ))}
              </div>
              <p className="text-xs text-slate-500">This only decides which modules and designs you see first; everything can be changed later in Settings.</p>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Your business details</h2>
              <BusinessBasics b={biz} onChange={setBiz} />
              <p className="text-xs text-slate-500">Bank accounts, UPI IDs, logo and signature can be added later in Settings &gt; Business profile.</p>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">All set</h2>
              <ul className="space-y-1 text-sm text-slate-700">
                <li>
                  <b>{biz.name}</b> {biz.gstin && `| ${biz.gstin}`}
                </li>
                <li>{PRESET_LABELS[biz.preset]}</li>
                <li>Invoice design: {biz.print.template.replace('_', ' ').toLowerCase()}</li>
                <li>Data is saved on this computer. Download a backup from Settings &gt; Backup &amp; restore once in a while.</li>
              </ul>
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <Button disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
            {step < 3 ? (
              <Button variant="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" busy={busy} onClick={() => void finish()}>
                Start billing
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
