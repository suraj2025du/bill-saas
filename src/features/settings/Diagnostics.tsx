import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ERROR_SOURCE_LABELS } from '../../core/diagnostics';
import { COLLECTIONS } from '../../core/model';
import type { CollectionName } from '../../core/model';
import { makeSnapshot, validateSnapshot } from '../../core/schema';
import { lastExportDate } from '../../shell/appState';
import { clearErrors, markErrorsSeen, useErrorLog } from '../../store/errorLog';
import { useSettings } from '../../store/hooks';
import { useStore } from '../../store/store';
import { confirmDialog } from '../../ui/feedback';
import { downloadJson } from '../../ui/files';
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from '../../ui/kit';
import { APP_VERSION } from '../../version';

const COLLECTION_LABELS: Record<CollectionName, string> = {
  businesses: 'Businesses',
  clients: 'Customers & suppliers',
  products: 'Products',
  godowns: 'Godowns',
  invoices: 'Sales documents',
  purchases: 'Purchase bills',
  expenses: 'Expenses',
  receipts: 'Payments',
  vouchers: 'Vouchers',
  ledgers: 'Ledgers',
  settings: 'Settings',
  trash: 'Trash bin',
};

const when = (iso: string) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');
const yes = (v: boolean) => (v ? 'Yes' : 'No');

/** Settings > Diagnostics: what this copy is, a data integrity check and the local error log. */
export function DiagnosticsPage() {
  const settings = useSettings();
  const adapter = useStore((s) => s.adapter);
  const data = useStore((s) => s.data);
  const log = useErrorLog((s) => s.log);
  const [check, setCheck] = useState<{ ok: boolean; problems: string[] } | null>(null);

  useEffect(() => markErrorsSeen(), [log]);

  const counts = useMemo(() => COLLECTIONS.map((c) => ({ c, n: data[c].length })), [data]);
  const total = counts.reduce((s, x) => s + x.n, 0);
  const env = {
    storage: adapter ? (adapter.kind === 'server' ? `Local server, data in ${adapter.location}` : 'This browser (IndexedDB)') : 'Not open',
    browser: navigator.userAgent,
    online: navigator.onLine,
    installedAsApp: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    worksOffline: !!navigator.serviceWorker?.controller,
    lastAutomaticBackup: settings.lastAutoBackup,
    lastDownloadedBackup: lastExportDate(),
    lastDriveBackup: settings.drive.lastBackupAt,
  };

  const runCheck = () => {
    const r = validateSnapshot(makeSnapshot(data));
    setCheck(r.ok ? { ok: true, problems: [] } : { ok: false, problems: r.errors });
  };

  const download = () =>
    downloadJson(
      {
        app: 'free-gst-billing',
        version: APP_VERSION,
        generatedAt: new Date().toISOString(),
        note: 'Contains no business records: only record counts, settings dates and the error log.',
        environment: env,
        records: Object.fromEntries(counts.map((x) => [x.c, x.n])),
        errors: log,
      },
      `Free GST Billing diagnostics ${new Date().toISOString().slice(0, 10)}.json`,
    );

  const rows: [string, string][] = [
    ['Version', APP_VERSION],
    ['Storage', env.storage],
    ['Installed as an app', yes(env.installedAsApp)],
    ['Ready to work offline', yes(env.worksOffline)],
    ['Internet connection now', yes(env.online)],
    ['Last automatic backup', env.lastAutomaticBackup || 'Never'],
    ['Last backup file downloaded', env.lastDownloadedBackup || 'Never'],
    ['Last Google Drive backup', when(env.lastDriveBackup)],
  ];

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        back="/settings"
        title="Diagnostics"
        subtitle="Version, storage, a data check and the problems recorded on this computer"
        actions={
          <Button icon={<Download className="h-4 w-4" />} onClick={download}>
            Download diagnostics
          </Button>
        }
      />
      <Card title="This copy of the app" bodyClassName="p-0">
        <table className="data-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row" className="w-64 font-medium">
                  {k}
                </th>
                <td className="break-all">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Data check"
        actions={
          <Button size="sm" icon={<ShieldCheck className="h-4 w-4" />} onClick={runCheck}>
            Check my data
          </Button>
        }
        bodyClassName="space-y-3 p-4"
      >
        <p className="text-sm text-slate-600">Runs the same integrity check as a restore: every record against its schema, duplicate ids and links between records.</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {counts.map((x) => (
            <p key={x.c} className="flex justify-between gap-2">
              <span className="text-slate-600">{COLLECTION_LABELS[x.c]}</span>
              <span className="font-medium tabular-nums">{x.n}</span>
            </p>
          ))}
        </div>
        {check &&
          (check.ok ? (
            <Alert tone="green" title={`All ${total} records passed the integrity check.`} />
          ) : (
            <Alert tone="red" title={`${check.problems.length} problem(s) found. Restore a recent backup or send the diagnostics file for help.`}>
              <ul className="list-disc pl-5">
                {check.problems.slice(0, 20).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          ))}
      </Card>

      <Card
        title="Problems recorded on this computer"
        actions={
          log.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={async () => {
                if (await confirmDialog({ title: 'Clear the problem log?', message: 'Only the log is cleared; your data is not touched.', confirmLabel: 'Clear' })) clearErrors();
              }}
            >
              Clear
            </Button>
          )
        }
        bodyClassName="p-0"
      >
        {log.length === 0 ? (
          <EmptyState title="No problems recorded" text="Unexpected errors are listed here, so you can send them to whoever helps you. Nothing is sent anywhere automatically." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Screen</th>
                <th>What happened</th>
                <th className="num">Times</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{when(r.at)}</td>
                  <td className="font-mono text-xs">{r.route}</td>
                  <td>
                    <Badge tone="amber">{ERROR_SOURCE_LABELS[r.source]}</Badge> {r.message}
                    {r.detail && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-slate-600">Technical detail</summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600">{r.detail}</pre>
                      </details>
                    )}
                  </td>
                  <td className="num">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
