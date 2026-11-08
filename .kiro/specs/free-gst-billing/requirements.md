# Requirements - Free GST Billing

> EARS notation. Each requirement is testable and traced to a task in `tasks.md`.
> Source: the "Complete Free GST Billing Software (All 36 Screenshot Features + Backend + Print Engine)" master prompt,
> with the tax rules corrected to the law in force on 2026-11-06 (see REQ-30 to REQ-34).

## Ubiquitous
- **REQ-1** The system SHALL work without an account, a sign-up or an internet connection after it is installed.
- **REQ-2** The system SHALL keep each business's data in JSON files under `_system/data` when it is served by
  `server.js`, and in the browser's IndexedDB when it is served as static files.
- **REQ-3** The system SHALL compute GST per line and per document: CGST + SGST (or UTGST) inside a state, IGST across
  states and for exports / SEZ, plus cess, discounts before tax and round-off.
- **REQ-4** The system SHALL issue seven document types (tax invoice, bill of supply, quotation, proforma, credit note,
  debit note, delivery challan), each with its own financial-year number series of at most 16 characters.
- **REQ-5** The system SHALL derive the double-entry books (journal, ledgers, day / cash / bank book, trial balance,
  profit and loss, balance sheet, receivable and payable ageing) from the saved documents and vouchers.
- **REQ-6** The system SHALL hold several businesses (GSTINs) with separate data and numbering.
- **REQ-7** The system SHALL bill in 22 currencies and convert to INR at the document's exchange rate for books and returns.
- **REQ-8** The system SHALL format Indian amounts with lakh / crore grouping and print amounts in words.

## Event-driven
- **REQ-9** WHEN a document is finalized, the system SHALL give it the next free number in its series.
- **REQ-10** WHEN a payment is recorded against a document, the system SHALL set the document to partly paid or paid and
  post a receipt.
- **REQ-11** WHEN a challan or quotation is converted, the system SHALL create the target document without moving stock twice.
- **REQ-12** WHEN the user prints or downloads a PDF, the system SHALL render the chosen design (8 A4/A5 designs or a
  58/76/80/112 mm thermal roll) with labels in English, Hindi, Tamil, Marathi or Bengali, the watermark and the copy label
  (original / duplicate / triplicate).
- **REQ-13** WHEN several documents are selected for download, the system SHALL build one ZIP of PDFs with progress and a
  cancel button.
- **REQ-14** WHEN the user opens GSTR-1 for a period, the system SHALL build B2B, B2CL, B2CS, exports, SEZ, CDNR, CDNUR,
  nil / exempt, HSN and documents-issued tables and export them as portal JSON and Excel.
- **REQ-15** WHEN the user opens GSTR-3B for a period, the system SHALL fill tables 3.1, 3.2, 4 and 5 and set off ITC in
  the order of sections 49, 49A, 49B and rule 88A, paying reverse-charge tax in cash.
- **REQ-16** WHEN a GSTR-2B JSON file is imported, the system SHALL match it against purchase bills and list matched,
  mismatched and missing documents.
- **REQ-17** WHEN the user exports an e-way bill, the system SHALL write NIC bulk-upload JSON for documents that move goods.
- **REQ-18** WHEN a supplier bill photo is read, the system SHALL run OCR on the device and prefill the bill for review.
- **REQ-19** WHEN the app starts, the system SHALL create due recurring invoices, take the daily backup and purge trash
  entries older than 30 days.
- **REQ-20** WHEN the user presses Ctrl+K, Alt+N or F1, the system SHALL open search, a new tax invoice or help; WHEN F4
  to F7 is pressed on an accounts screen, it SHALL open a contra, payment, receipt or journal voucher.

## State-driven
- **REQ-21** WHILE a PIN is set, the system SHALL show the lock screen at start and after the chosen idle time.
- **REQ-22** WHILE an invoice editor has unsaved changes, the system SHALL ask before leaving the screen.
- **REQ-23** WHILE a GST due date, an overdue invoice, low stock or a missing backup is pending, the system SHALL show it
  in the notification bell, most urgent first.

## Unwanted behaviour
- **REQ-24** IF a save is interrupted, THEN the server SHALL complete or undo it from its journal at the next start.
- **REQ-25** IF a backup file fails validation, THEN the system SHALL refuse it and leave the current data unchanged; every
  accepted restore SHALL first save a pre-restore backup.
- **REQ-26** IF an imported voucher does not balance, THEN the system SHALL post the difference to Suspense.
- **REQ-27** IF an API request carries a foreign Host header, lacks the `X-GST-Client` header or is not JSON, THEN the
  server SHALL reject it.
- **REQ-28** IF a screen fails, THEN the system SHALL show a recovery screen and keep the saved data.
- **REQ-29** IF a record is deleted, THEN the system SHALL keep it in the trash for 30 days so it can be restored.

## Optional (tax rules by date)
- **REQ-30** WHERE the invoice date is on or after 22 Sep 2025, the system SHALL offer the 0 / 5 / 18 / 40% slabs and
  keep 12% and 28% for earlier dates.
- **REQ-31** WHERE a B2C inter-state invoice exceeds Rs 1 lakh (Rs 2.5 lakh up to 31 Jul 2024), the system SHALL report
  it in B2CL.
- **REQ-32** WHERE the GSTR-1 period is May 2025 or later, the system SHALL split the HSN table into B2B and B2C.
- **REQ-33** WHERE TCS on sale of goods applies, the system SHALL charge section 206C(1H) only on invoices up to 31 Mar 2025.
- **REQ-34** WHERE a TDS/TCS return falls on or after 1 Apr 2026, the system SHALL use the Income-tax Act 2025 names
  (Form 140 for 26Q, Form 143 for 27EQ).
- **REQ-35** WHERE inventory is switched on, the system SHALL track stock by godown and batch and value it by weighted
  average, last purchase or standard cost.
- **REQ-36** WHERE the user adds a Google OAuth client ID, the system SHALL upload backups to Google Drive with the
  `drive.file` scope.
- **REQ-37** WHERE the business is in India, the system SHALL offer the income-tax helper (old / new regime, 44AD /
  44ADA / 44AE, advance tax, 234B / 234C).

## Non-functional
- **REQ-38** Accessibility: no serious or critical WCAG 2 A/AA problem (axe-core) on any screen.
- **REQ-39** Quality: unit + integration coverage of `src/core`, `src/data` and `server/` at 80% or more on lines,
  branches, functions and statements; ESLint with zero warnings.
- **REQ-40** Security: the server listens on 127.0.0.1 only and sends a strict CSP; no secrets in the repository; no
  open scanner finding of medium severity or higher (see `design.md` threat model).


## Added in round 2 (2026-11-07, gaps found by re-checking the 36 features of the master prompt)
- **REQ-41** (feature 7, TCS u/s 52) WHERE a sale is made through an e-commerce operator that collects TCS under
  section 52, the system SHALL total it per operator GSTIN in GSTR-1 Table 14 (`supeco.clttx`, net of credit notes)
  and show the TCS to expect: 0.5% of the net value from 10 Jul 2024, 1% before.
- **REQ-42** IF the operator GSTIN on an invoice is invalid or is the business's own GSTIN, THEN the system SHALL refuse
  to finalize the invoice.
- **REQ-43** (feature 4) WHEN the user exports GSTR-1 or GSTR-3B, the system SHALL offer CSV (one file per GSTR-1 table,
  with the GST offline tool's column names) besides the portal JSON and Excel.
- **REQ-44** (feature 12) WHEN the user picks "+ Add custom unit..." in the unit list of an invoice, purchase or product
  line, the system SHALL create the unit with its GST UQC and select it, without leaving the screen; a code that already
  exists (after normalising, e.g. "b-ndl" = "BNDL") SHALL be refused.
- **REQ-45** (feature 32) The in-app guide SHALL have a topic for every screen.
- **REQ-46** (observability) IF an unexpected error occurs, THEN the system SHALL record it on this computer only and
  show a notice in the bell until the user opens Settings > Diagnostics, which SHALL show the version, storage, backup
  dates, a data integrity check and the error log, and SHALL let the user download it without business records.
- **REQ-47** (non-functional) The CSP SHALL allow no inline scripts or styles (`'unsafe-inline'`); start-up JavaScript
  SHALL stay under 750 kB by loading screens on first use.
- **REQ-48** (release) The release ZIP SHALL run with Node.js alone, and a release SHALL be published only after a
  person approves the `production` environment.

## Added by code review fixes, batch 01: data safety (2026-11-07, `docs/reviews/2026-11-07-code-review.md`)
- **REQ-49** (review R2) IF another tab, window or browser has saved a record since this tab loaded it, THEN the system
  SHALL refuse the whole save in both storage modes (the server answers HTTP 409; browser storage checks inside the
  IndexedDB transaction), load the latest data into this tab and ask the user to save again; a screen that still holds
  the older copy of that record SHALL NOT overwrite it.
- **REQ-50** (review R2) The system SHALL NOT give one document number to two documents of a business when several
  tabs or windows save at the same time, including numbers typed by hand and recurring copies made at start-up.
- **REQ-51** (review R3) IF a data file cannot be written after the server has saved a change in its journal, THEN the
  server SHALL keep the change, write it before the next save (and refuse that save while it still fails) and replay
  it at the next start; it SHALL NOT replace a journal whose change is not yet in the data files.
- **REQ-52** (review Y11) WHEN the user restores a backup from the backup list, the system SHALL restore it where it is
  kept, without uploading it, so its size does not matter; WHEN the user restores a backup file in server mode, the
  server SHALL accept files up to 500 MB (other requests stay at 50 MB), and the Backup screen SHALL warn once the
  backups pass 80% of that limit.


## Added by code review fixes, batch 02: foreign-currency payments and receipt vouchers (2026-11-07)
Sources: `docs/reviews/2026-11-07-code-review.md` (R1, Y12, test gaps) and `docs/reviews/2026-11-07-design-critique.md`
(F06, F07).
- **REQ-53** (review R1) WHEN a payment is recorded against an invoice or bill in another currency, the system SHALL
  take the amount in that currency and the exchange rate on the payment date (the document's rate until changed), check
  the amount against the balance in that currency, post cash or bank at the payment's value, settle the party at the
  document's own rate and post the difference to the Exchange Gain/Loss ledger (Indirect Expenses).
- **REQ-54** (review R1) WHEN a voucher line is set against an invoice or bill (bill-wise), the system SHALL count its
  amount, which is in the book currency, in the document's currency at the document's rate.
- **REQ-55** (review R1) IF a payment was saved without a currency (every payment saved before 2026-11-07, in live data,
  browser storage or a backup file), THEN the system SHALL treat it as being in its linked document's currency at that
  document's rate, so it books no exchange difference and the document's status stays as it was; a payment with no
  linked document SHALL be in the book currency. A payment currency that is not a three-letter code, or a rate that is
  not a positive number, SHALL be refused on save and on restore.
- **REQ-56** (review Y12) IF a voucher has a bill-wise line set against an invoice or purchase bill, THEN the system
  SHALL refuse to cancel that invoice or delete that bill, naming the voucher.
- **REQ-57** (design F06) The system SHALL show money received or paid through a receipt or payment voucher as a
  payment: party lines of those vouchers on the Payments page (tagged Voucher, linked to the voucher), bill-wise voucher
  lines in the invoice's or bill's payment list, and receipt vouchers in the dashboard's "Received this month", which
  SHALL add payments in the book currency.
- **REQ-58** (design F07, already met) The invoice list SHALL show each document's amount and balance in the document's
  own currency.



## Added by code review fixes, batch 03: speed with large data (2026-11-07)
Source: `docs/reviews/2026-11-07-code-review.md` (R4, Y13, test gap "a performance budget test"). "Large data" below
means one business with 2,000 parties, 10,000 tax invoices, 10,000 receipts and a year of bills, vouchers and stock
(`tests/fixtures/large.ts`); the budgets are for the 4-core development PC.
- **REQ-59** (review R4) WHILE a business has large data, the system SHALL build the receivables ageing within 500 ms and
  the payables ageing within 200 ms (Parties list, party page, Outstanding), taking every party's total from one pass
  over the journal, with the same figures as before.
- **REQ-60** (review Y13) WHILE a business has large data, the system SHALL build the month-by-month profit and loss
  within 500 ms, valuing the opening and closing stock of every month from one pass over the stock movements; each
  month SHALL show the same figures as the profit and loss of that month on its own.
- **REQ-61** (review R4, Y13) WHEN a record the books are not built from is saved (settings such as a dismissed
  notification, godowns, the trash), the system SHALL NOT rebuild the books; WHEN a document, payment, voucher, party,
  ledger or product changes, it SHALL rebuild them.
- **REQ-62** (review Y13) The invoice list SHALL show at most the newest 200 documents that match the search and filters,
  with a button that shows 200 more; search, Select all and Export CSV SHALL still cover every matching document.
  WHILE the list holds 10,800 documents, it SHALL open within 2,000 ms and follow typing within 750 ms per keystroke
  (jsdom test).
- **REQ-63** (review Y13) The All tab of the invoice list SHALL show sales in its header: final invoices, bills of supply
  and debit notes less final credit notes, in the book currency, without quotations, proformas or delivery challans.
  A tab of one document type SHALL show the value of its documents.
- **REQ-64** (test gap) The speed budgets of REQ-59, REQ-60 and REQ-62 SHALL be checked by tests in the normal unit test
  run (and in the nightly gate, under coverage), never skipped.



## Added by review fixes, batch 04: GSTR-3B (2026-11-07)
Source: `docs/reviews/2026-11-07-compliance-research.md` (rows 1, 18, 26 and 32; section 2.3, R18, R19, R22, R23) and
`docs/reviews/2026-11-07-code-review.md` (Y7). Fix log: `docs/reviews/fixes/2026-11-07-04-gstr3b.md`.
- **REQ-65** (compliance row 1) WHEN the user opens the GSTR-2B JSON of the GSTR-3B period, the system SHALL take Table
  4(A)(5) from its B2B invoices and debit notes with ITC available, net of its credit notes; SHALL reverse in 4(B)(1)
  the documents with blocked credit (purchase bills marked ineligible, expenses whose credit is not claimed) and in
  4(B)(2) the documents that are not in the purchase bills or expenses; SHALL report ITC that the GSTR-2B marks as not
  available in 4(D)(2); and SHALL list, without claiming them, the bills and expenses of the period that claim credit
  but are not in the GSTR-2B. A GSTR-2B of another GSTIN SHALL be refused, and one of another period SHALL NOT be used.
- **REQ-66** (compliance row 1) WHILE no GSTR-2B is open, the system SHALL take 4(A)(5) from the purchase bills and
  expenses dated in the period and SHALL say that the portal takes it from GSTR-2B.
- **REQ-67** (compliance row 18) The system SHALL label Table 4(D) "(1) ITC reclaimed which was reversed under Table
  4(B)(2) in earlier tax period" and "(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules", keep
  their JSON types `RUL` and `OTH`, and show 4(D) on the GSTR-3B screen and in its Excel and CSV files.
- **REQ-68** (compliance row 26) IF the forward-charge tax of a head is negative for a period (credit notes above
  sales), THEN the system SHALL carry it to a negative liability statement worked out from the invoices of the earlier
  returns since September 2024, and SHALL set that balance off against the same head's tax of later returns before
  input tax credit.
- **REQ-69** (compliance row 32) The system SHALL report the taxable value of outward supplies under reverse charge in
  Table 3.1(a), with no tax, and SHALL leave them out of Table 3.2.
- **REQ-70** (review Y7) The system SHALL claim input tax credit on a forward-charge purchase bill or an expense only
  when the supplier's GSTIN is valid. The expense form SHALL offer "Claim input tax credit" only with a valid vendor
  GSTIN and say why otherwise, and saving an expense SHALL clear the claim when the GSTIN is not valid. Credit on
  reverse-charge purchases and imports SHALL NOT need a supplier GSTIN.
