import { addDays, addMonths, startOfMonth, todayISO } from '../core/dates';
import { takeNumber } from '../core/docs/numbering';
import {
  defaultSettings,
  lineFromProduct,
  newBusiness,
  newExpense,
  newGodown,
  newLedger,
  newParty,
  newPayment,
  newProduct,
  newPurchase,
  newSalesDocument,
  newVoucher,
  partySnapshot,
} from '../core/factories';
import { computeDocument } from '../core/gst/compute';
import { makeGstin } from '../core/gst/gstin';
import { defaultPlaceOfSupply, determineSupplyKind } from '../core/gst/supply';
import { makeCustomUnit } from '../core/gst/units';
import { newId } from '../core/ids';
import { bankLedgerId, partyLedgerId } from '../core/ledgers';
import type {
  Business,
  CollectionData,
  DocType,
  ISODate,
  LineItem,
  Party,
  PaymentRecord,
  Product,
  PurchaseBill,
  SalesDocument,
  SeriesKey,
} from '../core/model';
import { roundTo } from '../core/money';
import { emptyCollections } from '../core/schema';

type ItemSpec = [product: Product, qty: number, rate?: number, discountPct?: number];

/**
 * Sample books for "Sharma Electricals & Traders", Mumbai (Maharashtra, 27):
 * intra/inter-state B2B, B2C small and large, export under LUT, SEZ, challan,
 * quotation, credit note, recurring AMC invoice, purchases, expenses with TDS,
 * receipts, vouchers and a custom unit. Dates are relative to `today`.
 */
export function buildSampleData(today: ISODate = todayISO()): CollectionData {
  const data = emptyCollections();
  const m0 = startOfMonth(today);
  const day = (monthsAgo: number, d: number): ISODate => {
    const date = addDays(addMonths(m0, -monthsAgo), d - 1);
    return date > today ? today : date;
  };

  const hdfc = {
    id: newId('bank'),
    label: 'Current Account',
    bankName: 'HDFC Bank',
    accountHolder: 'Sharma Electricals & Traders',
    accountNumber: '50200012345678',
    ifsc: 'HDFC0000060',
    branch: 'Grant Road, Mumbai',
    swift: 'HDFCINBB',
    accountType: 'CURRENT' as const,
    openingBalance: 250000,
    isDefault: true,
  };
  const sbi = {
    ...hdfc,
    id: newId('bank'),
    label: 'Savings Account',
    bankName: 'State Bank of India',
    accountNumber: '30987654321',
    ifsc: 'SBIN0000300',
    branch: 'Mumbai Main',
    swift: 'SBININBB',
    accountType: 'SAVINGS' as const,
    openingBalance: 50000,
    isDefault: false,
  };
  let biz: Business = newBusiness({
    name: 'Sharma Electricals & Traders',
    legalName: 'Sharma Electricals & Traders',
    tagline: 'Wholesale & retail of electrical goods',
    gstin: makeGstin('27', 'AAPFS4321K'),
    pan: 'AAPFS4321K',
    tan: 'MUMS12345E',
    stateCode: '27',
    address1: 'Shop 12, Lamington Road',
    address2: 'Grant Road East',
    city: 'Mumbai',
    pincode: '400007',
    phone: '+91 98200 12345',
    email: 'accounts@sharmaelectricals.example',
    website: 'www.sharmaelectricals.example',
    preset: 'WHOLESALE',
    googleReviewUrl: 'https://g.page/r/sharma-electricals/review',
    bankAccounts: [hdfc, sbi],
    upiAccounts: [{ id: newId('upi'), vpa: 'sharmaelectricals@hdfcbank', payeeName: 'Sharma Electricals', label: 'HDFC UPI', isDefault: true }],
  });

  const main = newGodown(biz.id, 'Main Shop - Lamington Road', true);
  const warehouse = newGodown(biz.id, 'Bhiwandi Warehouse');
  warehouse.address = 'Gala 7, Bhiwandi, Thane';
  data.godowns.push(main, warehouse);

  const coil = makeCustomUnit('Coil', 'COIL', 'ROL', 0);

  const addr = (line1: string, city: string, pincode: string, stateCode: string, countryCode = 'IN') => ({
    line1,
    line2: '',
    city,
    pincode,
    stateCode,
    countryCode,
  });
  const reliance = newParty(biz.id, {
    name: 'Reliance Retail Ltd',
    contactPerson: 'Purchase Dept',
    gstin: makeGstin('27', 'AABCR1718E'),
    pan: 'AABCR1718E',
    registration: 'REGULAR',
    billing: addr('Maker Chambers IV, Nariman Point', 'Mumbai', '400021', '27'),
    phone: '+91 22 4477 0000',
    email: 'ap@reliance.example',
    creditDays: 30,
  });
  const bharat = newParty(biz.id, {
    name: 'Bharat Electricals Pvt Ltd',
    gstin: makeGstin('29', 'AACCB2345M'),
    pan: 'AACCB2345M',
    registration: 'REGULAR',
    billing: addr('45 SP Road', 'Bengaluru', '560002', '29'),
    shipping: addr('Plot 9, Peenya Industrial Area', 'Bengaluru', '560058', '29'),
    creditDays: 45,
  });
  const walkIn = newParty(biz.id, { name: 'Walk-in Customer', registration: 'CONSUMER', billing: addr('Mumbai', 'Mumbai', '400007', '27') });
  const anita = newParty(biz.id, {
    name: 'Anita Desai',
    registration: 'CONSUMER',
    billing: addr('12 CG Road, Navrangpura', 'Ahmedabad', '380009', '24'),
    phone: '+91 98250 11111',
  });
  const sez = newParty(biz.id, {
    name: 'Infotech Park SEZ Unit',
    gstin: makeGstin('27', 'AAECI5678P'),
    registration: 'SEZ',
    billing: addr('MIDC SEZ, Hinjewadi', 'Pune', '411057', '27'),
    creditDays: 30,
  });
  const gulf = newParty(biz.id, {
    name: 'Gulf Lighting LLC',
    registration: 'OVERSEAS',
    billing: addr('Al Quoz Industrial Area 3', 'Dubai', '00000', '96', 'AE'),
    email: 'buying@gulflighting.example',
    creditDays: 60,
  });
  const havells = newParty(biz.id, {
    kind: 'SUPPLIER',
    name: 'Havells India Ltd',
    gstin: makeGstin('09', 'AAACH0351E'),
    pan: 'AAACH0351E',
    registration: 'REGULAR',
    billing: addr('Sector 126', 'Noida', '201304', '09'),
    creditDays: 30,
  });
  const cables = newParty(biz.id, {
    kind: 'SUPPLIER',
    name: 'Mumbai Cable Co',
    gstin: makeGstin('27', 'AAFCM7788Q'),
    registration: 'REGULAR',
    billing: addr('Bhandup West', 'Mumbai', '400078', '27'),
    creditDays: 15,
  });
  const contractor = newParty(biz.id, {
    kind: 'SUPPLIER',
    name: 'Ravi Electrical Works',
    pan: 'BQRPK1234D',
    registration: 'UNREGISTERED',
    billing: addr('Dharavi', 'Mumbai', '400017', '27'),
    tdsSection: '194C',
  });
  data.clients.push(reliance, bharat, walkIn, anita, sez, gulf, havells, cables, contractor);

  const product = (p: Partial<Product>) => newProduct(biz.id, { godownId: main.id, ...p });
  const bulb = product({ name: 'LED Bulb 9W', sku: 'LED-9W', barcode: '8901234560011', hsn: '853950', unit: 'PCS', purchasePrice: 55, sellingPrice: 99, mrp: 149, gstRate: 18, openingStock: 500, openingStockRate: 55, lowStockLevel: 100, category: 'Lighting', batchNo: 'B2026-07' });
  const fan = product({ name: 'Ceiling Fan 1200mm', sku: 'FAN-1200', hsn: '841451', unit: 'PCS', purchasePrice: 1450, sellingPrice: 2199, mrp: 2899, gstRate: 18, openingStock: 40, openingStockRate: 1450, lowStockLevel: 10, category: 'Fans', godownId: warehouse.id });
  const wire = product({ name: 'Copper Wire 1.5 sq mm (90 m)', sku: 'CW-1.5', hsn: '854449', unit: coil.code, purchasePrice: 1150, sellingPrice: 1599, gstRate: 18, openingStock: 30, openingStockRate: 1100, lowStockLevel: 25, category: 'Wires' });
  const mcb = product({ name: 'MCB 32A Double Pole', sku: 'MCB-32', hsn: '853620', unit: 'PCS', purchasePrice: 180, sellingPrice: 289, gstRate: 18, openingStock: 200, openingStockRate: 175, lowStockLevel: 30, category: 'Switchgear' });
  const lantern = product({ name: 'Solar Lantern', sku: 'SOL-LAN', hsn: '940540', unit: 'PCS', purchasePrice: 420, sellingPrice: 650, gstRate: 5, openingStock: 60, openingStockRate: 410, lowStockLevel: 15, category: 'Solar' });
  const install = newProduct(biz.id, { kind: 'SERVICE', name: 'Electrical Installation Service', hsn: '995461', unit: 'HRS', sellingPrice: 750, gstRate: 18, trackStock: false, category: 'Services' });
  const amc = newProduct(biz.id, { kind: 'SERVICE', name: 'Annual Maintenance (monthly)', hsn: '998719', unit: 'NOS', sellingPrice: 8500, gstRate: 18, trackStock: false, category: 'Services' });
  data.products.push(bulb, fan, wire, mcb, lantern, install, amc);

  const number = (key: SeriesKey, date: ISODate): string => {
    const r = takeNumber(biz.series[key], date, biz.fyStartMonth);
    biz = { ...biz, series: { ...biz.series, [key]: r.series } };
    return r.number;
  };

  const lines = (specs: ItemSpec[], forPurchase = false): LineItem[] =>
    specs.map(([p, qty, rate, discountPct]) => ({
      ...lineFromProduct(p, forPurchase),
      qty,
      rate: rate ?? (forPurchase ? p.purchasePrice : p.sellingPrice),
      discountPct: discountPct ?? 0,
    }));

  const sale = (docType: DocType, party: Party, date: ISODate, specs: ItemSpec[], extra: Partial<SalesDocument> = {}): SalesDocument => {
    const pos =
      extra.placeOfSupply ??
      defaultPlaceOfSupply(biz.stateCode, {
        gstin: party.gstin,
        stateCode: party.billing.stateCode,
        countryCode: party.billing.countryCode,
        registration: party.registration,
      });
    const supplyKind = determineSupplyKind({
      businessCountry: 'IN',
      businessState: biz.stateCode,
      placeOfSupply: pos,
      partyRegistration: party.registration,
      partyCountry: party.billing.countryCode,
    });
    const base = newSalesDocument(biz, docType, {
      date,
      dueDate: addDays(date, party.creditDays || 15),
      partyId: party.id,
      party: partySnapshot(party),
      placeOfSupply: pos,
      supplyKind,
      status: 'FINAL',
      items: lines(specs),
      ...extra,
    });
    const computed = computeDocument(base.items, {
      docType,
      supplyKind,
      pricesIncludeTax: base.pricesIncludeTax,
      roundOff: base.roundOff,
      exportWithTax: base.exportWithTax,
      reverseCharge: base.reverseCharge,
      tds: base.tds,
      tcs: base.tcs,
      decimals: 2,
    });
    const doc: SalesDocument = { ...base, items: computed.items, totals: computed.totals, tds: computed.tds, tcs: computed.tcs };
    if (doc.status === 'FINAL') doc.number = number(docType, date);
    data.invoices.push(doc);
    return doc;
  };

  // Created strictly in date order so FY-reset numbering never repeats a number.
  const inv1 = sale('TAX_INVOICE', reliance, day(3, 5), [
    [bulb, 200],
    [fan, 10, 2099],
    [mcb, 50],
  ], { notes: 'Thank you for your business.' });
  sale('CREDIT_NOTE', reliance, day(2, 2), [[fan, 2, 2099]], {
    refDocId: inv1.id,
    refDocNumber: inv1.number,
    refDocDate: inv1.date,
    creditNoteReason: 'SALES_RETURN',
    stockApplied: true,
    dueDate: '',
  });
  const inv2 = sale('TAX_INVOICE', bharat, day(2, 8), [
    [fan, 20, 2150],
    [wire, 15],
    [lantern, 25, 640],
  ], {
    shipTo: { name: 'Bharat Electricals - Peenya Godown', gstin: bharat.gstin, address: bharat.shipping! },
    dispatch: {
      buyerOrderNo: 'PO/BE/2231',
      buyerOrderDate: day(2, 6),
      dispatchDocNo: 'LR-88213',
      deliveryNoteDate: day(2, 8),
      dispatchedThrough: 'VRL Logistics',
      destination: 'Bengaluru',
      transportMode: 'ROAD',
      vehicleNo: 'MH04AB1234',
      vehicleType: 'REGULAR',
      transporterId: makeGstin('29', 'AABCV3609C'),
      transporterName: 'VRL Logistics Ltd',
      transportDocNo: 'LR-88213',
      transportDocDate: day(2, 8),
      distanceKm: 985,
      termsOfDelivery: 'Door delivery',
      ewayBillNo: '351002345678',
    },
  });
  // Monthly AMC: the copy for the current month is generated on first launch.
  sale('TAX_INVOICE', reliance, day(1, 1), [[amc, 1]], {
    recurring: { enabled: true, frequency: 'MONTHLY', nextDate: m0, endDate: '' },
    notes: 'Monthly AMC for showroom electricals.',
  });
  sale('TAX_INVOICE', anita, day(1, 12), [[fan, 30, 2199], [lantern, 60, 640]]);
  sale('TAX_INVOICE', gulf, day(1, 20), [[fan, 100, 26.5], [bulb, 1000, 1.25]], {
    currency: 'USD',
    exchangeRate: 84.25,
    roundOff: false,
    exportWithTax: false,
    lutNumber: 'AD270326001234X',
    portCode: 'INNSA1',
    shippingBillNo: '7788123',
    shippingBillDate: day(1, 22),
  });
  sale('TAX_INVOICE', sez, day(0, 2), [[install, 40], [mcb, 100, 275]], { exportWithTax: false, lutNumber: 'AD270326001234X' });
  const inv3 = sale('TAX_INVOICE', walkIn, day(0, 3), [[bulb, 6], [mcb, 2]], { dueDate: day(0, 3), pricesIncludeTax: true });
  sale('DELIVERY_CHALLAN', reliance, day(0, 4), [[bulb, 100], [lantern, 10]], { dueDate: '' });
  sale('QUOTATION', bharat, day(0, 5), [[fan, 50, 2100, 2], [mcb, 200, 280]], { dueDate: addDays(day(0, 5), 15), notes: 'Valid for 15 days.' });
  sale('TAX_INVOICE', bharat, day(0, 6), [[wire, 5]], { status: 'DRAFT' });

  const purchase = (supplier: Party, billNo: string, date: ISODate, specs: ItemSpec[], extra: Partial<PurchaseBill> = {}): PurchaseBill => {
    const pos = biz.stateCode;
    const supplierState = supplier.gstin ? supplier.gstin.slice(0, 2) : supplier.billing.stateCode;
    const supplyKind = supplierState && supplierState !== biz.stateCode ? 'INTER_STATE' : 'INTRA_STATE';
    const base = newPurchase(biz, {
      supplierId: supplier.id,
      supplier: partySnapshot(supplier),
      billNo,
      billDate: date,
      receivedDate: date,
      dueDate: addDays(date, supplier.creditDays || 15),
      placeOfSupply: pos,
      supplyKind,
      items: lines(specs, true),
      ...extra,
    });
    const computed = computeDocument(base.items, {
      docType: 'TAX_INVOICE',
      supplyKind,
      pricesIncludeTax: false,
      roundOff: true,
      exportWithTax: false,
      reverseCharge: base.reverseCharge,
      tds: base.tds,
    });
    const bill = { ...base, items: computed.items, totals: computed.totals, tds: computed.tds };
    data.purchases.push(bill);
    return bill;
  };
  const pur1 = purchase(havells, 'HIL/MH/26/4411', day(3, 2), [[bulb, 1000], [fan, 60]]);
  purchase(cables, 'MCC-2291', day(2, 10), [[wire, 40]]);
  purchase(havells, 'HIL/MH/26/5120', day(0, 1), [[lantern, 50], [mcb, 150]], { itcCategory: 'INPUTS' });

  const expense = (date: ISODate, ledgerId: string, description: string, taxable: number, gstRate: number, extra: Partial<ReturnType<typeof newExpense>> = {}) => {
    const half = roundTo((taxable * gstRate) / 200);
    const e = newExpense(biz.id, {
      date,
      ledgerId,
      description,
      taxable,
      gstRate,
      cgst: half,
      sgst: half,
      total: roundTo(taxable + half * 2),
      itcEligible: gstRate > 0,
      paidVia: 'BANK',
      bankAccountId: hdfc.id,
      ...extra,
    });
    data.expenses.push(e);
    return e;
  };
  for (const ago of [2, 1, 0]) {
    const rent = expense(day(ago, 1), 'sys:exp-rent', 'Shop rent', 60000, 18, { vendorName: 'Patel Estates', vendorGstin: makeGstin('27', 'AAJFP4455R'), billNo: `RENT-${ago}` });
    rent.tds = { section: '194I', rate: 10, base: 60000, amount: 6000 };
    expense(day(ago, 5), 'sys:exp-electricity', 'MSEDCL electricity bill', 8450, 0, { vendorName: 'MSEDCL', itcEligible: false });
    expense(day(ago, 7), 'sys:exp-salary', 'Staff salaries', 85000, 0, { itcEligible: false });
    // A credit claim needs the vendor's GSTIN (review Y7).
    expense(day(ago, 9), 'sys:exp-telephone', 'Broadband & mobile', 2499, 18, { vendorName: 'Jio Platforms', vendorGstin: makeGstin('27', 'AABCJ4321P'), billNo: `JIO-${ago}` });
  }
  expense(day(1, 15), 'sys:exp-professional', 'Electrical contractor - showroom wiring', 45000, 0, {
    vendorName: contractor.name,
    itcEligible: false,
    tds: { section: '194C', rate: 1, base: 45000, amount: 450 },
  });

  const pay = (direction: 'IN' | 'OUT', party: Party, docId: string, date: ISODate, amount: number, mode: PaymentRecord['mode'], bank = true) => {
    const p = newPayment(biz.id, direction, {
      number: number(direction === 'IN' ? 'RECEIPT' : 'PAYMENT', date),
      date,
      partyId: party.id,
      partyName: party.name,
      docId,
      amount,
      mode,
      bankAccountId: bank ? hdfc.id : '',
      reference: mode === 'UPI' ? 'UPI/62781234' : mode === 'CHEQUE' ? 'CHQ 004512' : '',
    });
    data.receipts.push(p);
    return p;
  };
  pay('IN', reliance, inv1.id, day(2, 20), roundTo(inv1.totals.net - (data.invoices.find((d) => d.refDocId === inv1.id)?.totals.net ?? 0)), 'BANK');
  pay('IN', bharat, inv2.id, day(1, 18), 50000, 'CHEQUE');
  pay('IN', walkIn, inv3.id, inv3.date, inv3.totals.net, 'CASH', false);
  pay('OUT', havells, pur1.id, day(2, 1), pur1.totals.net, 'BANK');

  data.vouchers.push(
    newVoucher(biz.id, 'CONTRA', {
      number: number('VOUCHER_CONTRA', day(0, 4)),
      date: day(0, 4),
      narration: 'Cash deposited into HDFC current account',
      lines: [
        { ledgerId: bankLedgerId(hdfc.id), dr: 20000, cr: 0, docId: '', note: '' },
        { ledgerId: 'sys:cash', dr: 0, cr: 20000, docId: '', note: '' },
      ],
    }),
  );
  const drawings = newLedger(biz.id, 'Owner Drawings', 'CAPITAL');
  const furniture = newLedger(biz.id, 'Office Furniture', 'FIXED_ASSETS', { openingBalance: 75000, openingType: 'DR' });
  data.ledgers.push(drawings, furniture);
  data.vouchers.push(
    newVoucher(biz.id, 'PAYMENT', {
      number: number('VOUCHER_PAYMENT', day(1, 28)),
      date: day(1, 28),
      narration: 'Cash withdrawn by proprietor for personal use',
      lines: [
        { ledgerId: drawings.id, dr: 15000, cr: 0, docId: '', note: '' },
        { ledgerId: 'sys:cash', dr: 0, cr: 15000, docId: '', note: '' },
      ],
    }),
    newVoucher(biz.id, 'RECEIPT', {
      number: number('VOUCHER_RECEIPT', day(0, 6)),
      date: day(0, 6),
      narration: 'Part payment received from Bharat Electricals against invoice',
      lines: [
        { ledgerId: bankLedgerId(hdfc.id), dr: 25000, cr: 0, docId: '', note: '' },
        { ledgerId: partyLedgerId(bharat.id), dr: 0, cr: 25000, docId: inv2.id, note: '' },
      ],
    }),
  );

  data.businesses.push(biz);
  data.settings.push({ ...defaultSettings(), activeBusinessId: biz.id, setupComplete: true, customUnits: [coil] });
  return data;
}
