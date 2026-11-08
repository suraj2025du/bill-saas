import { Ban, Copy, FileDown, FileJson, Pencil, Printer, Receipt, Repeat, Share2, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { paymentFx } from '../../core/accounting/postings';
import { DOC_TYPES } from '../../core/docs/docTypes';
import { canCancel, canConvert, convertDocument, createCreditNote, duplicateDocument } from '../../core/docs/lifecycle';
import { salesPaymentSummary } from '../../core/docs/payments';
import type { Settlement } from '../../core/docs/payments';
import { nextRecurringDate } from '../../core/docs/recurring';
import { validateSalesDocument } from '../../core/docs/validate';
import { EWAY_DOC_TYPES, EWAY_SUB_SUPPLY, buildEwayBill } from '../../core/gst/eway';
import type { CreditNoteReason, PaymentRecord, RecurringFrequency, SalesDocument, TemplateId } from '../../core/model';
import { InvoiceDocument } from '../../print/InvoiceDocument';
import { ScaledPreview } from '../../print/printing';
import { cancelSalesDocument, deletePayment, deleteSalesDocument, setRecurring } from '../../store/actions';
import { useBusiness, useMine, usePaymentIndex, useSettings } from '../../store/hooks';
import { attempt, confirmDialog, promptDialog, toast } from '../../ui/feedback';
import { downloadJson } from '../../ui/files';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, TextInput, cx } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';
import { docView, downloadDocPdf, printDoc, statusOf } from './common';
import { PaymentDialog, printReceipt } from './PaymentDialog';

const TEMPLATES: { value: TemplateId; label: string }[] = [
  { value: 'TALLY', label: 'Tally style' },
  { value: 'BOXED', label: 'Boxed grid' },
  { value: 'MODERN', label: 'Modern corporate' },
  { value: 'RETAIL', label: 'Retail brand' },
  { value: 'MINIMAL', label: 'Minimalist' },
  { value: 'EXECUTIVE', label: 'Executive bold' },
  { value: 'COMPACT_A5', label: 'Compact A5' },
  { value: 'SERVICE', label: 'Service consultant' },
  { value: 'THERMAL', label: 'Thermal POS' },
];

function EwayDialog({ doc, onClose }: { doc: SalesDocument; onClose: () => void }) {
  const biz = useBusiness();
  const settings = useSettings();
  const [sub, setSub] = useState(doc.supplyKind === 'EXPORT' ? 3 : doc.docType === 'DELIVERY_CHALLAN' ? 8 : 1);
  const [desc, setDesc] = useState('');
  const result = buildEwayBill(biz, doc, { subSupplyType: sub, subSupplyDesc: desc, customUnits: settings.customUnits });
  return (
    <Modal
      open
      onClose={onClose}
      title="E-Way Bill JSON"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            disabled={result.errors.length > 0}
            onClick={() => {
              downloadJson(result.json, `EWB ${doc.number}.json`);
              toast.success('E-Way Bill JSON downloaded');
            }}
          >
            Download JSON
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sub-supply type">
            <Select value={String(sub)} onValue={(v) => setSub(Number(v))} options={Object.entries(EWAY_SUB_SUPPLY).map(([k, v]) => ({ value: k, label: v }))} />
          </Field>
          {sub === 8 && (
            <Field label="Description (max 20 characters)">
              <TextInput value={desc} maxLength={20} onValue={setDesc} />
            </Field>
          )}
        </div>
        {result.errors.length > 0 && (
          <Alert tone="red" title="Fix these first">
            <ul className="list-disc pl-5">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}
        {result.warnings.length > 0 && (
          <Alert tone="amber" title="Check">
            <ul className="list-disc pl-5">
              {result.warnings.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}
        <p className="text-slate-600">
          Transport details come from the document&apos;s dispatch section; edit the document to change them. Upload the file at ewaybillgst.gov.in &gt; e-Waybill &gt; Generate Bulk.
        </p>
      </div>
    </Modal>
  );
}

function CreditNoteDialog({ doc, onClose }: { doc: SalesDocument; onClose: () => void }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState<CreditNoteReason>('SALES_RETURN');
  const [goods, setGoods] = useState(true);
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Credit note against ${doc.number}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              try {
                navigate('/sales/new', { state: { draft: createCreditNote(doc, reason, goods) } });
              } catch (e) {
                toast.fromError(e);
              }
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Reason">
          <Select<CreditNoteReason>
            value={reason}
            onValue={setReason}
            options={[
              { value: 'SALES_RETURN', label: 'Sales return' },
              { value: 'POST_SALE_DISCOUNT', label: 'Post-sale discount' },
              { value: 'DEFICIENCY', label: 'Deficiency in service' },
              { value: 'CORRECTION', label: 'Correction in invoice' },
              { value: 'OTHER', label: 'Other' },
            ]}
          />
        </Field>
        <Checkbox checked={goods} onValue={setGoods} label="Goods are being returned (add them back to stock)" />
        <p className="text-xs text-slate-500">The next screen opens a copy of the invoice. Reduce quantities or rates to the amount being credited.</p>
      </div>
    </Modal>
  );
}

function RecurringDialog({ doc, onClose }: { doc: SalesDocument; onClose: () => void }) {
  const [freq, setFreq] = useState<RecurringFrequency>(doc.recurring?.frequency ?? 'MONTHLY');
  const [next, setNext] = useState(doc.recurring?.nextDate ?? nextRecurringDate(doc.date, 'MONTHLY'));
  const [end, setEnd] = useState(doc.recurring?.endDate ?? '');
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Recurring invoice"
      footer={
        <>
          {doc.recurring?.enabled && (
            <Button variant="danger" onClick={() => void attempt(() => setRecurring(doc, null), 'Recurring stopped').then(onClose)}>
              Stop recurring
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void attempt(() => setRecurring(doc, { enabled: true, frequency: freq, nextDate: next, endDate: end }), 'Recurring schedule saved').then((ok) => ok && onClose())}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Repeat">
          <Select<RecurringFrequency>
            value={freq}
            onValue={(f) => {
              setFreq(f);
              setNext(nextRecurringDate(doc.date, f));
            }}
            options={[
              { value: 'WEEKLY', label: 'Weekly' },
              { value: 'MONTHLY', label: 'Monthly' },
              { value: 'QUARTERLY', label: 'Quarterly' },
              { value: 'YEARLY', label: 'Yearly' },
            ]}
          />
        </Field>
        <Field label="Next invoice on">
          <Input type="date" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Stop after (optional)">
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500">Copies are created and numbered automatically each time the app starts on or after the due date.</p>
      </div>
    </Modal>
  );
}

export function DocView() {
  const { id } = useParams();
  const biz = useBusiness();
  const invoices = useMine('invoices');
  const receipts = useMine('receipts');
  const vouchers = useMine('vouchers');
  const index = usePaymentIndex();
  const money = useMoney();
  const navigate = useNavigate();
  const doc = invoices.find((d) => d.id === id);
  const [template, setTemplate] = useState<TemplateId | ''>('');
  const [dialog, setDialog] = useState<'' | 'pay' | 'eway' | 'cn' | 'recurring'>('');
  const [editPay, setEditPay] = useState<PaymentRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = useMemo(() => (template ? { ...biz.print, template } : biz.print), [biz.print, template]);
  const view = useMemo(() => (doc ? docView({ ...doc, template: template || doc.template }, biz, index, settings) : null), [doc, biz, index, settings, template]);
  if (!doc || !view) {
    return <EmptyState title="Document not found" text="It may have been deleted. Check the Trash bin in Settings." action={<Link className="btn btn-secondary" to="/sales">Back to documents</Link>} />;
  }
  const meta = DOC_TYPES[doc.docType];
  const summary = salesPaymentSummary(doc, index);
  const status = statusOf(doc, summary);
  // Payments and bill-wise voucher lines, as the balance counts them (design F06).
  const dateOf = (s: Settlement) => (s.source.kind === 'PAYMENT' ? s.source.payment.date : s.source.voucher.date);
  const settlements = (index.settlements.get(doc.id) ?? []).filter((s) => s.direction === 'IN').sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : 1));
  const foreign = doc.currency !== biz.currency;
  const related = invoices.filter((d) => d.refDocId === doc.id || d.id === doc.refDocId || d.id === doc.convertedToId);
  const issues = doc.status === 'FINAL' ? validateSalesDocument(doc, biz, true).filter((i) => i.level === 'warning') : [];
  const docForPrint = { ...doc, template: template || doc.template };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const check = canCancel(doc, invoices, receipts, vouchers);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }
    const reason = await promptDialog({
      title: `Cancel ${doc.number}?`,
      message: 'The number stays in the series and the document is stamped CANCELLED. Stock and accounts are reversed. This cannot be undone.',
      label: 'Reason',
      required: true,
      confirmLabel: 'Cancel document',
      danger: true,
    });
    if (reason) await attempt(() => cancelSalesDocument(doc, reason), `${doc.number} cancelled`);
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: 'Move to Trash?', message: 'You can restore it from Settings > Trash bin for 30 days.', confirmLabel: 'Move to Trash', danger: true }))) return;
    if (await attempt(() => deleteSalesDocument(doc), 'Moved to Trash')) navigate('/sales');
  };

  const share = async () => {
    const text = `${meta.label} ${doc.number} dated ${fdate(doc.date)} from ${biz.name}: ${money(doc.totals.net, doc.currency)}${summary.balance > 0 ? ` (balance due ${money(summary.balance, doc.currency)})` : ''}.${view.upi ? ` Pay by UPI: ${view.upi.vpa}` : ''}`;
    try {
      if (navigator.share) await navigator.share({ title: `${meta.label} ${doc.number}`, text });
      else {
        await navigator.clipboard.writeText(text);
        toast.success('Summary copied. Paste it in WhatsApp or e-mail.');
      }
    } catch {
      // Share sheet closed by the user.
    }
  };

  return (
    <div>
      <PageHeader
        back="/sales"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {meta.label} {doc.number || '(draft)'} <Badge tone={status.tone}>{status.label}</Badge>
            {doc.recurring?.enabled && <Badge tone="blue">Recurring {doc.recurring.frequency.toLowerCase()}</Badge>}
          </span>
        }
        subtitle={`${doc.party.name || 'No customer'} | ${fdate(doc.date)} | ${money(doc.totals.total, doc.currency)}`}
        actions={
          <>
            {meta.payable && doc.status === 'FINAL' && (
              summary.balance > 0 ? (
                <Button variant="primary" icon={<Receipt className="h-4 w-4" />} onClick={() => setDialog('pay')}>
                  Record payment
                </Button>
              ) : (
                <Button variant="ghost" disabled className="text-emerald-700 font-semibold cursor-default">
                  Paid in full
                </Button>
              )
            )}
            <Select<TemplateId | ''> className="w-44" aria-label="Design" value={template} placeholder="Saved design" onValue={setTemplate} options={TEMPLATES} />
            <Button icon={<Printer className="h-4 w-4" />} busy={busy} onClick={() => void run(() => printDoc(docForPrint, biz, index, settings))}>
              Print
            </Button>
            <Button icon={<FileDown className="h-4 w-4" />} busy={busy} onClick={() => void run(() => downloadDocPdf(docForPrint, biz, index, settings))}>
              PDF
            </Button>
            <Button icon={<Share2 className="h-4 w-4" />} onClick={() => void share()}>
              Share
            </Button>
            {doc.status !== 'CANCELLED' && (
              <Button icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`/sales/${doc.id}/edit`)}>
                Edit
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigate('/sales/new', { state: { draft: duplicateDocument(doc) } })}>
          Duplicate
        </Button>
        {meta.convertsTo.map((t) => {
          const check = canConvert(doc, t);
          return (
            <Button
              key={t}
              size="sm"
              disabled={!check.ok}
              title={check.reason}
              onClick={() => navigate('/sales/new', { state: { draft: convertDocument(doc, t) } })}
            >
              Convert to {DOC_TYPES[t].shortLabel}
            </Button>
          );
        })}
        {(doc.docType === 'TAX_INVOICE' || doc.docType === 'BILL_OF_SUPPLY') && doc.status === 'FINAL' && (
          <Button size="sm" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setDialog('cn')}>
            Credit note
          </Button>
        )}
        {biz.countryCode === 'IN' && EWAY_DOC_TYPES.has(doc.docType) && doc.status === 'FINAL' && (
          <Button size="sm" icon={<FileJson className="h-3.5 w-3.5" />} onClick={() => setDialog('eway')}>
            E-Way Bill JSON
          </Button>
        )}
        {doc.docType === 'TAX_INVOICE' && doc.status === 'FINAL' && (
          <Button size="sm" icon={<Repeat className="h-3.5 w-3.5" />} onClick={() => setDialog('recurring')}>
            {doc.recurring?.enabled ? 'Recurring settings' : 'Make recurring'}
          </Button>
        )}
        {doc.status === 'FINAL' && (
          <Button size="sm" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => void cancel()}>
            Cancel document
          </Button>
        )}
        {doc.status !== 'FINAL' && (
          <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void remove()}>
            Delete
          </Button>
        )}
      </div>

      {doc.status === 'CANCELLED' && (
        <div className="mb-3">
          <Alert tone="red" title={`Cancelled on ${fdate(doc.cancelledAt.slice(0, 10))}`}>
            Reason: {doc.cancelReason || '-'}
          </Alert>
        </div>
      )}
      {issues.length > 0 && (
        <div className="mb-3">
          <Alert tone="amber" title="Please check">
            <ul className="list-disc pl-5">
              {issues.map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <div className="rounded-lg bg-slate-200 p-3">
          <ScaledPreview>
            <InvoiceDocument view={view} />
          </ScaledPreview>
        </div>
        <div className="space-y-4">
          {meta.payable && doc.status === 'FINAL' && (
            <Card title="Payments">
              <dl className="mb-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Total</dt>
                  <dd className="font-semibold">{money(summary.total, doc.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Received</dt>
                  <dd className="font-semibold text-emerald-700">{money(summary.paid + summary.adjusted, doc.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Balance</dt>
                  <dd className={cx('font-semibold', summary.balance > 0 ? 'text-red-700' : 'text-emerald-700')}>
                    {money(summary.balance, doc.currency)}
                  </dd>
                </div>
              </dl>
              {settlements.length === 0 ? (
                <p className="text-sm text-slate-500">No payments yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {settlements.map((s, i) => {
                    if (s.source.kind === 'VOUCHER') {
                      const v = s.source.voucher;
                      return (
                        <li key={`${v.id}-${i}`} className="py-2">
                          <div className="font-medium">
                            {money(s.amount, doc.currency)}{' '}
                            <span className="text-xs text-slate-500">
                              by {v.type.toLowerCase()} voucher{foreign && ` (${money(s.bookAmount)})`}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500">
                            <Link className="text-brand-700 hover:underline" to={`/accounts/vouchers/${v.id}`}>
                              {v.number}
                            </Link>{' '}
                            | {fdate(v.date)}
                          </div>
                        </li>
                      );
                    }
                    const p = s.source.payment;
                    const fx = paymentFx(p, doc, biz);
                    return (
                      <li key={p.id} className="flex items-center gap-2 py-2">
                        <div className="flex-1">
                          <div className="font-medium">
                            {money(s.amount, doc.currency)}{' '}
                            <span className="text-xs text-slate-500">
                              by {p.mode.toLowerCase()}
                              {foreign && (fx.currency === doc.currency ? ` at ${fx.rate} (${money(s.bookAmount)})` : ` (${money(p.amount, fx.currency)})`)}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500">
                            {p.number} | {fdate(p.date)} {p.reference && `| ${p.reference}`}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" aria-label="Print receipt" onClick={() => void printReceipt(p)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label="Edit payment" onClick={() => setEditPay(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Delete payment"
                          onClick={async () => {
                            if (await confirmDialog({ title: `Delete payment ${p.number}?`, message: 'It moves to the Trash bin.', danger: true, confirmLabel: 'Delete' })) {
                              await attempt(() => deletePayment(p), 'Payment deleted');
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
          {related.length > 0 && (
            <Card title="Linked documents">
              <ul className="space-y-1 text-sm">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link className="text-brand-700 hover:underline" to={`/sales/${r.id}`}>
                      {DOC_TYPES[r.docType].shortLabel} {r.number || '(draft)'}
                    </Link>{' '}
                    <span className="text-slate-500">
                      {fdate(r.date)} | {money(r.totals.total, r.currency)} {r.status === 'CANCELLED' && '| cancelled'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Taxable value</dt>
              <dd className="text-right tabular-nums">{money(doc.totals.taxable, doc.currency)}</dd>
              <dt className="text-slate-500">Tax</dt>
              <dd className="text-right tabular-nums">{money(doc.totals.tax, doc.currency)}</dd>
              {doc.totals.tds > 0 && (
                <>
                  <dt className="text-slate-500">TDS by customer</dt>
                  <dd className="text-right tabular-nums">{money(doc.totals.tds, doc.currency)}</dd>
                </>
              )}
              {doc.totals.tcs > 0 && (
                <>
                  <dt className="text-slate-500">TCS collected</dt>
                  <dd className="text-right tabular-nums">{money(doc.totals.tcs, doc.currency)}</dd>
                </>
              )}
              <dt className="text-slate-500">Stock</dt>
              <dd className="text-right">{meta.stock === 'NONE' ? 'Not affected' : doc.stockApplied ? (meta.stock === 'OUT' ? 'Reduced' : 'Added back') : 'Not moved again'}</dd>
              {doc.currency !== biz.currency && (
                <>
                  <dt className="text-slate-500">Exchange rate</dt>
                  <dd className="text-right">{doc.exchangeRate}</dd>
                </>
              )}
            </dl>
          </Card>
        </div>
      </div>

      {dialog === 'pay' && <PaymentDialog open onClose={() => setDialog('')} direction="IN" doc={doc} />}
      {editPay && <PaymentDialog open onClose={() => setEditPay(null)} direction="IN" doc={doc} existing={editPay} />}
      {dialog === 'eway' && <EwayDialog doc={doc} onClose={() => setDialog('')} />}
      {dialog === 'cn' && <CreditNoteDialog doc={doc} onClose={() => setDialog('')} />}
      {dialog === 'recurring' && <RecurringDialog doc={doc} onClose={() => setDialog('')} />}
    </div>
  );
}
