import { useMemo, useState } from 'react';
import { fxFactor, paymentFx } from '../../core/accounting/postings';
import { DOC_TYPES } from '../../core/docs/docTypes';
import { buildPaymentIndex, purchasePaymentSummary, salesPaymentSummary } from '../../core/docs/payments';
import { newPayment } from '../../core/factories';
import type { PaymentMode, PaymentRecord, PurchaseBill, SalesDocument } from '../../core/model';
import { roundTo } from '../../core/money';
import { ReceiptDocument } from '../../print/SimpleDocuments';
import { pageSpec, printNode } from '../../print/printing';
import { savePayment } from '../../store/actions';
import { useBusiness, useMine } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Combobox } from '../../ui/Combobox';
import { toast } from '../../ui/feedback';
import { Button, Checkbox, Field, Input, Modal, NumberInput, Select, TextInput } from '../../ui/kit';
import { useMoney } from '../../ui/money';

export const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK', label: 'Bank transfer (NEFT/RTGS/IMPS)' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
];

export async function printReceipt(payment: PaymentRecord): Promise<void> {
  const data = useStore.getState().data;
  const business = data.businesses.find((b) => b.id === payment.businessId);
  if (!business) return;
  const doc = data.invoices.find((d) => d.id === payment.docId) ?? null;
  await printNode(<ReceiptDocument business={business} payment={payment} doc={doc} />, pageSpec(business.print, 'A5'));
}

/**
 * Record or edit a payment. With `doc` / `bill` it is linked to that document;
 * otherwise the user picks the party (an advance / on-account payment).
 */
export function PaymentDialog({
  open,
  onClose,
  direction,
  doc,
  bill,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  direction: 'IN' | 'OUT';
  doc?: SalesDocument | null;
  bill?: PurchaseBill | null;
  existing?: PaymentRecord | null;
}) {
  const biz = useBusiness();
  const parties = useMine('clients');
  const receipts = useMine('receipts');
  const vouchers = useMine('vouchers');
  const invoices = useMine('invoices');
  const purchases = useMine('purchases');
  const money = useMoney();
  const linkedDoc = doc ?? bill ?? undefined;

  const balance = useMemo(() => {
    const index = buildPaymentIndex(
      receipts.filter((r) => r.id !== existing?.id),
      vouchers,
      invoices,
      purchases,
      biz,
    );
    if (doc) return salesPaymentSummary(doc, index).balance;
    if (bill) return purchasePaymentSummary(bill, index).balance;
    return 0;
  }, [receipts, vouchers, invoices, purchases, biz, doc, bill, existing]);

  const [p, setP] = useState<PaymentRecord>(() => {
    const base =
      existing ??
      newPayment(biz.id, direction, {
        docId: doc?.id ?? bill?.id ?? '',
        partyId: doc?.partyId ?? bill?.supplierId ?? '',
        partyName: doc?.party.name ?? bill?.supplier.name ?? '',
        amount: balance,
        mode: biz.upiAccounts.length && direction === 'IN' ? 'UPI' : 'CASH',
        bankAccountId: biz.bankAccounts.find((b) => b.isDefault)?.id ?? biz.bankAccounts[0]?.id ?? '',
      });
    // Review R1: the amount is in the linked document's currency, valued at the rate on the payment date
    // (the document's rate until the user changes it). Older payments get the same defaults.
    const fx = paymentFx(base, linkedDoc, biz);
    return { ...base, currency: fx.currency, exchangeRate: fx.rate };
  });
  const [print, setPrint] = useState(direction === 'IN' && !existing);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<PaymentRecord>) => setP((x) => ({ ...x, ...patch }));
  const linked = !!linkedDoc;
  const docCur = linkedDoc?.currency || biz.currency;
  const cur = p.currency || biz.currency;
  const foreign = cur !== biz.currency;
  const rate = p.exchangeRate ?? 0;
  const value = roundTo(p.amount * rate);
  // As the books post it: positive when the payment is worth more (received) or costs less (paid) than at the document's rate.
  const atDocRate = linkedDoc && cur === docCur ? roundTo(p.amount * fxFactor(biz, docCur, linkedDoc.exchangeRate)) : value;
  const gain = roundTo(direction === 'IN' ? value - atDocRate : atDocRate - value);

  const submit = async () => {
    setBusy(true);
    try {
      const saved = await savePayment({ ...p, bankAccountId: p.mode === 'CASH' ? '' : p.bankAccountId });
      toast.success(`${direction === 'IN' ? 'Receipt' : 'Payment'} ${saved.number} saved`);
      onClose();
      if (print) await printReceipt(saved);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const title = existing ? `Edit ${existing.number}` : direction === 'IN' ? 'Record payment received' : 'Record payment made';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {linked ? (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            {doc ? `${DOC_TYPES[doc.docType].shortLabel} ${doc.number}` : `Bill ${bill?.billNo}`} | {p.partyName}
            <br />
            Balance due: <b>{money(balance, docCur)}</b>
          </p>
        ) : (
          <Field label={direction === 'IN' ? 'Received from' : 'Paid to'}>
            <Combobox
              value={p.partyId}
              displayValue={p.partyName}
              options={parties
                .filter((x) => (direction === 'IN' ? x.kind !== 'SUPPLIER' : x.kind !== 'CUSTOMER'))
                .map((x) => ({ value: x.id, label: x.name, hint: x.gstin }))}
              onValue={(v) => set({ partyId: v, partyName: parties.find((x) => x.id === v)?.name ?? '' })}
              onCreate={(name) => set({ partyId: '', partyName: name })}
              placeholder="Search party"
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={p.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label={foreign ? `Amount (${cur})` : 'Amount'}>
            <NumberInput value={p.amount} onValue={(n) => set({ amount: n })} autoFocus />
          </Field>
          {foreign && (
            <Field
              className="col-span-2"
              label={`Exchange rate on the payment date (1 ${cur} = ? ${biz.currency})`}
              hint={`In your books: ${money(value)}${gain ? `, exchange ${gain > 0 ? 'gain' : 'loss'} ${money(Math.abs(gain))}` : ''}`}
            >
              <NumberInput value={rate} onValue={(n) => set({ exchangeRate: n })} />
            </Field>
          )}
          <Field label="Mode">
            <Select value={p.mode} onValue={(v) => set({ mode: v })} options={PAYMENT_MODES} />
          </Field>
          {p.mode !== 'CASH' && (
            <Field label="Bank account">
              <Select
                value={p.bankAccountId}
                placeholder={biz.bankAccounts.length ? 'Choose' : 'No bank account (treated as cash)'}
                onValue={(v) => set({ bankAccountId: v })}
                options={biz.bankAccounts.map((b) => ({ value: b.id, label: `${b.bankName || b.label} ...${b.accountNumber.slice(-4)}` }))}
              />
            </Field>
          )}
        </div>
        <Field label="Reference (UTR / cheque no.)">
          <TextInput value={p.reference} onValue={(v) => set({ reference: v })} />
        </Field>
        <Field label="Notes">
          <TextInput value={p.notes} onValue={(v) => set({ notes: v })} />
        </Field>
        <Checkbox checked={print} onValue={setPrint} label="Print the receipt after saving" />
      </div>
    </Modal>
  );
}
