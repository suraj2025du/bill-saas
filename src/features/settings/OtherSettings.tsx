import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { todayISO } from '../../core/dates';
import { DOC_TYPES, DOC_TYPE_LIST } from '../../core/docs/docTypes';
import { DOC_NUMBER_MAX, previewNumber } from '../../core/docs/numbering';
import { PRESET_LABELS, defaultFeatures } from '../../core/factories';
import { BUILT_IN_UNITS, UQC_CODES, normalizeUnitCode } from '../../core/gst/units';
import type { BusinessPreset, FeatureFlags, NumberSeries, SeriesKey } from '../../core/model';
import { hashPin, isValidPinFormat, verifyPin } from '../../core/security/pin';
import { addCustomUnit, saveBusiness, saveCustomUnits, updateSettings } from '../../store/actions';
import { useBusiness, useSettings } from '../../store/hooks';
import { useStore } from '../../store/store';
import { attempt, confirmDialog, toast } from '../../ui/feedback';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, NumberInput, PageHeader, Select, TextInput } from '../../ui/kit';

const EXTRA_KEYS: { key: SeriesKey; label: string }[] = [
  { key: 'RECEIPT', label: 'Payment receipt' },
  { key: 'PAYMENT', label: 'Payment made' },
  { key: 'VOUCHER_PAYMENT', label: 'Payment voucher' },
  { key: 'VOUCHER_RECEIPT', label: 'Receipt voucher' },
  { key: 'VOUCHER_CONTRA', label: 'Contra voucher' },
  { key: 'VOUCHER_JOURNAL', label: 'Journal voucher' },
];

export function NumberingPage() {
  const biz = useBusiness();
  const [series, setSeries] = useState(biz.series);
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  const rows = [...DOC_TYPE_LIST.map((t) => ({ key: t as SeriesKey, label: DOC_TYPES[t].label })), ...EXTRA_KEYS];
  const set = (key: SeriesKey, patch: Partial<NumberSeries>) => setSeries((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  const tooLong = rows.filter((r) => previewNumber(series[r.key], today, biz.fyStartMonth).length > DOC_NUMBER_MAX);
  return (
    <div className="max-w-5xl">
      <PageHeader
        back="/settings"
        title="Invoice numbering"
        subtitle={`Numbers can be at most ${DOC_NUMBER_MAX} characters (GST rule 46)`}
        actions={
          <Button
            variant="primary"
            busy={busy}
            disabled={tooLong.length > 0}
            onClick={async () => {
              setBusy(true);
              await attempt(() => saveBusiness({ ...biz, series }), 'Numbering saved');
              setBusy(false);
            }}
          >
            Save
          </Button>
        }
      />
      {tooLong.length > 0 && <Alert tone="red">Too long: {tooLong.map((r) => r.label).join(', ')}. Shorten the prefix or padding.</Alert>}
      <div className="card mt-3 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Prefix</th>
              <th>FY in number</th>
              <th>Digits</th>
              <th>Suffix</th>
              <th>Next no.</th>
              <th>Restart each FY</th>
              <th>Next number looks like</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = series[r.key];
              const sample = previewNumber(s, today, biz.fyStartMonth);
              return (
                <tr key={r.key}>
                  <td className="font-medium">{r.label}</td>
                  <td>
                    <Input className="w-24 py-1" value={s.prefix} maxLength={8} onChange={(e) => set(r.key, { prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, '') })} aria-label={`${r.label} prefix`} />
                  </td>
                  <td>
                    <input type="checkbox" checked={s.includeFY} onChange={(e) => set(r.key, { includeFY: e.target.checked })} aria-label="Include FY" />
                  </td>
                  <td>
                    <NumberInput className="w-16 py-1" value={s.padding} onValue={(n) => set(r.key, { padding: Math.min(8, Math.max(1, Math.round(n))) })} aria-label="Digits" />
                  </td>
                  <td>
                    <Input className="w-16 py-1" value={s.suffix} maxLength={4} onChange={(e) => set(r.key, { suffix: e.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, '') })} aria-label="Suffix" />
                  </td>
                  <td>
                    <NumberInput className="w-20 py-1" value={s.nextNumber} onValue={(n) => set(r.key, { nextNumber: Math.max(1, Math.round(n)) })} aria-label="Next number" />
                  </td>
                  <td>
                    <input type="checkbox" checked={s.resetEachFY} onChange={(e) => set(r.key, { resetEachFY: e.target.checked })} aria-label="Reset each FY" />
                  </td>
                  <td className={sample.length > DOC_NUMBER_MAX ? 'font-mono text-red-600' : 'font-mono'}>
                    {sample} <span className="text-xs text-slate-500">({sample.length})</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">If a number is already used, the next free one is taken automatically.</p>
    </div>
  );
}

export function UnitsPage() {
  const settings = useSettings();
  const products = useStore((s) => s.data.products);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [uqc, setUqc] = useState('OTH');
  const [decimals, setDecimals] = useState(2);
  const add = async () => {
    if (await attempt(() => addCustomUnit({ name, code, uqc, decimals }), 'Unit added')) {
      setName('');
      setCode('');
    }
  };
  return (
    <div className="max-w-4xl">
      <PageHeader back="/settings" title="Units of measurement" subtitle="Each unit maps to a GST UQC for the GSTR-1 HSN summary" />
      <Card title="Add a custom unit" bodyClassName="grid gap-3 p-4 sm:grid-cols-5">
        <Field label="Name" className="sm:col-span-2">
          <TextInput value={name} onValue={setName} placeholder="e.g. Carat" />
        </Field>
        <Field label="Code">
          <TextInput value={code} maxLength={8} onValue={(v) => setCode(v.toUpperCase())} placeholder={normalizeUnitCode(name) || 'CT'} />
        </Field>
        <Field label="GST UQC">
          <Select value={uqc} onValue={setUqc} options={UQC_CODES.map((u) => ({ value: u.code, label: `${u.code} - ${u.name}` }))} />
        </Field>
        <Field label="Decimals">
          <NumberInput value={decimals} onValue={(n) => setDecimals(Math.min(4, Math.max(0, Math.round(n))))} />
        </Field>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} className="sm:col-span-5 sm:justify-self-start" onClick={() => void add()}>
          Add unit
        </Button>
      </Card>
      <div className="card mt-4 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>UQC</th>
              <th>Decimals</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...settings.customUnits, ...BUILT_IN_UNITS].map((u) => (
              <tr key={u.code}>
                <td className="font-mono">{u.code}</td>
                <td>
                  {u.name} {u.custom && <Badge tone="brand">custom</Badge>}
                </td>
                <td className="font-mono">{u.uqc}</td>
                <td>{u.decimals}</td>
                <td className="text-right">
                  {u.custom && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={async () => {
                        if (products.some((p) => p.unit === u.code)) return toast.error('Products use this unit.');
                        if (await confirmDialog({ title: `Delete unit ${u.code}?`, danger: true, confirmLabel: 'Delete' })) await attempt(() => saveCustomUnits(settings.customUnits.filter((x) => x.code !== u.code)), 'Deleted');
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FEATURE_LABELS: Record<keyof FeatureFlags, [string, string]> = {
  inventory: ['Inventory & stock', 'Products, stock levels, valuation'],
  godowns: ['Godowns / warehouses', 'Pick a location per item line'],
  batches: ['Batch numbers & expiry', 'For pharma, food and similar goods'],
  dispatch: ['Dispatch & transport details', 'For Tally-style print and E-Way Bill'],
  tdsTcs: ['TDS / TCS', 'On invoices, bills and expenses'],
  multiCurrency: ['Multi-currency billing', 'Invoice in 22 currencies'],
  recurring: ['Recurring invoices', 'Weekly / monthly / quarterly / yearly'],
  posMode: ['POS mode', 'Barcode scan box; thermal print by default'],
};

export function FeaturesPage() {
  const biz = useBusiness();
  const [f, setF] = useState(biz.features);
  const [preset, setPreset] = useState<BusinessPreset>(biz.preset);
  return (
    <div className="max-w-3xl">
      <PageHeader
        back="/settings"
        title="Features"
        subtitle="Show only what your business needs"
        actions={
          <Button variant="primary" onClick={() => void attempt(() => saveBusiness({ ...biz, preset, features: f }), 'Features saved')}>
            Save
          </Button>
        }
      />
      <Card title="Business type" bodyClassName="flex flex-wrap items-end gap-3 p-4">
        <Field label="Preset">
          <Select<BusinessPreset> value={preset} onValue={setPreset} options={(Object.keys(PRESET_LABELS) as BusinessPreset[]).map((p) => ({ value: p, label: PRESET_LABELS[p] }))} />
        </Field>
        <Button onClick={() => setF(defaultFeatures(preset))}>Apply preset features</Button>
      </Card>
      <Card title="Modules" className="mt-4" bodyClassName="grid gap-3 p-4 sm:grid-cols-2">
        {(Object.keys(FEATURE_LABELS) as (keyof FeatureFlags)[]).map((k) => (
          <Checkbox key={k} checked={f[k]} onValue={(v) => setF({ ...f, [k]: v })} label={FEATURE_LABELS[k][0]} hint={FEATURE_LABELS[k][1]} />
        ))}
      </Card>
    </div>
  );
}

export function SecurityPage() {
  const settings = useSettings();
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const has = !!settings.pin;

  const save = async () => {
    if (has && !(await verifyPin(current, settings.pin!))) return toast.error('Current PIN is wrong.');
    if (!isValidPinFormat(pin)) return toast.error('PIN must be 4 to 8 digits.');
    if (pin !== again) return toast.error('The two PINs do not match.');
    setBusy(true);
    const ok = await attempt(async () => updateSettings({ pin: await hashPin(pin) }), has ? 'PIN changed' : 'PIN set. The app will ask for it on start.');
    setBusy(false);
    if (ok) {
      setCurrent('');
      setPin('');
      setAgain('');
    }
  };
  const remove = async () => {
    if (!(await verifyPin(current, settings.pin!))) return toast.error('Enter your current PIN to remove it.');
    await attempt(() => updateSettings({ pin: null }), 'PIN removed');
    setCurrent('');
  };
  const pinInput = (value: string, onValue: (v: string) => void, label: string) => (
    <Field label={label}>
      <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={value} onChange={(e) => onValue(e.target.value.replace(/\D/g, ''))} />
    </Field>
  );
  return (
    <div className="max-w-xl">
      <PageHeader back="/settings" title="PIN lock" subtitle="Protect the app on a shared computer" />
      <Card title={has ? 'Change PIN' : 'Set a PIN'} bodyClassName="grid gap-3 p-4">
        {has && pinInput(current, setCurrent, 'Current PIN')}
        {pinInput(pin, setPin, 'New PIN (4-8 digits)')}
        {pinInput(again, setAgain, 'Repeat new PIN')}
        <div className="flex gap-2">
          <Button variant="primary" icon={<KeyRound className="h-4 w-4" />} busy={busy} onClick={() => void save()}>
            {has ? 'Change PIN' : 'Set PIN'}
          </Button>
          {has && (
            <Button variant="danger" onClick={() => void remove()}>
              Remove PIN
            </Button>
          )}
        </div>
      </Card>
      {has && (
        <Card title="Auto-lock" className="mt-4" bodyClassName="p-4">
          <Field label="Lock after inactivity">
            <Select
              value={String(settings.autoLockMinutes)}
              onValue={(v) => void attempt(() => updateSettings({ autoLockMinutes: Number(v) }), 'Saved')}
              options={[
                { value: '0', label: 'Never' },
                { value: '2', label: '2 minutes' },
                { value: '5', label: '5 minutes' },
                { value: '15', label: '15 minutes' },
                { value: '30', label: '30 minutes' },
                { value: '60', label: '1 hour' },
              ]}
            />
          </Field>
        </Card>
      )}
      <p className="mt-3 text-xs text-slate-500">The PIN is stored only as a salted PBKDF2 hash. It keeps people at this computer out of the app; it does not encrypt the data files.</p>
    </div>
  );
}
