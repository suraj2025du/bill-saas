import { Lock } from 'lucide-react';
import { useState } from 'react';
import { verifyPin } from '../core/security/pin';
import { useBusinessOrNull, useSettings } from '../store/hooks';
import { setUnlocked } from '../store/store';
import { Button, Input } from '../ui/kit';

export function LockScreen({ overlay }: { overlay?: boolean }) {
  const settings = useSettings();
  const biz = useBusinessOrNull();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const [help, setHelp] = useState(false);

  const submit = async () => {
    if (!settings.pin || busy) return;
    setBusy(true);
    setError('');
    try {
      if (await verifyPin(pin, settings.pin)) {
        setUnlocked(true);
        return;
      }
      const n = tries + 1;
      setTries(n);
      setPin('');
      setError(n >= 5 ? 'Wrong PIN. Please wait a few seconds before trying again.' : 'Wrong PIN.');
      if (n >= 5) await new Promise((r) => setTimeout(r, 3000 * (n - 4)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={overlay ? "fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900 p-4" : "flex min-h-full items-center justify-center bg-slate-900 p-4"}>
      <form
        className="card w-full max-w-sm p-6 text-center"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">{biz?.name ?? 'Free GST Billing'}</h1>
        <p className="mb-4 text-sm text-slate-500">Enter your PIN to unlock</p>
        <Input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          aria-label="PIN"
          maxLength={8}
          className="text-center text-lg tracking-[0.5em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          invalid={!!error}
        />
        {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="mt-4 w-full" busy={busy} disabled={pin.length < 4}>
          Unlock
        </Button>
        <button type="button" className="mt-3 text-xs text-slate-500 hover:underline" onClick={() => setHelp((h) => !h)}>
          Forgot your PIN?
        </button>
        {help && (
          <p className="mt-2 text-left text-xs text-slate-600">
            The PIN cannot be recovered; it is stored only as a secure hash. If you use the desktop launcher, close the app, open
            <code className="mx-1 rounded bg-slate-100 px-1">_system/data/settings.json</code>
            and set <code className="rounded bg-slate-100 px-1">"pin": null</code>. In the browser, the only way is to clear this site's data and restore your latest backup file.
          </p>
        )}
      </form>
    </div>
  );
}
