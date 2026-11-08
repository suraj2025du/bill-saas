# Fix Log - Batch 14: E-way Bill & Tax Rules Compliance

**Date:** 2026-11-08  
**Status:** Completed  
**Reference:** compliance-research.md (CO 11, CO 12, CO 13, CO 28, R32, R33)

---

## Context & Objectives
Batch 14 introduces rigorous validation compliance for Indian Goods and Services Tax (GST) and E-way bill generation, matching Tally and Busy software standards. The objectives included:
1. **CO 11 / R32 (Export Port exit PIN & State):** Ensuring that export invoices have valid port of exit PIN code and state code, setting the place of supply correctly to `96` (India Compliance alignment), and routing `toPincode` and `actualToStateCode` accordingly.
2. **CO 12 (180-Day Document Age):** Enforcing the official NIC restriction that blocks generating an E-way bill for any invoice or delivery challan older than 180 days.
3. **CO 28 (Vehicle Registration Formats):** Extending vehicle plate validation (`VEHICLE_RE`) to fully recognize standard regional registration number structures alongside special cases like defense (`DFxxxxxx`), temporary plates (`TMxxxxxx`), and neighboring transport (Bhutan/Nepal `BP` & `NP`).
4. **CO 13 (Compensation Cess Cutoff):** Implementing validation to block compensation cess completely on or after 1 Feb 2026 (`2026-02-01`), and warning (sales) or rejecting (purchases) on or after 22 Sep 2025 (`2025-09-22`) for any non-tobacco goods (tobacco and pan masala chapter 24 / 2106 remain active).

---

## Implementations & Code Modifications

### 1. Model & Factories Updates
- **File:** `src/core/model.ts`
  - Added optional properties `exportPortPincode` (string) and `exportPortStateCode` (string) to the `DispatchDetails` interface.
- **File:** `src/core/factories.ts`
  - Updated `emptyDispatch()` factory to initialize `exportPortPincode` and `exportPortStateCode` as empty strings (`''`).

### 2. E-way Bill Validation & Formatting
- **File:** `src/core/gst/eway.ts`
  - Re-formulated `VEHICLE_RE` to match standard, defense, temporary, and international formats:
    ```typescript
    const VEHICLE_RE = /^[A-Z]{2}[0-9]{1,3}[A-Z]{0,3}[0-9]{4}$|^[A-Z]{3}[0-9]{4}$|^DF[0-9A-Z]{5,}$|^TM[0-9A-Z]{5,}$|^(BP|NP)[0-9A-Z]{5,}$/;
    ```
  - Added 180-day document age check inside `buildEwayBill` using fake timer/deterministic millisecond checks:
    ```typescript
    const docDateMs = Date.parse(doc.date);
    const todayMs = Date.now();
    if (todayMs - docDateMs > 180 * 24 * 60 * 60 * 1000) {
      errors.push('The document date is more than 180 days in the past.');
    }
    ```
  - Upgraded the `exported` condition to strictly require dispatch details for the port of exit and align the `toStateCode` with India Compliance regulations (`96` state code and exit port details):
    ```typescript
    const exported = doc.supplyKind === 'EXPORT';
    if (exported) {
      if (!d.exportPortPincode) errors.push('Export invoices require a port of exit PIN code in dispatch details.');
      if (!d.exportPortStateCode) errors.push('Export invoices require a port of exit State Code in dispatch details.');
    }
    const toState = exported ? 96 : num(doc.placeOfSupply);
    const actualToState = exported ? num(d.exportPortStateCode || business.stateCode) : num(toAddr.stateCode || doc.placeOfSupply);
    ```
  - Configured `toPincode` to dynamically select the exit port PIN for exports:
    ```typescript
    toPincode: exported ? num(d.exportPortPincode || '') : num(toAddr.pincode),
    ```

### 3. Compensation Cess Cutoff Enforcement
- **File:** `src/core/docs/validate.ts` (Sales Documents)
  - Applied the cutoff check inside the `forEach` item validation loop:
    ```typescript
    if (item.cessRate > 0) {
      if (doc.date >= '2026-02-01') {
        err(`items.${i}.cessRate`, `${row}: Compensation cess ended on 1 February 2026 and cannot be charged.`);
      } else if (doc.date >= '2025-09-22') {
        const hsnClean = (item.hsn || '').replace(/\s/g, '');
        const isTobaccoOrPanMasala = hsnClean.startsWith('24') || hsnClean.startsWith('21069020');
        if (!isTobaccoOrPanMasala) {
          warn(`items.${i}.cessRate`, `${row}: Compensation cess was removed for non-tobacco goods on 22 Sep 2025.`);
        }
      }
    }
    ```
- **File:** `src/store/actions.ts` (Purchase Bills)
  - Applied strict validation inside `savePurchase`:
    ```typescript
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
    ```

---

## Verifications & Test Coverage

1. **Test Suite:** `tests/unit/core/cess-ewb-compliance.test.ts`
   - Created a dedicated unit/integration test covering:
     - 180-day E-way bill document age limits using Vitest's `vi.useFakeTimers()`.
     - Special vehicle registration plate formats (`DF`, `TM`, `BP`, `NP`).
     - Compensation cess cutoff logic on sales invoices (Feb 1 2026 errors & Sep 22 2025 warnings for non-tobacco).
     - Compensation cess cutoff logic on purchase invoices (utilizing `savePurchase` state actions & `UserError.details` assertions).
   - **Result:** **100% Passed**

2. **Test Suite:** `tests/unit/core/gst-returns.test.ts`
   - Updated existing export EWB assertions to test for missing dispatch details, and verify correct `toStateCode: 96` and `toPincode` outputs upon supply of exit port values.
   - **Result:** **100% Passed**

3. **Full Regression Suite:**
   - Executed the full vitest pipeline (`./node_modules/.bin/vitest run --maxWorkers=1 --no-file-parallelism`).
   - **Result:** **307 / 307 tests passed (100%)**

---

## Conclusion
Batch 14 successfully aligns the application's core compliance capabilities with official NIC portal rules and legal cess phaseouts. This guarantees that Free GST Billing can process commercial-grade inward/outward supply transactions without regulatory friction.
