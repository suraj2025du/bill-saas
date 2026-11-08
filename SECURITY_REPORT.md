# Security report

Generated 2026-11-07 with `npm run heal:nightly` (gitleaks, OSV-Scanner, Trivy and `npm audit` as part of the
nightly self-check). Raw reports: `security-reports/` (git-ignored). Regenerate on every PR and before every release;
CI runs the same tools in `.github/workflows/security.yml`, now also every night. Last run: after code review batch 03
(speed with large data), `security-reports/nightly-2026-11-07.md` (UTC date), "All gates passed" with the results
below.

## Result: no open finding of medium severity or higher

| Layer | Tool | Ran | Findings |
|---|---|---|---|
| Secrets | Gitleaks 8.30.1 (`gitleaks dir .`, whole folder) | yes | **0** |
| Dependencies | Trivy 0.75.0 (`fs`, MEDIUM+) | yes | **0** |
| Dependencies | OSV-Scanner 2.6.0 | yes | **0** open; 1 low accepted (below) |
| Dependencies | `npm audit --omit=dev` | yes | production: **0** |
| SAST | Semgrep | **no, not installed** | - |
| DAST | OWASP ZAP baseline | **no, needs Docker or CI** | - |

## Fixed in review batch 04: GSTR-3B (2026-11-07)

Tax-integrity and input-handling findings from `docs/reviews/2026-11-07-compliance-research.md` (rows 1, 18, 26 and
32) and `docs/reviews/2026-11-07-code-review.md` (Y7); fix log in `docs/reviews/fixes/2026-11-07-04-gstr3b.md`.

| Item | Before | Now |
|---|---|---|
| Row 1: source of Table 4(A)(5) (integrity of the return) | every purchase bill and expense dated in the period was claimed, also bills the supplier never reported, so 4(A)(5) could exceed GSTR-2B (excess claim, DRC-01C notice, reversal with interest) | with the period's GSTR-2B open, 4(A)(5) is the GSTR-2B's credit, net of its credit notes; blocked credit is reversed in 4(B)(1), documents not in the books in 4(B)(2), credit marked not available goes to 4(D)(2), and bills and expenses missing from the GSTR-2B are listed and not claimed (CBIC Circular 170/02/2022-GST); without a GSTR-2B the books figure is shown with a warning |
| Input handling (row 1) | the GSTR-3B page read no file | the GSTR-2B JSON goes through the existing `parse2b` (B2B invoices and credit/debit notes only; other sections are named and not used); invalid JSON is refused with a message, a file of another GSTIN is refused, and one of another period is not used; the file is never saved, it stays in the page's memory |
| Y7: credit without a supplier GSTIN (integrity) | "Claim input tax credit" on an expense needed no GSTIN, and tax on purchase bills from unregistered suppliers also went to 4(A)(5): credit that can never be in GSTR-2B | saving an expense clears the claim without a valid vendor GSTIN and the form disables the box with the reason; GSTR-3B leaves such credit out (older data included) and says how many bills and expenses it left out; reverse-charge and import credit are not affected |
| Row 26: negative liability (integrity) | the negative tax of a period was dropped ("not carried forward automatically") | carried to a negative liability statement worked out from the invoices since September 2024 and set off, head by head, against the tax of later returns before credit |
| Rows 18 and 32: labels and table (integrity of the return) | 4(D)(1) was labelled "Rule 38 (banking company)"; sales under reverse charge were in 3.1(c) | the 4(D) rows are named as in the form; sales under reverse charge are in 3.1(a) at taxable value with no tax, as the portal fills it from GSTR-1 Table 4B |

No stored data format changed: older expenses keep their saved flag, and GSTR-3B decides from the GSTIN.

## Fixed in code review batch 03: speed with large data (2026-11-07)

Availability and integrity findings from `docs/reviews/2026-11-07-code-review.md`; fix log in
`docs/reviews/fixes/2026-11-07-03-speed.md`.

| Item | Before | Now |
|---|---|---|
| R4: Parties and Outstanding with 2,000 parties (availability, and a data-loss risk) | each ageing report scanned the whole journal once per party: about 18 s in the review (6.2 s on the test data set here), and again after every save; the browser reported the page as unresponsive, and a user who closed it then could lose a save in progress | every party's total comes from one pass over the journal: 54-86 ms on the same data, with the same figures (fingerprints of every report compared with the old code's) |
| Y13: lists and reports (availability) | the month-by-month P&L valued the stock 24 times (1.8 s here, 3.7 s in the review); any save, even dismissing a notification, rebuilt the books; the invoice list drew all 10,800 rows (7 s to open, 2.7 s per keystroke in jsdom, out of memory with a 700 MB limit) | one stock pass for all month ends (52-97 ms); books rebuilt only when their records change; the list is sorted once and drawn 200 rows at a time (0.3-0.4 s to open, 0.12-0.18 s per keystroke) |
| Y13: sales figure in the invoice list header (integrity of a shown total) | the All tab's "value" added quotations, proformas and delivery challans (Rs 8,77,522 instead of Rs 6,71,513 on the sample business) | the All tab shows sales: invoices, bills of supply and debit notes less credit notes; the other tabs show their own documents' value, as before |
| Regression guard | no speed test | budget tests at the review's data size in every Vitest run and in `heal:nightly` |

No input handling or stored data changed in this batch.

## Fixed in code review batch 02: foreign-currency payments and receipt vouchers (2026-11-07)

Integrity and input-handling findings from `docs/reviews/2026-11-07-code-review.md`; fix log in
`docs/reviews/fixes/2026-11-07-02-currency-receipts.md`.

| Item | Before | Now |
|---|---|---|
| R1: payments in another currency (integrity of the books) | a dollar payment was posted as rupees one to one, so a paid USD invoice left almost all of it in the party ledger and the bank short by the same amount; voucher lines in rupees were counted as dollars | each payment keeps its currency and rate; cash or bank gets the payment's value, the party is cleared at the invoice's rate and the difference goes to Exchange Gain/Loss; voucher lines count at the invoice's rate; older payments keep their meaning (invoice currency at the invoice's rate), so existing data and backups open and restore with the same statuses |
| Input handling (R1) | - | the receipts schema accepts a missing currency (older data) and otherwise only a three-letter code and a positive rate, on every save through `/api/commit` and every restore; the payment action refuses a foreign payment without a rate |
| Y12: cancel and delete guards (integrity) | an invoice or bill with a bill-wise voucher could be cancelled or deleted, leaving the voucher pointing at it | refused while a voucher is set against it, naming the voucher |

Payments are still only records in the books: no card data and no money movement, so the PCI controls still do not apply.

## Fixed in code review batch 01: data safety (2026-11-07)

Integrity and data-loss findings from `docs/reviews/2026-11-07-code-review.md`; fix log in
`docs/reviews/fixes/2026-11-07-01-data-safety.md`.

| Item | Before | Now |
|---|---|---|
| R2: a second tab or window (integrity) | each tab saved from the copy it loaded at start; the last writer won, so a stale tab reissued invoice numbers and reverted newer records and business settings | every write carries the `updatedAt` its tab last loaded; the server and the IndexedDB transaction refuse the whole batch on a mismatch (HTTP 409), the tab reloads and the user saves again; typed numbers also write the business record; screens holding an older copy are refused |
| R3: a save that fails half-way (data loss) | memory changed before the data files; the next save replaced `journal.json`, so after a restart the failed change was gone | the journal is the commit point; a change waiting for a locked file is written before the next save (refused while that fails) and replayed at start; a journal is never replaced early |
| Y11: restoring a large backup (availability) | every restore was one request under the 50 MB limit | listed backups are restored on the server or in IndexedDB without an upload; `/api/restore` alone accepts up to 500 MB; every other request keeps 50 MB |
| Input handling | - | `base` versions in a batch are checked (null, or a string of at most 64 characters) before anything is saved |

## Fixed in the previous round

| Item | Before | Now |
|---|---|---|
| Content-Security-Policy | `style-src 'self' 'unsafe-inline'` | `style-src 'self' 'sha256-UP0QZg...l3g=' https://accounts.google.com` (no `'unsafe-inline'`) |
| Print `@page` rules | inline `<style>` element | constructed stylesheet (`document.adoptedStyleSheets`), allowed by CSP |
| Barcodes | JsBarcode's SVG renderer, which writes `style` attributes | bars drawn from JsBarcode's encoding as an SVG image |
| QR codes in PDFs | inline SVG that html2canvas re-serialised with `setAttribute('style')` | SVG image (data URL) |
| Dialog names | `role="dialog"` without a name | `aria-labelledby` the dialog title |

The single hash is the fixed `<style>` text html2canvas-pro adds to its PDF clone to hide pseudo-element placeholders.
`tests/unit/csp.test.ts` recomputes it from the installed package, so an upgrade that changes the text fails the test
before it can break PDF export. All end-to-end tests run in server mode under this CSP with zero violations.

Earlier in this round: GHSA-g3hv-75wg-m249 (minimatch, override to 11.0.4) and GHSA-3g3m-2fjr-6pw4 (glob, override to
14.0.3 for workbox-build), both in dev tools only.

## Accepted risk (documented, expires 2027-02-04)

| Advisory | Package | Severity | Why it is accepted |
|---|---|---|---|
| GHSA-gcqx-w48m-w2h4 (prototype poisoning in `mergeObject`) | deepmerge 4.3.1 via vite-plugin-pwa > workbox-build > @rollup/plugin-node-resolve | low (CVSS 5.3) | 4.3.1 is the newest release, so no fix exists. It runs only at build time, merges the build's own options and is not shipped in the app. Recorded in `osv-scanner.toml`. |

## Manual review of the local server

| Control | Where | Status |
|---|---|---|
| Listens on 127.0.0.1 only | `server/index.ts` | done |
| Host header allow-list against DNS rebinding (`127.0.0.1`, `localhost`, `[::1]` on its own port) | `server/security.ts` hostGuard | done, tested |
| Custom `X-GST-Client: 1` header on every API call, so other websites cannot call the API (no CORS approved) | apiGuard | done, tested |
| JSON only on writes (415 otherwise), 50 MB body limit (500 MB for `/api/restore` only), at most 5000 changes per save | `server/app.ts`, `fileStore.ts` | done, tested |
| Every record validated with zod schemas (payment currency and exchange rate included); a restore that fails validation changes nothing | `src/core/schema.ts` | done, tested |
| Atomic writes with a journal; interrupted restore rolls back; a change whose data file cannot be written stays in the journal until it is written | `server/fileStore.ts`, `atomic.ts` | done, tested |
| Optimistic concurrency: a batch based on an older version of any record it writes is refused whole (409), in server and browser storage | `server/fileStore.ts`, `src/data/indexeddb.ts`, `src/store/store.ts` | done, tested |
| Listed backups restored in place by id (pattern-checked, integrity-checked, pre-restore backup first) | `server/app.ts`, `src/data/indexeddb.ts` | done, tested |
| Backup ids checked against a strict pattern (no path traversal) | `server/backups.ts` | done, tested |
| Strict CSP (no inline script or style), `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, no-referrer, `x-powered-by` off | `server/security.ts` | done, tested |
| PIN stored as PBKDF2-SHA256 hash (150,000 iterations, random salt) | `src/core/security/pin.ts` | done |
| No secrets in the repo; `.env` git-ignored; `.env.example` has names only (none are secret) | `.gitignore` | done, Gitleaks clean |
| Error log stays on the computer (localStorage); the diagnostics download holds counts and errors, no business records | `src/store/errorLog.ts`, Settings > Diagnostics | done, tested |
| Release ZIP bundles express and zod into `dist-server/server.mjs`; no `npm install` or install scripts run on the user's PC | `vite.server.config.ts`, `scripts/package-release.mjs` | done, tested |

Known limits:

- The PIN locks the screen only; data files are not encrypted. Anyone with access to the Windows account can read
  `_system\data`. Use a Windows password and BitLocker on shared PCs.
- `script-src` keeps `'wasm-unsafe-eval'`, which the offline OCR engine (WebAssembly) needs. It does not allow `eval`
  of JavaScript. If the first CI ZAP run reports it, record it here as an accepted risk.
- Google Drive backup uses the `drive.file` scope (the app sees only files it created). The access token stays in memory.
- The bundled server includes express 5.3.0 and zod 4.6.7; a fix in either needs a rebuild and a new release ZIP. The
  nightly scan checks `package-lock.json`, which pins the bundled versions.

## Payments / PCI

Not applicable: the app records payments in the books and can print a UPI QR code, but it never handles card data
and never moves money. `payments-pci.md` was therefore not copied into `.kiro/steering/`.

## Next actions that need your approval

1. Install Semgrep (`pip install semgrep==1.183.0`) to run SAST locally (`npm run heal:nightly` picks it up), or let
   the CI job run it.
2. Push the repo to GitHub so `security.yml` runs Semgrep and the ZAP baseline against the running app.
