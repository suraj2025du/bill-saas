import { paymentFx, voucherDifference } from '../core/accounting/postings';
import { currencyDecimals } from '../core/currency/countries';
import { fyOf, isValidISODate, todayISO } from '../core/dates';
import { DOC_TYPES } from '../core/docs/docTypes';
import { canCancel, cancelDocument, markConverted, voucherAgainst } from '../core/docs/lifecycle';
import { takeNumber } from '../core/docs/numbering';
import { buildPaymentIndex, paymentSettles, purchasePaymentSummary, salesPaymentSummary } from '../core/docs/payments';
import { dueRecurringRuns, makeRecurringCopy } from '../core/docs/recurring';
import { hasErrors, validateSalesDocument } from '../core/docs/validate';
import { computeDocument } from '../core/gst/compute';
import { isValidGstin, validateGstin } from '../core/gst/gstin';
import { allUnits, makeCustomUnit } from '../core/gst/units';
import { nowISO } from '../core/ids';
import { getSystemLedger, parseLedgerRef } from '../core/ledgers';
import type {
  AppSettings,
  Business,
  CollectionMap,
  CollectionName,
  Expense,
  Godown,
  Ledger,
  Party,
  PaymentRecord,
  Product,
  PurchaseBill,
  SalesDocument,
  SeriesKey,
  TrashEntry,
  TrashableCollection,
  UnitDef,
  Voucher,
} from '../core/model';
import { roundTo } from '../core/money';
import { makeSnapshot, validateSnapshot } from '../core/schema';
import type { Batch, PutOp } from '../data/adapter';
import { putOp } from '../data/adapter';
import { expiredTrash, restoreBatch, trashBatch } from '../data/trash';
import { normalizeDocNo } from '../core/gst/returns/gstr2b';
import { checkBusinessLimit, checkInvoiceLimit, getSoftwareLockState, type PlanTier } from '../core/licensing';
import { StaleDataError, UserError } from './errors';
import { selectBusiness, selectSettings } from './hooks';
import { commit, createBackup, replaceAll, useStore } from './store';

function state() {
  const data = useStore.getState().data;
  return { data, settings: selectSettings(data), business: selectBusiness(data) };
}

function requireBusiness(): Business {
  const b = state().business;
  if (!b) throw new UserError('Create a business first (Settings > Businesses).');
  return b;
}

const batchOf = (...puts: PutOp[]): Batch => ({ puts, removes: [] });
const touch = <T extends { updatedAt: string }>(r: T): T => ({ ...r, updatedAt: nowISO() });

/**
 * Refuse to save a screen's copy of a record when this tab has since got a newer version
 * (saved in another tab or window, review R2, or by a start-up task) instead of overwriting it.
 */
function assertUnchanged(collection: CollectionName, input: { id: string; updatedAt: string }): void {
  const current = (state().data[collection] as { id: string; updatedAt: string }[]).find((r) => r.id === input.id);
  if (current && current.updatedAt !== input.updatedAt) {
    throw new UserError('This record changed after you opened it (for example in another tab or window), so it was not saved. Open it again to see the latest version.');
  }
}

// ---------------------------------------------------------------- settings & businesses

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const { settings } = state();
  await commit(batchOf(putOp('settings', { ...settings, ...patch, id: 'app', updatedAt: nowISO() })));
}

export function businessIssues(b: Business): string[] {
  const out: string[] = [];
  if (!b.name.trim()) out.push('Business name is required.');
  if (b.countryCode === 'IN' && b.gstRegistration !== 'UNREGISTERED') {
    const g = validateGstin(b.gstin);
    if (!b.gstin) out.push('GSTIN is required for a GST-registered business.');
    else out.push(...g.errors.map((m) => `GSTIN: ${m}`));
    if (b.gstin && g.valid && g.stateCode !== b.stateCode) out.push('State does not match the first two digits of the GSTIN.');
  }
  if (b.countryCode === 'IN' && !b.stateCode) out.push('Select the state.');
  return out;
}

export async function saveBusiness(b: Business): Promise<Business> {
  const issues = businessIssues(b);
  if (issues.length) throw new UserError('Please fix the business details:', issues);
  assertUnchanged('businesses', b);
  const rec = touch(b);
  await commit(batchOf(putOp('businesses', rec)));
  return rec;
}

export async function addBusiness(b: Business): Promise<void> {
  const issues = businessIssues(b);
  if (issues.length) throw new UserError('Please fix the business details:', issues);
  const { data, settings } = state();
  const lockState = getSoftwareLockState({
    licenseType: settings.licenseType as PlanTier,
    licenseExpiry: settings.licenseExpiry,
    licenseKey: settings.licenseKey,
    licenseDisabled: settings.licenseDisabled,
    licenseDisabledReason: settings.licenseDisabledReason,
    securityTamperDetected: settings.securityTamperDetected,
    lastVerifiedClock: settings.lastVerifiedClock,
  });
  if (lockState.disabled) {
    throw new UserError(lockState.message || 'Software is disabled.');
  }
  const bizCheck = checkBusinessLimit(data.businesses.length, {
    licenseType: settings.licenseType as PlanTier,
  });
  if (!bizCheck.allowed) {
    throw new UserError(bizCheck.reason || 'Business limit reached for your plan.');
  }
  await commit(batchOf(putOp('businesses', b), putOp('settings', { ...settings, id: 'app', activeBusinessId: b.id, updatedAt: nowISO() })));
}

export function switchBusiness(id: string): Promise<void> {
  return updateSettings({ activeBusinessId: id });
}

/** First-run wizard: create the business (and a default godown) and mark setup done, in one write. */
export async function completeSetup(b: Business): Promise<void> {
  const issues = businessIssues(b);
  if (issues.length) throw new UserError('Please fix the business details:', issues);
  const { settings } = state();
  const now = nowISO();
  const puts: PutOp[] = [putOp('businesses', { ...b, createdAt: now, updatedAt: now })];
  if (b.features.godowns || b.features.inventory) {
    puts.push(putOp('godowns', { id: `gdn_${b.id}`, businessId: b.id, name: 'Main godown', address: '', isDefault: true, createdAt: now, updatedAt: now }));
  }
  puts.push(putOp('settings', { ...settings, id: 'app', activeBusinessId: b.id, setupComplete: true, updatedAt: now }));
  await commit({ puts, removes: [] });
}

export async function deleteBusiness(id: string): Promise<void> {
  const { data, settings } = state();
  if (settings.activeBusinessId === id) throw new UserError('Switch to another business before deleting this one.');
  const used = (['invoices', 'purchases', 'expenses', 'receipts', 'vouchers', 'clients', 'products'] as const).some((c) =>
    (data[c] as { businessId: string }[]).some((r) => r.businessId === id),
  );
  if (used) throw new UserError('This business has records. Delete or move them first; businesses with data cannot be removed.');
  const biz = data.businesses.find((b) => b.id === id);
  if (biz) await commit(trashBatch('businesses', biz));
}

// ---------------------------------------------------------------- trash

export async function moveToTrash<K extends TrashableCollection>(collection: K, record: CollectionMap[K]): Promise<void> {
  assertUnchanged(collection, record);
  await commit(trashBatch(collection, record));
}

export async function restoreFromTrash(entry: TrashEntry): Promise<void> {
  const { data } = state();
  const list = data[entry.collection] as { id: string }[];
  if (list.some((r) => r.id === entry.recordId)) throw new UserError('A record with the same id already exists; it was restored before.');
  await commit(restoreBatch(entry));
}

export async function purgeTrash(entries: readonly TrashEntry[]): Promise<void> {
  await commit({ puts: [], removes: entries.map((e) => ({ collection: 'trash' as const, id: e.id })) });
}

// ---------------------------------------------------------------- masters

export async function saveParty(p: Party): Promise<Party> {
  const errors: string[] = [];
  if (!p.name.trim()) errors.push('Name is required.');
  if (p.gstin) errors.push(...validateGstin(p.gstin).errors.map((m) => `GSTIN: ${m}`));
  if (['REGULAR', 'COMPOSITION', 'SEZ', 'UIN'].includes(p.registration) && !p.gstin && p.billing.countryCode === 'IN') {
    errors.push('A registered party needs a GSTIN (or choose Unregistered / Consumer).');
  }
  if (p.openingBalance < 0) errors.push('Opening balance cannot be negative; choose Dr or Cr instead.');
  if (errors.length) throw new UserError('Please fix the party details:', errors);
  assertUnchanged('clients', p);
  const rec = touch({ ...p, name: p.name.trim(), gstin: p.gstin.trim().toUpperCase(), pan: p.pan.trim().toUpperCase() });
  await commit(batchOf(putOp('clients', rec)));
  return rec;
}

export async function saveProduct(p: Product): Promise<Product> {
  const { data } = state();
  const errors: string[] = [];
  if (!p.name.trim()) errors.push('Name is required.');
  if (p.sellingPrice < 0 || p.purchasePrice < 0) errors.push('Prices cannot be negative.');
  const dup = (field: 'sku' | 'barcode') =>
    p[field] && data.products.some((x) => x.businessId === p.businessId && x.id !== p.id && x[field] === p[field]);
  if (dup('sku')) errors.push(`SKU ${p.sku} is used by another product.`);
  if (dup('barcode')) errors.push(`Barcode ${p.barcode} is used by another product.`);
  if (errors.length) throw new UserError('Please fix the product details:', errors);
  assertUnchanged('products', p);
  const rec = touch({ ...p, name: p.name.trim() });
  await commit(batchOf(putOp('products', rec)));
  return rec;
}

export async function saveProducts(list: readonly Product[]): Promise<void> {
  for (const p of list) if (!p.name.trim()) throw new UserError('Every product needs a name.');
  for (const p of list) assertUnchanged('products', p);
  await commit({ puts: list.map((p) => putOp('products', touch(p))), removes: [] });
}

export async function saveGodown(g: Godown): Promise<void> {
  if (!g.name.trim()) throw new UserError('Godown name is required.');
  assertUnchanged('godowns', g);
  const { data } = state();
  const puts: PutOp[] = [putOp('godowns', touch(g))];
  if (g.isDefault) {
    for (const o of data.godowns) if (o.businessId === g.businessId && o.id !== g.id && o.isDefault) puts.push(putOp('godowns', touch({ ...o, isDefault: false })));
  }
  await commit({ puts, removes: [] });
}

export async function deleteGodown(g: Godown): Promise<void> {
  const { data } = state();
  if (data.products.some((p) => p.godownId === g.id)) throw new UserError('Products are stored in this godown. Move them first.');
  await moveToTrash('godowns', g);
}

export async function saveLedger(l: Ledger): Promise<void> {
  const { data } = state();
  const name = l.name.trim();
  if (!name) throw new UserError('Ledger name is required.');
  const clash = data.ledgers.some((x) => x.businessId === l.businessId && x.id !== l.id && x.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new UserError(`A ledger named "${name}" already exists.`);
  assertUnchanged('ledgers', l);
  await commit(batchOf(putOp('ledgers', touch({ ...l, name }))));
}

export async function deleteLedger(l: Ledger): Promise<void> {
  const { data } = state();
  const used = data.vouchers.some((v) => v.lines.some((x) => x.ledgerId === l.id)) || data.expenses.some((e) => e.ledgerId === l.id);
  if (used) throw new UserError('Vouchers or expenses use this ledger. Delete them first.');
  await moveToTrash('ledgers', l);
}

export async function saveCustomUnits(units: UnitDef[]): Promise<void> {
  await updateSettings({ customUnits: units });
}

/**
 * Validate and save one new custom unit, e.g. "Carat" with code CT mapped to UQC OTH.
 * The code is normalised before the duplicate check, so "ct-1" and "CT1" are the same unit.
 */
export async function addCustomUnit(input: { name: string; code: string; uqc: string; decimals: number }): Promise<UnitDef> {
  const { settings } = state();
  if (!input.name.trim()) throw new UserError('Enter the unit name, for example Carat or Bundle.');
  let unit: UnitDef;
  try {
    unit = makeCustomUnit(input.name, input.code, input.uqc, input.decimals);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : String(e));
  }
  if (allUnits(settings.customUnits).some((u) => u.code === unit.code)) throw new UserError(`Unit code ${unit.code} already exists.`);
  await saveCustomUnits([...settings.customUnits, unit]);
  return unit;
}

// ---------------------------------------------------------------- numbering

function numberFor(business: Business, key: SeriesKey, date: string, exists: (n: string) => boolean) {
  return takeNumber(business.series[key], date, business.fyStartMonth || 4, exists);
}

// ---------------------------------------------------------------- sales documents

/** Recalculate every line, the totals, TDS and TCS of a sales document. */
export function computeSales(doc: SalesDocument): SalesDocument {
  const c = computeDocument(doc.items, {
    docType: doc.docType,
    supplyKind: doc.supplyKind,
    pricesIncludeTax: doc.pricesIncludeTax,
    roundOff: doc.roundOff,
    exportWithTax: doc.exportWithTax,
    reverseCharge: doc.reverseCharge,
    tds: doc.tds?.section ? { section: doc.tds.section, rate: doc.tds.rate } : null,
    tcs: doc.tcs?.section ? { section: doc.tcs.section, rate: doc.tcs.rate, base: doc.tcs.section === '206C(1H)' ? doc.tcs.base : undefined } : null,
    decimals: currencyDecimals(doc.currency),
  });
  return { ...doc, items: c.items, totals: c.totals, tds: c.tds, tcs: c.tcs };
}

const CONVERTIBLE_SOURCES = new Set(['QUOTATION', 'PROFORMA', 'DELIVERY_CHALLAN']);

export async function saveSalesDocument(input: SalesDocument, finalize: boolean): Promise<SalesDocument> {
  const { data } = state();
  const business = requireBusiness();
  const prev = data.invoices.find((d) => d.id === input.id);
  if (prev?.status === 'CANCELLED') throw new UserError('A cancelled document cannot be changed.');
  assertUnchanged('invoices', input);
  let doc = computeSales({ ...input, businessId: business.id, status: finalize ? 'FINAL' : input.status });

  const licSettings = data.settings[0];
  if (licSettings) {
    const lockState = getSoftwareLockState({
      licenseType: licSettings.licenseType as PlanTier,
      licenseExpiry: licSettings.licenseExpiry,
      licenseKey: licSettings.licenseKey,
      licenseDisabled: licSettings.licenseDisabled,
      licenseDisabledReason: licSettings.licenseDisabledReason,
      securityTamperDetected: licSettings.securityTamperDetected,
      lastVerifiedClock: licSettings.lastVerifiedClock,
    });
    if (lockState.disabled) {
      throw new UserError(lockState.message || 'Software is disabled.');
    }
  }
  if (!prev && (doc.docType === 'TAX_INVOICE' || doc.docType === 'BILL_OF_SUPPLY')) {
    const invCheck = checkInvoiceLimit(data.invoices, {
      licenseType: licSettings?.licenseType as PlanTier,
      licenseExpiry: licSettings?.licenseExpiry,
    });
    if (!invCheck.allowed) {
      throw new UserError(invCheck.reason || 'Document quota exceeded.');
    }
  }
  const series = business.series[doc.docType];
  const docFy = fyOf(doc.date, business.fyStartMonth || 4);
  const exists = (n: string) =>
    data.invoices.some((d) => {
      if (d.businessId !== business.id || d.id === doc.id || d.number !== n) return false;
      if (series.resetEachFY && !series.includeFY) {
        const otherFy = fyOf(d.date, business.fyStartMonth || 4);
        return otherFy.label === docFy.label;
      }
      return true;
    });
  const puts: PutOp[] = [];
  if (doc.status === 'FINAL' && !doc.number) {
    const t = numberFor(business, doc.docType, doc.date, exists);
    doc = { ...doc, number: t.number };
    puts.push(putOp('businesses', touch({ ...business, series: { ...business.series, [doc.docType]: t.series } })));
  } else if (doc.number && doc.number !== prev?.number) {
    // A typed number changes the business record too, so a tab that has not seen it cannot issue it again (review R2).
    puts.push(putOp('businesses', touch(business)));
  }
  const issues = validateSalesDocument(doc, business, doc.status === 'FINAL');
  if (doc.number && exists(doc.number)) issues.push({ level: 'error', field: 'number', message: `Number ${doc.number} is already used by another document.` });
  if (doc.docType === 'CREDIT_NOTE' && doc.refDocId) {
    const original = data.invoices.find((d) => d.id === doc.refDocId);
    if (original) {
      const siblingCNs = data.invoices.filter(
        (d) => d.docType === 'CREDIT_NOTE' && d.refDocId === doc.refDocId && d.id !== doc.id && d.status !== 'CANCELLED'
      );
      const sumCNs = siblingCNs.reduce((acc, cn) => acc + cn.totals.total, 0);
      if (sumCNs + doc.totals.total > original.totals.total) {
        issues.push({
          level: 'error',
          field: 'totals.total',
          message: `The sum of credit notes (₹${(sumCNs + doc.totals.total).toFixed(2)}) exceeds the original invoice total (₹${original.totals.total.toFixed(2)}).`,
        });
      }
    }
  }
  if (doc.status === 'FINAL' && hasErrors(issues)) {
    throw new UserError(
      'Please fix these before finalizing:',
      issues.filter((i) => i.level === 'error').map((i) => i.message),
    );
  }
  doc = touch(doc);
  puts.unshift(putOp('invoices', doc));
  if (doc.status === 'FINAL' && doc.refDocId && doc.docType !== 'CREDIT_NOTE' && doc.docType !== 'DEBIT_NOTE') {
    const source = data.invoices.find((d) => d.id === doc.refDocId);
    if (source && CONVERTIBLE_SOURCES.has(source.docType)) {
      if (source.convertedToId && source.convertedToId !== doc.id) {
        const otherDoc = data.invoices.find((d) => d.id === source.convertedToId);
        throw new UserError(`Already converted to ${otherDoc?.number || 'another document'}.`);
      }
      if (!source.convertedToId) {
        puts.push(putOp('invoices', markConverted(source, doc.id)));
      }
    }
  }
  await commit({ puts, removes: [] });
  return doc;
}

export async function cancelSalesDocument(doc: SalesDocument, reason: string): Promise<void> {
  const { data } = state();
  assertUnchanged('invoices', doc);
  const check = canCancel(doc, data.invoices, data.receipts, data.vouchers);
  if (!check.ok) throw new UserError(check.reason);
  const puts: PutOp[] = [putOp('invoices', cancelDocument(doc, reason))];
  // Free the quotation / challan this invoice was made from, so it can be converted again.
  const source = doc.refDocId ? data.invoices.find((d) => d.id === doc.refDocId && d.convertedToId === doc.id) : undefined;
  if (source) puts.push(putOp('invoices', touch({ ...source, convertedToId: '' })));
  await commit({ puts, removes: [] });
}

export async function deleteSalesDocument(doc: SalesDocument): Promise<void> {
  if (doc.status === 'FINAL') {
    throw new UserError('A final document cannot be deleted. Cancel it instead: GST rules need issued numbers to stay in the series.');
  }
  await moveToTrash('invoices', doc);
}

export async function setRecurring(doc: SalesDocument, rule: SalesDocument['recurring']): Promise<void> {
  if (rule?.enabled && !isValidISODate(rule.nextDate)) throw new UserError('Choose the next date.');
  assertUnchanged('invoices', doc);
  await commit(batchOf(putOp('invoices', touch({ ...doc, recurring: rule }))));
}

// ---------------------------------------------------------------- payments

export async function savePayment(input: PaymentRecord): Promise<PaymentRecord> {
  const { data } = state();
  const business = requireBusiness();
  const errors: string[] = [];
  const inv = input.docId ? data.invoices.find((d) => d.id === input.docId) : undefined;
  const bill = input.docId ? data.purchases.find((b) => b.id === input.docId) : undefined;
  // Review R1: a payment keeps its currency and that currency's rate on the payment date. Without a
  // currency it is in the linked document's currency at that document's rate (as the dialog used to ask).
  const fx = paymentFx(input, inv ?? bill, business);
  const exchangeRate = fx.currency === business.currency ? 1 : input.currency ? (input.exchangeRate ?? 0) : fx.rate;
  const p: PaymentRecord = { ...input, amount: roundTo(input.amount), currency: fx.currency, exchangeRate, businessId: business.id };
  if (!(p.amount > 0)) errors.push('Amount must be more than 0.');
  if (!(exchangeRate > 0)) errors.push(`Enter the exchange rate on the payment date (1 ${fx.currency} = ? ${business.currency}).`);
  if (!isValidISODate(p.date)) errors.push('Enter a valid date.');
  if (p.mode !== 'CASH' && business.bankAccounts.length && !p.bankAccountId) errors.push('Choose the bank account for this payment mode.');
  if (p.docId) {
    const others = data.receipts.filter((r) => r.id !== p.id);
    const index = buildPaymentIndex(others, data.vouchers, data.invoices, data.purchases, business);
    const doc = inv ?? bill;
    const balance = inv ? salesPaymentSummary(inv, index).balance : bill ? purchasePaymentSummary(bill, index).balance : 0;
    if (!doc) errors.push('The linked document no longer exists.');
    else if (exchangeRate > 0 && paymentSettles(p, doc, business) > balance + 0.005) {
      errors.push(`Amount is more than the balance due (${doc.currency || business.currency} ${balance.toFixed(2)}). Record the extra as an advance without linking a bill.`);
    }
  }
  if (errors.length) throw new UserError('Please fix the payment:', errors);
  assertUnchanged('receipts', input);
  const puts: PutOp[] = [];
  let rec: PaymentRecord = p;
  if (!rec.number) {
    const key: SeriesKey = rec.direction === 'IN' ? 'RECEIPT' : 'PAYMENT';
    const t = numberFor(business, key, rec.date, (n) => data.receipts.some((r) => r.businessId === business.id && r.number === n));
    rec = { ...rec, number: t.number };
    puts.push(putOp('businesses', touch({ ...business, series: { ...business.series, [key]: t.series } })));
  }
  rec = touch(rec);
  puts.unshift(putOp('receipts', rec));
  await commit({ puts, removes: [] });
  return rec;
}

export function deletePayment(p: PaymentRecord): Promise<void> {
  return moveToTrash('receipts', p);
}

// ---------------------------------------------------------------- purchases & expenses

export function computePurchase(bill: PurchaseBill): PurchaseBill {
  const c = computeDocument(bill.items, {
    docType: 'TAX_INVOICE',
    supplyKind: bill.supplyKind,
    pricesIncludeTax: bill.pricesIncludeTax,
    roundOff: bill.roundOff,
    exportWithTax: true,
    reverseCharge: bill.reverseCharge,
    tds: bill.tds?.section ? { section: bill.tds.section, rate: bill.tds.rate } : null,
    decimals: currencyDecimals(bill.currency),
  });
  return { ...bill, items: c.items, totals: { ...c.totals, tcs: bill.totals.tcs, net: roundTo(c.totals.net + (bill.totals.tcs || 0)) }, tds: c.tds };
}

export async function savePurchase(input: PurchaseBill): Promise<PurchaseBill> {
  const { data } = state();
  const business = requireBusiness();
  const bill = computePurchase({ ...input, businessId: business.id });
  const errors: string[] = [];
  if (!bill.supplier.name.trim()) errors.push('Select or enter the supplier.');
  if (!bill.billNo.trim()) errors.push("Enter the supplier's bill number.");
  if (!isValidISODate(bill.billDate)) errors.push('Enter a valid bill date.');
  if (bill.supplier.gstin) errors.push(...validateGstin(bill.supplier.gstin).errors.map((m) => `Supplier GSTIN: ${m}`));
  if (!bill.items.length) errors.push('Add at least one item.');
  bill.items.forEach((it, i) => {
    if (!it.name.trim()) errors.push(`Item ${i + 1}: name is required.`);
    if (!(it.qty > 0)) errors.push(`Item ${i + 1}: quantity must be more than 0.`);
    if (it.cessRate > 0) {
      if (bill.billDate >= '2026-02-01') {
        errors.push(`Item ${i + 1}: Compensation cess ended on 1 February 2026 and cannot be charged.`);
      } else if (bill.billDate >= '2025-09-22') {
        const hsnClean = (it.hsn || '').replace(/\s/g, '');
        const isTobaccoOrPanMasala = hsnClean.startsWith('24') || hsnClean.startsWith('21069020');
        if (!isTobaccoOrPanMasala) {
          errors.push(`Item ${i + 1}: Compensation cess was removed for non-tobacco goods on 22 Sep 2025.`);
        }
      }
    }
  });
  const key = (b: PurchaseBill) => `${(b.supplier.gstin || b.supplier.name).toUpperCase()}|${normalizeDocNo(b.billNo)}`;
  if (data.purchases.some((b) => b.businessId === business.id && b.id !== bill.id && b.status === 'FINAL' && key(b) === key(bill))) {
    errors.push(`Bill ${bill.billNo} from this supplier is already recorded.`);
  }
  if (errors.length) throw new UserError('Please fix the purchase bill:', errors);
  assertUnchanged('purchases', input);
  const rec = touch(bill);
  await commit(batchOf(putOp('purchases', rec)));
  return rec;
}

export async function deletePurchase(bill: PurchaseBill): Promise<void> {
  const { data } = state();
  if (data.receipts.some((r) => r.docId === bill.id)) throw new UserError('Payments are recorded against this bill. Delete them first.');
  // Review Y12: a payment voucher set against the bill pays it just like a payment does.
  const voucher = voucherAgainst(data.vouchers, bill.id);
  if (voucher) throw new UserError(`Voucher ${voucher.number} is set against this bill (bill-wise). Change or delete that voucher first.`);
  await moveToTrash('purchases', bill);
}

export function computeExpense(e: Expense): Expense {
  const taxable = roundTo(Math.max(0, e.taxable));
  const rate = e.supplyKind === 'NON_GST' ? 0 : Math.max(0, e.gstRate);
  const half = roundTo((taxable * rate) / 200);
  const cgst = e.supplyKind === 'INTRA_STATE' ? half : 0;
  const sgst = cgst;
  const igst = e.supplyKind === 'INTER_STATE' ? roundTo((taxable * rate) / 100) : 0;
  const tds = e.tds?.section ? { ...e.tds, base: taxable, amount: roundTo((taxable * e.tds.rate) / 100) } : null;
  // Review Y7: credit needs the vendor's GST invoice, so a valid vendor GSTIN (an unregistered vendor's bill never reaches GSTR-2B).
  const itcEligible = rate > 0 && e.itcEligible && isValidGstin(e.vendorGstin);
  return { ...e, taxable, gstRate: rate, cgst, sgst, igst, total: roundTo(taxable + cgst + sgst + igst), tds, itcEligible };
}

export async function saveExpense(input: Expense): Promise<Expense> {
  const business = requireBusiness();
  const e = computeExpense({ ...input, businessId: business.id });
  const errors: string[] = [];
  if (!isValidISODate(e.date)) errors.push('Enter a valid date.');
  if (!(e.taxable > 0)) errors.push('Amount must be more than 0.');
  if (!e.ledgerId) errors.push('Choose the expense head.');
  if (e.vendorGstin) errors.push(...validateGstin(e.vendorGstin).errors.map((m) => `Vendor GSTIN: ${m}`));
  if (['BANK', 'UPI', 'CARD'].includes(e.paidVia) && business.bankAccounts.length && !e.bankAccountId) errors.push('Choose the bank account it was paid from.');
  if (errors.length) throw new UserError('Please fix the expense:', errors);
  assertUnchanged('expenses', input);
  const rec = touch(e);
  await commit(batchOf(putOp('expenses', rec)));
  return rec;
}

// ---------------------------------------------------------------- vouchers

const isMoneyLedger = (id: string) => id === 'sys:cash' || parseLedgerRef(id).kind === 'bank';

export function voucherIssues(v: Voucher): string[] {
  const out: string[] = [];
  const lines = v.lines.filter((l) => l.ledgerId || l.dr || l.cr);
  if (!isValidISODate(v.date)) out.push('Enter a valid date.');
  if (lines.length < 2) out.push('A voucher needs at least two ledger lines.');
  lines.forEach((l, i) => {
    if (!l.ledgerId) out.push(`Line ${i + 1}: choose a ledger.`);
    if (l.dr < 0 || l.cr < 0) out.push(`Line ${i + 1}: amounts cannot be negative.`);
    if ((l.dr > 0) === (l.cr > 0)) out.push(`Line ${i + 1}: enter either a debit or a credit amount.`);
  });
  const diff = voucherDifference({ lines });
  if (Math.abs(diff) >= 0.005) out.push(`Debits and credits differ by ${Math.abs(diff).toFixed(2)}.`);
  const money = lines.filter((l) => isMoneyLedger(l.ledgerId));
  if (v.type === 'CONTRA' && money.length !== lines.length) out.push('Contra vouchers move money between cash and bank only.');
  if (v.type === 'PAYMENT' && !money.some((l) => l.cr > 0)) out.push('A payment voucher must credit Cash or a bank account.');
  if (v.type === 'RECEIPT' && !money.some((l) => l.dr > 0)) out.push('A receipt voucher must debit Cash or a bank account.');
  if (v.type === 'JOURNAL' && money.length) out.push('Journal vouchers do not use Cash or bank ledgers; use Payment, Receipt or Contra.');
  for (const l of lines) {
    if (parseLedgerRef(l.ledgerId).kind === 'system' && !getSystemLedger(l.ledgerId)) out.push(`Unknown ledger ${l.ledgerId}.`);
  }
  return out;
}

const VOUCHER_SERIES: Record<Voucher['type'], SeriesKey> = {
  PAYMENT: 'VOUCHER_PAYMENT',
  RECEIPT: 'VOUCHER_RECEIPT',
  CONTRA: 'VOUCHER_CONTRA',
  JOURNAL: 'VOUCHER_JOURNAL',
};

export async function saveVoucher(input: Voucher): Promise<Voucher> {
  const { data } = state();
  const business = requireBusiness();
  const v: Voucher = {
    ...input,
    businessId: business.id,
    lines: input.lines.filter((l) => l.ledgerId || l.dr || l.cr).map((l) => ({ ...l, dr: roundTo(l.dr || 0), cr: roundTo(l.cr || 0) })),
  };
  const issues = voucherIssues(v);
  if (issues.length) throw new UserError('Please fix the voucher:', issues);
  assertUnchanged('vouchers', input);
  const puts: PutOp[] = [];
  let rec = v;
  if (!rec.number) {
    const key = VOUCHER_SERIES[rec.type];
    const t = numberFor(business, key, rec.date, (n) => data.vouchers.some((x) => x.businessId === business.id && x.number === n));
    rec = { ...rec, number: t.number };
    puts.push(putOp('businesses', touch({ ...business, series: { ...business.series, [key]: t.series } })));
  }
  rec = touch(rec);
  puts.unshift(putOp('vouchers', rec));
  await commit({ puts, removes: [] });
  return rec;
}

// ---------------------------------------------------------------- start-up tasks

/** Create the recurring invoices that fell due (also catches up after days offline). */
export async function runRecurring(today = todayISO()): Promise<number> {
  const { data } = state();
  const puts: PutOp[] = [];
  let created = 0;
  for (const biz of data.businesses) {
    const runs = dueRecurringRuns(
      data.invoices.filter((d) => d.businessId === biz.id && d.status === 'FINAL'),
      today,
    );
    if (!runs.length) continue;
    let series = biz.series;
    const used = new Set(data.invoices.filter((d) => d.businessId === biz.id).map((d) => d.number));
    for (const run of runs) {
      for (const date of run.dates) {
        const copy = computeSales(makeRecurringCopy(run.source, date));
        const t = takeNumber(series[copy.docType], date, biz.fyStartMonth || 4, (n) => used.has(n));
        used.add(t.number);
        series = { ...series, [copy.docType]: t.series };
        puts.push(putOp('invoices', { ...copy, number: t.number }));
        created += 1;
      }
      puts.push(putOp('invoices', touch({ ...run.source, recurring: run.nextRule })));
    }
    puts.push(putOp('businesses', touch({ ...biz, series })));
  }
  if (puts.length) await commit({ puts, removes: [] });
  return created;
}

export async function purgeExpiredTrash(): Promise<number> {
  const old = expiredTrash(state().data.trash);
  if (old.length) await purgeTrash(old);
  return old.length;
}

/** One automatic backup per day, kept by the storage layer (browser: last 10; server: _system/backups). */
export async function dailyBackup(today = todayISO()): Promise<boolean> {
  const { settings, data } = state();
  if (!data.businesses.length || settings.lastAutoBackup === today) return false;
  await createBackup('auto');
  await updateSettings({ lastAutoBackup: today });
  return true;
}

// ---------------------------------------------------------------- backup / restore

export function exportSnapshot() {
  return makeSnapshot(useStore.getState().data);
}

/** Validate a backup file fully before touching live data; any failure leaves data unchanged. */
export async function importSnapshot(json: unknown): Promise<void> {
  const v = validateSnapshot(json);
  if (!v.ok) throw new UserError('This backup file failed the integrity check. Nothing was changed.', v.errors.slice(0, 20));
  await replaceAll(v.snapshot);
}

export function isPayableDoc(doc: SalesDocument): boolean {
  return DOC_TYPES[doc.docType].payable && doc.status === 'FINAL';
}

/** Housekeeping on every launch. Failures are reported, never fatal. */
export async function runStartupTasks(): Promise<string[]> {
  const notes: string[] = [];
  const attempt = async (label: string, task: () => Promise<string | null>) => {
    try {
      const note = await task();
      if (note) notes.push(note);
    } catch (e) {
      // Another tab or window ran the same housekeeping first; this tab now has its result.
      if (e instanceof StaleDataError) return;
      console.warn(`[startup] ${label} failed`, e);
      notes.push(`${label} could not run: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await attempt('Trash clean-up', async () => {
    const n = await purgeExpiredTrash();
    return n ? `${n} item(s) older than 30 days were removed from the Trash.` : null;
  });
  await attempt('Recurring invoices', async () => {
    const n = await runRecurring();
    return n ? `${n} recurring invoice(s) were created.` : null;
  });
  await attempt('Daily backup', async () => ((await dailyBackup()) ? null : null));
  return notes;
}
