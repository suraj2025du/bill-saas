import { Link } from 'react-router';
import { SETTINGS_SECTIONS } from '../../shell/nav';
import { useBusiness, useSettings } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Badge, PageHeader } from '../../ui/kit';
import { APP_VERSION } from '../../version';

export function SettingsHome() {
  const biz = useBusiness();
  const settings = useSettings();
  const adapter = useStore((s) => s.adapter);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Settings" subtitle={`${biz.name}${biz.gstin ? ` | ${biz.gstin}` : ''}`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_SECTIONS.map((s) => (
          <Link key={s.to} to={s.to} className="card block px-4 py-3 hover:border-brand-300 hover:shadow">
            <p className="font-medium text-slate-800">{s.label}</p>
            <p className="text-xs capitalize text-slate-500">{s.keywords}</p>
          </Link>
        ))}
      </div>
      <div className="card mt-6 space-y-1 px-4 py-3 text-sm text-slate-600">
        <p>
          <b>Free GST Billing</b> v{APP_VERSION} <Badge tone="green">Offline</Badge> {settings.pin && <Badge tone="brand">PIN on</Badge>}
        </p>
        <p>Storage: {adapter?.kind === 'server' ? `local server, ${adapter.location}` : 'this browser (IndexedDB)'}</p>
        <p>No sign-up, no tracking. Your data never leaves this computer unless you export it or turn on Google Drive backup.</p>
        <p className="text-xs text-slate-500">
          Tax rules built in: GST slabs from 22 Sep 2025, B2C (Large) limit Rs 1 lakh, GSTR-1 HSN B2B/B2C tables from May 2025, Income-tax Act 2025 from 1 Apr 2026 (TDS Form 140 / TCS Form 143), TCS u/s 206C(1H) only up to 31 Mar 2025.
        </p>
      </div>
    </div>
  );
}
