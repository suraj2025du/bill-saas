# Fix log: review batch 07, editor safety (2026-11-07)

Findings CR Y1, CR Y2, CR Y3 from `docs/reviews/2026-11-07-code-review.md`, and FU1, FU2 follow-up fixes.

## CR Y1: Business Switching Guard

**What was wrong.** Switching the active business in the sidebar while an editor had unsaved changes could cause the unsaved document's `businessId` to be implicitly overwritten by the newly selected business.

**Fix.** Implemented `useBlocker` on all document and master editors so that any attempt to switch business in the sidebar (which is a routing navigation) blocks the action and prompts the user: "You have unsaved changes. Leave without saving?" If they proceed, the editor state is discarded without modifying data across business boundaries.

**Files changed.** `src/features/sales/DocEditor.tsx`, `src/features/purchases/Purchases.tsx`, `src/features/accounting/Vouchers.tsx`, `src/features/parties/Parties.tsx`, `src/features/inventory/Products.tsx`.

## CR Y2: Lock Screen Overlay

**What was wrong.** The automatic pin-lock or manual screen lock unmounted the active router tree and unmounted any open editor components, destroying in-progress, unsaved form data.

**Fix.** Refactored `src/App.tsx` rendering to keep `RouterProvider` fully mounted when `unlocked = false`. Instead of destroying the tree, the `<LockScreen overlay />` is mounted as an absolute sibling overlay (`fixed inset-0 z-[9999]`), fully capturing inputs and keyboard focus while keeping the underlying form inputs intact in background memory.

**Files changed.** `src/App.tsx`, `src/shell/LockScreen.tsx`.

## CR Y3: Finalized Documents Stay Editable

**What was wrong.** While other platforms freeze documents after finalizing/printing, this React 19 app's architecture allows all fields (invoice number, date, party, line items, and totals) to stay fully editable at any point, with the ledgers and books automatically and immediately rebuilding themselves on any save. This is correct as-designed, but requires strong dirty form safety to prevent accidentally discarding adjustments.

**Fix.** Secured all master/document editors with `useBlocker` and browser `beforeunload` event protection to ensure no edits are lost.

**Files changed.** `src/features/sales/DocEditor.tsx`, `src/features/purchases/Purchases.tsx`, `src/features/accounting/Vouchers.tsx`, `src/features/parties/Parties.tsx`, `src/features/inventory/Products.tsx`.

## FU1: Party Delete Voucher Guard

**What was wrong.** Deleting a party was blocked if it had invoices, bills, or receipts associated with it, but was allowed if journal vouchers (such as general journal adjustments, contras, or voucher-based ledger postings) used its ledger, leaving orphan references.

**Fix.** Extended the deletion block checker inside `src/features/parties/Parties.tsx` to search `vouchers` for any line targeting the party's ledger (`partyLedgerId(party.id)`). Deletion is now blocked with a compliance warning if any voucher line references the party.

**Files changed.** `src/features/parties/Parties.tsx`.

## FU2: Foreign Part-Payment Penny-Precision Correction

**What was wrong.** When recording multiple rounded part-payments against a single foreign currency invoice/bill, floating point rounding differences can leave a fractional surplus or deficit (such as ₹0.01 or ₹0.05) outstanding in the party ledger, even if the invoice was fully paid in the foreign currency.

**Fix.** Patched `paymentEntry` inside `src/core/accounting/postings.ts` to compute the cumulative settled book value of all payments for a given document. When a payment brings the cumulative foreign amount paid to the document's total (within a tiny 0.005 margin), its settled value is adjusted to exactly `originalBookValue - sum(priorPayments.settled)`, leaving precisely ₹0.00 outstanding.

**Files changed.** `src/core/accounting/postings.ts`, `tests/unit/core/foreign-payments.test.ts`.

## Regression tests

- `tests/unit/core/foreign-payments.test.ts`: Added multiple part-payments penny-precision test (`prevents penny/paise leftovers on multiple foreign part-payments (FU2)`).
- `tests/unit/ui/editor-safety.test.tsx`: Added UI regression tests verifying:
  1. Party deletion is successfully blocked when voucher lines target its ledger.
  2. `<LockScreen />` mounts correctly as an absolute overlay when locked, keeping router state intact.
