// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGstin } from '../../../src/core/gst/gstin';
import { parse2b } from '../../../src/core/gst/returns/gstr2b';
import { buildGstr3b } from '../../../src/core/gst/returns/gstr3b';
import { monthPeriod, portalDate } from '../../../src/core/gst/returns/period';
import type { CollectionData } from '../../../src/core/model';
import { buildSampleData } from '../../../src/data/seed';
import { ExpensesPage } from '../../../src/features/expenses/Expenses';
import { Gstr3bPage } from '../../../src/features/gst/Gstr3bPage';
import { useStore } from '../../../src/store/store';
import { Toaster } from '../../../src/ui/feedback';
import { pickFile } from '../../../src/ui/files';

// The GSTR-3B page and the expense dialog with the sample business (review batch 04:
// compliance rows 1 and 18, code review Y7).

vi.mock('../../../src/ui/files', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../src/ui/files')>()), pickFile: vi.fn() }));

let data: CollectionData;

beforeEach(() => {
  data = buildSampleData();
  useStore.setState({ data, adapter: null, boot: 'ready', unlocked: true });
});

afterEach(cleanup);

const show = (element: ReactNode) =>
  render(
    <MemoryRouter>
      {element}
      <Toaster />
    </MemoryRouter>,
  );
const LANDLORD = makeGstin('27', 'AAJFP4455R');
/** The same GSTIN with a wrong check character, as a typo gives. */
const TYPO = LANDLORD.slice(0, 14) + (LANDLORD[14] === 'A' ? 'B' : 'A');
const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The month the GSTR-3B page opens on: the month before today. */
function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A GSTR-2B for last month: the sample rent bill, and one invoice the books do not have. */
function gstr2bFile(month: string) {
  const biz = data.businesses[0];
  const rent = data.expenses.find((e) => e.ledgerId === 'sys:exp-rent' && e.date.startsWith(month))!;
  const json = {
    data: {
      gstin: biz.gstin,
      rtnprd: `${month.slice(5, 7)}${month.slice(0, 4)}`,
      docdata: {
        b2b: [
          { ctin: rent.vendorGstin, trdnm: 'Patel Estates', inv: [{ inum: rent.billNo, dt: portalDate(rent.date), val: rent.total, txval: rent.taxable, cgst: rent.cgst, sgst: rent.sgst }] },
          { ctin: makeGstin('27', 'AABCB1234C'), trdnm: 'Unknown Supplier', inv: [{ inum: 'X-1', dt: portalDate(`${month}-05`), val: 1_180, txval: 1_000, cgst: 90, sgst: 90 }] },
        ],
      },
    },
  };
  return { json, file: new File([JSON.stringify(json)], 'gstr2b-sample.json', { type: 'application/json' }) };
}

describe('the GSTR-3B page', () => {
  it('shows Table 4(D) with the rows the form has had since FY 2023-24 (compliance row 18)', () => {
    show(<Gstr3bPage />);
    expect(screen.getByText('(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period')).toBeTruthy();
    expect(screen.getByText('(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules')).toBeTruthy();
    expect(screen.queryByText(/Rule 38 \(reversal of credit by a banking company\)/)).toBeNull();
  });

  it('says that 4(A)(5) comes from the books until a GSTR-2B is opened (compliance row 1)', () => {
    show(<Gstr3bPage />);
    expect(screen.getByText('4(A)(5) from your books (no GSTR-2B open)')).toBeTruthy();
    expect(screen.getByText(/No GSTR-2B is open/)).toBeTruthy();
  });

  it('takes 4(A)(5) from a GSTR-2B opened on the page and lists what needs a look (compliance row 1)', async () => {
    const month = lastMonth();
    const { json, file } = gstr2bFile(month);
    vi.mocked(pickFile).mockResolvedValue(file);
    show(<Gstr3bPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open GSTR-2B' }));
    expect(await screen.findByText('4(A)(5) from gstr2b-sample.json')).toBeTruthy();

    const expected = buildGstr3b(data.businesses[0], data, monthPeriod(month), parse2b(json));
    const row5 = screen.getByText('(5) All other ITC').closest('tr')!;
    expect(row5.textContent).toContain(inr(expected.itcAvailable[4].camt));
    const check = screen.getByRole('heading', { name: 'GSTR-2B check for Table 4' }).closest('section')!;
    const unknown = within(check).getByText('X-1').closest('tr')!;
    expect(unknown.textContent).toContain('Not in your books');
    expect(unknown.textContent).toContain('Reversed in 4(B)(2)');
    expect(screen.getByText('(2) Others').closest('tr')!.textContent).toContain(inr(90));

    // Another month: the file no longer applies, and the page says so.
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2000-01' } });
    expect(screen.getByText(/The GSTR-2B open \(gstr2b-sample\.json\) is for period/)).toBeTruthy();
    expect(screen.getByText('4(A)(5) from your books (no GSTR-2B open)')).toBeTruthy();
  });

  it('refuses a GSTR-2B of another GSTIN', async () => {
    const { json } = gstr2bFile(lastMonth());
    json.data.gstin = makeGstin('29', 'AACCK1234L');
    vi.mocked(pickFile).mockResolvedValue(new File([JSON.stringify(json)], 'other.json', { type: 'application/json' }));
    show(<Gstr3bPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open GSTR-2B' }));
    expect(await screen.findByText(/This GSTR-2B is for GSTIN/)).toBeTruthy();
    expect(screen.getByText('4(A)(5) from your books (no GSTR-2B open)')).toBeTruthy();
  });
});

describe('the expense dialog (review Y7)', () => {
  it('offers "Claim input tax credit" only once a valid vendor GSTIN is entered', () => {
    show(<ExpensesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'New expense' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('GST rate'), { target: { value: '18' } });
    const box = () => within(dialog).getByLabelText(/Claim input tax credit/) as HTMLInputElement;
    expect(box().disabled).toBe(true);
    expect(box().checked).toBe(false);
    expect(dialog.textContent).toContain("Enter the vendor's GSTIN first");

    fireEvent.change(within(dialog).getByLabelText('Vendor GSTIN (for ITC)'), { target: { value: LANDLORD } });
    expect(box().disabled).toBe(false);
    fireEvent.click(box());
    expect(box().checked).toBe(true);

    // A typo in the GSTIN takes the claim away again.
    fireEvent.change(within(dialog).getByLabelText('Vendor GSTIN (for ITC)'), { target: { value: TYPO } });
    expect(box().disabled).toBe(true);
    expect(box().checked).toBe(false);
  });
});
