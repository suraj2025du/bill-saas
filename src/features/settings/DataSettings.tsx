import { Cloud, Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DOC_TYPES } from '../../core/docs/docTypes';
import { buildPaymentIndex } from '../../core/docs/payments';
import { todayISO } from '../../core/dates';
import type { SalesDocument } from '../../core/model';
import type { BackupInfo } from '../../data/adapter';
import { MAX_RESTORE_BYTES } from '../../data/http';
import { daysLeft } from '../../data/trash';
import { InvoiceDocument } from '../../print/InvoiceDocument';
import { nodeToPdf, pageSpec } from '../../print/printing';
import { pageOf } from '../../print/view';
import { exportSnapshot, importSnapshot, purgeTrash, restoreFromTrash, updateSettings } from '../../store/actions';
import { useBusiness, useSettings } from '../../store/hooks';
import { createBackup, listBackups, readBackup, restoreBackup as restoreInPlace, useStore } from '../../store/store';
import { markExported } from '../../shell/appState';
import { attempt, confirmDialog, toast } from '../../ui/feedback';
import { downloadJson, pickFile } from '../../ui/files';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, PageHeader, TextInput } from '../../ui/kit';
import { docFileName, docView } from '../sales/common';
import { driveToken, ensureFolder, isValidClientId, uploadFile } from './drive';

const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function BackupPage() {
  const adapter = useStore((s) => s.adapter);
  const data = useStore((s) => s.data);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState('');
  const refresh = () => listBackups().then(setBackups).catch(toast.fromError);
  useEffect(() => {
    void refresh();
  }, []);

  const download = () => {
    const snap = exportSnapshot();
    downloadJson(snap, `free-gst-billing-backup-${todayISO()}.json`);
    markExported(todayISO());
    toast.success('Backup file downloaded. Keep it on a pen drive or cloud storage.');
  };

  const restoreFile = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    if (adapter?.kind === 'server' && file.size > MAX_RESTORE_BYTES) {
      return toast.error(`This file is ${kb(file.size)}; the largest backup file that can be restored here is ${kb(MAX_RESTORE_BYTES)}. Nothing was changed.`, [
        'Backups in the Automatic backups list are restored on this computer, at any size.',
      ]);
    }
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return toast.error('This is not a backup file (invalid JSON). Nothing was changed.');
    }
    if (!(await confirmDialog({ title: 'Restore this backup?', message: `All current data will be replaced by "${file.name}". A copy of the current data is saved first.`, danger: true, confirmLabel: 'Restore' }))) return;
    setBusy('restore');
    const ok = await attempt(() => importSnapshot(json), 'Backup restored');
    setBusy('');
    if (ok) void refresh();
  };

  const restoreBackup = async (b: BackupInfo) => {
    if (!(await confirmDialog({ title: 'Restore this automatic backup?', message: `Data will go back to ${new Date(b.createdAt).toLocaleString()}. A copy of the current data is saved first.`, danger: true, confirmLabel: 'Restore' }))) return;
    setBusy(b.id);
    // Restored where the backup is kept, so it never has to fit in an upload (review Y11).
    const ok = await attempt(() => restoreInPlace(b.id), 'Restored');
    setBusy('');
    if (ok) void refresh();
  };

  // Warn before backups outgrow what "Restore from file" can upload (80% of the limit).
  const largest = Math.max(0, ...backups.map((b) => b.sizeBytes));
  const nearUploadLimit = adapter?.kind === 'server' && largest > MAX_RESTORE_BYTES * 0.8;

  const counts = [
    ['Businesses', data.businesses.length],
    ['Documents', data.invoices.length],
    ['Parties', data.clients.length],
    ['Products', data.products.length],
    ['Purchases', data.purchases.length],
    ['Payments', data.receipts.length],
  ] as const;

  return (
    <div className="max-w-3xl">
      <PageHeader back="/settings" title="Backup & restore" />
      <Card title="Where your data is" bodyClassName="space-y-2 p-4 text-sm">
        <p>
          {adapter?.kind === 'server' ? 'On this computer, as JSON files:' : 'In this browser (IndexedDB). Clearing browser data deletes it, so download backups regularly.'}{' '}
          {adapter?.kind === 'server' && <code className="rounded bg-slate-100 px-1">{adapter.location}</code>}
        </p>
        <div className="flex flex-wrap gap-2">
          {counts.map(([k, v]) => (
            <Badge key={k}>
              {k}: {v}
            </Badge>
          ))}
        </div>
      </Card>
      <Card title="Backup file" className="mt-4" bodyClassName="flex flex-wrap gap-2 p-4">
        <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={download}>
          Download full backup
        </Button>
        <Button icon={<Upload className="h-4 w-4" />} busy={busy === 'restore'} onClick={() => void restoreFile()}>
          Restore from file
        </Button>
        <p className="w-full text-xs text-slate-500">Restore checks every record first. If anything is wrong, nothing is changed.</p>
        {nearUploadLimit && (
          <div className="w-full">
            <Alert>
              Your backups are about {kb(largest)}. A backup file larger than {kb(MAX_RESTORE_BYTES)} cannot be restored from a file; the backups listed under Automatic backups can be restored at any size.
            </Alert>
          </div>
        )}
      </Card>
      <Card
        title="Automatic backups"
        className="mt-4"
        actions={
          <Button size="sm" onClick={() => void attempt(async () => (await createBackup('manual'), refresh()), 'Backup taken')}>
            Back up now
          </Button>
        }
        bodyClassName="p-0"
      >
        {backups.length === 0 ? (
          <EmptyState title="No backups yet" text="One is taken automatically every day when you open the app." />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {[...backups]
              .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
              .map((b) => (
                <li key={b.id} className="flex items-center gap-2 px-4 py-2">
                  <span className="flex-1">
                    {new Date(b.createdAt).toLocaleString()} <Badge tone={b.reason === 'auto' ? 'gray' : b.reason === 'manual' ? 'brand' : 'amber'}>{b.reason}</Badge>
                    <span className="ml-2 text-xs text-slate-500">{kb(b.sizeBytes)}</span>
                  </span>
                  <Button size="sm" variant="ghost" aria-label="Download" onClick={() => void readBackup(b.id).then((s) => downloadJson(s, `${b.id}.json`), toast.fromError)}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" busy={busy === b.id} icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void restoreBackup(b)}>
                    Restore
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Upload one document's PDF when auto-upload is on (called after finalizing). */
export async function autoUploadPdf(doc: SalesDocument): Promise<void> {
  const settings = useStore.getState().data.settings.find((s) => s.id === 'app');
  if (!settings?.drive.autoUploadPdf) return;
  await uploadDocPdf(doc);
}

/** Upload one final document's PDF to the app's Drive folder; errors are shown, never thrown. */
export async function uploadDocPdf(doc: SalesDocument): Promise<void> {
  const data = useStore.getState().data;
  const settings = data.settings.find((s) => s.id === 'app');
  if (!settings?.drive.clientId || doc.status !== 'FINAL') return;
  const biz = data.businesses.find((b) => b.id === doc.businessId);
  if (!biz) return;
  try {
    const token = await driveToken(settings.drive.clientId);
    const folder = await ensureFolder(token, settings.drive.folderId);
    if (folder !== settings.drive.folderId) await updateSettings({ drive: { ...settings.drive, folderId: folder } });
    const view = docView(doc, biz, buildPaymentIndex(data.receipts, data.vouchers, data.invoices, data.purchases, biz));
    const blob = await nodeToPdf(<InvoiceDocument view={view} />, pageSpec(view.settings, pageOf(view.template)));
    await uploadFile(token, folder, `${docFileName(doc)}.pdf`, blob);
    toast.success(`${doc.number} uploaded to Google Drive`);
  } catch (e) {
    toast.error('Google Drive upload failed', [e instanceof Error ? e.message : String(e)]);
  }
}

export function DrivePage() {
  const settings = useSettings();
  const biz = useBusiness();
  const invoices = useStore((s) => s.data.invoices);
  const [clientId, setClientId] = useState(settings.drive.clientId);
  const [busy, setBusy] = useState('');
  const drive = settings.drive;

  const backupNow = async () => {
    setBusy('backup');
    await attempt(async () => {
      const token = await driveToken(drive.clientId);
      const folder = await ensureFolder(token, drive.folderId);
      const blob = new Blob([JSON.stringify(exportSnapshot())], { type: 'application/json' });
      await uploadFile(token, folder, `free-gst-billing-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, blob);
      await updateSettings({ drive: { ...drive, folderId: folder, lastBackupAt: new Date().toISOString() } });
    }, 'Backup uploaded to Google Drive');
    setBusy('');
  };

  const uploadMonth = async () => {
    const month = todayISO().slice(0, 7);
    const docs = invoices.filter((d) => d.businessId === biz.id && d.status === 'FINAL' && d.date.startsWith(month) && DOC_TYPES[d.docType].payable);
    if (!docs.length) return toast.info('No final invoices this month.');
    setBusy('pdfs');
    for (const d of docs) await uploadDocPdf(d);
    setBusy('');
  };

  return (
    <div className="max-w-2xl">
      <PageHeader back="/settings" title="Google Drive backup" subtitle="Optional. Uses your own Google Cloud OAuth Client ID; only files this app creates are visible to it." />
      <Card title="1. Connect" bodyClassName="space-y-3 p-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Open console.cloud.google.com, create a project and enable the Google Drive API.</li>
          <li>Create an OAuth Client ID of type "Web application". Add this app&apos;s address ({window.location.origin}) as an authorised JavaScript origin.</li>
          <li>Paste the Client ID below.</li>
        </ol>
        <Field label="OAuth Client ID" error={clientId && !isValidClientId(clientId) ? 'Should end with .apps.googleusercontent.com' : undefined}>
          <TextInput value={clientId} onValue={(v) => setClientId(v.trim())} placeholder="1234567890-abc123.apps.googleusercontent.com" />
        </Field>
        <Button variant="primary" disabled={!isValidClientId(clientId)} onClick={() => void attempt(() => updateSettings({ drive: { ...drive, clientId } }), 'Client ID saved')}>
          Save Client ID
        </Button>
      </Card>
      {drive.clientId && (
        <Card title="2. Use it" className="mt-4" bodyClassName="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Cloud className="h-4 w-4" />} busy={busy === 'backup'} onClick={() => void backupNow()}>
              Back up to Drive now
            </Button>
            <Button busy={busy === 'pdfs'} onClick={() => void uploadMonth()}>
              Upload this month&apos;s invoice PDFs
            </Button>
          </div>
          {drive.lastBackupAt && <p className="text-sm text-slate-600">Last Drive backup: {new Date(drive.lastBackupAt).toLocaleString()}</p>}
          <Checkbox
            checked={drive.autoUploadPdf}
            onValue={(v) => void attempt(() => updateSettings({ drive: { ...drive, autoUploadPdf: v } }), v ? 'Auto-upload turned on' : 'Auto-upload turned off')}
            label="Upload each invoice PDF automatically when I finalize it"
          />
          <Button variant="ghost" onClick={() => void attempt(() => updateSettings({ drive: { clientId: '', autoUploadPdf: false, folderId: '', lastBackupAt: '' } }), 'Disconnected')}>
            Disconnect
          </Button>
        </Card>
      )}
      <div className="mt-3">
        <Alert tone="blue">Google Drive needs internet. Everything else in the app keeps working offline.</Alert>
      </div>
    </div>
  );
}

export function TrashPage() {
  const trash = useStore((s) => s.data.trash);
  const biz = useBusiness();
  const list = [...trash].filter((t) => t.businessId === biz.id || t.collection === 'businesses').sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
  return (
    <div className="max-w-3xl">
      <PageHeader
        back="/settings"
        title="Trash bin"
        subtitle="Deleted items stay here for 30 days"
        actions={
          list.length > 0 && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirmDialog({ title: 'Empty the Trash?', message: `${list.length} item(s) will be deleted forever.`, danger: true, confirmLabel: 'Delete forever' })) await attempt(() => purgeTrash(list), 'Trash emptied');
              }}
            >
              Empty trash
            </Button>
          )
        }
      />
      <div className="card">
        {list.length === 0 ? (
          <EmptyState icon={<Trash2 className="h-10 w-10" />} title="Trash is empty" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {list.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-4 py-2">
                <span className="flex-1">
                  <b>{t.label}</b>
                  <span className="block text-xs text-slate-500">
                    Deleted {new Date(t.deletedAt).toLocaleString()} | {daysLeft(t)} day(s) left
                  </span>
                </span>
                <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void attempt(() => restoreFromTrash(t), 'Restored')}>
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Delete forever"
                  onClick={async () => {
                    if (await confirmDialog({ title: 'Delete forever?', message: t.label, danger: true, confirmLabel: 'Delete' })) await attempt(() => purgeTrash([t]), 'Deleted');
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
