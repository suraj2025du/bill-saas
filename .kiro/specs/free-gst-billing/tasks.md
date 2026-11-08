# Tasks - Free GST Billing

> Definition of Done (DoD): tests green + scanners clean + docs updated + rollback path exists.
> Status on 2026-11-07: tasks 1-27 done. Evidence: `TEST_REPORT.md` (263 unit/integration tests, 10 e2e runs over 50
> screens) and `SECURITY_REPORT.md`. Rollback path: previous release ZIP + daily and pre-restore data backups (README,
> "Updating and rolling back"), plus git history once the first commit is made.

- [x] 1. Domain model, money / dates, currencies, schemas - _traces to: REQ-1, REQ-7, REQ-8, REQ-25; design: Domain_
  - [x] unit tests - [x] security scan clean - [x] docs updated
- [x] 2. GST engine, documents, numbering, conversion, recurring - _REQ-3, REQ-4, REQ-9 to REQ-11, REQ-19, REQ-30_
  - [x] unit tests - [x] security scan clean - [x] docs updated
- [x] 3. Storage: JSON file server with journal and backups, IndexedDB adapter, mode detection - _REQ-2, REQ-24, REQ-25, REQ-27; design: TB1, TB2_
  - [x] unit tests - [x] integration tests - [x] security scan clean - [x] docs updated
- [x] 4. Accounting postings and reports - _REQ-5, REQ-26_
  - [x] unit tests - [x] e2e (trial balance and balance sheet balance) - [x] docs updated
- [x] 5. GST returns: GSTR-1, GSTR-3B set-off, GSTR-2B reconciliation, e-way bill, TDS/TCS - _REQ-14 to REQ-17, REQ-31 to REQ-34_
  - [x] unit tests - [x] e2e (GSTR-1 B2C row) - [x] docs updated
- [x] 6. Income-tax helper - _REQ-37_
  - [x] unit tests - [x] e2e (screen opens) - [x] docs updated
- [x] 7. Print engine: 8 designs + thermal, 5 languages, watermark, copies, PDF, bulk ZIP - _REQ-12, REQ-13_
  - [x] e2e (PDF download) - [x] docs updated
- [x] 8. Screens: sales, parties, inventory, purchases with OCR, expenses, vouchers F4-F7, books, settings, setup wizard,
  dashboard, command palette, notifications, help, PIN lock - _REQ-6, REQ-18, REQ-20 to REQ-23, REQ-28, REQ-29, REQ-35, REQ-36_
  - [x] e2e every-screen sweep (both storage modes) - [x] axe a11y clean - [x] docs updated
- [x] 9. CI workflows: build-test, e2e, security (actions pinned to SHAs) - _REQ-39, REQ-40; design: TB6_
  - [x] files added - [ ] first run on GitHub (needs a remote, see below)
- [x] 10. Dependency fixes: minimatch 11 and glob 14 overrides; deepmerge low risk accepted until 2027-02-04 - _REQ-40_
  - [x] tests, build and e2e re-run green - [x] `SECURITY_REPORT.md` updated
- [x] 11. E-commerce operator GSTIN on invoices, GSTR-1 Table 14 with expected TCS u/s 52 - _REQ-41, REQ-42_
  - [x] unit tests - [x] e2e - [x] help topic
- [x] 12. CSV exports: GSTR-1 (one file per table, ZIP) and GSTR-3B - _REQ-43_
  - [x] unit tests - [x] e2e (ZIP and CSV contents) - [x] docs updated
- [x] 13. "+ Add custom unit..." in every unit list, shared validated action - _REQ-44_
  - [x] e2e (dialog, axe, duplicate refused) - [x] docs updated
- [x] 14. Help topics for every screen, corrected shortcut and dashboard texts - _REQ-45_
- [x] 15. Local diagnostics: error log, bell notice, Settings > Diagnostics with data check - _REQ-46; design: diagnostics_
  - [x] unit tests - [x] e2e (error reaches bell and Diagnostics) - [x] docs updated
- [x] 16. Strict CSP without 'unsafe-inline'; route-level code splitting (start-up JS 1,128 kB -> 710 kB) - _REQ-47_
  - [x] unit test (CSP hash recomputed from html2canvas-pro) - [x] e2e under the CSP, 0 violations
- [x] 17. Release ZIP (self-contained server), launcher skips install for releases, `heal:nightly`, nightly and deploy
  workflows with manual production approval - _REQ-48; design: TB6_
  - [x] release ZIP unzipped and started without node_modules - [x] full nightly run green - [x] README rollback steps
- [x] 18. Review R2: per-record version check in both storage modes, reload on conflict, older copies refused, typed
  numbers claimed through the business record - _REQ-49, REQ-50; design: STRIDE "second tab", key decision "Several tabs"_
  - [x] integration tests (`tests/integration/multi-tab.test.ts`, both modes; conflict tests in `server.test.ts`,
    `adapters.test.ts`) - [x] e2e (`tests/e2e/two-tabs.spec.ts`, both modes) - [x] docs updated
- [x] 19. Review R3: journal as the commit point, a waiting change written before the next save, journal never replaced
  early - _REQ-51; design: STRIDE "data file locked"_
  - [x] integration tests (`server.test.ts`, "a save that fails half-way") - [x] docs updated
- [x] 20. Review Y11: restore listed backups in place, 500 MB restore uploads, size check and warning on the Backup
  screen - _REQ-52; design: key decision "Restore"_
  - [x] integration tests (`server.test.ts`, "restoring a large backup"; `adapters.test.ts`) - [x] docs updated
- [x] 21. Review R1: payments keep their currency and rate; cash / bank at the payment's value, party at the document's
  rate, difference to Exchange Gain/Loss; voucher lines counted in the document's currency; payment dialog asks for
  the rate; older payments keep their statuses - _REQ-53 to REQ-55; design: key decision "Payments in another currency",
  STRIDE "payment currency or exchange rate"_
  - [x] unit tests (`foreign-payments.test.ts`) - [x] integration tests (`payments-store.test.ts`, `old-data.test.ts`
    with a backup written by the version before the fix) - [x] screen test (`payment-screens.test.tsx`) - [x] docs updated
- [x] 22. Review Y12: cancel and delete guards look at bill-wise voucher lines - _REQ-56; design: STRIDE "voucher is set
  against it"_
  - [x] unit test (`docs.test.ts`) - [x] integration tests (`payments-store.test.ts`) - [x] docs updated
- [x] 23. Design F06: receipt and payment vouchers on the Payments page, in the invoice's and bill's payment lists and in
  "Received this month" - _REQ-57; design: key decision "Payment lists"_
  - [x] unit tests (`foreign-payments.test.ts`) - [x] screen tests (`payment-screens.test.tsx`) - [x] docs updated
- [x] 24. Design F07: checked, already met (the list shows `$3,900.00`); no code change - _REQ-58_
  - [x] regression screen test (`payment-screens.test.tsx`)
- [x] 25. Review R4: ageing totals from one pass over the journal, parties looked up by id - _REQ-59, REQ-61; design:
  STRIDE "large data", key decision "Speed with large data"_
  - [x] budget and same-figures tests (`reports-performance.test.ts`, fingerprints taken from the code before the
    fix) - [x] books-hook test (`large-data.test.tsx`) - [x] docs updated
- [x] 26. Review Y13: month-by-month P&L from one stock pass (`closingStockValues`), ledger names remembered per set of
  books, books rebuilt only when their records change, invoice list sorted once and shown 200 rows at a time, sales in
  the All tab header without quotations, proformas or challans - _REQ-60 to REQ-63_
  - [x] unit tests (`reports-performance.test.ts`) - [x] screen tests (`large-data.test.tsx`) - [x] help and docs updated
- [x] 27. Test gap: speed budgets for ageing, P&L and the invoice list at the review's data size, in every Vitest run -
  _REQ-64_
  - [x] `tests/fixtures/large.ts`, `reports-performance.test.ts`, `large-data.test.tsx` - [x] passing in `heal:nightly`
- [x] 28. Compliance row 1: Table 4(A)(5) from the GSTR-2B opened on the GSTR-3B page (4(B)(1), 4(B)(2), 4(D)(2), the
  GSTR-2B check list), the books figure as a fallback with a warning - _REQ-65, REQ-66; design: STRIDE "GSTR-2B file",
  key decision "GSTR-3B"_
  - [x] unit tests (`gstr3b-review.test.ts`) - [x] screen tests (`gstr3b-screens.test.tsx`) - [x] help and docs updated
- [x] 29. Compliance row 18: Table 4(D) labels as in the form; 4(D) on the screen and in the Excel and CSV files -
  _REQ-67_
  - [x] unit and screen tests - [x] docs updated
- [x] 30. Compliance row 26: negative liability statement carried from earlier returns and set off before ITC - _REQ-68;
  design: key decision "GSTR-3B"_
  - [x] unit tests (`gstr3b-review.test.ts`) - [x] help and docs updated
- [x] 31. Compliance row 32 (was UNVERIFIED): confirmed from the GSTN system-generated GSTR-3B (3.1(a) break-up lists
  GSTR-1 Table 4B) and India Compliance; outward reverse-charge sales moved from 3.1(c) to 3.1(a) - _REQ-69_
  - [x] unit tests (`gstr3b-review.test.ts`, updated `gst-returns.test.ts`) - [x] help and docs updated
- [x] 32. Review Y7: credit needs a valid supplier GSTIN (`computeExpense`, `buildGstr3b`, expense form, sample data) -
  _REQ-70; design: STRIDE "credit without a GSTIN"_
  - [x] unit tests (`gstr3b-review.test.ts`, `seed-trash.test.ts`) - [x] screen test (`gstr3b-screens.test.tsx`)
    - [x] help and docs updated

## Blocked / needs decision
- **First git commit:** git has no `user.name` / `user.email` on this PC. Decision: the name and e-mail to commit with.
- **GitHub remote:** the repo is local only. Decision: which GitHub repository to push to (and sign in to GitHub on this
  PC), so the CI workflows run, including the ZAP baseline. After the push, create the `production` environment with
  required reviewers (Settings > Environments) so `deploy.yml` waits for approval.
- **Semgrep (SAST):** not installed on this PC. Decision: approve `pip install semgrep==1.183.0`, or rely on the CI job.
- **Lighthouse budgets:** needs `@lhci/cli` (approval).
- **GSTR-1 JSON version:** `GST3.0.4` could not be checked against an official schema (the e-way bill `1.0.0621` matches
  what india-compliance uses today). Decision: confirm with one real upload on the GST portal.
- **Browser version hosting:** the app can also run from static hosting (IndexedDB). Decision: keep it PC-only, or
  publish `dist/` somewhere such as GitHub Pages.
