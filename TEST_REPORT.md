# Test report

Generated 2026-11-07 on the Windows dev PC (Node 22.23.3, Microsoft Edge via Playwright 1.64.1) with
`npm run heal:nightly`, which runs every gate below in one go. Regenerate on every PR (CI:
`.github/workflows/build-test.yml`, `e2e.yml`, and `nightly.yml` every night). Last run: after code review batch 03
(speed with large data), report `security-reports/nightly-2026-11-07.md` (UTC date), "All gates passed".

## Result: all gates green

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass, 0 errors |
| Lint | `npm run lint` (`--max-warnings=0`) | pass, 0 errors, 0 warnings |
| Unit + integration | `npm run coverage` | **263 / 263 passed**, 25 files, 0 skipped, 0 `.only` |
| Coverage gate (>= 80%) | same | statements **97.39%**, branches **91.64%**, functions **97.26%**, lines **98.79%** |
| Speed budgets | same (`reports-performance.test.ts`, `large-data.test.tsx`) | all within budget at 2,000 parties and 10,000 invoices (below) |
| Build | `npm run build` | pass (web + self-contained server bundle; the service worker precaches about 70 files) |
| End-to-end | `npm run e2e` | **10 / 10 passed** (5 tests x 2 storage modes) |
| Accessibility | axe-core WCAG 2 A + AA inside e2e | **0 serious / critical** problems on 50 screens and the new dialogs, both modes |
| Content-Security-Policy | e2e in server mode | **0 violations** with no `'unsafe-inline'` (PDF export included) |

## Unit and integration tests (Vitest)

Coverage scope: `src/core` (tax, GST, accounting, documents, ITR engines, diagnostics), `src/data` (storage adapters)
and `server/`. React screens are covered by the end-to-end suite instead, plus one jsdom file for the payment screens.

| File | Tests | Covers |
|---|---|---|
| tests/unit/core/gst-basics.test.ts | 15 | GSTIN and PAN checks, states and UTs, CGST+SGST / CGST+UTGST / IGST choice, exports and SEZ, place of supply, current / special / legacy slabs, UQC units, HSN/SAC |
| tests/unit/core/gst-compute.test.ts | 14 | tax per line and per document: tax-inclusive prices, discounts before tax, bill of supply and LUT exports, cess, round-off, reverse charge, TDS/TCS on a document, HSN-wise summary |
| tests/unit/core/gst-returns.test.ts | 22 | GSTR-1 (B2B, B2CL, B2CS, exports, SEZ, CDNR/CDNUR, nil/exempt, HSN B2B/B2C and the single table before May 2025, documents issued, portal JSON), GSTR-3B 3.1/3.2/4/5 + set-off order + JSON (sales under reverse charge in 3.1(a)), GSTR-2B parsing and matching, e-way bill JSON, TDS/TCS collection |
| tests/unit/core/gstr3b-review.test.ts | 20 | review batch 04: Table 4(A)(5) from an opened GSTR-2B (net of credit notes; blocked credit in 4(B)(1), documents not in the books in 4(B)(2), credit marked not available in 4(D)(2), bills and expenses missing from the GSTR-2B listed and not claimed, values that differ, expenses matched by vendor GSTIN and bill number, unused sections named), the books fallback with its warning; the 4(D) labels and JSON types; the negative liability statement (carried, set off before credit, partly used, per head, from September 2024, monthly and quarterly); sales under reverse charge in 3.1(a) and not in 3.2; no credit without a valid supplier GSTIN (expenses, purchase bills, `computeExpense`), reverse-charge credit kept |
| tests/unit/core/gst-ecommerce-csv.test.ts | 9 | GSTR-1 Table 14 per e-commerce operator (net of credit notes; reverse charge, bills of supply and invalid GSTINs left out with a warning), `supeco.clttx` JSON, TCS rate by date, operator GSTIN validation on the invoice, CSV per table (offline-tool column names, dates, place of supply, HSN merge before May 2025) |
| tests/unit/core/accounting.test.ts | 19 | journal from invoices, credit notes, purchases, expenses, receipts and vouchers (TDS, TCS, reverse charge, exports, foreign currency, VAT, suspense), trial balance, P&L, balance sheet, prior-year profit, ledger statement, receivables ageing |
| tests/unit/core/docs.test.ts | 21 | seven document types, FY numbering, payment status, conversion, credit notes, cancellation (refused while a voucher is set against the invoice), recurring invoices, pre-save validation and warnings |
| tests/unit/core/foreign-payments.test.ts | 11 | payments against dollar invoices and bills through to the party ledger: older payments at the invoice rate (party cleared), a receipt or payment at another rate (exchange gain or loss, trial balance, P&L), part-payments (ageing equals the ledger), rupee payments and bill-wise voucher lines counted in dollars, on-account payments in rupees; currency defaults, schema checks of currency and rate, the payments and voucher lines behind a document's paid amount, payments and receipt / payment voucher lines merged |
| tests/unit/core/itr.test.ts | 11 | new and old regime (zero tax up to Rs 12.75 lakh salary, marginal relief, deductions, senior citizens, surcharge), house-property loss, 44AD/44ADA/44AE, 234B/234C, advance tax |
| tests/unit/core/tax-ledgers-export.test.ts | 12 | Income-tax Act 2025 forms from 1 Apr 2026, 194C/194Q thresholds, 206C(1H) only before 1 Apr 2025, ledgers, PIN hashing, CSV formula-injection guard, XLSX workbook |
| tests/unit/core/currency.test.ts | 8 | 22 countries and currencies, Indian (lakh/crore) and international number formats, amounts with paise / sub-units |
| tests/unit/core/money-dates.test.ts | 10 | money rounding without float errors, input parsing, April and calendar financial years, quarters, GST periods |
| tests/unit/core/data-stock-factories.test.ts | 9 | backup file validation, stock movements, low stock, valuation (weighted average, last purchase, standard cost), record factories |
| tests/unit/core/notifications.test.ts | 4 | monthly and QRMP GST due dates, overdue invoices, low stock, backup reminders, dismissals |
| tests/unit/core/diagnostics.test.ts | 5 | error descriptions, browser noise filter, repeat counting per screen and day, 50-entry cap, bell notice since the last visit |
| tests/unit/data/seed-trash.test.ts | 5 | sample business (its credit claims all have a valid vendor GSTIN), unique numbers across financial years, trash and 30-day purge |
| tests/unit/csp.test.ts | 2 | CSP has no `'unsafe-inline'` / `'unsafe-eval'`; the one style hash is recomputed from the installed html2canvas-pro, so an upgrade that changes it fails here |
| tests/unit/print-codes.test.ts | 4 | CODE-128 bars, barcode and QR code SVG without style attributes, UPI links |
| tests/integration/server.test.ts | 27 | REST API, host guard (DNS rebinding), client header, content type, batch validation (including `base` versions), a batch based on an older version refused with 409 and nothing written, restore with pre-restore backup, backups and path-traversal guard, journal replay, interrupted-restore recovery, concurrent saves, atomic writes; a save whose data file is locked (kept in the journal, written by the next save, later saves refused while locked, nothing lost after a restart), a journal that cannot be written; a 54 MB backup file restored, a server backup restored in place (missing, invalid and damaged ones refused), the 50 MB limit kept for saves |
| tests/integration/adapters.test.ts | 10 | IndexedDB adapter (atomic commits, restore rollback, local backups, two connections refusing a write from an older copy, local backup restored in place) and HTTP adapter against the real server app (409 as `ConflictError`, server backup restored in place) |
| tests/integration/payments-store.test.ts | 6 | the payment action on browser storage: a dollar payment checked against the dollar balance and saved with its currency and rate, defaults for a payment without a currency, a missing rate refused; an invoice cancel and a bill delete refused while a voucher is set against them |
| tests/integration/old-data.test.ts | 6 | a backup written by the version before batch 02 (dollar payments without a currency): integrity check, restore into IndexedDB (also from a stored backup), restore on the server from a file and from its backup folder, opened as the live data folder, all with the statuses that version showed; old payments post at their invoice rates; a new payment on that data is saved with its currency and a stale tab is still refused |
| tests/unit/core/reports-performance.test.ts | 8 | speed budgets on `tests/fixtures/large.ts` (2,000 parties, 10,000 invoices, 10,800 receipts and payments, 1,000 bills, vouchers, expenses, 300 stock items): books 1,000 ms, receivables ageing 500 ms, payables ageing 200 ms, month-by-month P&L 500 ms (fastest of three runs); the same figures as the code before batch 03 (fingerprints of the ageing, P&L, balance sheet and trial balance), ageing totals equal to the ledger statements, each month equal to that month's P&L, stock valued on several dates equal to one date at a time |
| tests/unit/ui/large-data.test.tsx | 4 | jsdom: the invoice list with 10,800 documents opens within 2,000 ms with 200 rows and "Show 200 more", typing stays within 750 ms per keystroke; the All tab header shows sales without quotations or challans and a one-type tab its own value (sample business); the books hook is rebuilt for an invoice change but not for a settings or godown save |
| tests/unit/ui/payment-screens.test.tsx | 5 | jsdom screens with the sample business: a receipt voucher on the Payments page (tagged Voucher), in the invoice's Payments card and in Received this month; the dollar invoice's amount and balance in dollars in the invoice list; the payment dialog asks for the exchange rate, shows the rupee value and gain, and saves both |
| tests/unit/ui/gstr3b-screens.test.tsx | 5 | jsdom screens with the sample business (review batch 04): the GSTR-3B page shows the 4(D) rows of the form and says 4(A)(5) comes from the books until a GSTR-2B is opened; Open GSTR-2B takes 4(A)(5) from the file, lists a document missing from the books (reversed in 4(B)(2)) and stops using the file for another month; a GSTR-2B of another GSTIN is refused; the expense dialog offers "Claim input tax credit" only with a valid vendor GSTIN and takes it away again on a typo |
| tests/integration/multi-tab.test.ts | 16 | two tabs on the same storage, in both modes (IndexedDB and the local server): a stale tab cannot reuse an invoice number (automatic or typed), cannot undo business settings, cannot overwrite a party from an editor opened earlier, and does not create recurring copies twice; saves queued behind a refused one are refused too; two finalizes started together in one tab cannot share a number; start-up housekeeping done by another tab is skipped quietly |

## End-to-end tests (Playwright)

Every test runs twice: **server-mode** (`node server.js` with the strict CSP, data in JSON files, fresh data folder
per run) and **browser-mode** (`vite preview` static hosting, data in IndexedDB). The server's data is emptied through
`/api/restore` before each test, so the tests do not depend on each other.

| Spec | What it proves |
|---|---|
| `tests/e2e/smoke.spec.ts` | First run wizard (wholesale preset, GSTIN `27AAPFS1234K1ZW`), new tax invoice for a walk-in customer (2 x Rs 250 + 18% = Rs 590.00), finalize, record payment (status Paid), PDF download, GSTR-1 B2C (Others) row Rs 500.00 taxable / Rs 45.00 tax, trial balance and balance sheet balance, no console errors, axe check on dashboard and invoice editor |
| `tests/e2e/screens.spec.ts` | Loads the sample business, then opens 44 routes plus 6 detail screens (invoice, party, product, purchase bill, voucher, ledger): each renders a heading, shows no error screen, logs no console error and has no serious / critical axe problem |
| `tests/e2e/features.spec.ts` (1) | Unit "Bundle" (code BNDL, UQC BDL) created from an invoice line's "+ Add custom unit..." with an axe check on the dialog; sale through an e-commerce operator; GSTR-1 Table 14 shows Rs 10,000.00 net value and Rs 50.00 TCS; the CSV ZIP contains `eco.csv` and the HSN row with UQC BDL; GSTR-3B CSV has the 3.1(a) row; Settings > Units refuses the same code again; Diagnostics data check passes with no recorded problems |
| `tests/e2e/features.spec.ts` (2) | An error thrown from a timer reaches the bell ("1 app problem recorded"), opens Settings > Diagnostics with the message, and is no longer counted after that visit |
| `tests/e2e/two-tabs.spec.ts` | Two tabs of the same browser on the same data: the newer tab issues `INV/../0001`; the tab opened earlier is refused with "Another tab or window saved changes first", loads the latest data and gets `INV/../0002` on the next Finalize (review R2) |

Run times on this PC: smoke 7-10 s, features 2-12 s, two tabs 5-7 s, every-screen sweep about 1.2-1.3 min per mode,
whole suite 3.5 min.

Speed at the code review's data size, before and after batch 03 (fastest of three runs on this PC, a 4-core i5-1135G7
with most of its memory in use; "coverage" is the same run under V8 coverage, as in `heal:nightly`):

| Measured | Before | After | After, coverage | Budget |
|---|---|---|---|---|
| Receivables ageing (Parties list, party page, Outstanding) | 6,175 ms (review: 17,979 ms) | 54-76 ms | 86 ms | 500 ms |
| Payables ageing | 940 ms | 30-33 ms | 33 ms | 200 ms |
| Month-by-month P&L | 1,785 ms (review: 3,721 ms) | 52-56 ms | 97 ms | 500 ms |
| Books (journal) build, unchanged code | 88 ms (average of three) | 80-85 ms | 164 ms | 1,000 ms |
| Invoice list, opening (jsdom) | 7,037 ms (one run; out of memory at 700 MB) | 298-395 ms | 396 ms | 2,000 ms |
| Invoice list, per keystroke (jsdom) | 2,739 ms | 122-172 ms | 180 ms | 750 ms |

Problems from the 2026-11-07 compliance research (rows 1, 18, 26, 32) and code review (Y7), reproduced by failing tests
first and fixed in batch 04 (GSTR-3B): all 20 tests in `gstr3b-review.test.ts` failed on the old code (it had no
GSTR-2B input, so October's 4(A)(5) was the books' Rs 360.00 CGST where the GSTR-2B gives Rs 306.00; Rs 162.00 of
negative IGST was dropped; a Rs 1,000 sale under reverse charge was in 3.1(c); an expense without a GSTIN claimed
credit), and all 5 tests in `gstr3b-screens.test.tsx` failed against the old screens (old 4(D) labels, no Open GSTR-2B
button, the claim box enabled without a GSTIN). Row 32 was UNVERIFIED; the GSTN system-generated GSTR-3B maps GSTR-1
Table 4B into 3.1(a), so it was fixed too.

Problems from the 2026-11-07 code review, reproduced by failing tests first and fixed in batch 03 (speed with large
data): R4 (the times above; the receivables test failed with "expected 6175 to be less than 500"); Y13 (the P&L, list
and keystroke times above; the All tab header showed "value ₹8,77,522.00" where sales are ₹6,71,513.00 on the sample
business; the books were rebuilt after a settings save); the test gap "a performance budget test" (closed by the two
new files).

Problems from the 2026-11-07 code review and design critique, reproduced by failing tests first and fixed in batch 02
(foreign-currency payments and receipt vouchers):

- R1: a USD 1,000 invoice at 83 showed Paid after a 1,000 payment while the party ledger still showed Rs 82,000 Dr
  (6 failing tests in `foreign-payments.test.ts`); on a backup written by the old version the dollar customer's ledger
  read Rs 6,48,825 instead of Rs 2,02,200 (`old-data.test.ts`); the store saved no currency and asked for no rate
  (`payments-store.test.ts`), and the payment dialog had no rate field (`payment-screens.test.tsx`).
- Y12: an invoice with a receipt voucher set against it was cancelled, and a bill with a payment voucher was deleted.
- F06: the receipt voucher was missing from the Payments page and the invoice's Payments card, and Received this month
  showed Rs 1,172.00 instead of Rs 26,172.00 (3 failing screen tests).
- F07 was not reproduced: the screen test passed before any change, with `$3,900.00` in both columns.

Problems from the 2026-11-07 code review, reproduced by failing tests first and fixed in batch 01 (data safety):

- R2: a stale second tab reissued an invoice number, reverted business settings, overwrote a party and repeated
  recurring copies (10 failing tests in `multi-tab.test.ts` across both storage modes).
- R3: a save whose data file was locked was lost after the next save and a restart (`server.test.ts`, 0 parties after
  the restart instead of 1).
- Y11: a 54 MB backup file got HTTP 413, and there was no way to restore a listed backup without uploading it.

Problems the tests found and that were fixed in the previous round:

- Modal and Drawer had `role="dialog"` without an accessible name (axe `aria-dialog-name`); they now point
  `aria-labelledby` at their title.
- The strict CSP showed three blocked inline styles during PDF export: html2canvas-pro's fixed pseudo-element style
  (now allowed by its hash) and two style attributes written while re-serialising inline SVG (QR codes and barcodes
  are now SVG images, so nothing is re-serialised).

## Not covered yet

- Lighthouse performance budgets (`@lhci/cli` is not installed; needs approval). Start-up JavaScript is now about
  710 kB (index 455 kB + shared 251 kB) after route-level code splitting, down from 1,128 kB.
- API collections (Bruno / Hoppscotch): the API is covered by `tests/integration/server.test.ts` instead.
- Manual checks that need real devices or accounts: a thermal printer, OCR on real supplier bills, Google Drive sign-in,
  and uploading the GSTR-1 / e-way bill JSON to the government portals.
