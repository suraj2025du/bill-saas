import { FileDown, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { DOC_TYPES } from '../../core/docs/docTypes';
import type { PaymentIndex, PaymentSummary } from '../../core/docs/payments';
import { salesPaymentSummary } from '../../core/docs/payments';
import { isLicenseExpired } from '../../core/licensing';
import type { Business, PrintSettings, SalesDocument } from '../../core/model';
import { InvoiceDocument } from '../../print/InvoiceDocument';
import { bulkPdfZip, nodeToPdf, pageSpec, printNode } from '../../print/printing';
import { buildInvoiceView, pageOf } from '../../print/view';
import { useStore } from '../../store/store';
import { toast } from '../../ui/feedback';
import { downloadBlob } from '../../ui/files';
import { Badge, Button, Modal } from '../../ui/kit';
import type { Tone } from '../../ui/kit';

export function statusOf(doc: SalesDocument, summary: PaymentSummary): { label: string; tone: Tone } {
  if (doc.status === 'CANCELLED') return { label: 'Cancelled', tone: 'red' };
  if (doc.status === 'DRAFT') return { label: 'Draft', tone: 'gray' };
  if (doc.convertedToId) return { label: 'Converted', tone: 'blue' };
  if (!DOC_TYPES[doc.docType].payable) return { label: 'Final', tone: 'brand' };
  if (summary.status === 'PAID') return { label: 'Paid', tone: 'green' };
  if (summary.overdueDays > 0) return { label: `Overdue ${summary.overdueDays}d`, tone: 'red' };
  if (summary.status === 'PARTIAL') return { label: 'Partial', tone: 'amber' };
  return { label: 'Unpaid', tone: 'amber' };
}

export function StatusBadge({ doc, index }: { doc: SalesDocument; index: PaymentIndex }) {
  const s = statusOf(doc, salesPaymentSummary(doc, index));
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function docView(doc: SalesDocument, business: Business, index: PaymentIndex | null, settings?: PrintSettings) {
  const currentSettings = useStore.getState().data.settings[0];
  const isTrial = !currentSettings || currentSettings.licenseType === 'TRIAL' || isLicenseExpired(currentSettings);
  return buildInvoiceView(doc, business, {
    settings,
    payment: index ? salesPaymentSummary(doc, index) : null,
    isTrial,
  });
}

export function docFileName(doc: SalesDocument): string {
  return `${DOC_TYPES[doc.docType].shortLabel} ${doc.number || 'draft'} ${doc.party.name}`.trim();
}

export async function printDoc(doc: SalesDocument, business: Business, index: PaymentIndex | null, settings?: PrintSettings): Promise<void> {
  const view = docView(doc, business, index, settings);
  await printNode(<InvoiceDocument view={view} />, pageSpec(view.settings, pageOf(view.template)));
}

export async function downloadDocPdf(doc: SalesDocument, business: Business, index: PaymentIndex | null, settings?: PrintSettings): Promise<void> {
  const view = docView(doc, business, index, settings);
  const blob = await nodeToPdf(<InvoiceDocument view={view} />, pageSpec(view.settings, pageOf(view.template)));
  downloadBlob(blob, `${docFileName(doc)}.pdf`);
}

/** "Export PDFs" for selected documents: progress bar, cancel, one ZIP at the end. */
export function BulkPdfButton({ docs, business, index, disabled }: { docs: SalesDocument[]; business: Business; index: PaymentIndex; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  const start = async () => {
    setOpen(true);
    setDone(0);
    setRunning(true);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const items = docs.map((d) => {
        const view = docView(d, business, index);
        return { name: docFileName(d), node: <InvoiceDocument view={view} />, page: pageSpec(view.settings, pageOf(view.template)) };
      });
      const zip = await bulkPdfZip(items, (n) => setDone(n), c.signal);
      if (zip) {
        downloadBlob(zip, `${business.name} documents ${new Date().toISOString().slice(0, 10)}.zip`);
        toast.success(`${items.length} PDF(s) exported`);
        setOpen(false);
      } else toast.info('Export cancelled');
    } catch (e) {
      toast.fromError(e);
    } finally {
      setRunning(false);
    }
  };

  const pct = docs.length ? Math.round((done / docs.length) * 100) : 0;
  return (
    <>
      <Button icon={<FileDown className="h-4 w-4" />} disabled={disabled || !docs.length || running} onClick={() => void start()}>
        Export PDFs{docs.length ? ` (${docs.length})` : ''}
      </Button>
      <Modal
        open={open}
        size="sm"
        title="Exporting PDFs"
        onClose={() => {
          if (!running) setOpen(false);
        }}
        footer={
          running ? (
            <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => ctrl.current?.abort()}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => setOpen(false)}>Close</Button>
          )
        }
      >
        <p className="mb-2 text-sm text-slate-600">
          {done} of {docs.length} done
        </p>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Modal>
    </>
  );
}
