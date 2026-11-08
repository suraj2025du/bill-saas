# Compliance research: GST and income-tax rules used by Free GST Billing

- Date of check: 7 November 2026 (law and portal formats in force on that date)
- Scope: every GST / income-tax rule, threshold, date and portal file format found in the code. No app code was changed.
- Code paths are relative to `C:\Users\Suraj\workplace\free-gst-billing\`. Line numbers are from the working tree on 7 Nov 2026.
- Verdicts: **OK**, **WRONG** (the app does something the law or portal does not accept), **OUTDATED** (was right, changed since), **MISSING** (a rule the app should apply and does not), **UNVERIFIED** (could not be confirmed from a fetched source; what was tried is stated).
- Source labels: [S1]..[S20] are listed at the end with the URL, the notification/advisory number and date. "Secondary" marks a non-government source used only where no official page could be read.

## 1. Everything that is not OK, most harmful first

| # | Area | Verdict | Problem in one line | Where |
|---|------|---------|---------------------|-------|
| 1 | GSTR-3B ITC | WRONG | Table 4(A) ITC is taken from every purchase bill dated in the period, not from GSTR-2B / IMS. ITC not in GSTR-2B is not allowed and the portal flags excess claims. | `src/core/gst/returns/gstr3b.ts:220-254` |
| 2 | TCS 206C(1) rates | WRONG (from 1 Apr 2026) | Scrap, liquor, minerals still 1% and tendu leaves 5%; Finance Act 2026 made all of them 2% under s.394(1). No date ranges. | `src/core/tds.ts:192-208` |
| 3 | E-invoicing (IRN) | MISSING | No IRN / e-invoice JSON. Mandatory for B2B, export and CDN documents of businesses with AATO of Rs 5 crore and above; IRP rejects documents older than 30 days for AATO >= Rs 10 crore. | (no code) `src/core/model.ts:172` has a `turnoverAbove5Cr` flag that is not used for this |
| 4 | GSTR-3B liability / GSTR-1A | OUTDATED + MISSING | Portal 3B liability (Table 3.1, 3.1.1) is non-editable from July 2025 and Table 3.2 from Nov 2025; corrections go through GSTR-1A. The app computes 3B from its books, never compares it with what was filed in GSTR-1, and has no GSTR-1A. | `src/core/gst/returns/gstr3b.ts:156-304`, `src/help/guide.ts:147` |
| 5 | TDS/TCS statement section codes | OUTDATED | CSV for the quarterly statement always writes 1961 codes (194C, 206C(1)...). For credits/payments from 1 Apr 2026 the IT Department says old codes cause processing errors; it must be s.393 / s.394 table serial numbers. | `src/core/tdsReports.ts:119-135`, `src/core/tds.ts:62-209` |
| 6 | TDS on non-residents (195) | WRONG | 195 rows go into the Form 26Q / Form 140 register. Non-resident TDS is reported in Form 27Q, now Form 144. | `src/core/tdsReports.ts:112-116`, `src/core/tds.ts:29-34` |
| 7 | HSN in invoices / GSTR-1 | WRONG | 6-digit HSN for AATO > Rs 5 crore is never enforced on invoices (flag not passed, warnings dropped); no check against the GST HSN master that the portal uses since Phase-III (May 2025). | `src/core/docs/validate.ts:71-75`, `src/core/gst/hsn.ts:16-35` |
| 8 | GSTR-1 JSON `version` | UNVERIFIED (most important open question) | App writes `"version": "GST3.0.4"` (a 2021 offline-tool release). Current tool is V3.2.4. India Compliance, whose files the portal accepts, writes no `version` and no `hash` at all. | `src/core/gst/returns/gstr1.ts:581` |
| 9 | GSTR-1 JSON blanks | WRONG | Empty strings (e.g. `hsn_sc: ""` for an item without HSN) are written; the portal rejects blank values and India Compliance strips them. | `src/core/gst/returns/gstr1.ts:563-577, 580-673` |
| 10 | GSTR-1 CSV export | WRONG | Column sets and order differ from the official offline-tool CSV templates (extra tax columns, Rate column in the wrong place in B2CS and HSN, no operator name in eco, UQC and date formats, file name). Files will not import into the offline tool. | `src/core/gst/returns/gstr1Csv.ts:20-122` |
| 11 | E-way bill export | WRONG | `toPincode` is 999999 for exports; NIC requires the PIN of the place where goods leave India (port). | `src/core/gst/eway.ts:122` |
| 12 | E-way bill base document age | MISSING | From 1 Jan 2025 an EWB cannot be generated for a document older than 180 days; the app does not warn. | `src/core/gst/eway.ts:49-68` |
| 13 | Compensation cess | OUTDATED | Cess can be charged on any date. Compensation cess ended for all goods on 1 Feb 2026 (only tobacco items kept it from 22 Sep 2025 to 31 Jan 2026). | `src/core/gst/compute.ts:59`, `src/features/sales/DocEditor.tsx:679`, `src/features/inventory/Products.tsx:271` |
| 14 | Credit note must cite the invoice | MISSING | Rule 53(1A) requires the serial number and date of the original invoice; the app only warns "recommended". | `src/core/docs/validate.ts:78-80` |
| 15 | Credit note time limit | MISSING | s.34(2): a credit note for an FY's supply must be declared by 30 November of the next FY (or the annual return, if earlier). No check. | (no code) |
| 16 | Rule 46(e) B2C >= Rs 50,000 | MISSING | For an unregistered buyer with taxable value of Rs 50,000 or more the invoice must show name, address, delivery address, state name and code. Not validated. | `src/core/docs/validate.ts:34-46` |
| 17 | Rule 48 copy labels for services | WRONG | Services invoice must be in duplicate: "DUPLICATE FOR SUPPLIER". App always prints "Duplicate for Transporter" / "Triplicate for Supplier". | `src/print/view.ts:131-137`, `src/print/labels.ts:50-52` |
| 18 | GSTR-3B Table 4(D) labels | WRONG | 4(D)(1)/(2) are "ITC reclaimed which was reversed under 4(B)(2) earlier" and "Ineligible ITC u/s 16(4) & PoS rules". App labels 4(D)(1) "Rule 38 (banking company)". | `src/core/gst/returns/gstr3b.ts:210` |
| 19 | Section 9(5) e-commerce supplies | MISSING | No GSTR-1 Table 14(b) `paytx`, no Table 15, no GSTR-3B Table 3.1.1. | `src/core/gst/returns/gstr1.ts:308-311, 669`, `src/core/gst/returns/gstr3b.ts:310-338` |
| 20 | ITR filing due date default | OUTDATED | Default return date is 31 July; from AY 2026-27 non-audit business/profession cases are due 31 August. Affects the 234B months shown. | `src/core/itr/incomeTax.ts:157` |
| 21 | "TDS deducted by customers" label | OUTDATED | For Tax Year 2026-27 the annual statement is Form 168, not Form 26AS/AIS. | `src/core/tdsReports.ts:114` |
| 22 | TCS 206C(1) without PAN | MISSING | No "No PAN" rate for 206C(1) (other sections have one). | `src/core/tds.ts:192-208` |
| 23 | Income-tax Act 2025 section names | OUTDATED (cosmetic) | For Tax Year 2026-27 the helper still labels 80C/80D/87A/44AD/234C; new references are e.g. Schedule XV with s.123, s.156 (rebate), s.58 (presumptive), s.425 (234C). | `src/core/itr/incomeTax.ts:244, 257, 271, 293-300` |
| 24 | QRMP monthly payment / IFF | MISSING | No reminder for PMT-06 (25th, months 1 and 2 of the quarter) or optional IFF (13th). | `src/core/gst/dueDates.ts:45-51`, `src/help/guide.ts:242` |
| 25 | 3-year time bar | MISSING | Returns cannot be filed 3 years after their due date (enforced on the portal since the July 2025 period). No warning when preparing such a period. | (no code) |
| 26 | Negative liability in 3B | MISSING | Portal carries negative liability forward (negative liability statement, since Sep 2024). App says it is "not carried forward automatically". | `src/core/gst/returns/gstr3b.ts:272-274` |
| 27 | Invoice number first character | WRONG (low) | Regex allows a number starting with "-" or "/". India Compliance requires the first character to be a letter or digit. | `src/core/docs/numbering.ts:6` |
| 28 | Vehicle number check | WRONG (low) | Regex misses NIC formats ABC1234, AB123A1234, DF..., TM... (any length >= 7), BP..., NP.... Only a warning. | `src/core/gst/eway.ts:43` |
| 29 | Intra-state e-way warning | MISSING (low) | "E-way bill required" warning is shown only for inter-state movement; intra-state movements also need one above the state's limit. | `src/core/docs/validate.ts:81-89` |
| 30 | RSP valuation of tobacco | MISSING (niche) | From 1 Feb 2026 GST on notified tobacco goods is computed on the retail sale price. Not supported. | (no code) |
| 31 | E-way export `toStateCode` 99 | UNVERIFIED | App writes 99; India Compliance sends the place of supply (96 for exports, 96 also for SEZ billing state). | `src/core/gst/eway.ts:73` |
| 32 | RCM outward sales in 3B 3.1(c) | UNVERIFIED | App puts the taxable value of outward reverse-charge sales in 3.1(c). | `src/core/gst/returns/gstr3b.ts:185-189` |
| 33 | E-way 4,000 km cap | UNVERIFIED | Error above 4,000 km. | `src/core/gst/eway.ts:61` |
| 34 | 57th GST Council (8 Oct 2026) | UNVERIFIED (watch) | Recommendations on returns, IMS rule 60(6A), e-invoicing for RCM self-invoices and some service rates are not yet confirmed as notified. | n/a |

Count of non-OK items: WRONG 11, OUTDATED 6, MISSING 13, UNVERIFIED 5 (items 8 and 31-34; item 34 is a watch item). Row 4 is counted once as OUTDATED and once as MISSING.

---

## 2. Rule-by-rule findings

### 2.1 GST rates and cess

**R1. Rate slabs after 22 Sep 2025** - OK
- App: `src/core/gst/rates.ts:4` reform date `2025-09-22`; `:7` current slabs `[0, 5, 18, 40]`; `:11` legacy `[12, 28]`; `:22-24` warning when 12/28 is used on or after the reform date; `:28` picker shows `0, 5, 12, 18, 28` for older dates. Help text `src/help/guide.ts:29`.
- Rule: 56th GST Council, effective 22 Sep 2025: two slabs 5% and 18%, 40% for select goods; large cars "flat 40% (no cess)"; tobacco 28% -> 40% [S1]. Offline tool release 3.2.3 "Addition of new tax rate - 40%" [S2]. From 1 Feb 2026 bidi moved to 18% and all other tobacco to 40%, the "now-defunct 28% slab" [S11, secondary; GSTN advisory 646 on RSP valuation, 23 Jan 2026, S3].
- Change: none. Optional: once nothing is taxed at 28% after 31 Jan 2026, upgrade the 28% warning to "no goods use 28% on or after 1 Feb 2026".

**R2. Special rates** - OK
- App: `src/core/gst/rates.ts:9` `[0.1, 0.25, 1, 1.5, 3, 6, 7.5]`.
- Rule: the offline tool accepts 1%, 1.5%, 7.5% (release 2.3.1) and 6% (release 3.1.5) besides the slabs [S2]; NIC e-way bill validates rates against its standard list [S7].
- Change: none.

**R3. Compensation cess** - OUTDATED
- App: `src/core/gst/compute.ts:59` applies `item.cessRate` whenever the line is taxed, with no date check; cess can be typed for any product (`src/features/inventory/Products.tsx:271`) and line (`src/features/sales/DocEditor.tsx:679`).
- Rule: from 22 Sep 2025 compensation cess was removed for all items except tobacco; from 1 Feb 2026 it ceased for those as well (Ministry of Finance notifications of 1 Jan 2026) [S11, secondary]; GSTN's 23 Jan 2026 advisory on RSP-based valuation of notified tobacco goods confirms the new regime from 1 Feb 2026 [S3, id 646].
- Change: in `validate.ts`, error when `cessRate > 0` and the document date is on/after `2026-02-01`; warning when `cessRate > 0` between `2025-09-22` and `2026-01-31` unless the HSN is tobacco/pan masala (chapter 24, 2106 90 20). Keep cess for older documents. Same check for purchase bills.

**R4. RSP-based valuation for tobacco (from 1 Feb 2026)** - MISSING (niche)
- Rule: GSTN advisory 646 (23 Jan 2026) [S3]; NIC relaxed EWB error 620 for those HSNs from 1 Feb 2026 under Notification 20/2025-CT dated 31 Dec 2025 [S7 release notes].
- Change: document as unsupported in `src/help/guide.ts`; block 40% tobacco HSNs or add an RSP input later. Low priority for this app's users.

### 2.2 GSTR-1

**R5. B2C (Large) limit** - OK
- App: `src/core/gst/returns/period.ts:67-70` Rs 2.5 lakh up to 31 Jul 2024, Rs 1 lakh from 1 Aug 2024, compared with `>` in `gstr1.ts:423` and for unregistered notes via the original invoice date `gstr1.ts:444-448`. Help `src/help/guide.ts:124`.
- Rule: Notification 12/2024-CT (10 Jul 2024) cut the limit from 2.5 lakh to 1 lakh [S3, id 518]; offline tool 3.2.1 uses the return period before/after Aug 2024, 3.2.4 accepts 100000.01-100000.49 [S2]; India Compliance `B2C_LIMIT = [("2024-07-31", 2_50_000), ("2099-03-31", 1_00_000)]` [S6].
- Change: none.

**R6. Table 12 HSN split into B2B and B2C from the May 2025 period** - OK
- App: `period.ts:72-73` `HSN_SPLIT_FROM = '2025-05-01'`; `gstr1.ts:275, 360, 653-658` writes `hsn: { hsn_b2b, hsn_b2c }` from May 2025 and `hsn: { data }` before; SEZ goes to B2B (`:360`).
- Rule: GSTN advisories 22 Jan 2025 (Phase-III: dropdown, B2B/B2C tabs) and 1 May 2025 (Phase-3 from May 2025 return period) [S3, ids 574, 597]; offline tool release 3.2.2 [S2]; India Compliance `HSN_BIFURCATION_FROM = 2025-05-01`, keys `hsn_b2b` / `hsn_b2c` / `data` [S6].
- Change: none.

**R7. HSN digits by turnover, HSN validity** - WRONG
- App: `src/core/gst/hsn.ts:16-35` accepts 4, 6 or 8 digits and only warns about < 6 digits when `turnoverAbove5Cr` is passed. `src/core/docs/validate.ts:72` calls `checkHsn(item.hsn)` without the flag, and `:74` uses only `h.errors`, so the 6-digit rule is never applied to invoices (it is only shown on the product screen, `src/features/inventory/Products.tsx:161`). There is no check against the GST HSN master.
- Rule: Notification 78/2020-CT (15 Oct 2020): minimum 4 or 6 digits by AATO of the preceding FY (6 digits above Rs 5 crore); Phase-3 from May 2025 makes the HSN a dropdown from the master list and Table 13 mandatory [S3, ids 574, 597]; offline tool 3.1.6 "minimum input HSN length to 6 digits for AATO greater than 5 CR", 3.1.7 "HSN validation phase II" [S2]. India Compliance ships a master `india_compliance/gst_india/data/hsn_codes.json` [S6].
- Change: in `validate.ts:72` call `checkHsn(item.hsn, business.turnoverAbove5Cr)` and treat the < 6 digit case as an error for GSTR-1 documents of such businesses; add an offline HSN/SAC master (copy the public list; no new dependency) and warn when a code is not in it; block GSTR-1 export when any line has no HSN.

**R8. HSN description 30 characters, UQC list, services "NA"** - OK
- App: `period.ts:74` `HSN_DESC_MAX = 30`; `gstr1.ts:369`; UQC list `src/core/gst/units.ts:5-51`; services report `NA` with no quantity `units.ts:117-122`, `gstr1.ts:363-380`.
- Rule: India Compliance `HSN_DESCRIPTION_LIMIT = 30`, services UQC `"NA"` [S6]; the NIC master code list has the same 45 UQC codes [S7 master codes].
- Change: none.

**R9. Table 13 documents issued** - OK
- App: `gstr1.ts:114-122` natures 1, 4, 5, 9-12; `:227-260`; `:660-667`.
- Rule: Table 13 mandatory from the May 2025 period [S3, id 597]; the offline tool docs.csv uses "Nature of Document, Sr. No. From, Sr. No. To, Total Number, Cancelled" [S2].
- Change: none.

**R10. Table 14 (supplies through e-commerce operators, `supeco` / `clttx`)** - OK for 14(a)
- App: `gstr1.ts:46-62, 300-330, 668-671` writes `supeco: { clttx: [{ etin, suppval, igst, cgst, sgst, cess }] }`; B2C(Others) rows keep `typ: 'OE'` (`:617`).
- Rule: Tables 14 and 15 added by Notification 26/2022-CT (26 Dec 2022), live from the Jan 2024 period; 14A/15A from Feb 2024 [S3, ids 483, 489]. India Compliance JSON keys: `supeco`, `clttx` (u/s 52), `paytx` (u/s 9(5)), `etin`, `suppval`, `igst`, `cgst`, `sgst`, `cess`; B2CS type is always `OE` [S6 `gst_returns/fields/gstr1.py:131-174`, `sections/b2cs.py:29`].
- Change: none for 14(a).

**R11. Table 14(b) `paytx`, Table 15, and other section 9(5) reporting** - MISSING
- App: reverse-charge e-commerce sales are only warned about (`gstr1.ts:308-311`, `validate.ts:55`); `gstr1.ts:669` comment "paytx ... is not supported"; help `guide.ts:137`.
- Rule: same as R10 [S3, ids 483, 489]; GSTR-3B Table 3.1.1 exists for 9(5) supplies [S5].
- Change: add `paytx` rows (operator GSTIN, net value; tax is paid by the operator) for sales flagged "operator pays tax u/s 9(5)" (restaurant, passenger transport, accommodation through apps), report them in 3B 3.1.1(ii), and exclude their tax from the supplier's own liability. Table 15 is mainly for operators and can stay out, documented.

**R12. GSTR-1A** - MISSING
- Rule: Notification 12/2024-CT introduced GSTR-1A, available from Aug 2024 for amending the current period before 3B [S3, id 506]; 3B liability became non-editable from the July 2025 period, corrections only through GSTR-1A [S3, id 606]; Table 3.2 non-editable from the Nov 2025 period [S3, id 640].
- Change: add a "GSTR-1A" export: the same JSON writer for the documents added/changed after the GSTR-1 for that period was marked filed (store a "filed on" snapshot per period). At minimum, let the user mark GSTR-1 as filed and show the difference between books and the filed figures.

**R13. GSTR-1 JSON `version` value ("GST3.0.4")** - UNVERIFIED (most important open question)
- App: `src/core/gst/returns/gstr1.ts:581` `{ gstin, fp, version: 'GST3.0.4', hash: 'hash' }`.
- What was checked:
  - The portal's download page shows "Returns Offline Tool Version V3.2.4" [S2]. The zip was downloaded (SHA-256 F0A7D6F6...AC60E312, matches the value on the page; Last-Modified 31 Oct 2026). Its `ReleaseNotes.txt` lists 3.0.4 as a 2021-era release ("Relaxation in validations for hsn table 12"), older than 3.1.x (HSN validation), 3.2 (Tables 14/15), 3.2.2 (HSN split) and 3.2.3 (40%).
  - India Compliance, whose GSTR-1 JSON is uploaded to the portal by its users, builds the upload file as `{"gstin": ..., "fp": ..., **sections}` with no `version` and no `hash` key, and strips every blank value [S6 `doctype/gstr_1/gstr_1_export.py:2293-2308`].
  - The reference project's portal rejection for an Aug 2026 file ("Download the latest version of Offline tool...") was fixed by splitting HSN and removing blanks, not by changing the version string [S15].
  - Not confirmed: the exact `version` string the 3.2.4 tool writes. The tool is an Inno Setup installer; reading its files needs installing or an unpacker, which this task forbids. No official schema page states the field.
- Change: remove `version` and `hash` from `gstr1Json` (match India Compliance, which is the only portal-proven reference found), and strip blank values (R14). If the team prefers to keep a header, use `"version": "GST3.2.4"` to match the current tool. Either way, the acceptance test is one real upload of a month with B2B, B2CS, HSN B2B/B2C and Table 13 on gst.gov.in > Returns > GSTR-1 > Prepare offline.

**R14. Blank values in the JSON** - WRONG
- App: `gstr1.ts:563-577` always writes `hsn_sc`, `desc`, `uqc`; an item without HSN yields `hsn_sc: ""` (only a warning at `:388`); other writers can emit empty `pos`/`ctin` when data is missing.
- Rule: India Compliance strips blanks because "portal rejects blanks" [S6 `gstr_1_export.py:2295-2296`, `sections/__init__.py` `strip_empty`]; the reference repo fix #133 says the same [S15].
- Change: add a `stripEmpty` pass (drop `''`, `null`, `undefined`, empty arrays/objects; keep 0) before returning from `gstr1Json`, and block the export when a required field (HSN, POS, recipient GSTIN) is empty.

**R15. GSTR-1 CSV files "with the column names of the GST offline tool"** - WRONG
- App: `src/core/gst/returns/gstr1Csv.ts:7-10` claims the offline-tool template; headers at `:45, 54, 61, 70, 79, 86, 100, 116, 118`; dates `:20-23` as `05-Nov-2026`; UQC as the bare code `:87`; file names `:97-120`. Help `src/help/guide.ts:126`.
- Rule (official `Section_wise_CSV_files/GSTR1/*.csv` in the V3.2.4 zip [S2]):
  - `b2b,sez,de.csv`: `GSTIN/UIN of Recipient, Receiver Name, Invoice Number, Invoice date, Invoice Value, Place Of Supply, Reverse Charge, Applicable % of Tax Rate, Invoice Type, E-Commerce GSTIN, Rate, Taxable Value, Cess Amount` (no IGST/CGST/SGST columns).
  - `b2cl.csv`: `Invoice Number, Invoice date, Invoice Value, Place Of Supply, Applicable % of Tax Rate, Rate, Taxable Value, Cess Amount, E-Commerce GSTIN` (no IGST column).
  - `b2cs.csv`: `Type, Place Of Supply, Rate, Applicable % of Tax Rate, Taxable Value, Cess Amount, E-Commerce GSTIN` (Rate before Applicable %; no tax columns).
  - `exp.csv`: `Export Type, Invoice Number, Invoice date, Invoice Value, Port Code, Shipping Bill Number, Shipping Bill Date, Rate, Taxable Value, Cess Amount`.
  - `cdnr.csv`: `..., Note Value, Applicable % of Tax Rate, Rate, Taxable Value, Cess Amount`; `cdnur.csv`: `UR Type, Note Number, Note Date, Note Type, Place Of Supply, Note Value, Applicable % of Tax Rate, Rate, Taxable Value, Cess Amount`.
  - `hsn(b2b).csv`, `hsn(b2c).csv`, `hsn.csv`: `HSN, Description, UQC, Total Quantity, Total Value, Taxable Value, Integrated Tax Amount, Central Tax Amount, State/UT Tax Amount, Cess Amount, Rate` (Rate is last; UQC as `BAG-BAGS`).
  - `eco.csv`: `Nature of Supply, GSTIN of E-Commerce Operator, E-Commerce Operator Name, Net value of supplies, Integrated tax, Central tax, State/UT tax, Cess`.
  - `exemp.csv`, `docs.csv`: match the app.
  - Sample dates are `14-Jul-17` (dd-Mmm-yy); India Compliance's offline-tool Excel uses `dd-mmm-yy` [S6 `gstr_1_export.py:885`].
- Change: make each CSV match its template exactly (same columns, same order, `code-NAME` UQC, `dd-Mmm-yy` dates, file name `b2b,sez,de.csv`). If tax columns are wanted for checking, put them in a separate "review" sheet/file, not in the import CSVs. Fix the comment at `:7-10` and the help text.

**R16. GST TCS by e-commerce operators (s.52)** - OK
- App: `gstr1.ts:59-62` 1% up to 9 Jul 2024, 0.5% from 10 Jul 2024; help `guide.ts:134-136`.
- Rule: Notification 15/2024-CT dated 10 Jul 2024, rate 0.5% (0.25% CGST + 0.25% SGST/UTGST or 0.5% IGST) from 10 Jul 2024 [S3, id 512].
- Change: none.

### 2.3 GSTR-3B, GSTR-2B and IMS

**R17. Liability source and locks** - OUTDATED
- App: `gstr3b.ts:171-202` builds 3.1 and 3.2 from the app's invoices; help `guide.ts:147` "compare it with this report before you pay".
- Rule: the portal auto-fills 3.1, 3.1.1 and 3.2 from GSTR-1/1A/IFF [S5]; auto-populated liability is non-editable from the July 2025 tax period [S3, id 606]; Table 3.2 non-editable from the Nov 2025 period [S3, id 640]; from Feb 2026 the "Tax liability breakup" for earlier-period documents is auto-filled from document dates and must be confirmed [S3, id 653]. The 57th Council (8 Oct 2026) also recommended aligning 3B liability with GSTR-1/1A/IFF [S14].
- Change: compute 3B liability from the GSTR-1 report of the same period (same filter as `buildGstr1`), show any difference with the books as an error that points to GSTR-1A, and update `guide.ts:147` to say liability is locked to GSTR-1/1A.

**R18. Input tax credit source (Table 4A)** - WRONG
- App: `gstr3b.ts:220-254` adds ITC of every FINAL purchase bill and every expense with GST whose own date falls in the period. The 2B reconciliation (`gstr2b.ts:172-255`) is not used.
- Rule: Table 4A is auto-populated from GSTR-2B [S5 note 5]; GSTR-2B is generated on the 14th from IMS actions (accept/reject/pending) [S3, ids 517, 549, 628]; credit notes can be kept pending one period and the ITC reversal on acceptance can be declared [S3, ids 624, 631]; ITC claimed in 4A(2)/(3) above the RCM statement balance is flagged [S5].
- Change: build 4A(5) from the matched/accepted GSTR-2B documents of the period when a 2B file has been imported (bills "missing in 2B" excluded and listed), and keep the books-based figure only as a fallback with a clear warning. Credit notes in 2B should reduce ITC.

**R19. Table 4(B) and 4(D) labels** - WRONG (4D), OK (4B)
- App: `gstr3b.ts:209` 4(B)(1) "As per rules 38, 42 & 43 of CGST Rules and section 17(5)", 4(B)(2) "Others" (OK); `:210` 4(D)(1) "Rule 38 (reversal of credit by a banking company)", 4(D)(2) "Others".
- Rule: from FY 2023-24 Table 4(D) is "ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period" and "Ineligible ITC under section 16(4) & ITC restricted due to PoS rules"; non-reclaimable reversals go to 4(B)(1), reclaimable to 4(B)(2) [S5].
- Change: rename the two 4(D) rows (keep JSON `ty` values `RUL`/`OTH`, as India Compliance's 3B template does - not re-checked here) and put blocked/time-barred ITC in 4(D)(2).

**R20. Table 3.1.1 (s.9(5))** - MISSING. See R11. `gstr3bJson` (`gstr3b.ts:310-338`) has no `eco_dtls` block.

**R21. ITC set-off order (s.49, 49A, 49B, rule 88A)** - OK
- App: `gstr3b.ts:95-144`; help `guide.ts:146`.
- Rule: IGST credit first for IGST, then CGST or SGST/UTGST in any order, before CGST/SGST credit; balance IGST liability may then be paid from CGST or SGST credit "in any order"; CGST credit never for SGST and vice versa; reverse-charge and 3.1.1(i) liabilities only in cash [S5, payment section f].
- Change: none. Note: the app's fixed CGST-then-SGST order for IGST is one of the allowed choices.

**R22. Negative liability** - MISSING (low). Portal allows negative values in 3.1/3.1.1 since Sep 2024 and keeps a negative liability statement [S5]; `gstr3b.ts:272-274` only notes it. Change: show the negative amount as "carried to the negative liability statement" instead of flooring at 0 (`:266-271`).

**R23. Outward reverse-charge sales in 3.1(c)** - UNVERIFIED. App `gstr3b.ts:185-189, 203-205` with a note. No official instruction for this row was fetched (the GSTR-3B user guide [S5] is silent). Keep the note; confirm with the form instructions before changing.

**R24. 3-year time bar** - MISSING (low)
- Rule: Finance Act 2023, effective 1 Oct 2023 (Notification 28/2023-CT); GSTR-1/1A, 3B, 4, 9/9C barred 3 years after the due date, enforced on the portal from the July 2025 period; e.g. from 1 Dec 2025 GSTR-1 and 3B for Oct 2022 are barred [S3, ids 607, 633].
- Change: in the GSTR-1/3B pages, warn when the selected period's due date is more than 3 years before today.

**R25. GSTR-2B parser** - OK as far as checked. `gstr2b.ts:64-114` reads `data.docdata.b2b/cdnr` with `ctin, trdnm, inum, dt, val, rev, itcavl` and skips amendments/imports. GSTR-2B from Oct 2025 also carries IMS import-of-goods records (`impg`) [S3, id 634]; the parser lists them as skipped. Not compared field-by-field with an official 2B schema.

### 2.4 Due dates

**R26. Monthly GSTR-1 (11th) and GSTR-3B (20th)** - OK. `src/core/gst/dueDates.ts:43-44`. Portal "important dates": GSTR-1 (Oct 2026) 11 Nov 2026, GSTR-3B (Oct 2026) 20 Nov 2026 [S4].

**R27. QRMP GSTR-1 13th, GSTR-3B 22nd/24th, state lists** - OK
- App: `dueDates.ts:8` 22nd for codes 22-37 (incl. old 25 and 28), 24th for the rest (incl. 38 Ladakh, 01, 04, 07); `:49-50`.
- Rule: portal: GSTR-1 (Oct-Dec 2026) 13 Jan 2027, GSTR-3B (Oct-Dec 2026) "Jan 22nd, 24th, 2027", IFF (optional) 13th, CMP-08 18th [S4]. State groups: 22nd for Chhattisgarh, MP, Gujarat, DNH & DD, Maharashtra, Karnataka, Goa, Lakshadweep, Kerala, Tamil Nadu, Puducherry, A&N, Telangana, AP; 24th for the others including J&K, Ladakh, Chandigarh, Delhi [S12, secondary; the CBIC notification PDF was not read].
- Change: none.

**R28. QRMP PMT-06 and IFF reminders** - MISSING (low). PMT-06 by the 25th for months 1 and 2 of a quarter [S12, secondary]; IFF optional by the 13th [S4]. Change: add both to `gstDeadlines` for `QUARTERLY` filers and to `guide.ts:242`.

### 2.5 E-way bill

**R29. Bulk JSON version "1.0.0621"** - OK. `src/core/gst/eway.ts:46-47, 146`. India Compliance writes the same `"version": "1.0.0621"` with `billLists` and the bulk-only keys `transType`, `actualFromStateCode`, `actualToStateCode`, `OthValue`, `TotNonAdvolVal` [S6 `utils/e_waybill.py:91-94, 1888-1903`]. Matches the app.

**R30. Rs 50,000 limit** - OK for the value used; MISSING (low) for intra-state. `eway.ts:68`, `validate.ts:17, 81-89`. The value is the general Rule 138 limit (the rule text was not fetched; India Compliance keeps a "State-wise e-Waybill Threshold" table because intra-state limits differ by state [S6 tree]). Change: also warn for intra-state movements and let the user set the state's intra-state limit.

**R31. 180-day age limit on the base document** - MISSING
- Rule: from 1 Jan 2025 EWB only for documents dated within 180 days of generation; extensions capped at 360 days from generation; MFA mandatory for all users from 1 Apr 2025 (AATO > 20 crore from 1 Jan 2025, > 5 crore from 1 Feb 2025) [S3, id 561; S7 announcements 18 Dec 2024].
- Change: in `buildEwayBill`, error when `today - doc.date > 180 days`. The 360-day cap and MFA need no app change (no extension or login in the app); mention MFA in the help text.

**R32. Export consignee PIN** - WRONG
- App: `eway.ts:122` `toPincode: exported ? 999999 : ...`; `:74` `actualToStateCode` = business state for exports.
- Rule: "In export scenario, toPincode should be of the place from where goods leave the country" [S7 announcements]; India Compliance uses the port address as ship-to (real PIN and state) and 999999 only for the foreign billing address [S6 `utils/e_waybill.py:1219-1224`, `utils/transaction_data.py:426-430`].
- Change: add "port of exit PIN and state" to the dispatch details of export invoices; use them for `toPincode` and `actualToStateCode`; error if missing.

**R33. Export `toStateCode`** - UNVERIFIED. App `eway.ts:73` uses 99. India Compliance sends the POS state (96 for exports) and forces 96 for SEZ billing states to avoid NIC errors 641/642 [S6 `utils/e_waybill.py:1684-1690, 1825-1828`]. The NIC state master was not found on the API docs site [S7 master codes]. Change: align with India Compliance (96) after one sandbox or portal test.

**R34. Vehicle number formats** - WRONG (low). App `eway.ts:43`. NIC valid formats: AB121234, AB12A1234, AB12AB1234, ABC1234, AB123A1234, AB12ABC1234, DFxxxxxx, TM (>= 7 chars), BP/NP (>= 7 chars) [S7 master codes]. Change: replace the regex with these patterns (warning only, as now).

**R35. Other EWB items** - OK / watch
- Sub-supply, document, transport mode and vehicle type codes (`eway.ts:10-22, 42, 75, 140`) match the NIC master list [S7].
- EWB number grows from 12 to 14 digits (consolidated 10 to 11) from 1 Jan 2027 [S3, id 687]; the app stores `ewayBillNo` as free text with no length check (searched `src/`), so no change is needed now.
- Ship-to GSTIN mandatory and EWB closure were put on hold on 29 Jul 2026 [S3, id 668; S7 release notes]. No change.
- 4,000 km cap (`eway.ts:61`): UNVERIFIED - not stated on the fetched NIC pages. Same-PIN rule (distance 1-100 km, portal does not auto-calculate) [S7 announcements]: the warning at `eway.ts:145` "portal will calculate it" is wrong for same-PIN moves; make distance mandatory when both PINs are equal.

### 2.6 E-invoicing (IRN)

**R36. E-invoice support** - MISSING (large gap for businesses above Rs 5 crore)
- Rule: e-invoicing applies to taxpayers with AATO of Rs 5 crore and above ("the current eligibility threshold for e-Invoicing") [S3, id 678, 16 Oct 2026]; from 1 Apr 2025 taxpayers with AATO of Rs 10 crore and above cannot report a document older than 30 days, for invoices, credit notes and debit notes [S3, id 543]. GSTN also announced e-way bill integration with the IRP portals in 2024 [S3, advisory titles 488 and 504; their text was not read]. The 57th Council recommended extending IRN to RCM self-invoices (RCMDOM/RCMIMP) for the same Rs 5 crore class [S3, id 678; S14].
- Size of the gap: a business below Rs 5 crore AATO in every FY since 2017-18 is not affected (and B2C invoices never need an IRN). A business that crosses Rs 5 crore in any year must issue IRNs for every B2B invoice, export and B2B credit/debit note; an invoice without IRN is not a valid tax invoice and the buyer loses ITC. Such a user cannot rely on this app for B2B billing.
- Change: smallest useful step: when `business.turnoverAbove5Cr` is on, show a blocking notice on B2B/export invoices that an IRN is required, and export the invoice in the NIC e-invoice JSON schema (INV-01) for manual upload on the IRP "bulk generation" tool, with fields to paste back the IRN, Ack No/Date and signed QR. Full API integration needs GSP credentials and is out of scope.

### 2.7 Invoices and notes (Rules 46, 48, 49, 53; s.34)

**R37. Rule 46(b) invoice number** - OK (length, characters), WRONG (low) on the first character
- App: `src/core/docs/numbering.ts:4-6, 14-22` max 16, `[A-Za-z0-9/-]`; help `guide.ts:203`.
- Rule: "a consecutive serial number not exceeding sixteen characters ... alphabets or numerals or special characters hyphen or dash and slash ... unique for a financial year" [S8]. India Compliance: `^[^\W_][A-Za-z0-9\-\/]{0,15}$`, so the first character is a letter or digit [S6 `constants/__init__.py:1478`]; the offline tool rejects invoice number "0" (release 2.2.8) [S2].
- Change: `DOC_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$/` and reject an all-zero number.

**R38. Rule 46(e) details for unregistered buyers** - MISSING
- Rule: name and address of the recipient and the address of delivery, with the name of State and its code, if the recipient is unregistered and the value of taxable supply is Rs 50,000 or more [S8].
- Change: in `validateSalesDocument`, error on finalize when the buyer has no GSTIN, the taxable value (in INR) is >= 50,000 and the name, address, delivery address or state is empty.

**R39. Rule 48 copies** - WRONG for services
- App: `src/print/view.ts:131-137`, labels `src/print/labels.ts:50-52` ("Original for Recipient", "Duplicate for Transporter", "Triplicate for Supplier"); help `guide.ts:69`.
- Rule: goods - triplicate (ORIGINAL FOR RECIPIENT, DUPLICATE FOR TRANSPORTER, TRIPLICATE FOR SUPPLIER); services - duplicate (ORIGINAL FOR RECIPIENT, DUPLICATE FOR SUPPLIER) [S8].
- Change: when `allServices` (`view.ts:101`) is true, print only two copies and label the second "Duplicate for Supplier" (add that label in every language block of `labels.ts`).

**R40. Rule 49 bill of supply; composition legend** - OK. `validate.ts:43-45` (composition/unregistered must issue a bill of supply), `view.ts:129` legend "Composition taxable person, not eligible to collect tax on supplies". Bill of supply particulars and the 16-character number are in [S8]. (The composition legend's source, rule 5(1)(g), was not re-read.)

**R41. Rule 53 credit/debit note particulars** - MISSING
- App: `validate.ts:78-80` only warns "Link the original invoice (recommended for GSTR-1)".
- Rule: a credit or debit note must contain the "serial number and date of the corresponding tax invoice or, as the case may be, bill of supply", plus taxable value, rate and tax credited/debited, and signature [S8, rule 53(1)].
- Change: make the original invoice number and date required on finalize (an error, with an "invoice issued outside the app" option that captures number and date as text), and print them on the note.

**R42. Credit note time limit, s.34(2)** - MISSING
- Rule: from 1 Oct 2022 (Finance Act 2022 s.102, Notification 18/2022-CT dated 28 Sep 2022) the credit note for supplies of an FY must be declared not later than 30 November of the next FY or the date of the annual return, whichever is earlier [S13 - official PDF read through the search index only; the PDF itself was not parsed].
- Change: warn on finalize when the original invoice belongs to an FY whose 30 November deadline has passed (output tax cannot be reduced; the note is then commercial only).

### 2.8 State and UT codes

**R43. State codes, UTGST territories, Ladakh and DNH & DD** - OK
- App: `src/core/gst/states.ts:20-61`; Ladakh 38 (`:58`), DNH & DD 26 (`:46`), old Daman & Diu 25 kept as legacy (`:45`), old AP 28 legacy (`:48`), Other Territory 97 (`:60`), foreign 96 (`:65`). UTGST flag on 04, 25, 26, 31, 35, 38, 97; SGST for J&K 01, Delhi 07, Puducherry 34. Help `guide.ts:27`.
- Rule: India Compliance state numbers (identical list incl. 26, 38, 96 "Other Countries", 97 "Other Territory") [S6 `constants/__init__.py:96-136`]. UTGST Act s.1(2): extends to A&N Islands, Lakshadweep, Dadra and Nagar Haveli, Daman and Diu, Chandigarh and other territory [S16 - CBIC page fetched but rendered empty; text taken from the search index]; the amended text names "Dadra and Nagar Haveli and Daman and Diu, Ladakh" [S16b, secondary PDF].
- Change: none. (POS labels in CSVs use "Lakshadweep" while India Compliance uses "Lakshadweep Islands"; the offline tool's exact label was not checked.)

### 2.9 Income-tax TDS / TCS

**R44. Income-tax Act 2025 from 1 Apr 2026; forms** - OK for the form names, OUTDATED for section codes, WRONG for 195
- App: `src/core/tds.ts:4-34` (`NEW_ACT_FROM = '2026-04-01'`, Form 140 / Form 143), `src/core/tdsReports.ts:7-12, 112-135`, help `guide.ts:174`.
- Rule:
  - Which Act applies depends on the earlier of credit or payment; on/after 1 Apr 2026 the 2025 Act applies; TDS rates and thresholds were retained; quoting an old section (194C instead of s.393(1) Table Sl. No. 6(i)) "may lead to processing errors" and needs a correction statement; TCS is under s.394; TY 2026-27 statement of credits is Form 168 [S10 TDS compliance FAQ].
  - Form 140 (earlier 26Q) for non-salary TDS to residents; Form 143 (earlier 27EQ) for TCS; Form 144 (earlier 27Q) for TDS on non-residents; due 31 Jul, 31 Oct, 31 Jan, 31 May [S10 form manuals].
  - New codes: 194C -> s.393(1) Table 6(i); 194J -> 393(1) 6(iii); 194H -> 393(1) 1(ii); 194I -> 393(1) 2(ii); 194O -> 393(1) 8(v); 194Q -> 393(1) 8(ii); 195 -> 393(2) 17; 206C(1) -> 394(1) Sl. 1-5; 206C(1F) -> 394(1) Sl. 6 [S9 TDS rates, s.393, s.394].
- Change: (a) add the new section reference to each `SectionDef` and write it in the CSV `Section` column for dates on/after 2026-04-01 (`tdsReports.ts:122`); (b) route 195 rows to "Form 27Q / Form 144" in `statementFor` (`tdsReports.ts:112-116`) - e.g. `returnFormFor` gains a `NR` kind; (c) `tdsReports.ts:114` label "Form 26AS / AIS (Form 168 from TY 2026-27)".

**R45. TDS rates and thresholds** - OK
- App: `tds.ts:62-165`: 194C 1%/2%, Rs 30,000 single / Rs 1,00,000 aggregate; 194J 10% / 2%, Rs 50,000; 194H 2%, Rs 20,000; 194I 2% / 10%, Rs 50,000 per month; 194O 0.1%; 194Q 0.1% above Rs 50 lakh; 195 per Act/DTAA; no-PAN 20% (5% for 194O/194Q).
- Rule: s.393(1) table: commission 2%, Rs 20,000; rent 2%/10%, Rs 50,000 for a month or part; contractors 1%/2%, Rs 30,000 / Rs 1,00,000 [S9 s.393]; FTS/call centre 2%, other professional 10%; e-commerce 0.1%; goods purchase 0.1% above Rs 50 lakh [S9 TDS rates]; rates retained from the 1961 Act [S10].
- Change: none. (The 194J Rs 50,000 threshold and the no-PAN rates were not re-read on the new-Act page; the IT Department states all thresholds were retained [S10].)

**R46. TCS 206C(1) rates** - WRONG from 1 Apr 2026
- App: `tds.ts:192-208` scrap/minerals/liquor 1%, timber/forest 2%, tendu 5%, no dates, no no-PAN rate.
- Rule: s.394(1) as amended by the Finance Act 2026: liquor 2%, tendu leaves 2%, timber/forest produce 2%, scrap 2%, coal/lignite/iron ore 2%; motor vehicle / notified goods above Rs 10 lakh 1% [S9 s.394, amendment footnotes 86-89]. For FY 2025-26 (1961 Act) the rates were liquor 1%, tendu 5%, timber 2%, scrap 1%, minerals 1% [S9 TCS rates].
- Change: split 206C(1) into dated rate options (1%/5% up to 2026-03-31, 2% from 2026-04-01) and add a no-PAN rate (twice the rate or 5%, whichever is higher; source not re-read for the 2025 Act - mark it as UNVERIFIED in the code comment). Fix the comment at `tds.ts:10` "Rates and thresholds carry over" (true for TDS, not for TCS).

**R47. 206C(1F) and 206C(1H)** - OK
- App: `tds.ts:166-191` 206C(1H) only up to 2025-03-31; 206C(1F) 1% above Rs 10 lakh.
- Rule: 206C(1H) "not applicable w.e.f. 01-04-2025"; 206C(1F) covers motor vehicles and, from 22 Apr 2025, 10 notified luxury goods (Notification 36/2025) [S9 TCS rates]; s.394(1) Sl. 6 keeps 1% [S9 s.394].
- Change: optional: list the notified goods in the 206C(1F) note.

### 2.10 Income tax for FY 2025-26 and Tax Year 2026-27

**R48. New and old regime slabs, rebate, standard deduction, surcharge, cess** - OK
- App: `src/core/itr/incomeTax.ts:169-187` slabs; `:281` standard deduction 75,000 / 50,000; `:311-316` rebate (new: Rs 60,000 up to Rs 12 lakh with marginal relief; old: Rs 12,500 up to Rs 5 lakh); `:204-216` surcharge 10/15/25/37, capped at 25% in the new regime; `:219-229` surcharge marginal relief; `:319` cess 4%.
- Rule: AY 2026-27 table on incometax.gov.in: new regime 0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%, above 24L 30%; old 2.5/3/5 lakh exemption by age, 5%, 20%, 30%; 87A rebate 60,000 / 12,500; surcharge as in the app; marginal relief as in the app; 4% cess [S10 business/profession page]. Tax Year 2026-27 under the 2025 Act keeps the same slabs (economictimes, secondary [S17]); s.156 (old 87A) keeps Rs 12,500 up to Rs 5 lakh [S9 search index for s.156 - not fetched].
- Change: none.

**R49. Presumptive taxation (44AD, 44ADA, 44AE)** - OK
- App: `incomeTax.ts:231-277`: 44AD 6%/8%, limit Rs 3 crore if cash <= 5% else Rs 2 crore; 44ADA 50%, Rs 75 lakh / Rs 50 lakh; 44AE Rs 1,000 per ton per month (heavy), Rs 7,500 per month (other), at most 10 vehicles.
- Rule: 2025 Act s.58(2) table: identical limits, rates, the 5% cash test and the 10-vehicle limit; heavy vehicle = GVW above 12,000 kg [S9 s.58].
- Change: none (labels: see R51).

**R50. Advance tax dates, 234C, 234B; ITR due date** - OK for advance tax; OUTDATED for the default filing date
- App: `incomeTax.ts:365-372` 15 Jun/15 Sep/15 Dec/15 Mar with 15/45/75/100% and 12%/36% safe harbours, single 15 Mar instalment for 44AD/44ADA; `:379` 1% per month; `:385-388` 234B when paid < 90%; `:351-358` s.207/208; `:157` default filing date 31 July.
- Rule: 2025 Act s.425 (old 234C): same dates, percentages, 12%/36% relief, 3%/1% interest, presumptive single 15 March instalment for s.58(2) Sl. 1 or 3 [S9 s.425]. ITR due date for AY 2026-27: 31 July, or 31 August for non-audit business cases; belated return by 31 Dec 2026 [S10 ITR FAQ].
- Change: default `filingDate` to `${end}-08-31` when `businessMode !== 'NONE'` (non-audit), else `${end}-07-31`. (234B's new section number was not checked.)

**R51. Section labels for Tax Year 2026-27** - OUTDATED (cosmetic). App strings `incomeTax.ts:244, 257, 271, 293-300`, file comment `:9-11`. The IT Department refers to "Schedule XV read with section 123" for old 80C [S10 TDS FAQ, Q21], s.58 for presumptive [S9], s.425 for 234C [S9]. Change: show both numbers when `fy === '2026-27'`.

### 2.11 Other items checked

**R52. GSTIN format and checksum** - OK. `src/core/gst/gstin.ts:5-64`. Not compared with an official spec; India Compliance has a matching "normal" pattern and a separate TCS pattern (`...[C]...`) [S6 `constants/__init__.py:1444-1469`].

**R53. Place of supply and supply type** - OK. `src/core/gst/supply.ts:20-48` (exports and SEZ as inter-state IGST; UT without legislature uses UTGST). Consistent with R43.

**R54. 57th GST Council (8 Oct 2026)** - UNVERIFIED (watch). Recommendations include aligning 3B with GSTR-1/1A/IFF, an IMS rule 60(6A), e-invoicing for RCM self-invoices of AATO >= Rs 5 crore, a 5% option for EV passenger transport, simplified registration for small e-commerce sellers [S3, ids 675, 676, 678; S14]. Whether rate or rule notifications were issued by 7 Nov 2026 was not confirmed. Re-check before the fix task changes rates.

---

## 3. Sources

Official unless marked secondary. "Fetched" means the page or file was downloaded during this check on 7 Nov 2026.

- [S1] PIB factsheet on the 2025 GST rate rationalisation (56th GST Council; 5%/18%/40%; large cars flat 40% no cess; tobacco 40%), fetched: [pib.gov.in FactsheetDetails Id=150302](https://www.pib.gov.in/FactsheetDetails.aspx?Id=150302)
- [S2] GST portal "Returns Offline Tool Version V3.2.4" page, fetched: [gst.gov.in/download/returns](https://www.gst.gov.in/download/returns); the tool zip, fetched and read (ReleaseNotes.txt, Section_wise_CSV_files/GSTR1/*.csv; SHA-256 F0A7D6F66BF71B30E9ECD045A664DDA428C8FAC239F51127D656E6FAAC60E312): [gst_offline_tool.zip](https://tutorial.gst.gov.in/offlineutilities/returns/gst_offline_tool.zip)
- [S3] GSTN news and advisories, fetched as JSON from the portal's own feed: list [gst.gov.in/fomessage/newsupdates](https://www.gst.gov.in/fomessage/newsupdates), items `https://www.gst.gov.in/fomessage/newsupdates/<id>` (open the item on [gst.gov.in News and Updates](https://www.gst.gov.in/newsandupdates)). Items used: 483 (15 Jan 2024, Tables 14/15, Notification 26/2022-CT), 488 (8 Mar 2024, title only: EWB integration with new IRP portals), 489 (12 Mar 2024, Tables 14A/15A), 504 (16 Jul 2024, title only: integrated services from NIC-IRP portals), 506 (26 Jul 2024, GSTR-1A, Notification 12/2024-CT), 512 (2 Aug 2024, TCS 0.5% from 10 Jul 2024, Notification 15/2024-CT), 517 (3 Sep 2024, IMS), 518 (3 Sep 2024, B2CL Rs 1 lakh, Notification 12/2024-CT), 543 (5 Nov 2024, e-invoice 30-day limit for AATO >= Rs 10 crore from 1 Apr 2025), 549 (16 Nov 2024, GSTR-2B and IMS), 561 (17 Dec 2024, EWB 180/360 days, MFA), 574 (22 Jan 2025, HSN Phase-III), 597 (1 May 2025, HSN and Table 13 from May 2025, Notification 78/2020-CT), 606 (7 Jun 2025, 3B liability non-editable from July 2025), 607 and 633 (7 Jun 2025, 29 Oct 2025, 3-year bar, Notification 28/2023-CT), 624 and 631 (23 Sep 2025, 17 Oct 2025, IMS pending credit notes), 628 (8 Oct 2025, IMS), 634 (30 Oct 2025, import of goods in IMS), 640 (5 Dec 2025, Table 3.2 non-editable from Nov 2025), 646 (23 Jan 2026, RSP valuation of tobacco), 653 (16 Mar 2026, tax liability breakup from Feb 2026), 668 (29 Jul 2026, EWB enhancements on hold), 675 and 676 (9 and 13 Oct 2026, 57th Council), 678 (16 Oct 2026, e-invoice threshold Rs 5 crore, RCMDOM/RCMIMP), 687 (4 Nov 2026, EWB number 14 digits from 1 Jan 2027).
- [S4] GST portal "important dates" feed, fetched: [gst.gov.in/fomessage/impdts](https://www.gst.gov.in/fomessage/impdts)
- [S5] GSTN user guide "Create and Submit GSTR-3B", fetched: [tutorial.gst.gov.in Create_and_Submit_GSTR3B](https://tutorial.gst.gov.in/userguide/returns/Create_and_Submit_GSTR3B.htm)
- [S6] resilient-tech/india-compliance, `develop` branch, files fetched raw on 7 Nov 2026: `india_compliance/gst_india/doctype/gstr_1/gstr_1_export.py`, `utils/gstr_1/__init__.py`, `utils/gstr_1/sections/{supecom,hsn,b2cs,_shared,__init__}.py`, `gst_returns/fields/gstr1.py`, `constants/__init__.py`, `constants/e_waybill.py`, `utils/e_waybill.py`, `utils/transaction_data.py`; repository: [github.com/resilient-tech/india-compliance](https://github.com/resilient-tech/india-compliance)
- [S7] NIC e-way bill API documentation, fetched: [announcements](https://docs.ewaybillgst.gov.in/apidocs/announcements.html) (18 Dec 2024 validations; export toPincode note; same-PIN 100 km), [release notes](https://docs.ewaybillgst.gov.in/apidocs/release-notes.html) (Notification 20/2025-CT, 31 Dec 2025; 2 Dec 2025 validations; 30 Jul 2026 hold), [master codes](https://docs.ewaybillgst.gov.in/apidocs/master-codes-list.html)
- [S8] CBIC "Invoice Rules" as notified (tax invoice, manner of issue, bill of supply, revised invoice and credit/debit notes), PDF fetched and text extracted locally: [cbic-gst.gov.in invoice-gst-rules17052017.pdf](https://cbic-gst.gov.in/pdf/invoice-gst-rules17052017.pdf). This is the 2017 text; later amendments to Rules 46/53 were not re-read.
- [S9] Income Tax Department (incometaxindia.gov.in), fetched: [TDS rates under the 2025 Act](https://www.incometaxindia.gov.in/w/tds-rates), [section 393](https://www.incometaxindia.gov.in/w/section-393-6), [section 394 (as amended by Finance Act 2026)](https://www.incometaxindia.gov.in/w/section-394-6), [TCS rates, 1961 Act](https://www.incometaxindia.gov.in/w/tcs-rates), [section 425](https://www.incometaxindia.gov.in/w/section-425-6), [section 58](https://www.incometaxindia.gov.in/w/section-58-138)
- [S10] e-filing portal (incometax.gov.in), fetched: [TDS compliance FAQ](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance), [Income Tax Returns FAQ](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/%20income%20tax%20returns-faq), [Individual with business/profession, AY 2026-27 (slabs, surcharge, rebate)](https://www.incometax.gov.in/iec/foportal/help/individual-business-profession), [Form 140 manual](https://www.incometax.gov.in/iec/foportal/newformpage/forms/form140-um), [Form 143 manual](https://www.incometax.gov.in/iec/foportal/newformpage/forms/from143-um), [Form 144 manual](https://www.incometax.gov.in/iec/foportal/newformpage/forms/form144-um)
- [S11] Secondary: The Hindu, 1 Jan 2026, "Govt. notifies February 1 as the end of GST compensation cess", fetched: [thehindu.com article](https://www.thehindu.com/business/Economy/govt-notifies-february-1-as-the-end-of-gst-compensation-cess-start-of-new-tobacco-tax-regime/article70459716.ece). The GST Council newsletter PDF (Dec 2025) was downloaded but its text could not be extracted.
- [S12] Secondary: Tax2win, QRMP state groups and PMT-06, fetched: [tax2win.in QRMP guide](https://tax2win.in/guide/qrmp-scheme-under-gst). The CBIC notification PDF was not read.
- [S13] GST Council / PIB clarification on Notification 18/2022-CT (30 November time limits), official PDF; content taken from the search index snippet, the PDF itself was not parsed: [gstcouncil.gov.in pib1865179.pdf](https://gstcouncil.gov.in/sites/default/files/2024-02/pib1865179.pdf)
- [S14] Press release on the 57th GST Council meeting (8 Oct 2026), PDF fetched and text extracted locally: [tutorial.gst.gov.in press_release.pdf](https://tutorial.gst.gov.in/downloads/news/press_release.pdf)
- [S15] Reference project IamRamgarhia/Free-GST-Billing-Software, `src/utils/gstr1Json.js` (v1.10.83, fix #133), fetched: [gstr1Json.js](https://raw.githubusercontent.com/IamRamgarhia/Free-GST-Billing-Software/main/src/utils/gstr1Json.js)
- [S16] CBIC UTGST Act page (fetched, rendered no text; s.1(2) wording from the search index): [cbic-gst.gov.in UTGST-bill-e.html](https://cbic-gst.gov.in/hindi/UTGST-bill-e.html); [S16b] secondary consolidated UTGST Act PDF naming DNH & DD and Ladakh (search index only).
- [S17] Secondary: Economic Times, "Income tax slabs for Tax Year 2026-2027" (no slab change under the 2025 Act), search index only.

Tried and not available: incometaxindia.gov.in PDF notes on Forms 140/143/144 (HTTP 403 for scripted downloads; the HTML form manuals [S10] were used instead); GST Council newsletter PDF (text not extractable); the version string inside the offline tool installer (Inno Setup archive; installing it is outside this task).

## 4. Not checked / risks

Not checked: GSTR-9/9C, GSTR-4/CMP-08 content, composition rates, ITC-04, rule 86B, RCM categories, export LUT rules, GSTR-2B JSON field-by-field, the GSTR-3B JSON `ty` codes against an official 3B schema, later amendments to Rules 46/53 after 2017, the s.156 page itself, the new section number for 234B, and print templates beyond the Rule 46/48 labels. Risk: items marked UNVERIFIED (especially the GSTR-1 `version` header) need one real portal upload before release.
