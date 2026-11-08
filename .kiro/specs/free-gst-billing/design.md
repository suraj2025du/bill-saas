# Design - Free GST Billing

## Architecture overview

| Layer | Folder | Role |
|---|---|---|
| Domain (pure TypeScript, no I/O) | `src/core` | model + zod schemas, money / dates, GST engine, documents and numbering, accounting postings and reports, GST returns (GSTR-1/3B/2B, e-way bill), TDS/TCS, ITR, notifications, CSV/XLSX export |
| Storage adapters | `src/data` | `HttpAdapter` (server mode) and `IndexedDbAdapter` (browser mode) behind one `StorageAdapter` interface; `open.ts` probes `/api/health` and picks one |
| State | `src/store` | zustand store, a serial commit queue, domain actions (finalize, convert, payments, vouchers, recurring, backup, import) |
| UI | `src/ui`, `src/shell`, `src/features`, `src/print` | UI kit, layout and command palette, feature screens, print engine (HTML documents, PDF via html2canvas-pro + jsPDF, ZIP via JSZip) |
| Local server | `server/` -> `dist-server/server.mjs` (express and zod bundled in), started by `server.js` | Express 5 on 127.0.0.1:47371: static app + REST API, JSON file store with journal, backups |
| Diagnostics | `src/core/diagnostics.ts`, `src/store/errorLog.ts`, Settings > Diagnostics | local error log (localStorage), bell notice, data integrity check, downloadable report without business records |

The books are not stored: `buildJournal` derives every posting from documents at read time, so a document edit can never
leave the ledgers out of step.

## Data-flow diagram

```
 [User] --keyboard/mouse--> [Browser page: React app]
                                 |  (TB1) fetch /api/* with X-GST-Client: 1, JSON only
                                 v
                    [server.js on 127.0.0.1:47371] --atomic write + journal--> [_system/data/*.json]
                                 |                --daily / pre-restore-->      [_system/backups/*.json]
                                 |                <--restore in place, by id--  [_system/backups/*.json]
 [Other websites in the same browser] ...(TB2: blocked by host guard + custom header)...> server

 [Browser page] --(TB3) imported files: backup JSON, GSTR-2B JSON, bill photos (OCR in a web worker)--> validated in src/core
 [Browser page] --(TB4, optional) OAuth token + backup upload--> [Google Identity Services, Drive API]
 [Browser page] --(TB5) exported files: PDF, ZIP, CSV, XLSX, portal JSON--> [Excel, GST portal, NIC e-way portal]
 Browser mode: [Browser page] <--> [IndexedDB] (same origin only)
 Build / CI: [npm registry, GitHub Actions] --(TB6 supply chain)--> node_modules, dist
```

## STRIDE threat model

| Threat | Where | Risk | Mitigation | Status |
|---|---|---|---|---|
| **S**poofing | TB2: a website sends requests to 127.0.0.1:47371, or uses DNS rebinding | data read or changed by another site | Host allow-list (`127.0.0.1`, `localhost`, `[::1]` on the app port); every API call needs `X-GST-Client: 1`, which forces a CORS preflight that is never approved | done, tested (`server.test.ts`) |
| **T**ampering | TB3: a corrupt or edited backup / import file | wrong or broken books | zod schema for every record, duplicate and reference checks; restore is all-or-nothing and saves a pre-restore backup first | done, tested |
| **T**ampering | TB1 / disk: power cut during a save or restore | half-written data | write-ahead journal replayed at start; atomic rename; interrupted restore rolls back | done, tested |
| **T**ampering | TB1 / IndexedDB: a second tab, window or browser saving from the data it loaded earlier (review R2) | the same invoice number issued twice (GST Rule 46, GSTR-1 rejects a repeated number), newer records and business settings overwritten, recurring copies made twice | every write carries the `updatedAt` its tab last loaded (`base`); `FileStore.commit` and the IndexedDB read-write transaction refuse the whole batch on any mismatch (HTTP 409); the tab reloads and the user saves again; every number claim, typed or automatic, also writes the business record; save actions refuse a screen's older copy of a record | done, tested (`multi-tab.test.ts`, `two-tabs.spec.ts`) |
| **D**enial of service (data loss) | disk: a data file locked (antivirus, indexer) or the disk full after the journal was written (review R3) | a saved invoice or party gone after the next save and a restart | the journal is the commit point and memory changes only after it is on disk; a change that could not reach its data file stays in the journal, is written before the next save (refused while that fails) and is replayed at start; a journal is never replaced early | done, tested (`server.test.ts`) |
| **T**ampering | TB1 / TB3: a save or a backup file with a payment currency or exchange rate that is not valid (review R1 added both fields) | foreign payments valued wrongly, books out of balance with the bank | the receipts schema allows a missing currency (older data) but otherwise only a three-letter code and a positive rate, on every save through `/api/commit` and on every restore; `savePayment` refuses a foreign payment without a rate | done, tested (`foreign-payments.test.ts`, `payments-store.test.ts`) |
| **T**ampering | UI / store: an invoice cancelled or a bill deleted while a voucher is set against it bill-wise (review Y12) | the voucher points at a cancelled or missing document; the party's bill-wise outstanding is wrong | `canCancel` and `deletePurchase` look at voucher lines as well as payments and name the voucher to change first | done, tested (`docs.test.ts`, `payments-store.test.ts`) |
| **D**enial of service | UI thread: a business with large data (2,000 parties, 10,000 invoices) opens Parties, Outstanding, the P&L or the invoice list (review R4, Y13) | the screen freezes for seconds (about 18 s per ageing report in the review), again after every save; the browser reports the page as unresponsive and the user may close it while it saves | ageing totals from one pass over the journal and parties looked up by id; ledger names remembered per set of books; every month's stock valued in one pass; books rebuilt only when their records change; invoice list sorted once and drawn 200 rows at a time; speed budgets at that size in every test run | done, tested (`reports-performance.test.ts`, `large-data.test.tsx`) |
| **T**ampering | TB3: a GSTR-2B JSON opened on the GSTR-3B page that belongs to another GSTIN or period, or was edited (compliance row 1) | Table 4 claims credit that the portal's own GSTR-2B does not hold | `parse2b` reads only B2B invoices and credit/debit notes (other sections are named, not used); a file of another GSTIN is refused and one of another period is not used (warning, books figure); every document not in the books is reversed in 4(B)(2) and listed, every bill or expense of the period missing from the file is listed and not claimed; the portal fills 4(A) from its own GSTR-2B | done, tested (`gstr3b-review.test.ts`, `gstr3b-screens.test.tsx`) |
| **T**ampering | UI / store: "Claim input tax credit" on an expense, or tax on a purchase bill, whose supplier has no valid GSTIN (review Y7) | excess credit in GSTR-3B 4(A)(5): mismatch notice, reversal with interest, penalty | `computeExpense` clears the claim on save without a valid GSTIN and the form disables the box with the reason; `buildGstr3b` leaves such credit out (older data included) and counts it in a note; reverse-charge and import credit are not affected | done, tested (`gstr3b-review.test.ts`, `gstr3b-screens.test.tsx`, `seed-trash.test.ts`) |
| **R**epudiation | finalized documents changed later | disputes about what was billed | numbers fixed at finalize, cancel instead of delete, deleted records kept 30 days in trash, daily backups (30 kept) | partial: no per-edit audit log (single-user local app) |
| **I**nformation disclosure | disk: `_system/data` readable by anyone using the Windows account | customer and sales data exposed | server reachable only from this PC; PIN lock for the screen; advice to use a Windows password and BitLocker | accepted: files are not encrypted |
| **I**nformation disclosure | TB4: Google Drive backup | wider Drive access | `drive.file` scope (only files the app created); token kept in memory; CSP `connect-src` limited to Google APIs | done |
| **D**enial of service | TB1: very large or many requests | server stalls | 50 MB body limit (500 MB for a backup file sent to `/api/restore` only, review Y11), 5000 changes per save, serial commit queue; loopback only | done, tested |
| **E**levation of privilege | TB3 / UI: script or CSS injection through names, notes or imported text | code runs in the app, or CSS leaks data | React escaping, no `dangerouslySetInnerHTML`; CSP without `'unsafe-inline'` for scripts and styles (one hash for html2canvas-pro's fixed style, checked by a unit test); print `@page` rules via a constructed stylesheet; QR codes and barcodes as SVG images | done, tested (e2e runs under the CSP with 0 violations) |
| **I**nformation disclosure | Diagnostics download | business data shared by mistake | the error log stays in this browser's storage; the download is user-initiated and holds only version, storage, record counts, backup dates and error messages | done |
| **T**ampering | TB6: release ZIP | users run a modified or untested build | ZIP built in CI from the lockfile after lint, tests and e2e; published as a GitHub Release only after approval of the `production` environment; the bundled server needs no `npm install` on the user's PC | done (approval rule is set up after the first push) |
| **E**levation of privilege | TB5: CSV opened in Excel | formula injection | cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'` (OWASP CSV guard) | done, tested |
| **T**ampering | TB6: compromised npm package or GitHub Action | malicious build | lockfile, OSV-Scanner + Trivy + npm audit, CI actions pinned to commit SHAs (trivy-action >= v0.36.0 after CVE-2026-33634) | done |

## Payment surfaces

None. The app records payments in the books and prints a UPI QR code that opens the customer's own UPI app. It never
sees card data and never moves money, so the `payments-pci.md` controls do not apply.

## Key decisions

- Storage mode is chosen at start by probing `/api/health` (1.5 s timeout); static hosting falls back to IndexedDB.
  `vite preview` has no API proxy, so a test or preview can never touch a running copy's data.
- ITC set-off: IGST credit first (split to cover CGST / SGST shortfalls), then CGST credit (CGST, then IGST), SGST credit
  (SGST, then IGST); cess only against cess; reverse-charge tax always in cash.
- Router: `createHashRouter` (a data router), so the unsaved-changes prompt (`useBlocker`) works with static hosting.
- Service worker: registered only in production builds, on a secure context, outside iframes.
- Screens load on first visit (`route.lazy` from React Router, `React.lazy` for the setup wizard); the dashboard stays in
  the start-up bundle. Editors keep `Remount`, so each navigation still gives a fresh form.
- E-commerce sales stay in their normal GSTR-1 table and are also totalled per operator in Table 14 (`supeco.clttx`).
  Section 9(5) supplies (the operator pays the tax) are not supported and are left out with a warning.
- Diagnostics are local-only (no Sentry): the product promise is that nothing leaves the PC. The bell is the alert
  channel; `npm run heal:nightly` and `nightly.yml` re-run every gate and open an issue on failure.
- The server is bundled with its dependencies (`ssr.noExternal`), so a release is `dist/` + `dist-server/` + launcher.
- Several tabs (review R2): optimistic concurrency per record instead of a single-writer lock, because a second
  browser on the same server shares no lock with the first. `store.commit` takes each record's `updatedAt` from the
  tab's data when the batch is made; storage compares it with the stored record (`findConflicts`) and refuses the
  whole batch on a mismatch (`ConflictError`, HTTP 409), after which the tab reloads (`StaleDataError`). `nowISO()`
  never repeats within a tab, so every save gives a new version. Numbering stays in the client: a typed or automatic
  number always writes the business record, so two tabs cannot both claim a number.
- Server journal (review R3): the journal is the commit point, the data files are checkpoints. A batch is in memory
  only once its journal is on disk; one waiting for a locked data file is written before the next batch is accepted.
- Restore (review Y11): a listed backup is restored where it is kept (`POST /api/backups/:id/restore`, or inside
  IndexedDB), so it never travels to the browser and back. A backup file upload may be up to 500 MB, under the
  ~512 MB a JavaScript engine can hold as one JSON string, so every backup this app writes can be restored.
- Payments in another currency (review R1): a payment record keeps `currency` and `exchangeRate` (book currency per
  unit on the payment date). `paymentFx` (in `postings.ts`) gives older records, which have neither, the linked
  document's currency and rate, or the book currency when not linked, so no migration is needed and old statuses stay.
  `paymentEntry` posts cash / bank at the payment's value, the party at the document's rate and the difference to
  `sys:fx-gain-loss` (Exchange Gain/Loss under Indirect Expenses, as in ERPNext's standard chart of accounts; India
  Compliance builds on ERPNext). `buildPaymentIndex` counts everything in the document's currency: a payment in that
  currency as entered, voucher lines (book currency) and other currencies at the document's rate.
- Payment lists (design F06): `buildPaymentIndex` also keeps the payments and voucher lines behind each document's paid
  amount (`settlements`), so the invoice and bill screens list exactly what the status counts; `partyPayments` merges
  payment records with the party lines of receipt and payment vouchers for the Payments page and the dashboard.

- Speed with large data (review R4, Y13): the books are still derived from the records, but each report makes one
  pass where it made one per party or per month. `ledgerBalancesOn` gives every ledger's balance from one journal
  pass (it adds in the same order as the old per-party scan, so the totals are identical); `ledgerInfo` remembers
  resolved ledgers per `Books` object in a `WeakMap`, so a report no longer searches the party list for every line;
  `closingStockValues` values several dates from one sorted list of stock movements (the same code as `valueStock`);
  `useBooks` selects the eight collections it reads instead of the whole data object; the invoice list sorts once per
  change of the documents and draws 200 rows at a time. The budget tests take the fastest of three runs, and the
  budgets are about five times the time measured under coverage, so a busy PC does not fail them while a return to
  per-party or per-month work does. `reports-performance.test.ts` also compares fingerprints of every report on the
  large data with the ones the code produced before this change.

- GSTR-3B (batch 04): Table 4 follows CBIC Circular 170/02/2022-GST para 4.3 when a GSTR-2B is open: 4(A)(5) is every
  GSTR-2B document with ITC available, net of credit notes; blocked credit is reversed in 4(B)(1), a document that is
  not in the books (not received or not recorded) in 4(B)(2), and ITC marked not available goes to 4(D)(2). Bills and
  expenses are matched by supplier GSTIN and `normalizeDocNo`, as on the GSTR-2B page, with a Rs 1 tolerance for
  "values differ". Without a GSTR-2B the books figure stays as a fallback, with a note. 3.1(d), 4(A)(1) to (4) and
  4(D)(1) still come from the books. The negative liability statement is not stored: its balance is recomputed, head
  by head, from the invoices of every earlier return of the same frequency since September 2024 (when the portal
  started it) and used before ITC, as the GSTN user guide describes. Outward reverse-charge sales go to 3.1(a) at
  taxable value only, as the system-generated GSTR-3B maps GSTR-1 Table 4B and India Compliance does.
