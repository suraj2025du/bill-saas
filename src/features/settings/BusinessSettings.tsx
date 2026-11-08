import { Building2, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { COUNTRIES, CURRENCIES } from '../../core/currency/countries';
import { PRESET_LABELS, defaultFeatures, defaultPrintSettings, newBusiness, newGodown } from '../../core/factories';
import { stateCodeFromGstin, validateGstin } from '../../core/gst/gstin';
import { SELECTABLE_STATES } from '../../core/gst/states';
import { newId } from '../../core/ids';
import type { BankAccount, Business, BusinessPreset, UpiAccount } from '../../core/model';
import { addBusiness, deleteBusiness, saveBusiness, saveGodown, switchBusiness } from '../../store/actions';
import { useBusiness, useSettings } from '../../store/hooks';
import { useStore } from '../../store/store';
import { attempt, confirmDialog, toast } from '../../ui/feedback';
import { imageToDataUrl, pickFile } from '../../ui/files';
import { Badge, Button, Card, Checkbox, Field, Modal, NumberInput, PageHeader, Select, TextInput, Textarea } from '../../ui/kit';

const STATES = SELECTABLE_STATES.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` }));

function BankDialog({ initial, onSave, onClose }: { initial: BankAccount; onSave: (b: BankAccount) => void; onClose: () => void }) {
  const [b, setB] = useState(initial);
  const set = (patch: Partial<BankAccount>) => setB((x) => ({ ...x, ...patch }));
  const ifscOk = !b.ifsc || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.ifsc);
  return (
    <Modal
      open
      onClose={onClose}
      title={initial.accountNumber ? 'Edit bank account' : 'Add bank account'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!b.accountNumber.trim() || !b.bankName.trim()) return toast.error('Bank name and account number are required.');
              if (!ifscOk) return toast.error('IFSC must be 11 characters like HDFC0001234.');
              onSave(b);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bank name">
          <TextInput value={b.bankName} onValue={(v) => set({ bankName: v })} autoFocus />
        </Field>
        <Field label="Label (e.g. Current A/c)">
          <TextInput value={b.label} onValue={(v) => set({ label: v })} />
        </Field>
        <Field label="Account holder name">
          <TextInput value={b.accountHolder} onValue={(v) => set({ accountHolder: v })} />
        </Field>
        <Field label="Account number">
          <TextInput value={b.accountNumber} onValue={(v) => set({ accountNumber: v.replace(/\s/g, '') })} />
        </Field>
        <Field label="IFSC" error={ifscOk ? undefined : 'Format: 4 letters, 0, 6 letters/digits'}>
          <TextInput value={b.ifsc} maxLength={11} onValue={(v) => set({ ifsc: v.toUpperCase() })} />
        </Field>
        <Field label="Branch">
          <TextInput value={b.branch} onValue={(v) => set({ branch: v })} />
        </Field>
        <Field label="SWIFT (for exports)">
          <TextInput value={b.swift} onValue={(v) => set({ swift: v.toUpperCase() })} />
        </Field>
        <Field label="Account type">
          <Select
            value={b.accountType}
            onValue={(v) => set({ accountType: v })}
            options={[
              { value: 'CURRENT', label: 'Current' },
              { value: 'SAVINGS', label: 'Savings' },
              { value: 'OD', label: 'Overdraft' },
              { value: 'CC', label: 'Cash credit' },
            ]}
          />
        </Field>
        <Field label="Opening balance (negative for overdraft)">
          <NumberInput value={b.openingBalance} onValue={(n) => set({ openingBalance: n })} />
        </Field>
        <Checkbox className="self-end" checked={b.isDefault} onValue={(v) => set({ isDefault: v })} label="Print this account by default" />
      </div>
    </Modal>
  );
}

function UpiDialog({ initial, onSave, onClose }: { initial: UpiAccount; onSave: (u: UpiAccount) => void; onClose: () => void }) {
  const [u, setU] = useState(initial);
  const ok = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(u.vpa.trim());
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="UPI ID"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={() => onSave({ ...u, vpa: u.vpa.trim() })}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="UPI ID (VPA)" error={u.vpa && !ok ? 'Looks like name@bank' : undefined}>
          <TextInput value={u.vpa} onValue={(v) => setU({ ...u, vpa: v })} placeholder="yourshop@okhdfcbank" autoFocus />
        </Field>
        <Field label="Payee name shown in UPI apps">
          <TextInput value={u.payeeName} onValue={(v) => setU({ ...u, payeeName: v })} />
        </Field>
        <Field label="Label">
          <TextInput value={u.label} onValue={(v) => setU({ ...u, label: v })} />
        </Field>
        <Checkbox checked={u.isDefault} onValue={(v) => setU({ ...u, isDefault: v })} label="Use on invoices by default" />
      </div>
    </Modal>
  );
}

export function BusinessProfile() {
  const current = useBusiness();
  const [b, setB] = useState<Business>(current);
  const [busy, setBusy] = useState(false);
  const [bank, setBank] = useState<BankAccount | null>(null);
  const [upi, setUpi] = useState<UpiAccount | null>(null);
  const set = (patch: Partial<Business>) => setB((x) => ({ ...x, ...patch }));
  const indian = b.countryCode === 'IN';
  const g = b.gstin ? validateGstin(b.gstin) : null;

  const image = async (field: 'logoDataUrl' | 'signatureDataUrl') => {
    const file = await pickFile('image/png,image/jpeg,image/webp,image/svg+xml');
    if (!file) return;
    try {
      set({ [field]: await imageToDataUrl(file, field === 'logoDataUrl' ? 500 : 400) } as Partial<Business>);
    } catch (e) {
      toast.fromError(e);
    }
  };

  const saveBank = (acc: BankAccount) => {
    const list = b.bankAccounts.some((x) => x.id === acc.id) ? b.bankAccounts.map((x) => (x.id === acc.id ? acc : x)) : [...b.bankAccounts, acc];
    set({ bankAccounts: acc.isDefault ? list.map((x) => ({ ...x, isDefault: x.id === acc.id })) : list });
    setBank(null);
  };
  const saveUpi = (u: UpiAccount) => {
    const list = b.upiAccounts.some((x) => x.id === u.id) ? b.upiAccounts.map((x) => (x.id === u.id ? u : x)) : [...b.upiAccounts, u];
    set({ upiAccounts: u.isDefault ? list.map((x) => ({ ...x, isDefault: x.id === u.id })) : list });
    setUpi(null);
  };

  const submit = async () => {
    setBusy(true);
    // Keep the saved copy, so saving this form again is not mistaken for an edit of an older version.
    await attempt(async () => setB(await saveBusiness(b)), 'Business saved');
    setBusy(false);
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        back="/settings"
        title="Business profile"
        actions={
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Save
          </Button>
        }
      />
      <div className="space-y-4">
        <Card title="Identity" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Business name (printed)">
            <TextInput value={b.name} onValue={(v) => set({ name: v })} />
          </Field>
          <Field label="Legal name (if different)">
            <TextInput value={b.legalName} onValue={(v) => set({ legalName: v })} />
          </Field>
          <Field label="Tagline">
            <TextInput value={b.tagline} onValue={(v) => set({ tagline: v })} />
          </Field>
          {indian && (
            <>
              <Field label="GST registration">
                <Select
                  value={b.gstRegistration}
                  onValue={(v) => set({ gstRegistration: v })}
                  options={[
                    { value: 'REGULAR', label: 'Regular' },
                    { value: 'COMPOSITION', label: 'Composition' },
                    { value: 'UNREGISTERED', label: 'Not registered' },
                  ]}
                />
              </Field>
              <Field label="GSTIN" error={g && !g.valid ? g.errors[0] : undefined} hint={g?.valid ? 'Valid. State and PAN taken from it.' : undefined}>
                <TextInput
                  value={b.gstin}
                  maxLength={15}
                  onValue={(v) => {
                    const gstin = v.toUpperCase().replace(/\s/g, '');
                    const check = validateGstin(gstin);
                    set(check.valid ? { gstin, pan: check.pan, stateCode: stateCodeFromGstin(gstin) } : { gstin });
                  }}
                />
              </Field>
              <Field label="PAN">
                <TextInput value={b.pan} maxLength={10} onValue={(v) => set({ pan: v.toUpperCase() })} />
              </Field>
              <Field label="TAN (for TDS)">
                <TextInput value={b.tan} maxLength={10} onValue={(v) => set({ tan: v.toUpperCase() })} />
              </Field>
            </>
          )}
          {!indian && (
            <Field label={`${COUNTRIES.find((c) => c.code === b.countryCode)?.taxIdLabel ?? 'Tax'} number`}>
              <TextInput value={b.tan} onValue={(v) => set({ tan: v })} />
            </Field>
          )}
          <Field label="Currency">
            <Select value={b.currency} onValue={(v) => set({ currency: v })} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))} />
          </Field>
        </Card>
        <Card title="Address & contact" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Address line 1" className="sm:col-span-2">
            <TextInput value={b.address1} onValue={(v) => set({ address1: v })} />
          </Field>
          <Field label="Address line 2">
            <TextInput value={b.address2} onValue={(v) => set({ address2: v })} />
          </Field>
          <Field label="City">
            <TextInput value={b.city} onValue={(v) => set({ city: v })} />
          </Field>
          <Field label="PIN code">
            <TextInput value={b.pincode} onValue={(v) => set({ pincode: v })} />
          </Field>
          {indian && (
            <Field label="State">
              <Select value={b.stateCode} placeholder="Select state" onValue={(v) => set({ stateCode: v })} options={STATES} />
            </Field>
          )}
          <Field label="Phone">
            <TextInput value={b.phone} onValue={(v) => set({ phone: v })} />
          </Field>
          <Field label="E-mail">
            <TextInput type="email" value={b.email} onValue={(v) => set({ email: v })} />
          </Field>
          <Field label="Website">
            <TextInput value={b.website} onValue={(v) => set({ website: v })} />
          </Field>
          <Field label="Google review link (feedback QR)" className="sm:col-span-2 lg:col-span-3">
            <TextInput value={b.googleReviewUrl} onValue={(v) => set({ googleReviewUrl: v.trim() })} placeholder="https://g.page/r/..." />
          </Field>
        </Card>
        <Card title="Logo & signature" bodyClassName="flex flex-wrap gap-6 p-4">
          {(['logoDataUrl', 'signatureDataUrl'] as const).map((f) => (
            <div key={f} className="space-y-2">
              <p className="label">{f === 'logoDataUrl' ? 'Logo' : 'Signature / stamp'}</p>
              <div className="flex h-24 w-48 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50">
                {b[f] ? <img src={b[f]} alt="" className="max-h-20 max-w-44 object-contain" /> : <Building2 className="h-8 w-8 text-slate-300" />}
              </div>
              <div className="flex gap-2">
                <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => void image(f)}>
                  Upload
                </Button>
                {b[f] && (
                  <Button size="sm" variant="ghost" onClick={() => set({ [f]: '' } as Partial<Business>)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
        <Card
          title="Bank accounts"
          actions={
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setBank({ id: newId('bank'), label: '', bankName: '', accountHolder: b.legalName || b.name, accountNumber: '', ifsc: '', branch: '', swift: '', accountType: 'CURRENT', openingBalance: 0, isDefault: b.bankAccounts.length === 0 })}>
              Add bank account
            </Button>
          }
        >
          {b.bankAccounts.length === 0 ? (
            <p className="text-sm text-slate-500">No bank accounts. Add one to print it on invoices and record bank payments.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {b.bankAccounts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-2">
                  <span className="flex-1">
                    <b>{a.bankName}</b> {a.label && `(${a.label})`} ...{a.accountNumber.slice(-4)} | {a.ifsc} {a.isDefault && <Badge tone="brand">Default</Badge>}
                  </span>
                  <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setBank(a)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove"
                    onClick={async () => {
                      const used = useStore.getState().data.receipts.some((r) => r.bankAccountId === a.id) || useStore.getState().data.expenses.some((e) => e.bankAccountId === a.id);
                      if (used) return toast.error('Payments use this account; it cannot be removed.');
                      if (await confirmDialog({ title: 'Remove this bank account?', danger: true, confirmLabel: 'Remove' })) set({ bankAccounts: b.bankAccounts.filter((x) => x.id !== a.id) });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="UPI IDs"
          actions={
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setUpi({ id: newId('upi'), vpa: '', payeeName: b.name, label: '', isDefault: b.upiAccounts.length === 0 })}>
              Add UPI ID
            </Button>
          }
        >
          {b.upiAccounts.length === 0 ? (
            <p className="text-sm text-slate-500">Add a UPI ID to print a scan-to-pay QR code with the exact amount.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {b.upiAccounts.map((u) => (
                <li key={u.id} className="flex items-center gap-2 py-2">
                  <span className="flex-1">
                    <b>{u.vpa}</b> {u.payeeName && `| ${u.payeeName}`} {u.isDefault && <Badge tone="brand">Default</Badge>}
                  </span>
                  <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setUpi(u)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => set({ upiAccounts: b.upiAccounts.filter((x) => x.id !== u.id) })}>
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Tax & year settings" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {indian && (
            <>
              <Field label="GSTR-1 / 3B filing">
                <Select
                  value={b.gstFiling}
                  onValue={(v) => set({ gstFiling: v })}
                  options={[
                    { value: 'MONTHLY', label: 'Monthly' },
                    { value: 'QUARTERLY', label: 'Quarterly (QRMP)' },
                  ]}
                />
              </Field>
              <Checkbox className="self-end" checked={b.turnoverAbove5Cr} onValue={(v) => set({ turnoverAbove5Cr: v })} label="Turnover above Rs 5 crore" hint="6-digit HSN needed on invoices" />
              <Checkbox className="self-end" checked={b.turnoverAbove10Cr} onValue={(v) => set({ turnoverAbove10Cr: v })} label="Turnover above Rs 10 crore" hint="194Q TDS on purchases applies" />
            </>
          )}
          <Field label="Financial year starts in">
            <Select
              value={String(b.fyStartMonth)}
              onValue={(v) => set({ fyStartMonth: Number(v) })}
              options={['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => ({ value: String(i + 1), label: m }))}
              disabled={indian}
            />
          </Field>
        </Card>
        <Card title="Default terms & declaration" bodyClassName="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Terms & conditions">
            <Textarea rows={4} value={b.terms} onValue={(v) => set({ terms: v })} />
          </Field>
          <Field label="Declaration">
            <Textarea rows={4} value={b.declaration} onValue={(v) => set({ declaration: v })} />
          </Field>
        </Card>
      </div>
      {bank && <BankDialog initial={bank} onSave={saveBank} onClose={() => setBank(null)} />}
      {upi && <UpiDialog initial={upi} onSave={saveUpi} onClose={() => setUpi(null)} />}
    </div>
  );
}

/** Small form shared by the setup wizard and "Add business". */
export function BusinessBasics({ b, onChange }: { b: Business; onChange: (b: Business) => void }) {
  const set = (patch: Partial<Business>) => onChange({ ...b, ...patch });
  const indian = b.countryCode === 'IN';
  const g = b.gstin ? validateGstin(b.gstin) : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Business name" className="sm:col-span-2">
        <TextInput value={b.name} onValue={(v) => set({ name: v })} autoFocus />
      </Field>
      <Field label="Country">
        <Select
          value={b.countryCode}
          onValue={(code) => {
            const c = COUNTRIES.find((x) => x.code === code);
            const fresh = newBusiness({ name: b.name, countryCode: code, preset: b.preset });
            onChange({ ...fresh, id: b.id, currency: c?.currency ?? b.currency });
          }}
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
        />
      </Field>
      <Field label="Type of business">
        <Select<BusinessPreset>
          value={b.preset}
          onValue={(preset) => onChange({ ...b, preset, features: defaultFeatures(preset), print: defaultPrintSettings(preset) })}
          options={(Object.keys(PRESET_LABELS) as BusinessPreset[]).map((p) => ({ value: p, label: PRESET_LABELS[p] }))}
        />
      </Field>
      {indian && (
        <>
          <Field label="GST registration">
            <Select
              value={b.gstRegistration}
              onValue={(v) => set({ gstRegistration: v })}
              options={[
                { value: 'REGULAR', label: 'Regular GST' },
                { value: 'COMPOSITION', label: 'Composition scheme' },
                { value: 'UNREGISTERED', label: 'Not registered' },
              ]}
            />
          </Field>
          {b.gstRegistration !== 'UNREGISTERED' && (
            <Field label="GSTIN" error={g && !g.valid ? g.errors[0] : undefined} hint={g?.valid ? 'Valid GSTIN' : 'State is read from the first two digits'}>
              <TextInput
                value={b.gstin}
                maxLength={15}
                onValue={(v) => {
                  const gstin = v.toUpperCase().replace(/\s/g, '');
                  const check = validateGstin(gstin);
                  set(check.valid ? { gstin, pan: check.pan, stateCode: stateCodeFromGstin(gstin) } : { gstin });
                }}
              />
            </Field>
          )}
          <Field label="State">
            <Select value={b.stateCode} placeholder="Select state" onValue={(v) => set({ stateCode: v })} options={STATES} />
          </Field>
        </>
      )}
      <Field label="City">
        <TextInput value={b.city} onValue={(v) => set({ city: v })} />
      </Field>
      <Field label="Address">
        <TextInput value={b.address1} onValue={(v) => set({ address1: v })} />
      </Field>
      <Field label="Phone">
        <TextInput value={b.phone} onValue={(v) => set({ phone: v })} />
      </Field>
    </div>
  );
}

export function BusinessesPage() {
  const current = useBusiness();
  const businesses = useStore((s) => s.data.businesses);
  const settings = useSettings();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Business | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!draft) return;
    setBusy(true);
    const ok = await attempt(async () => {
      await addBusiness(draft);
      if (draft.features.godowns) await saveGodown(newGodown(draft.id, 'Main godown', true));
    }, `${draft.name} added and opened`);
    setBusy(false);
    if (ok) {
      setDraft(null);
      navigate('/settings/business');
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        back="/settings"
        title="Businesses"
        subtitle="Each business has its own GSTIN, numbering, bank accounts and data"
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDraft(newBusiness({ name: '', countryCode: current.countryCode, preset: 'GENERAL' }))}>
            Add business
          </Button>
        }
      />
      <div className="card">
        <ul className="divide-y divide-slate-100">
          {businesses.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <p className="font-medium">
                  {b.name} {b.id === settings.activeBusinessId && <Badge tone="green">Open</Badge>}
                </p>
                <p className="text-xs text-slate-500">{[b.gstin, b.city, PRESET_LABELS[b.preset]].filter(Boolean).join(' | ')}</p>
              </div>
              {b.id !== settings.activeBusinessId && (
                <Button size="sm" icon={<Star className="h-3.5 w-3.5" />} onClick={() => void attempt(() => switchBusiness(b.id), `Opened ${b.name}`).then(() => navigate('/'))}>
                  Open
                </Button>
              )}
              {b.id !== settings.activeBusinessId && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Delete"
                  onClick={async () => {
                    if (await confirmDialog({ title: `Delete ${b.name}?`, message: 'Only a business without any records can be deleted.', danger: true, confirmLabel: 'Delete' })) await attempt(() => deleteBusiness(b.id), 'Deleted');
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {draft && (
        <Modal
          open
          onClose={() => setDraft(null)}
          title="Add business"
          footer={
            <>
              <Button onClick={() => setDraft(null)}>Cancel</Button>
              <Button variant="primary" busy={busy} onClick={() => void create()}>
                Create
              </Button>
            </>
          }
        >
          <BusinessBasics b={draft} onChange={setDraft} />
        </Modal>
      )}
    </div>
  );
}
