import { useState } from 'react';
import { UQC_CODES, allUnits, normalizeUnitCode } from '../../core/gst/units';
import type { UnitDef } from '../../core/model';
import { addCustomUnit } from '../../store/actions';
import { useSettings } from '../../store/hooks';
import { toast } from '../../ui/feedback';
import { Button, Field, Modal, NumberInput, Select, TextInput } from '../../ui/kit';

const ADD_UNIT = '__add_unit__';
const UQC_OPTIONS = UQC_CODES.map((u) => ({ value: u.code, label: `${u.code} - ${u.name}` }));
const byCode = (u: UnitDef) => u.code;

/**
 * "Add a custom unit" form (e.g. Carat, Bundle, Session): name, short code, decimals and the
 * GST UQC the unit is reported under in the GSTR-1 HSN summary.
 */
export function AddUnitDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded?: (unit: UnitDef) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [uqc, setUqc] = useState('OTH');
  const [decimals, setDecimals] = useState(2);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setName('');
    setCode('');
    setUqc('OTH');
    setDecimals(2);
    onClose();
  };
  const save = async () => {
    setBusy(true);
    try {
      const unit = await addCustomUnit({ name, code, uqc, decimals });
      toast.success(`Unit ${unit.code} added`);
      onAdded?.(unit);
      close();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a custom unit"
      size="sm"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Add unit
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Unit name" className="sm:col-span-2">
          <TextInput autoFocus value={name} onValue={setName} placeholder="e.g. Carat, Bundle, Session" />
        </Field>
        <Field label="Short code">
          <TextInput value={code} maxLength={8} onValue={(v) => setCode(v.toUpperCase())} placeholder={normalizeUnitCode(name) || 'CT'} />
        </Field>
        <Field label="Decimals in quantity">
          <NumberInput value={decimals} onValue={(n) => setDecimals(Math.min(4, Math.max(0, Math.round(n))))} />
        </Field>
        <Field label="GST UQC (GSTR-1 HSN summary)" className="sm:col-span-2">
          <Select value={uqc} onValue={setUqc} options={UQC_OPTIONS} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">Pick OTH (others) when no UQC fits. Service lines (SAC codes) are always reported as NA.</p>
    </Modal>
  );
}

/**
 * Unit picker for invoice, purchase and product lines. Its last option, "+ Add custom unit...",
 * opens AddUnitDialog and selects the new unit when it is saved.
 */
export function UnitSelect({
  value,
  onValue,
  format = byCode,
  className,
  ariaLabel,
}: {
  value: string;
  onValue: (code: string) => void;
  format?: (u: UnitDef) => string;
  className?: string;
  ariaLabel?: string;
}) {
  const settings = useSettings();
  const [adding, setAdding] = useState(false);
  const units = allUnits(settings.customUnits);
  const options = units.map((u) => ({ value: u.code, label: format(u) }));
  // A unit deleted from Settings still shows on old records.
  if (value && !units.some((u) => u.code === value)) options.unshift({ value, label: value });
  options.push({ value: ADD_UNIT, label: '+ Add custom unit...' });
  return (
    <>
      <Select className={className} aria-label={ariaLabel} value={value} options={options} onValue={(v) => (v === ADD_UNIT ? setAdding(true) : onValue(v))} />
      <AddUnitDialog open={adding} onClose={() => setAdding(false)} onAdded={(u) => onValue(u.code)} />
    </>
  );
}
