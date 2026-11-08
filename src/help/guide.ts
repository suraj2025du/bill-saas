export interface GuideArticle {
  id: string;
  title: string;
  /** Route prefix the article belongs to (opened first on that screen). */
  route: string;
  body: string[];
}

export const GUIDE: GuideArticle[] = [
  {
    id: 'start',
    title: 'Getting started',
    route: '/',
    body: [
      'Your data stays on this computer. In the browser it is kept in IndexedDB; with the desktop launcher (Start-GST-Billing.cmd) it is kept as JSON files in the _system/data folder.',
      'Set up your business in Settings > Business profile: GSTIN, address, bank accounts and UPI IDs. The state code is read from the GSTIN.',
      'Create invoices from Sales > Invoices & documents > New. Press Ctrl+K anywhere to search or jump to a screen.',
      'Download a backup regularly from Settings > Backup & restore and keep it outside this computer.',
    ],
  },
  {
    id: 'invoice',
    title: 'Creating a GST invoice',
    route: '/sales',
    body: [
      'Choose the customer (or type a new name), the date and the items. The place of supply comes from the customer\'s GSTIN or state.',
      'Same state: CGST + SGST. Different state: IGST. Union territories without a legislature (Chandigarh, Ladakh, Andaman & Nicobar, Lakshadweep, Dadra & Nagar Haveli and Daman & Diu): CGST + UTGST.',
      'Save as draft keeps the invoice editable without a number. Finalize gives it the next number of the series and updates stock and accounts.',
      'The invoice list shows the newest 200 documents that match the search and filters; Show 200 more adds the next ones. Search, Select all and Export CSV cover every matching document.',
      'GST slabs from 22 Sep 2025 are 0%, 5%, 18% and 40%; 12% and 28% remain only for old invoices and a few items. Special rates (0.25%, 3%, ...) are also available.',
    ],
  },
  {
    id: 'doctypes',
    title: 'Quotation, proforma, challan, credit note',
    route: '/sales',
    body: [
      'Quotations and proformas do not affect stock or accounts. Convert them to a tax invoice with one click.',
      'On the All tab of the invoice list the header shows sales: invoices, bills of supply and debit notes, less credit notes. Quotations, proformas and challans are not counted; their own tabs show their value.',
      'A delivery challan reduces stock when finalized. Converting it to an invoice does not reduce stock again.',
      'A credit note against an invoice reduces sales and output tax; tick "Goods returned" to add the stock back.',
      'Bill of supply is for exempt goods or for composition dealers: no GST is charged.',
    ],
  },
  {
    id: 'cancel',
    title: 'Cancel, delete and the Trash bin',
    route: '/sales',
    body: [
      'A final invoice cannot be deleted because GST rules need issued numbers to stay in the series. Cancel it instead; it is stamped CANCELLED and shown as cancelled in GSTR-1 Table 13.',
      'Drafts and cancelled documents can be deleted. Deleted records go to the Trash bin for 30 days and can be restored from Settings > Trash bin.',
    ],
  },
  {
    id: 'payments',
    title: 'Recording payments and receipts',
    route: '/payments',
    body: [
      'Open an invoice and click Record payment. Partial payments move the status from Unpaid to Partial; the final payment marks it Paid.',
      'Each payment gets a receipt number and can be printed or saved as PDF. Edit or delete a payment from the invoice\'s payment history.',
      'For an invoice or bill in another currency, enter the amount in that currency and the exchange rate on the payment date. The difference from the invoice\'s own rate is booked to Exchange Gain/Loss.',
      'Money received without a bill is recorded as an advance (on account) and shows in the party\'s statement.',
      'Receipt and payment vouchers are listed here too, and a voucher line set against an invoice shows in that invoice\'s payments.',
    ],
  },
  {
    id: 'print',
    title: 'Print designs, colours and languages',
    route: '/settings/print',
    body: [
      'Settings > Print & PDF design has nine designs including Tally style and thermal receipts (58, 76, 80, 112 mm). The preview on the right updates as you change settings.',
      'Choose colours, margins in millimetres, the label language (English, Hindi, Tamil, Marathi, Bengali) and the watermark.',
      'Rule 48 copies: tick Original, Duplicate and Triplicate to print all copies in one go. Rows, tax tables and signature blocks are never split across pages.',
      'UPI QR codes carry the balance due, so customers can scan and pay the exact amount.',
    ],
  },
  {
    id: 'bulkpdf',
    title: 'Bulk PDF export',
    route: '/',
    body: ['On the Dashboard or the invoice list, tick several documents and click Export PDFs. A progress bar shows the work and Cancel stops it. The PDFs are downloaded together as a ZIP file.'],
  },
  {
    id: 'inventory',
    title: 'Products, stock and valuation',
    route: '/inventory',
    body: [
      'Each product has HSN/SAC, unit, purchase and selling price, GST rate, opening stock and a low-stock alert level. Godowns and batch numbers can be switched on in Settings > Features.',
      'Stock rises with purchase bills and credit notes (goods returned) and falls with invoices and delivery challans.',
      'Stock & valuation shows closing stock on any date at weighted-average cost, last purchase price or standard cost, and exports to Excel, CSV or PDF.',
    ],
  },
  {
    id: 'purchases',
    title: 'Purchase bills and OCR',
    route: '/purchases',
    body: [
      'Record supplier bills to add stock and claim input tax credit. Mark the ITC type: inputs, capital goods, input services, imports or ineligible (blocked credit u/s 17(5)).',
      'Read from photo: attach a photo or scan of the bill and the app reads the GSTIN, bill number, date and total offline. Always check what it filled in.',
      'Reverse charge bills: GST is payable by you in cash and can be claimed as credit in the same return.',
    ],
  },
  {
    id: 'vouchers',
    title: 'Vouchers (F4, F5, F6, F7)',
    route: '/accounts',
    body: [
      'F4 Contra: move money between cash and bank. F5 Payment: money paid from cash or bank. F6 Receipt: money received into cash or bank. F7 Journal: adjustments without cash or bank.',
      'Debits must equal credits before a voucher can be saved. Link a line to an invoice or bill to settle it bill-wise. Voucher amounts are in the business currency (rupees for an Indian business); for an invoice in another currency, credit the party at the invoice\'s rate and put any difference on Exchange Gain/Loss.',
      'An invoice or bill that a voucher is set against cannot be cancelled or deleted. Change or delete the voucher first.',
    ],
  },
  {
    id: 'reports',
    title: 'Trial balance, P&L and balance sheet',
    route: '/accounts',
    body: [
      'All reports are built from your invoices, bills, expenses, payments and vouchers, so a corrected invoice corrects the books automatically.',
      'Closing stock is valued from inventory. Party and bank opening balances are taken from their masters; enter capital and other opening balances as ledgers or a journal voucher. Any gap shows as "Difference in opening balances".',
      'Outstanding & ageing shows customer and supplier balances in 0-30, 31-60, 61-90 and 90+ day buckets.',
    ],
  },
  {
    id: 'gstr1',
    title: 'Filing GSTR-1',
    route: '/gst/gstr1',
    body: [
      'Pick the month (or quarter for QRMP). The tables follow the portal: 4A B2B, 5 B2C (Large), 6A exports, 7 B2C (Others), 8 nil/exempt, 9B credit/debit notes, 12 HSN summary (B2B and B2C tabs from May 2025) and 13 documents issued.',
      'B2C (Large) is an inter-state invoice to an unregistered buyer above Rs 1 lakh (Rs 2.5 lakh up to 31 Jul 2024).',
      'Download the JSON and upload it on gst.gov.in > Returns > GSTR-1 > Prepare offline > Upload. Check the warnings shown above the tables first.',
      'Excel gives one sheet per table. CSV (ZIP) gives one CSV file per table with the column names of the GST offline tool template, for checking or for other software. Upload the JSON, not the CSVs, to the portal.',
    ],
  },
  {
    id: 'ecommerce',
    title: 'Selling on Amazon, Flipkart and other e-commerce sites',
    route: '/gst/gstr1',
    body: [
      'When a sale goes through an e-commerce operator that collects TCS under section 52 (Amazon, Flipkart, Meesho and similar), enter the operator\'s GSTIN on the invoice under Tax and supply > Sold through an e-commerce operator.',
      'The sale stays in its normal GSTR-1 table (B2B, B2C Large or B2C Others) and is also totalled per operator in Table 14, which the JSON exports as "supeco". Credit notes for such sales reduce the total.',
      'The operator deducts TCS of 0.5% of the net value (1% before 10 July 2024) from your payout and files GSTR-8; the amount then appears in your electronic cash ledger. The Table 14 tab shows the TCS to expect, so you can compare it with the operator\'s statement.',
      'Supplies on which the operator itself pays the tax under section 9(5) (for example restaurant service or passenger transport through an app) are not handled by this app.',
    ],
  },
  {
    id: 'gstr3b',
    title: 'GSTR-3B and ITC set-off',
    route: '/gst/gstr3b',
    body: [
      'Table 3.1 comes from your sales and Table 3.1(d) from reverse-charge purchases. Sales under reverse charge are in 3.1(a) at their taxable value, with no tax, as the portal fills them from GSTR-1 Table 4B.',
      'Table 4(A)(5) can be claimed only for documents in GSTR-2B. Choose Open GSTR-2B and pick the GSTR-2B JSON of the same period: 4(A)(5) then comes from it, net of credit notes. Blocked credit is reversed in 4(B)(1), a document you have not recorded in 4(B)(2), and credit the GSTR-2B marks as not available goes to 4(D)(2). The GSTR-2B check lists bills and expenses that are not in the GSTR-2B (not claimed). Without a GSTR-2B the report uses your bills and expenses of the period and says so.',
      'Credit for a bill or expense needs the supplier\'s valid GSTIN: without one the bill never reaches GSTR-2B.',
      'When credit notes exceed sales, the negative tax goes to the negative liability statement and is set off against the tax of the next returns before input tax credit, as on the portal since September 2024.',
      'The set-off follows sections 49, 49A and 49B: IGST credit is used first (IGST, then CGST and SGST), CGST credit pays CGST then IGST, SGST credit pays SGST then IGST. Reverse-charge tax is always paid in cash.',
      'GSTR-3B on the portal is auto-filled from GSTR-1 and GSTR-2B; compare it with this report before you pay.',
    ],
  },
  {
    id: 'gstr2b',
    title: 'GSTR-2B reconciliation',
    route: '/gst/gstr2b',
    body: [
      'Download GSTR-2B as JSON from the GST portal and open it here. Each supplier invoice is matched with your purchase bills by GSTIN and invoice number.',
      'Matched: same values. Mismatch: amounts, date or reverse-charge flag differ. Missing in books: the supplier reported it but you have not recorded it. Missing in 2B: you recorded it but the supplier has not filed it yet.',
    ],
  },
  {
    id: 'eway',
    title: 'E-Way Bill JSON',
    route: '/sales',
    body: [
      'Open a final invoice or challan and choose E-Way Bill JSON. Fill the transport details (vehicle number, distance, transporter) in the invoice\'s dispatch section first.',
      'Upload the file on ewaybillgst.gov.in > e-Waybill > Generate Bulk. Movements of goods above Rs 50,000 usually need an e-way bill.',
    ],
  },
  {
    id: 'tds',
    title: 'TDS and TCS',
    route: '/gst/tds',
    body: [
      'Add TDS to purchase bills and expenses (194C, 194J, 194H, 194I, 194O, 194Q, 195) and TCS to invoices (206C(1), 206C(1F)). The register groups them by quarter and exports a CSV for the statement.',
      'From 1 April 2026 the Income-tax Act, 2025 applies: Form 26Q becomes Form 140 and Form 27EQ becomes Form 143. TCS on sale of goods u/s 206C(1H) was omitted from 1 April 2025, so it is offered only for older invoices.',
      'GST TCS under section 52 is collected by e-commerce operators, not by you: see "Selling on Amazon, Flipkart and other e-commerce sites".',
    ],
  },
  {
    id: 'itr',
    title: 'Income tax helper',
    route: '/itr',
    body: [
      'Compare the old and new regimes for FY 2025-26 or 2026-27, including presumptive income (44AD, 44ADA, 44AE), deductions (80C, 80D, 80TTA/80TTB, NPS), the 87A rebate with marginal relief, surcharge and cess.',
      'The advance-tax plan shows the 15 June, 15 September, 15 December and 15 March instalments and the interest under sections 234B and 234C.',
      'This is an estimate for planning. File your return on incometax.gov.in and confirm figures with a tax professional.',
    ],
  },
  {
    id: 'multi',
    title: 'Several businesses, currencies and units',
    route: '/settings',
    body: [
      'Add more businesses in Settings > All businesses and switch from the top of the sidebar. Each has its own GSTIN, numbering, bank accounts and data.',
      'Invoices can be in 22 currencies with the right amount-in-words and tax label (GST, VAT, SST, MwSt, TVA). Enter the exchange rate for GST reporting in rupees.',
      'Add your own units (Carat, Bundle, Session...) with their GST UQC: choose "+ Add custom unit..." in the unit list of any invoice, purchase or product line, or use Settings > Units.',
    ],
  },
  {
    id: 'settings',
    title: 'Numbering, units and features',
    route: '/settings',
    body: [
      'Settings > Invoice numbering sets the prefix, digits, suffix and next number for each document type, and whether the number restarts every financial year. Numbers must fit the 16 characters the GST portal allows; a number that is already used is skipped.',
      'Settings > Units lists the built-in units and your own. Each unit maps to a UQC for the GSTR-1 HSN summary; services always report NA.',
      'Settings > Features switches modules on or off: inventory, godowns, batches, dispatch details, TDS/TCS, multi-currency, recurring invoices and fast counter (POS) billing. The business preset chosen at setup only sets the starting point.',
    ],
  },
  {
    id: 'parties',
    title: 'Customers, suppliers and statements',
    route: '/parties',
    body: [
      'Add a customer or supplier with name, GSTIN, address, phone and credit days. Typing a valid GSTIN fills in the state, which decides CGST + SGST or IGST on invoices.',
      'Open a party to see its account statement with a running Dr/Cr balance and the ageing strip (0-30, 31-60, 61-90, 90+ days). Download it as PDF to send to the party.',
      'An opening balance entered on the party is carried into its statement, the outstanding report and the trial balance.',
    ],
  },
  {
    id: 'expenses',
    title: 'Expenses',
    route: '/expenses',
    body: [
      'Record rent, salary, electricity and other running costs with the expense head, vendor, bill number and GST. Tick "Claim input tax credit" when the vendor\'s GST can be claimed: the box works once a valid vendor GSTIN is entered, and the bill number lets GSTR-3B find the bill in GSTR-2B.',
      'Choose how it was paid (cash, bank or on credit) and add TDS where it applies. Expenses appear in profit & loss, in GSTR-3B Table 4 (eligible ITC) and in the TDS register.',
    ],
  },
  {
    id: 'books',
    title: 'Ledgers, day book, cash book and bank book',
    route: '/accounts',
    body: [
      'Ledgers lists every account: parties, banks, sales, purchases, taxes, expense heads and your own ledgers. Open one to see its statement for any date range.',
      'Day book shows every entry of a day with its debit and credit lines. Cash book and bank book show receipts and payments with the running balance; click a voucher number to open the invoice, bill or voucher behind it.',
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard and notifications',
    route: '/',
    body: [
      'The Dashboard shows this month\'s sales, receipts, purchases and expenses, the money still to receive, your cash and bank balance, the estimated GST payable, a 12-month sales chart, coming deadlines and low-stock items. Tick documents under Recent documents to export their PDFs together.',
      'The bell lists overdue invoices with the days overdue, low-stock products, GST return dates (GSTR-1 on the 11th and GSTR-3B on the 20th for monthly filers; the 13th and the 22nd or 24th for quarterly QRMP filers), backup reminders and app updates.',
    ],
  },
  {
    id: 'recurring',
    title: 'Recurring invoices',
    route: '/sales',
    body: [
      'Open a final invoice and choose Make recurring: weekly, monthly, quarterly or yearly, with an optional end date.',
      'Each time the app starts it creates the copies that fell due (also catching up after days away) and numbers them from the series.',
    ],
  },
  {
    id: 'backup',
    title: 'Backup, restore and Google Drive',
    route: '/settings/backup',
    body: [
      'A backup is taken automatically once a day. Download a full backup file from Settings > Backup & restore and keep it on a pen drive or in the cloud.',
      'Restore checks the whole file first. If anything is wrong, nothing is changed; a copy of the current data is saved before every restore.',
      'Google Drive backup is optional: create your own OAuth Client ID in Google Cloud Console (Web application, with this app\'s address as an authorised origin) and paste it in Settings > Google Drive.',
    ],
  },
  {
    id: 'security',
    title: 'PIN lock and privacy',
    route: '/settings/security',
    body: [
      'Set a 4 to 8 digit PIN to lock the app on start and after a period of inactivity. The PIN is stored only as a salted hash.',
      'There is no sign-up, e-mail or OTP. Nothing leaves this computer unless you export a file or turn on Google Drive backup.',
    ],
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics and data check',
    route: '/settings/diagnostics',
    body: [
      'Settings > Diagnostics shows the app version, where your data is kept, whether the app is installed and ready to work offline, and the dates of the last backups.',
      'Check my data runs the same integrity check as a restore on all your records. If it finds problems, restore a recent backup.',
      'Unexpected errors are recorded on this computer only; the bell shows a notice when new ones appear. Download diagnostics saves a file with the version, record counts and the error log (no business records) that you can send to whoever helps you.',
    ],
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    route: '/',
    body: [
      'Ctrl+K: search and command palette. Alt+N: new invoice. F1: this help. Ctrl+S: save the invoice or voucher you are editing. Esc: close dialogs.',
      'In Accounts: F4 Contra, F5 Payment, F6 Receipt, F7 Journal voucher.',
    ],
  },
];

export function searchGuide(query: string): GuideArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return GUIDE;
  const words = q.split(/\s+/);
  return GUIDE.map((a) => {
    const text = `${a.title} ${a.body.join(' ')}`.toLowerCase();
    const score = words.reduce((s, w) => s + (a.title.toLowerCase().includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0), 0);
    return { a, score };
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}

export function articlesFor(path: string): GuideArticle[] {
  const exact = GUIDE.filter((a) => a.route !== '/' && path.startsWith(a.route));
  return exact.length ? exact : GUIDE.filter((a) => a.route === '/');
}
