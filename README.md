# Free GST Billing

Free, offline billing, inventory and accounting for Indian GST businesses (and VAT / sales-tax businesses abroad).
No account, no sign-up, no internet needed after the first install.

## Start it on your PC (Windows)

1. Install [Node.js](https://nodejs.org) 20.19 or newer (once).
2. Unzip the release (`Free-GST-Billing-<version>.zip`) into a folder of your choice, for example `D:\GST Billing`.
3. Double-click **`Start-GST-Billing.cmd`**. It opens <http://127.0.0.1:47371> in your browser. Keep the black window
   open while you work; close it to stop the app.

The release ZIP is already built and needs nothing else. From a source checkout (this repository) the first start
installs the tools and builds the app once, which takes a few minutes.

Your data is saved as JSON files in **`_system\data`** inside this folder. An automatic backup is taken every day into
**`_system\backups`** (the newest 30 daily and 20 manual / pre-restore backups are kept). You can also download a backup
file from **Settings > Backup & restore**, and optionally upload backups to your own Google Drive.

The server only listens on 127.0.0.1, so other computers on the network cannot reach it.

You can keep the app open in more than one tab or window. If another tab has saved changes since a tab loaded its
data, that tab's save is refused with a message and nothing is saved; the tab then loads the latest data, so save
again. A document number is never given twice, and a screen that still shows an older copy of a record cannot
overwrite the newer one: open the record again.

If antivirus, backup or sync software holds a data file while you save, the change is kept in
`_system\data\journal.json` and written to the data files on the next save or start. While the file stays locked,
saves are refused with a message; changes saved earlier are safe.

### Jaldi shuru karein (Hindi)

Release ZIP ko kisi folder mein unzip karke `Start-GST-Billing.cmd` par double-click karein; browser mein app khul
jayega. Data isi folder ke `_system\data` mein save hota hai. Hafte mein ek baar **Settings > Backup & restore** se
backup file download kar lein.

## Run it in a browser only (static hosting, AI Studio preview)

`npm run build` creates `dist/`. Host that folder on any static web server. Without `server.js` the app detects that no
server is present and keeps the data in the browser's IndexedDB instead. In this mode, download backup files regularly:
clearing the browser's site data deletes the data.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Start the local server (after `npm run build`) |
| `npm run dev` | Development server on <http://127.0.0.1:5173> (API proxied to a running `npm start`) |
| `npm run build` | Typecheck, then build the web app (`dist/`) and the server (`dist-server/`) |
| `npm run lint` / `npm run typecheck` | ESLint (zero warnings allowed) / TypeScript |
| `npm test` / `npm run coverage` | Unit + integration tests (Vitest); coverage fails below 80% |
| `npm run e2e` | Playwright end-to-end tests (needs `npm run build` first). Locally: `$env:PLAYWRIGHT_CHANNEL='msedge'` |
| `npm run package` | After `npm run build`: write `release/Free-GST-Billing-<version>.zip` (runs with Node.js alone) |
| `npm run heal:nightly` | Run every gate (lint, types, tests, build, e2e, audit, installed scanners) and write `security-reports/nightly-<date>.md` |

Settings for the server (all optional, see `.env.example`): `PORT` (default 47371), `GST_DATA_DIR`, `GST_BACKUP_DIR`.

## What is inside

- **Sales:** tax invoice, bill of supply, quotation, proforma, credit note, debit note, delivery challan; recurring
  invoices; payments with receipts; convert, cancel and share; bulk PDF download as a ZIP. The invoice list shows the
  newest 200 documents that match the search and filters, with **Show 200 more** for the next ones; search, Select all
  and Export CSV still cover every matching document. On its All tab the header shows sales: invoices, bills of supply
  and debit notes less credit notes, without quotations, proformas or challans. A payment against an invoice
  or bill in another currency is entered in that currency with the exchange rate on the payment date: cash or bank gets
  that value, the party is cleared at the invoice's own rate, and the difference goes to the Exchange Gain/Loss ledger.
  Payments recorded before this (with no rate of their own) count at their invoice's rate, so their status and books
  stay as they were.
- **Print & PDF:** Tally-style and seven other A4/A5 designs, thermal rolls (58/76/80/112 mm), labels in English, Hindi,
  Tamil, Marathi and Bengali, watermark, original/duplicate/triplicate copies, UPI QR code and barcodes.
- **Inventory:** products and services with HSN/SAC, godowns, batches, stock movements, valuation, bulk price edit,
  your own units (Carat, Bundle, Session...) with their GST UQC, added straight from any line's unit list.
- **Purchases and expenses:** supplier bills with offline OCR (English) from a bill photo or scan, photo/PDF
  attachments, ITC, TDS thresholds.
- **Accounts (Tally keys F4-F7):** contra, payment, receipt and journal vouchers; ledgers; day, cash and bank books;
  outstanding and ageing; trial balance; profit and loss (also month by month); balance sheet. Money received or paid
  with a receipt or payment voucher shows on the Payments page (tagged Voucher) and in the dashboard's Received this
  month, and a voucher line set against an invoice or bill (bill-wise) is listed in that document's payments. Such an
  invoice cannot be cancelled, nor such a bill deleted, until the voucher is changed or deleted. The reports stay quick
  with large data: with 2,000 parties and 10,000 invoices, the Parties list, Outstanding and the month-by-month P&L
  each take 0.1 to 0.3 s on a 4-core laptop (about 18 s before), and the books are rebuilt only when a record they
  are made from changes (not when you dismiss a notification or change a setting).
- **GST and tax:** GSTR-1 (all tables including Table 14 for sales through e-commerce operators that collect TCS
  u/s 52; portal JSON, Excel and one CSV per table), GSTR-3B (with the ITC set-off order; JSON, Excel, CSV), GSTR-2B
  reconciliation, e-way bill JSON, TDS/TCS register, income-tax helper (old and new regime, 44AD/44ADA, advance tax,
  234B/234C), due-date reminders. In GSTR-3B, **Open GSTR-2B** takes Table 4(A)(5) from the GSTR-2B JSON of the
  period, as the portal does (credit not in GSTR-2B cannot be claimed), with blocked credit in 4(B)(1), documents you
  have not recorded in 4(B)(2), credit marked not available in 4(D)(2), and a list of bills and expenses missing from
  the GSTR-2B; without one it uses your bills and expenses and says so. Credit on a bill or expense needs the
  supplier's valid GSTIN. Negative tax (credit notes above sales) goes to the negative liability statement and is set
  off against the next returns' tax, and sales under reverse charge are in 3.1(a) at their taxable value.
- **Other:** several businesses (GSTINs) in one app, 22 currencies, PIN lock with auto-lock, trash bin (30 days),
  command palette (Ctrl+K), new invoice (Alt+N), help (F1), Settings > Diagnostics (version, data check, local error
  log), works as an installable offline app (PWA).

Tax rules built in (check them with your CA for your case): GST rates 0/5/18/40% from 22 Sep 2025 (12% and 28% stay for
older dates); B2C large invoice limit Rs 1 lakh from 1 Aug 2024 (Rs 2.5 lakh before); GSTR-1 HSN table split into B2B
and B2C from May 2025; TCS under section 206C(1H) only on invoices up to 31 Mar 2025; Income-tax Act 2025 form names
from 1 Apr 2026 (Form 140 for 26Q, Form 143 for 27EQ).

## Known limits

- OCR reads English only, and its results must be checked before saving.
- Google Drive backup needs your own Google OAuth client ID (Settings > Google Drive).
- The PIN only locks the screen. It does not encrypt the data files; protect the PC with a Windows password.
- The e-way bill JSON uses version `1.0.0621`, the same as the india-compliance project uses today. The GSTR-1 JSON
  `version` (`GST3.0.4`) could not be checked against an official schema. If the portal rejects an upload, note the
  error message; the Excel and CSV exports are there as a fallback.
- Sales on which the e-commerce operator itself pays the GST under section 9(5) (restaurant service, cab rides through
  an app) are not reported in Table 14(b).
- The CSV files use the column names of the GST offline tool template, but they are meant for checking and for other
  software. Upload the JSON to the portal.
- GSTR-3B reads the B2B invoices and credit/debit notes of a GSTR-2B. Amendments, ISD and import sections are listed
  but not used (4(A)(1) and 4(A)(4) stay as in your books), 3.1(d) and 4(A)(3) come from your reverse-charge purchase
  bills, and credit reclaimed later in 4(D)(1) is not tracked. The negative liability carried from earlier returns is
  worked out from your invoices since September 2024 (same filing frequency, figures as filed from this app); check
  it against the portal's statement.

## Updating and rolling back

Before updating, download a backup (Settings > Backup & restore) or copy the `_system` folder.

To update, close the app, unzip the new release (it creates a new `Free-GST-Billing-<version>` folder) and move the
`_system` folder from the old app folder into the new one. The ZIP contains no `_system` folder, so nothing of yours
is overwritten. Then start the new folder's `Start-GST-Billing.cmd`.

To roll back, keep the old folder until you are happy with the new version: close the app, move `_system` back into
the old folder and start it from there (from a source checkout: `git checkout` the previous version and run
`npm run build`). If the data itself needs to go back, restore a backup in Settings > Backup & restore. Every restore
first saves a `pre-restore` backup, so a restore can itself be undone. Backups in that screen's list are restored on
this computer, so their size does not matter; a backup file chosen with **Restore from file** can be up to 500 MB, and
the screen warns when your backups get close to that.

## Releases (maintainers)

`.github/workflows/deploy.yml` builds, tests and packages the ZIP on every push to `main` (kept as a workflow artifact,
the staging build). Pushing a tag such as `v1.0.1` (it must match `version` in `package.json`) publishes a GitHub
Release after someone approves the `production` environment. Set that up once in the repository: Settings >
Environments > New environment `production` > Required reviewers.

To withdraw a bad release: mark it as a pre-release or delete it on GitHub, and point users to the previous ZIP.

## Project documents

- Specs: `.kiro/specs/free-gst-billing/` (requirements, design with threat model, tasks)
- Reports: `TEST_REPORT.md`, `SECURITY_REPORT.md`; installs: `INSTALL_MANIFEST.json`
- CI: `.github/workflows/` (build-test, e2e, security with a nightly re-scan, nightly self-check, deploy)

License: MIT.
