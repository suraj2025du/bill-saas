# Code review: Free GST Billing (whole repository), 2026-11-07

Method: Kiro Crew Code Review Sage ruleset (design dimension + 9 code-level dimensions, consequence chain per finding, self-critique pass, red = must-fix, yellow = should-fix, nice-to-haves dropped). There is no pull request, so the whole repository at the current working tree was treated as the change. No code was changed. Findings marked **confirmed** were reproduced with a one-off Vitest file run from a scratch folder outside the repo (`C:\Users\Suraj\.kiro\crew\scratch\code-review\confirm.test.ts`, run with the repo's own `node_modules/vitest` and `--root` set to the scratch folder). Everything else is marked **by reading**.

## Summary

- **Red (must-fix): 4**
- **Yellow (should-fix): 13**
- **Ship decision reason:** 4 must-fix: foreign-currency receipts are booked 1:1 in rupees, a second open tab reissues invoice numbers and overwrites records, a failed server save is silently lost on the next restart, and the Parties and Outstanding screens freeze for about 18 s at 2,000 parties.

Design dimension: **CONCERNS**, design risk medium, criticality critical (money, tax returns and the only copy of the user's books). The layering is sound: pure engines in `src/core`, storage behind one adapter interface, a write-ahead journal and atomic renames on the server, and zod checks at the HTTP boundary. Three design gaps sit under the red findings: (1) the store assumes it is the only writer, so it does read-modify-write on whole records with numbering done in the client and no version check anywhere (R2); (2) the server updates memory before disk and treats the journal as one slot (R3); (3) the model has no "book currency amount" on payments and voucher allocations, so the multi-currency promise in REQ-7 stops at the invoice (R1). The tests are strong on `src/core` but `src/store/actions.ts`, where numbering, recurring runs, payment allocation and business ownership are decided, has no tests and sits outside the coverage gate.

---

## Red (must-fix) findings

### R1. Payments against foreign-currency invoices are posted in the books as if they were rupees

- **Severity:** red
- **Dimension:** correctness (money); docs fidelity (REQ-7)
- **Where:** `src/core/accounting/postings.ts:229` (`paymentEntry`), `src/features/sales/PaymentDialog.tsx:77`, `src/store/actions.ts:312-321` (`savePayment`), `src/core/docs/payments.ts:47` (voucher bill-wise lines)

```ts
// postings.ts paymentEntry
const b = new EntryBuilder(1);           // fx factor is always 1
...
b.dr(money, rec.amount);
b.cr(partyOrWalkin(partyId, WALKIN_LEDGER), rec.amount);
```

```tsx
// PaymentDialog.tsx: default amount is the balance in the INVOICE currency
amount: balance,
```

- **Consequence chain:** a USD invoice is posted at its exchange rate (USD 1,000 x 83 = Rs 83,000 Dr to the party), but the payment record has no currency, the dialog pre-fills the USD balance (1,000) and `savePayment` checks the amount against the USD balance, so the user can only enter 1,000 → `paymentEntry` posts Rs 1,000 to bank and party → the invoice shows **PAID** while the party ledger, trial balance, balance sheet and receivables ageing still show Rs 82,000 outstanding, and the bank balance is short by Rs 82,000. Every exporter or freelancer billing in USD/EUR gets wrong books. Bill-wise voucher lines (`line.cr` in rupees) are added to the same `paidIn` map that is compared with the USD balance, so a voucher allocation has the opposite error. REQ-7 ("convert to INR at the document's exchange rate for books") is not met for receipts.
- **Reproduce:** confirmed. USD 1,000 @ 83 export invoice, payment created exactly as `PaymentDialog` does (`amount = balance`): `salesPaymentSummary` → `PAID`; `ledgerStatement(party)` closing = **82,000** Dr.
- **Suggested fix:** store the currency and the book-currency amount on each payment (`currency`, `exchangeRate` or `bookAmount`), defaulting to the linked document's currency and a user-editable rate on the receipt date. Post `paymentEntry` with that factor and book the difference against the invoice rate to a "Foreign exchange gain/loss" ledger. Make `buildPaymentIndex` compare amounts in the document currency (convert voucher lines, which are in book currency, back with the document rate). Add a test: USD invoice + USD receipt at a different rate → party ledger 0, gain/loss = difference.

### R2. A second tab or window reissues the same invoice number and overwrites newer records

- **Severity:** red
- **Dimension:** design (single-writer assumption); correctness / regression risk; data safety
- **Where:** `src/store/actions.ts:257-263` (`saveSalesDocument`), same pattern in `savePayment` (L328-334), `saveVoucher` (L462-467), `runRecurring` (L477-503); `src/store/store.ts:49-62` (`commit`); `server/fileStore.ts:110-118`; `src/data/indexeddb.ts` `commit`

```ts
const { data } = state();                       // this tab's in-memory copy
const business = requireBusiness();
...
const exists = (n: string) => data.invoices.some((d) => d.businessId === business.id && d.id !== doc.id && d.number === n);
...
puts.push(putOp('businesses', touch({ ...business, series: { ...business.series, [doc.docType]: t.series } })));
```

- **Consequence chain:** each tab loads all data once at boot and never refreshes it → numbering (`takeNumber` + `exists`) runs against that tab's copy, and the whole `Business` record (series, bank accounts, print settings) is written back from it → the server and IndexedDB apply puts by id with no version or `updatedAt` check, so the last writer wins → a tab opened in the morning finalizes `INV/26-27/0042` after another tab already issued `INV/26-27/0042`; both are saved, and any business-settings change made in the other tab is reverted. Duplicate invoice numbers break GST Rule 46 and the GSTR-1 upload (the portal rejects a repeated `inum` per recipient), and the recurring runner in two tabs opened at the same time can create the same copies twice. Leaving the app open in one tab and starting it again from the launcher is a normal way to end up with two tabs.
- **Reproduce:** by reading. `commit` serialises writes only within one tab (`serial`), and nothing compares the stored record with the one the tab started from. The single-tab double-run of start-up tasks is guarded (`startupDone` in `App.tsx`), and the Finalize button is disabled while busy, so this needs two tabs or windows.
- **Suggested fix:** make the storage layer refuse stale writes and own the counters: (a) send the `updatedAt` each record was read with and have `FileStore.commit` / the IndexedDB transaction reject the whole batch with 409 when the stored copy is newer, then reload and retry in the client; (b) allocate document numbers inside the commit (server side or inside the IDB transaction) and enforce unique `(businessId, docType, number)`; (c) cheap first step: take a `navigator.locks.request('fgb-writer', { ifAvailable: true })` lock at boot and show "The app is already open in another tab" when it is held, plus a `BroadcastChannel` reload after each commit.

### R3. A server save that fails half-way is kept only in memory and is lost after the next save and restart

- **Severity:** red
- **Dimension:** data safety (error handling that prevents data loss); docs fidelity (`design.md` STRIDE row "Tampering: write-ahead journal")
- **Where:** `server/fileStore.ts:110-118`

```ts
commit(batch: Batch): Promise<void> {
  return this.serialize(async () => {
    const journal = join(this.dir, JOURNAL_FILE);
    await writeFileAtomic(journal, JSON.stringify(batch));
    this.apply(batch);          // memory changes first
    await this.persist(batch);  // may throw (file locked, disk full)
    await rm(journal, { force: true });
  });
}
```

- **Consequence chain:** `persist` throws after `apply` (antivirus or indexer holding `clients.json` past the 6 retries of about 0.8 s, disk full) → the client gets a 500 and does not show the change, but the server's memory has it and serves it on the next `GET /api/db` → the journal still holds the batch, but the next successful commit overwrites `journal.json` with its own batch and then deletes it, and `persist` writes only the collections that next batch touches → the failed batch's collection file is never written → after a restart the record is gone, although the user may already have seen it after a reload and printed it. Silent loss of a saved invoice or party, on Windows where file locks are common.
- **Reproduce:** confirmed. Scratch test: commit a business; make `clients.json` a directory (file cannot be replaced); commit a party → throws, server memory has 1 client; remove the directory; commit another business change → succeeds, journal removed; new `FileStore` on the same folder → **0 clients**.
- **Suggested fix:** keep memory and disk in step: apply to a copy and swap it in only after `persist` succeeds, or on any `persist` failure reload memory from disk + journal and refuse further commits until the journal is replayed. Never overwrite an existing `journal.json` (replay it first, or use one journal file per batch and delete only after its persist). Add the failure-path test above to `tests/integration/server.test.ts`.

### R4. Parties and Outstanding screens take about 18 s per ageing report at 2,000 parties

- **Severity:** red (latent must-fix: high probability for a wholesale business, the UI is frozen while it runs)
- **Dimension:** resource / performance
- **Where:** `src/core/accounting/reports.ts:446-462` (`ledgerBalanceOn`, called from `finishAgeing`), used by `src/features/parties/Parties.tsx:47-48`, `Parties.tsx:341`, `src/features/accounting/Reports.tsx:406`; recomputed whenever any record changes because of `src/store/hooks.ts:69` (`useBooks` depends on the whole `data` object)

```ts
for (const row of rows.values()) {
  row.bills = ...;
  row.total = roundTo(sign * ledgerBalanceOn(books, row.ledgerId, asOf)); // scans the whole journal per party
```

- **Consequence chain:** `receivablesAgeing` creates a row for every customer and, for each row, walks every journal entry and line → O(parties x journal lines) → 2,000 parties x 20,000 entries took **17,979 ms** on this PC → the Parties list runs both receivables and payables ageing on mount, so the main thread blocks for roughly 30 s or more, and again after every save, because `useBooks` rebuilds on any change to `data` (even dismissing a notification). The browser shows "page unresponsive"; users think the app has hung and may kill it mid-save.
- **Reproduce:** confirmed. 2,000 parties, 10,000 invoices, 10,000 receipts: `receivablesAgeing` = 17,979 ms; `monthlyPnl` = 3,721 ms.
- **Suggested fix:** compute all ledger balances in one pass (one `Map<ledgerId, number>` over the journal up to `asOf`, the same way `movements()` already does) and read from it in `finishAgeing`; precompute a `Set` of BOTH-kind party ids and a party `Map` for `ageingRow`. Make `useBooks` depend on the collections it reads (`invoices`, `purchases`, `expenses`, `receipts`, `vouchers`, `clients`, `ledgers`, `products`) instead of `data`. Add a perf test with a budget (for example under 500 ms for this data set).

---

## Yellow (should-fix) findings

### Data entry and documents

#### Y1. Switching business while an editor has unsaved changes saves the document into the other business

- **Dimension:** correctness (wrong business after switching)
- **Where:** `src/shell/Layout.tsx:56`; `src/store/actions.ts:257`, `:312`, `:363`, `saveExpense`, `saveVoucher`

```ts
if (b.id !== biz.id) void attempt(() => switchBusiness(b.id), `Switched to ${b.name}`).then(() => navigate('/'));
...
let doc = computeSales({ ...input, businessId: business.id, status: ... }); // business = the ACTIVE one
```

- **Consequence chain:** the switch is committed before navigation → the editor's "Leave without saving?" prompt fires; if the user picks Cancel to keep the draft, the editor now renders under business B → Save overwrites `businessId` with B and numbers the document from B's series → an invoice (or an edited existing invoice of A) moves into the wrong GSTIN and the wrong GSTR-1.
- **Reproduce:** by reading.
- **Suggested fix:** in every save action, refuse when `input.businessId` is set and differs from the active business (`UserError('This document belongs to another business')`), and keep `input.businessId` for existing records. Optionally block the business switcher while an editor is dirty.

#### Y2. Unsaved edits are destroyed by auto-lock, the Lock button, and navigation away from non-invoice editors

- **Dimension:** correctness (unsaved edits lost)
- **Where:** `src/App.tsx:198`, `src/shell/appState.ts:40`, `src/shell/Layout.tsx` Lock button; `useBlocker` exists only in `src/features/sales/DocEditor.tsx:146`

```tsx
else if (!unlocked) body = <LockScreen />;   // replaces the whole RouterProvider
```

- **Consequence chain:** idle auto-lock (or Lock now) swaps the router for the lock screen → the open editor unmounts with no prompt → a half-typed invoice, purchase bill (including an OCR read) or voucher is gone after unlocking. Purchases, vouchers, parties and products editors also have no unsaved-changes guard on ordinary navigation.
- **Reproduce:** by reading.
- **Suggested fix:** render `LockScreen` as an overlay above the still-mounted router (keep the state, block interaction), and reuse the DocEditor `useBlocker` + `beforeunload` pattern in the purchase, voucher, party and product editors.

#### Y3. Finalized documents stay fully editable, including number, date, party and amounts

- **Dimension:** correctness / compliance
- **Where:** `src/features/sales/DocEditor.tsx:377`; `src/store/actions.ts:256` (only CANCELLED is blocked); `src/core/docs/lifecycle.ts` `canEdit`

```tsx
onValue={(v) => update({ number: v.toUpperCase().replace(/\s/g, '') })}
```

- **Consequence chain:** a FINAL invoice can be renumbered, redated into another month or FY, given another customer, or have its total cut below the payments already received → the books and GSTR-1 change silently after a return was filed, the serial gets gaps, and a paid invoice can show a negative balance that is clamped to 0 (`payments.ts:57-63`), hiding the over-receipt.
- **Reproduce:** by reading.
- **Suggested fix:** lock number, date and party on FINAL documents (corrections go through credit/debit notes or cancel + reissue); when items change, refuse a new `totals.net` below the amount already paid; optionally add a "books closed up to" date per business.

#### Y4. Credit notes are not limited to the original invoice, and a quotation or challan can be billed twice

- **Dimension:** correctness (tax and receivables)
- **Where:** `src/core/docs/validate.ts:78-80`; `src/store/actions.ts:276-277`; `src/core/docs/lifecycle.ts:43`

```ts
if (source && CONVERTIBLE_SOURCES.has(source.docType) && !source.convertedToId) puts.push(putOp('invoices', markConverted(source, doc.id)));
```

- **Consequence chain:** (a) nothing checks that the credit notes against an invoice add up to no more than its value → output tax in GSTR-1/3B is reduced by more than was ever charged. (b) A conversion is only a draft until finalized, and `canConvert` checks `convertedToId`, which is set only on finalize → converting the same challan twice gives two drafts; finalizing both bills the customer twice (and neither moves stock, so stock is understated once).
- **Reproduce:** by reading.
- **Suggested fix:** in `validateSalesDocument` for CREDIT_NOTE, error when `sum(final credit notes for refDocId) + this > original.totals.total`. In `saveSalesDocument`, when finalizing a document whose `refDocId` points to a convertible source that already has another `convertedToId`, throw `UserError('Already converted to ...')`.

#### Y5. Duplicates, recurring copies and credit notes copy the source's e-way bill, vehicle and transport details

- **Dimension:** correctness
- **Where:** `src/core/docs/lifecycle.ts:55` (`freshCopy`), `src/core/docs/recurring.ts:53` (`makeRecurringCopy`)

```ts
return { ...source, id: newId('doc'), ... }   // dispatch (ewayBillNo, vehicleNo, transportDocNo) kept
```

- **Consequence chain:** a duplicated or monthly recurring invoice prints and exports the previous consignment's e-way bill number and vehicle → goods move with a document naming the wrong EWB, which is a detention and penalty risk under section 129. Recurring copies are also made FINAL without `validateSalesDocument`.
- **Reproduce:** confirmed. `makeRecurringCopy`, `duplicateDocument` and `createCreditNote` all return `dispatch.ewayBillNo = '321009876543'` from the source.
- **Suggested fix:** reset `dispatch` to `{ ...emptyDispatch(), buyerOrderNo, termsOfDelivery }` (or simply `emptyDispatch()`) in `freshCopy` and `makeRecurringCopy`; run `validateSalesDocument` in `runRecurring` and skip (with a startup note) copies that fail.

#### Y6. "Restart at 1 each financial year" does nothing when the FY is not part of the number

- **Dimension:** correctness
- **Where:** `src/core/docs/numbering.ts:27` with the `exists` check in `src/store/actions.ts:258`

```ts
if (series.resetEachFY && series.fy && series.fy !== fy.label) return 1;
```

- **Consequence chain:** with `includeFY: false`, the reset returns 1, but `exists` searches every FY, finds last year's `INV/0001`, and walks forward to the first unused number → the new FY continues at 0120 instead of restarting, contrary to the setting the user chose.
- **Reproduce:** confirmed. Series at 120 in 2025-26, numbers 1-119 used, first number on 2026-04-02 = `INV/0120`.
- **Suggested fix:** when `resetEachFY` is on and `includeFY` is off, limit `exists` to documents in the same FY (GST needs uniqueness per FY only), or block that combination in the numbering settings with an explanation.

### Tax and printing

#### Y7. Input tax credit on expenses is claimed in GSTR-3B even without a vendor GSTIN

- **Dimension:** correctness (tax)
- **Where:** `src/store/actions.ts:398` (`computeExpense`), `src/core/gst/returns/gstr3b.ts:248`

```ts
if (e.itcEligible) addItc(rowOf('OTH'), 1, tax);
```

- **Consequence chain:** the "Claim input tax credit" box is offered whenever the rate is above 0, with no vendor GSTIN required → that tax goes into 3B Table 4(A)(5) but can never appear in GSTR-2B → excess ITC claim, which brings a mismatch notice, reversal with interest and possibly a penalty.
- **Reproduce:** by reading.
- **Suggested fix:** in `computeExpense`, set `itcEligible` only when `vendorGstin` is a valid GSTIN, and show the reason next to the checkbox.

#### Y8. HSN 6-digit rule for businesses above Rs 5 crore is never applied

- **Dimension:** correctness (returns)
- **Where:** `src/core/docs/validate.ts:72`

```ts
const h = checkHsn(item.hsn);                 // turnoverAbove5Cr not passed
for (const m of h.errors) (strict ? err : warn)(...); // h.warnings never shown
```

- **Consequence chain:** `Business.turnoverAbove5Cr` exists but is not passed, and `checkHsn` reports the rule only as a warning that is then dropped → invoices with 4-digit HSN finalize silently → the GSTR-1 HSN table for a >Rs 5 Cr taxpayer fails portal validation at filing time, after the invoices are issued.
- **Reproduce:** by reading.
- **Suggested fix:** `checkHsn(item.hsn, business.turnoverAbove5Cr)`, surface `h.warnings`, and make it an error for `strict` documents.

#### Y9. Invoice prints the net receivable in words under the Grand Total figure

- **Dimension:** correctness (printed document)
- **Where:** `src/print/view.ts:172`; shown under `L.grandTotal` in `src/print/InvoiceDocument.tsx:271/371` and `ThermalDocument.tsx:81/91`

```ts
amountInWords: amountInWords(doc.totals.net, doc.currency),
```

- **Consequence chain:** with TDS deducted by the customer (194J at 10 percent) or TCS, `net` differs from `total` → the invoice shows "Grand Total Rs 1,18,000" next to words for Rs 1,08,000 (or the TCS-inclusive figure) → the customer or bank questions the document, since the invoice value in words must match the invoice value.
- **Reproduce:** by reading.
- **Suggested fix:** use `doc.totals.total` for `amountInWords`; if the net receivable is shown, label it separately ("Net receivable after TDS").

#### Y10. Income-tax estimate sets a business loss off against salary

- **Dimension:** correctness (tax)
- **Where:** `src/core/itr/incomeTax.ts:284`

```ts
const grossTotalIncome = Math.max(0, pos(input.salary) - standardDeduction + businessIncome + hp + otherSources);
```

- **Consequence chain:** section 71(2A) does not allow a business loss to be set off against salary → salary 15 lakh with a 5 lakh business loss gives total income 9.25 lakh and tax 0 under the new regime → the advance-tax plan understates tax, which leads to 234B/234C interest when the real return is filed.
- **Reproduce:** confirmed. `computeItr` → `new.totalIncome = 925000`, `totalTax = 0`.
- **Suggested fix:** set a business loss off only against non-salary heads (house property, other sources), carry the remainder forward, and show it in the warnings.

### Data safety, performance and guards

#### Y11. Restoring a large backup fails at the 50 MB request limit

- **Dimension:** data safety / operability
- **Where:** `server/app.ts:35`; restore path `DataSettings.tsx` → `readBackup` → `importSnapshot` → `POST /api/restore`

```ts
api.use(express.json({ limit: '50mb' }));
```

- **Consequence chain:** purchase-bill attachments are kept up to about 3 MB each inside the data → after a few dozen attachments the snapshot, and so every server backup, exceeds 50 MB → "Restore" (which downloads the backup to the browser and posts it back) fails with "Request is too large", so the user cannot restore their own backup from the app at the moment they need it.
- **Reproduce:** by reading.
- **Suggested fix:** add `POST /api/backups/:id/restore` that restores a server-side backup without the round trip, and raise or stream the limit for `/restore` file uploads; warn in Backup when the data size nears the limit.

#### Y12. Cancel and delete guards ignore bill-wise voucher allocations

- **Dimension:** correctness
- **Where:** `src/core/docs/lifecycle.ts:30`, `src/store/actions.ts:386`

```ts
if (payments.some((p) => p.docId === doc.id)) return no('Payments are recorded against it. Delete those payments first.');
```

- **Consequence chain:** receipts and payments made through vouchers with a bill-wise `docId` count as paid in `buildPaymentIndex`, but `canCancel` and `deletePurchase` check only the `receipts` collection → an invoice or bill with voucher allocations can be cancelled or deleted, leaving the voucher pointing at a cancelled or missing document and the party's bill-wise outstanding wrong.
- **Reproduce:** by reading.
- **Suggested fix:** pass vouchers to `canCancel` and check `v.lines.some((l) => l.docId === doc.id)` there and in `deletePurchase`.

#### Y13. Lists and reports redo all their work on every keystroke and every save

- **Dimension:** resource / performance; UI totals
- **Where:** `src/features/sales/SalesList.tsx:81` and `:197`; `src/core/accounting/reports.ts:335` (`monthlyPnl`); `src/store/hooks.ts:69`

```tsx
return { value: t.value + sign * d.totals.total * f, due: ... };   // sums every FINAL doc type
...
{rows.map((d) => { const s = salesPaymentSummary(d, index, today); ...
```

- **Consequence chain:** the sales list renders every matching row (10,000 table rows) with no paging, on each search keystroke → typing lags by seconds; `monthlyPnl` rebuilds stock valuation 24 times (3.7 s confirmed at 10,000 invoices); `useBooks` rebuilds the journal after any change to `data`. The list header "value" also adds quotations, proformas and delivery challans to sales value, so the figure shown is higher than real sales.
- **Reproduce:** `monthlyPnl` timing confirmed (3,721 ms); the rest by reading.
- **Suggested fix:** page or virtualise the sales list (render at most 200 rows, with "show more"); count only `payable` documents (and subtract credit notes) in the header value; compute stock movements once per `monthlyPnl` call and value month ends from the same pass; narrow `useBooks` dependencies (see R4).

---

## Test gaps (logic that can lose money or data and has no test)

- `src/store/actions.ts` has **no tests**, and `vitest.config.ts` coverage covers only `src/core`, `src/data` and `server`, so the 80 percent gate never sees it. Untested there: `saveSalesDocument` numbering and duplicate check, `savePayment` over-allocation, `runRecurring` (restart and catch-up, no duplicates), `computeExpense`, `computePurchase` with TCS, `voucherIssues`, business ownership on save (Y1), conversion marking (Y4).
- Foreign-currency receipts and voucher allocations through to the party ledger (R1).
- `FileStore.commit` when `persist` fails, and journal replacement (R3). Today's test only covers replaying a journal written by hand.
- Stale or concurrent writers: two clients committing against the same base (R2).
- Credit-note total against the original invoice; converting the same source twice (Y4).
- `freshCopy` / `makeRecurringCopy` field reset (Y5); numbering with `includeFY: false` + `resetEachFY` (Y6).
- Expense ITC without GSTIN in GSTR-3B (Y7); HSN rule above Rs 5 crore (Y8).
- A performance budget test for ageing, P&L and the sales list at realistic sizes (R4, Y13).

## Files reviewed

**Read in full, against all dimensions:**
`src/core/money.ts`, `src/core/model.ts`, `src/core/dates.ts`, `src/core/ids.ts`, `src/core/schema.ts`, `src/core/factories.ts`, `src/core/ledgers.ts`, `src/core/tds.ts`, `src/core/tdsReports.ts`, `src/core/accounting/postings.ts`, `src/core/accounting/reports.ts`, `src/core/docs/docTypes.ts`, `src/core/docs/numbering.ts`, `src/core/docs/lifecycle.ts`, `src/core/docs/payments.ts`, `src/core/docs/recurring.ts`, `src/core/docs/validate.ts`, `src/core/gst/compute.ts`, `src/core/gst/supply.ts`, `src/core/gst/rates.ts`, `src/core/gst/states.ts`, `src/core/gst/gstin.ts`, `src/core/gst/hsn.ts`, `src/core/gst/dueDates.ts`, `src/core/gst/eway.ts`, `src/core/gst/returns/gstr1.ts`, `src/core/gst/returns/gstr1Csv.ts`, `src/core/gst/returns/gstr2b.ts`, `src/core/gst/returns/gstr3b.ts`, `src/core/gst/returns/period.ts`, `src/core/itr/incomeTax.ts`, `src/core/inventory/stock.ts`, `src/core/inventory/valuation.ts`, `src/core/security/pin.ts`, `src/core/export/csv.ts`, `src/core/export/xlsx.ts`, `src/core/currency/countries.ts`, `src/core/currency/format.ts`, `src/core/currency/words.ts`, `src/data/adapter.ts`, `src/data/apply.ts`, `src/data/http.ts`, `src/data/indexeddb.ts`, `src/data/open.ts`, `src/data/trash.ts`, `src/store/actions.ts`, `src/store/store.ts`, `src/store/hooks.ts`, `src/store/errorLog.ts`, `src/App.tsx`, `src/main.tsx`, `src/shell/Layout.tsx`, `src/shell/LockScreen.tsx`, `src/shell/appState.ts`, `src/features/sales/DocEditor.tsx`, `src/features/sales/PaymentDialog.tsx`, `src/features/sales/SalesList.tsx`, `src/features/expenses/Expenses.tsx`, `src/features/settings/DataSettings.tsx`, `src/features/settings/drive.ts`, `src/print/view.ts`, `src/print/printing.tsx`, `src/ui/files.ts`, `server/app.ts`, `server/atomic.ts`, `server/backups.ts`, `server/fileStore.ts`, `server/index.ts`, `server/security.ts`.

**Read in part or by targeted search** (save, numbering, lifecycle, totals, key handlers, perf hot paths, swallowed errors, unsafe HTML/URL APIs):
`src/features/purchases/Purchases.tsx` (editor, supply kind, OCR merge, save), `src/features/accounting/Vouchers.tsx` (editor, keys, bill-wise lines), `src/features/sales/DocView.tsx` (cancel, convert, credit note, share), `src/features/sales/common.tsx`, `src/features/sales/PaymentsPage.tsx`, `src/features/parties/Parties.tsx` (list balances, detail ageing), `src/features/accounting/Reports.tsx`, `Books.tsx`, `Ledgers.tsx` (report calls only), `src/features/inventory/Products.tsx`, `Stock.tsx` (stock calls only), `src/features/gst/Gstr2bPage.tsx` (file import), `src/features/setup/SetupWizard.tsx` (sample data, restore), `src/features/settings/OtherSettings.tsx` (PIN set/remove), `src/features/itr/ItrPage.tsx` (localStorage), `src/print/InvoiceDocument.tsx`, `ThermalDocument.tsx`, `SimpleDocuments.tsx` (totals and words only), `src/ui/kit.tsx` (key handler only).

**Not reviewed in depth** (presentation code with no money, storage or security logic found by the searches above; residual risk is layout or wording bugs): `src/features/dashboard/Dashboard.tsx`, `src/features/gst/Gstr1Page.tsx`, `Gstr3bPage.tsx`, `PeriodPicker.tsx`, `TdsPage.tsx`, `src/features/purchases/ocr.ts`, `src/features/settings/BusinessSettings.tsx`, `PrintSettings.tsx`, `SettingsHome.tsx`, `UnitSelect.tsx`, `Diagnostics.tsx`, `src/print/labels.ts`, `src/print/codes.tsx`, the rest of `InvoiceDocument.tsx`, `src/shell/CommandPalette.tsx`, `HelpDrawer.tsx`, `NotificationBell.tsx`, `nav.ts`, `src/ui/Combobox.tsx`, `feedback.tsx`, `money.ts`, `src/core/gst/units.ts`, `src/core/notifications.ts`, `src/core/diagnostics.ts`, `src/data/seed.ts`, `src/help/guide.ts`, `src/store/errors.ts`, `src/index.css`, `src/version.ts`, `src/vite-env.d.ts`.

Coverage is therefore **not complete** for `src/features`, `src/print`, `src/shell` and `src/ui`: those files were checked for the risk categories in the brief (unsaved edits, business switching, shortcuts in text fields, displayed versus saved totals, XSS, swallowed errors, O(n^2) work) by search, not line by line. `src/core`, `src/data`, `src/store` and `server` were covered in full. The IDE's `grep_search` tool returned false "no matches" during this review, so every search above was redone with PowerShell `Select-String`.

Not checked: real GST portal acceptance of the generated GSTR-1/3B/e-way JSON (no portal access), browser-specific print and PDF output, and behaviour under real antivirus file locks beyond the simulated lock in R3.
