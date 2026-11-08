# Fix log: review batch 02, foreign-currency payments and receipt vouchers (2026-11-07)

Findings R1 and Y12 and the test gap "foreign-currency receipts and voucher allocations through to the party ledger"
from `docs/reviews/2026-11-07-code-review.md`, and F06 and F07 from `docs/reviews/2026-11-07-design-critique.md`.
Each finding was reproduced with a failing test before any code changed; the tests stay as regression tests. F07 did
not reproduce, so no code changed for it (evidence below).

Sources for the accounting treatment. The review cites REQ-7 only ("convert to INR at the document's exchange rate for
books"); no tax law or portal format is involved, because GST is valued at the invoice date and a payment does not
change it. There is no official source in the review for the settlement difference, so this follows ERPNext, on which
India Compliance (github.com/resilient-tech/india-compliance) is built:
[Manage Foreign Exchange Difference](https://docs.frappe.io/erpnext/manage-foreign-exchange-difference) (the receivable
is cleared at the invoice rate, the bank gets the payment-date value, the difference goes to an Exchange Gain/Loss
account, each part-payment realises its own difference, the invoice rate is never changed) and ERPNext's standard
chart of accounts (`erpnext/accounts/doctype/account/chart_of_accounts/verified/standard_chart_of_accounts.py`), which
puts "Exchange Gain/Loss" under Indirect Expenses next to Round Off.

## R1: payments against foreign-currency invoices were posted in the books as if they were rupees

**What was wrong.** A payment record had no currency. The payment dialog filled in the balance in the invoice's
currency (USD 1,000) and `savePayment` checked it against that balance, but `paymentEntry` posted the number as rupees
(Rs 1,000 to bank and party). A USD 1,000 invoice at 83 showed Paid while the party ledger still showed Rs 82,000 Dr and
the bank was Rs 82,000 short. Bill-wise voucher lines, which are in rupees, were added to the same total as the dollar
payments, so Rs 41,500 against that invoice counted as USD 41,500 (Paid). The Payments page, the dashboard's Received
this month and the printed receipt read the amounts the same unconverted way.

**Reproduced.** `tests/unit/core/foreign-payments.test.ts` failed 6 of 7 tests before the fix; the first gave
`expected 82000 to be +0`, the review's number. On a backup written by the old version (below), the dollar
customer's ledger read Rs 6,48,825 instead of Rs 2,02,200. `payments-store.test.ts` showed that a payment was saved
without a currency and a foreign payment without a rate was accepted; `payment-screens.test.tsx` found no rate field.

**Root cause.** The model had no currency or book-currency value on payments, so the multi-currency handling stopped at
the invoice: `paymentEntry` used a factor of 1, and `buildPaymentIndex` summed payments (document currency) and voucher
lines (book currency) as one number without knowing either document's currency.

**Fix.**
- `PaymentRecord` has two optional fields: `currency` and `exchangeRate` (book currency per unit on the payment date).
  `paymentFx` in `postings.ts` resolves them; a payment without them (everything saved before this fix) is in its
  linked document's currency at that document's rate, as the old dialog asked, or in the book currency when it is not
  linked. So no data migration is needed and old payments book no exchange difference.
- `paymentEntry` posts cash or bank at the payment's own value, the party at the document's rate, and the difference
  to the new system ledger `sys:fx-gain-loss` "Exchange Gain/Loss" (Indirect Expenses; a gain is a credit).
- `buildPaymentIndex` now takes the purchase bills and the business, and counts everything in the document's own
  currency: a payment in that currency as entered; voucher lines and payments in another currency at the document's
  rate (`paymentSettles`). Every caller passes them (store hook, ageing reports, payment action and dialog, Drive PDF).
- `savePayment` stores the currency and rate on every save, refuses a foreign payment without a positive rate
  ("Enter the exchange rate on the payment date (1 USD = ? INR).") and checks the amount against the balance in the
  document's currency ("Amount is more than the balance due (USD 1000.00)...").
- The payment dialog shows "Amount (USD)" and "Exchange rate on the payment date (1 USD = ? INR)", filled with the
  invoice's rate, and under it the rupee value and the exchange gain or loss the books will post.
- The receipts schema accepts a missing currency and otherwise only a three-letter code and a positive rate, on every
  save sent to the server and on every restore.
- Amounts show in their own currency on the Payments page (with the rupee value under foreign ones; the total and the
  CSV's new "Amount (INR)" column are in the book currency), on the invoice's Payments card (with the rate and rupee
  value), on the purchase bill's payment list and on the printed receipt. Received this month adds book values.
- Shortcut, commented in `paymentEntry`: each part-payment is converted on its own, so several part-payments of one
  foreign invoice can leave a few paise in the party ledger.

**Old data.** `tests/fixtures/backup-v1-2026-11-07.json` was written before any change, by the code as it was: sample
data plus a USD 1,500 part-payment on INV/26-27/0005 (USD 3,900 at 84.25) and a full payment of a second dollar invoice
(INV/26-27/0008 at 83.50), recorded through the real `savePayment` action against the real local server and backed up
by the server's own backup code. The statuses that version showed for every invoice and bill are in
`backup-v1-2026-11-07.expected.json`. With the fix, that backup passes the integrity check, restores into IndexedDB
(also from a stored backup), restores on the server from a file and in place from its backup folder, and opens as a
live data folder, every time with the same statuses. Its old dollar payments post at their invoice rates, so no
exchange difference appears and the customer's ledger shows Rs 2,02,200 (USD 2,400 at 84.25). A new dollar payment on
that data is saved with its currency and rate, and the batch-01 version check still refuses a stale tab.

**Files changed.** `src/core/model.ts`, `src/core/ledgers.ts`, `src/core/accounting/postings.ts`,
`src/core/accounting/reports.ts`, `src/core/docs/payments.ts`, `src/core/schema.ts`, `src/store/actions.ts`,
`src/store/hooks.ts`, `src/features/sales/PaymentDialog.tsx`, `src/features/sales/DocView.tsx`,
`src/features/sales/PaymentsPage.tsx`, `src/features/dashboard/Dashboard.tsx`, `src/features/purchases/Purchases.tsx`,
`src/features/settings/DataSettings.tsx`, `src/print/SimpleDocuments.tsx`, `src/help/guide.ts`.

**Regression tests.**
- `tests/unit/core/foreign-payments.test.ts`, "payments in another currency (review R1)": "posts a dollar receipt
  recorded the way the payment dialog does at the invoice rate, so the party ledger is cleared"; "books the difference
  between the receipt rate and the invoice rate as exchange gain or loss"; "counts a bill-wise voucher line on a dollar
  invoice in dollars, at the invoice rate"; "keeps the outstanding bills and the party ledger equal after a
  part-payment at another rate"; "settles the rupee value of a rupee payment against a dollar invoice, with no exchange
  difference"; "pays a dollar purchase bill at the payment rate and books the difference"; "keeps a payment with no
  linked document in the book currency" (a guard that already passed). "payment currency and rate (review R1)":
  "values a payment saved before payments had a currency in its document's currency, at the document's rate";
  "accepts payments with or without a currency in backups and saves, and refuses an invalid currency or rate".
- `tests/integration/payments-store.test.ts`, "savePayment with another currency (review R1)": "checks a dollar
  payment against the dollar balance and keeps its currency and rate"; "gives a payment saved without a currency the
  linked document's currency and rate"; "asks for the exchange rate of a payment in another currency".
- `tests/integration/old-data.test.ts`, "data saved before payments had a currency (review R1)": "passes the backup
  integrity check and shows the same payment statuses as before"; "restores into browser storage, also from a stored
  backup, with the same statuses"; "restores on the local server from a file and from its backup folder, with the same
  statuses"; "opens as the live data folder of the local server, with the same statuses" (these four passed before the
  fix too, as they must); "posts the old dollar payments at their invoice rates: no exchange difference, and the ledger
  shows the dollar balance due"; "saves a new dollar payment on restored data with its currency and rate, and still
  refuses a stale copy (review R2)".
- `tests/unit/ui/payment-screens.test.tsx`, "the payment dialog for a dollar invoice (review R1)": "asks for the
  exchange rate on the payment date and saves it with the payment".
- Existing tests updated for the new parameters only: `accounting.test.ts` (`paymentEntry`), `docs.test.ts` and
  `notifications.test.ts` (`buildPaymentIndex`); their expected values are unchanged.

## Test gap: foreign-currency receipts and voucher allocations through to the party ledger

Closed by the R1 tests above: each one follows the payment or voucher line into `ledgerStatement` of the party (and of
the bank and Exchange Gain/Loss), `receivablesAgeing` / `payablesAgeing` (bill-wise total equal to the ledger, nothing
left on account), the trial balance and the P&L, for receipts and for payments to suppliers.

## Y12: cancel and delete guards ignored bill-wise voucher allocations

**What was wrong.** `canCancel` and `deletePurchase` looked only at payment records. An invoice with a receipt voucher
set against it could be cancelled, and a bill with a payment voucher set against it could be deleted, leaving the
voucher pointing at a cancelled or missing document and the party's bill-wise outstanding wrong.

**Reproduced.** Before the fix `canCancel` returned `{ ok: true }` with such a voucher, `cancelSalesDocument`
cancelled the invoice and `deletePurchase` moved the bill to the trash ("promise resolved instead of rejecting").

**Root cause.** The guards were written before bill-wise voucher lines counted as payments in `buildPaymentIndex`, and
were never given the vouchers.

**Fix.** `voucherAgainst` in `lifecycle.ts` finds a voucher with a line set against a document. `canCancel` now takes
the vouchers and refuses with "Voucher RV/26-27/0003 is set against it (bill-wise). Change or delete that voucher
first."; `deletePurchase` refuses the same way. The invoice page passes its vouchers to `canCancel`.

**Files changed.** `src/core/docs/lifecycle.ts`, `src/store/actions.ts`, `src/features/sales/DocView.tsx`.

**Regression tests.** `tests/unit/core/docs.test.ts`, "lifecycle > refuses to cancel an invoice that a voucher pays
bill-wise (review Y12)"; `tests/integration/payments-store.test.ts`, "cancel and delete guards with vouchers (review
Y12)": "refuses to cancel an invoice that a voucher pays bill-wise", "refuses to delete a purchase bill that a voucher
pays bill-wise", "still deletes a bill nothing is set against" (a guard that already passed).

## F06: money received through a Receipt voucher did not show as a payment

**What was wrong.** On the sample data, INV/26-27/0002's Payments card said Received Rs 75,000.00 but listed only the
Rs 50,000.00 payment; receipt voucher RV/26-27/0001 (Rs 25,000.00) was missing there, on the Payments page and from the
dashboard's Received this month (Rs 1,172.00).

**Reproduced.** `tests/unit/ui/payment-screens.test.tsx` renders the real screens with the sample business in jsdom.
Before the fix all three tests failed: the voucher number was not on the Payments page, there was no link to it in the
invoice's card, and Received this month read `₹1,172.00`.

**Root cause.** The status and balance came from `buildPaymentIndex`, which counts payment records and bill-wise
voucher lines, but every "who paid me" screen read only the payment records.

**Fix.** Shared code instead of one more filter per screen: `buildPaymentIndex` also keeps, per document, the payments
and voucher lines behind its paid amount (`settlements`), and `partyPayments` merges payment records with the party
lines of receipt and payment vouchers (credits to a party in a receipt voucher, debits to a party in a payment
voucher; lines on other ledgers and journal vouchers are not payments).
- The invoice's Payments card lists the settlements, so it adds up to Received by construction; voucher lines link to
  the voucher. The purchase bill's payment list does the same for payment vouchers (same cause, same code).
- The Payments page lists receipt vouchers under Received and payment vouchers under Paid, tagged Voucher, numbered
  with a link to the voucher, with the party and the document they are set against; tab counts, total and CSV include
  them.
- Received this month adds payments and receipt-voucher party lines of the month, in the book currency (Rs 26,172.00
  on the sample data).

**Files changed.** `src/core/docs/payments.ts`, `src/features/sales/DocView.tsx`, `src/features/sales/PaymentsPage.tsx`,
`src/features/dashboard/Dashboard.tsx`, `src/features/purchases/Purchases.tsx`, `src/help/guide.ts`.

**Regression tests.** `tests/unit/ui/payment-screens.test.tsx`, "money received through a receipt voucher (design
F06)": "is listed on the Payments page with a voucher tag"; "is listed in the invoice's Payments card, which adds up to
the amount received"; "is counted in the dashboard's Received this month". `tests/unit/core/foreign-payments.test.ts`,
"what money a document was paid with (design F06)": "lists the payments and bill-wise voucher lines behind the amount
paid, in the document currency"; "lists payments and the party lines of receipt and payment vouchers as money received
and paid".

## F07: the invoice list showed a dollar invoice as rupees (not reproduced, no code change)

**Evidence that it was already right.**
- `SalesList.tsx` formats both columns in the document's currency: `money(d.totals.total, d.currency)` and
  `money(s.balance, d.currency)`. The file is byte-identical in the batch-01 backup taken before the critique's
  screenshots (SHA-256 prefix `BFD17896D784` in both backups).
- The critique's own screenshot `docs/reviews/design-shots/d-sales-list.png` shows INV/26-27/0005 with
  `$3,900.00` in Amount and in Balance, not `₹3,900.00`.
- `tests/unit/ui/payment-screens.test.tsx`, "a dollar invoice in the invoice list (design F07) > shows its amount and
  balance in dollars", passed before any change (both cells `$3,900.00`) and stays as a regression test.

The critique's optional idea of a rupee value as a second line in each foreign row was not added: it is a design
addition, not a defect, and this batch changes no code for a finding that did not reproduce.

## Documents updated

`README.md` (foreign-currency payments, vouchers as payments, the cancel / delete guard), `src/help/guide.ts` (payments
and vouchers topics), `TEST_REPORT.md`, `SECURITY_REPORT.md`, `.kiro/specs/free-gst-billing/requirements.md`
(REQ-53 to REQ-58), `design.md` (STRIDE rows "payment currency or exchange rate" and "voucher is set against it", key
decisions "Payments in another currency" and "Payment lists") and `tasks.md` (tasks 21 to 24).

## Final gate

`$env:PLAYWRIGHT_CHANNEL='msedge'; npm.cmd run heal:nightly` wrote
`C:\Users\Suraj\workplace\free-gst-billing\security-reports\nightly-2026-11-07.md` (UTC date), result line:
**All gates passed.** Lint, typecheck, unit and integration tests with the coverage gate (statements 97.14%, branches
91.19%, functions 96.95%, lines 98.7%), both builds, 10 / 10 Playwright runs (server and browser mode, 3.5 min), npm
audit 0, gitleaks no leaks, OSV-Scanner no issues, Trivy 0. Semgrep is not installed, as before. The gate keeps only
the end of each step's output, so the test count comes from a Vitest run on the same files right after it: 251 / 251
passed in 23 files, none skipped, no `.only`.

## Backup

Taken before the first edit: `C:\Users\Suraj\.kiro\crew\workspace\backups\free-gst-billing-2026-11-07-02-currency-receipts`.

## Not done, not checked, risks

- Not done: deleting a party is still allowed while a voucher line uses its ledger (`Parties.tsx` checks invoices,
  bills and payments only). That guard is not about bill-wise allocations, so it was left out of Y12.
- Not done: an on-account payment (no linked document) is always in the book currency, as before, so an advance in
  dollars cannot be entered in dollars; and the printed receipt of a dollar payment shows no rupee value.
- Known limit: voucher amounts are in the book currency. For a dollar invoice settled by voucher, the user credits the
  party at the invoice's rate and posts the difference to Exchange Gain/Loss (the help says so); the app does not split
  it automatically.
- Known limit: part-payments of one foreign document can leave a few paise in the party ledger (shortcut comment in
  `paymentEntry`).
- Not checked: Semgrep (not installed), and the user's live data in `_system` (not opened, as instructed; the same
  record format was tested through the fixture written by the old code).
