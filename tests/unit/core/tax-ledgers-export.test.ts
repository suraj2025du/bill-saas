import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { recordsToCsv, recordsToRows, toCsv } from '../../../src/core/export/csv';
import { XLSX_MIME, buildXlsx, columnLetter, safeSheetName } from '../../../src/core/export/xlsx';
import { newLedger } from '../../../src/core/factories';
import { EXPENSE_LEDGERS, GROUP_LABELS, PNL_GROUPS, allLedgers, bankLedgerId, parseLedgerRef, partyLedgerId, resolveLedger } from '../../../src/core/ledgers';
import { hashPin, isValidPinFormat, verifyPin } from '../../../src/core/security/pin';
import {
  NEW_ACT_FROM,
  actFor,
  actLabel,
  applyThreshold,
  getSection,
  isSectionAvailable,
  returnFormFor,
  sectionCodeFor,
  sectionsFor,
  tcs206C1H,
} from '../../../src/core/tds';
import { statementFor, tdsCsv, tdsRegister } from '../../../src/core/tdsReports';
import { newExpense } from '../../../src/core/factories';
import { sampleBusiness, sampleDoc, sampleParty, samplePurchase } from '../../fixtures/sample';

describe('TDS / TCS', () => {
  it('switches to the Income-tax Act 2025 and new forms from 1 Apr 2026', () => {
    expect(actFor('2026-03-31')).toBe('IT_ACT_1961');
    expect(actFor(NEW_ACT_FROM)).toBe('IT_ACT_2025');
    expect(actLabel('2026-10-29')).toBe('Income-tax Act, 2025');
    expect(actLabel('2025-10-29')).toBe('Income-tax Act, 1961');
    expect(returnFormFor('TDS', '2026-10-29')).toMatch(/Form 140/);
    expect(returnFormFor('TCS', '2026-10-29')).toMatch(/Form 143/);
    expect(returnFormFor('NR', '2026-10-29')).toMatch(/Form 144/);
    expect(returnFormFor('TDS', '2025-10-29')).toBe('Form 26Q');
    expect(returnFormFor('TCS', '2025-10-29')).toBe('Form 27EQ');
    expect(returnFormFor('NR', '2025-10-29')).toBe('Form 27Q');
  });

  it('uses uniform 2% for 206C(1) from 1 Apr 2026, keeps dated rates before, and includes No-PAN rates (CO 2, 22)', () => {
    const s2026 = getSection('206C(1)', '2026-04-01')!;
    expect(s2026.rates.map((r) => [r.key, r.rate])).toEqual([
      ['STD_2026', 2],
      ['NOPAN', 5],
    ]);
    const s2025 = getSection('206C(1)', '2026-03-31')!;
    expect(s2025.rates.map((r) => [r.key, r.rate])).toEqual([
      ['SCRAP', 1],
      ['FOREST', 2],
      ['TENDU', 5],
      ['NOPAN', 5],
    ]);
    expect(getSection('195')!.rates.some((r) => r.key === 'NOPAN' && r.rate === 20)).toBe(true);
  });

  it('writes 2025 Act section codes from 1 Apr 2026, routes 195 to Form 27Q / Form 144, and labels Form 168 (CO 5, 6, 21)', () => {
    expect(sectionCodeFor('194C', '2026-03-31')).toBe('194C');
    expect(sectionCodeFor('194C', '2026-04-01')).toBe('393(1) Sl. 6(i)');
    expect(sectionCodeFor('194J', '2026-04-01')).toBe('393(1) Sl. 6(iii)');
    expect(sectionCodeFor('195', '2026-04-01')).toBe('393(2) Sl. 17');
    expect(sectionCodeFor('206C(1)', '2026-04-01')).toBe('394(1) Sl. 1-5');
    expect(sectionCodeFor('206C(1F)', '2026-04-01')).toBe('394(1) Sl. 6');

    expect(statementFor('DEDUCTED_NR', '2025-12-31')).toBe('Form 27Q');
    expect(statementFor('DEDUCTED_NR', '2026-06-30')).toBe('Form 144 (earlier 27Q)');
    expect(statementFor('SUFFERED', '2025-12-31')).toBe('Form 26AS / AIS (deducted by your customers)');
    expect(statementFor('SUFFERED', '2026-06-30')).toMatch(/Form 168/);

    const biz = sampleBusiness();
    const supplier = sampleParty(biz.id, { kind: 'SUPPLIER' });
    const bill194c = samplePurchase(biz, supplier, [{ qty: 1, rate: 50_000 }], {
      billDate: '2026-05-10',
      tds: { section: '194C', rate: 2, base: 50_000, amount: 1_000 },
    });
    const exp195 = newExpense(biz.id, {
      date: '2026-05-12',
      vendorName: 'Foreign Cloud Inc',
      taxable: 100_000,
      tds: { section: '195', rate: 10, base: 100_000, amount: 10_000 },
    });
    const inv = sampleDoc(biz, sampleParty(biz.id), [{ qty: 1, rate: 10_000 }], { date: '2026-05-15' });
    const rows = tdsRegister(
      { businessId: biz.id, purchases: [bill194c], expenses: [exp195], invoices: [inv], parties: [supplier] },
      '2026-04-01',
      '2026-06-30',
    );
    expect(rows.map((r) => [r.section, r.register])).toEqual([
      ['194C', 'DEDUCTED'],
      ['195', 'DEDUCTED_NR'],
    ]);
    const csv = tdsCsv(rows);
    expect(csv).toContain('393(1) Sl. 6(i)');
    expect(csv).toContain('393(2) Sl. 17');
  });

  it('hides TCS on sale of goods after its omission', () => {
    expect(sectionsFor('TCS', '2026-10-29').map((s) => s.code)).not.toContain('206C(1H)');
    expect(sectionsFor('TCS', '2025-03-01').map((s) => s.code)).toContain('206C(1H)');
    expect(sectionsFor('TDS', '2026-10-29').map((s) => s.code)).toEqual(['194C', '194J', '194H', '194I', '194O', '194Q', '195']);
    expect(isSectionAvailable({ ...getSection('194C')!, validFrom: '2027-01-01' }, '2026-10-29')).toBe(false);
  });

  it('applies whole-amount thresholds (194C)', () => {
    const s = getSection('194C')!;
    expect(applyThreshold(s, 25_000, 0, '2026-10-29').applicable).toBe(false);
    expect(applyThreshold(s, 35_000, 0, '2026-10-29')).toMatchObject({ applicable: true, base: 35_000 });
    expect(applyThreshold(s, 20_000, 90_000, '2026-10-29')).toMatchObject({ applicable: true, base: 20_000 });
    expect(applyThreshold(getSection('194O')!, 10, 0, '2026-10-29').applicable).toBe(true);
  });

  it('taxes only the excess for 194Q', () => {
    const s = getSection('194Q')!;
    expect(applyThreshold(s, 200_000, 4_900_000, '2026-10-29')).toMatchObject({ applicable: true, base: 100_000 });
    expect(applyThreshold(s, 200_000, 1_000_000, '2026-10-29').applicable).toBe(false);
  });

  it('computes 206C(1H) only before 1 Apr 2025, for large sellers, on the excess', () => {
    expect(tcs206C1H('2025-04-01', 100_000, 6_000_000, true).reason).toMatch(/omitted/);
    expect(tcs206C1H('2025-03-15', 100_000, 6_000_000, false).applicable).toBe(false);
    expect(tcs206C1H('2025-03-15', 100_000, 4_950_000, true)).toMatchObject({ applicable: true, base: 50_000 });
    expect(applyThreshold(getSection('206C(1H)')!, 10, 0, '2026-01-01').applicable).toBe(false);
  });
});

describe('ledgers', () => {
  const biz = sampleBusiness();
  const customer = sampleParty(biz.id);
  const supplier = sampleParty(biz.id, { kind: 'SUPPLIER', name: 'Havells Distributor' });
  const custom = newLedger(biz.id, 'Director Loan', 'LOANS');
  const ctx = { business: biz, parties: [customer, supplier], ledgers: [custom] };

  it('resolves system, party, bank and custom ledgers', () => {
    expect(resolveLedger('sys:cash', ctx)).toMatchObject({ name: 'Cash', group: 'CASH', kind: 'system' });
    expect(resolveLedger(partyLedgerId(customer.id), ctx)?.group).toBe('SUNDRY_DEBTORS');
    expect(resolveLedger(partyLedgerId(supplier.id), ctx)?.group).toBe('SUNDRY_CREDITORS');
    expect(resolveLedger(bankLedgerId('bank_1'), ctx)).toMatchObject({ name: 'HDFC Bank ...5678', group: 'BANK' });
    expect(resolveLedger(custom.id, ctx)?.name).toBe('Director Loan');
    expect(resolveLedger('sys:nope', ctx)).toBeNull();
    expect(resolveLedger('party:nope', ctx)).toBeNull();
    expect(resolveLedger('bank:nope', ctx)).toBeNull();
    expect(resolveLedger('led_nope', ctx)).toBeNull();
  });

  it('lists every ledger and parses references', () => {
    const all = allLedgers(ctx);
    expect(all.some((l) => l.id === 'sys:out-igst')).toBe(true);
    expect(all.filter((l) => l.kind === 'party')).toHaveLength(2);
    expect(all.some((l) => l.id === custom.id)).toBe(true);
    expect(parseLedgerRef('party:abc')).toEqual({ kind: 'party', key: 'abc' });
    expect(parseLedgerRef('bank:xyz')).toEqual({ kind: 'bank', key: 'xyz' });
    expect(parseLedgerRef('led_1')).toEqual({ kind: 'custom', key: 'led_1' });
    expect(EXPENSE_LEDGERS.length).toBeGreaterThan(10);
    expect(PNL_GROUPS.has('SALES')).toBe(true);
    expect(GROUP_LABELS.SUNDRY_DEBTORS).toBe('Sundry Debtors');
  });
});

describe('PIN', () => {
  it('hashes and verifies without storing the PIN', async () => {
    const h = await hashPin('4821', 1000);
    expect(h.hash).toHaveLength(64);
    expect(h.salt).toHaveLength(32);
    expect(JSON.stringify(h)).not.toContain('4821');
    expect(await verifyPin('4821', h)).toBe(true);
    expect(await verifyPin('4822', h)).toBe(false);
    expect(await verifyPin('12', h)).toBe(false);
    expect(await verifyPin('4821', { ...h, hash: 'ab' })).toBe(false);
    await expect(hashPin('12ab')).rejects.toThrow();
    expect(isValidPinFormat('123456')).toBe(true);
    expect(isValidPinFormat('123')).toBe(false);
  });
});

describe('CSV', () => {
  it('escapes, adds a BOM and blocks formula injection', () => {
    const csv = toCsv([
      ['Name', 'Note', 'Amount', 'Flag', 'Empty'],
      ['A, B', 'He said "hi"\nbye', 12.5, true, null],
      ['=HYPERLINK("x")', '-cmd', -5, false, undefined],
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"A, B"');
    expect(csv).toContain('"He said ""hi""\nbye"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'-cmd");
    expect(csv).toContain(',-5,No,');
    expect(toCsv([[Number.NaN]], false)).toBe('');
  });

  it('maps records to columns', () => {
    const cols = [
      { header: 'No', value: (r: { n: number }) => r.n },
      { header: 'Twice', value: (r: { n: number }) => r.n * 2 },
    ];
    expect(recordsToRows([{ n: 1 }], cols)).toEqual([['No', 'Twice'], [1, 2]]);
    expect(recordsToCsv([{ n: 2 }], cols)).toBe('\uFEFFNo,Twice\r\n2,4');
  });
});

describe('XLSX', () => {
  it('names columns and sheets safely', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(701)).toBe('ZZ');
    expect(columnLetter(702)).toBe('AAA');
    const used = new Set<string>();
    expect(safeSheetName('GSTR-1: B2B/B2C', used)).toBe('GSTR-1  B2B B2C');
    expect(safeSheetName('GSTR-1: B2B/B2C', used)).toBe('GSTR-1  B2B B2C (2)');
    expect(safeSheetName('', used)).toBe('Sheet');
    expect(safeSheetName('x'.repeat(40), used)).toHaveLength(31);
  });

  it('writes a valid workbook', async () => {
    const bytes = await buildXlsx([
      { name: 'Sales', rows: [['Item', 'Qty', 'OK'], ['Bulb <9W> & "co"', 3, true], [null, Number.NaN, '']] },
      { name: 'Plain', rows: [['a']], header: false },
    ]);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/styles.xml']),
    );
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('Bulb &lt;9W&gt; &amp; &quot;co&quot;');
    expect(sheet).toContain('<c r="B2"><v>3</v></c>');
    expect(sheet).toContain('s="1"');
    expect(sheet).toContain('>Yes<');
    const plain = await zip.file('xl/worksheets/sheet2.xml')!.async('string');
    expect(plain).not.toContain('s="1"');
    expect(XLSX_MIME).toMatch(/spreadsheetml/);
    await expect(buildXlsx([])).rejects.toThrow();
  });
});
