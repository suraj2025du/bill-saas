import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useStore } from '../../src/store/store';
import { buildSampleData } from '../../src/data/seed';
import {
  saveSalesDocument,
} from '../../src/store/actions';
import { duplicateDocument } from '../../src/core/docs/lifecycle';
import { makeRecurringCopy } from '../../src/core/docs/recurring';
import type { Business, CollectionData, SalesDocument } from '../../src/core/model';
import type { UserError } from '../../src/store/errors';

vi.mock('../../src/store/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/store/store')>();
  const { applyBatch } = await import('../../src/data/apply');
  return {
    ...actual,
    boot: vi.fn(() => Promise.resolve()),
    commit: vi.fn(async (batch) => {
      actual.useStore.setState((s) => ({
        data: applyBatch(s.data, batch),
      }));
    }),
  };
});

describe('Batch 08: Store Actions Tests (CR Y4, Y5, Y6; CO 14, 15, 27)', () => {
  let data: CollectionData;
  let business: Business;

  beforeEach(() => {
    data = buildSampleData();
    business = data.businesses[0];
    useStore.setState({ data, adapter: null, boot: 'ready', unlocked: true });
  });

  it('Y6: resets series numbering per financial year when resetEachFY is true and includeFY is false', async () => {
    // Enable resetEachFY but disable includeFY on TAX_INVOICE
    business.series.TAX_INVOICE = {
      prefix: 'INV/',
      padding: 4,
      resetEachFY: true,
      includeFY: false,
      nextNumber: 1,
    };

    // Add an invoice from the previous financial year
    const invoiceFY25 = {
      ...data.invoices[0],
      id: 'inv-prev-fy',
      date: '2025-05-10',
      number: 'INV/0001',
      docType: 'TAX_INVOICE',
      status: 'FINAL',
      refDocId: '',
      refDocNumber: '',
      refDocDate: '',
    };
    data.invoices.push(invoiceFY25);

    // Create a new invoice in FY 2026-27
    const invoiceFY26 = {
      ...data.invoices[0],
      id: 'inv-new-fy',
      date: '2026-05-10',
      number: '', // Let system auto-assign
      docType: 'TAX_INVOICE',
      status: 'FINAL',
      refDocId: '',
      refDocNumber: '',
      refDocDate: '',
    };

    const saved = await saveSalesDocument(invoiceFY26, true);
    // Since resetEachFY is on and includeFY is off, the auto-assigned number must restart at 'INV/0001'!
    expect(saved.number).toBe('INV/0001');
  });

  it('Y4: prevents converting a quotation/challan twice', async () => {
    const quotation = data.invoices.find((d) => d.docType === 'QUOTATION');
    expect(quotation).toBeDefined();
    if (!quotation) return;

    // Mark the quotation as FINAL so it can be converted
    quotation.status = 'FINAL';
    quotation.convertedToId = ''; // Reset

    // Create first conversion
    const conversion1 = {
      ...data.invoices[0],
      id: 'conversion-1',
      docType: 'TAX_INVOICE' as const,
      refDocId: quotation.id,
      status: 'FINAL' as const,
      number: 'INV/9991',
    };

    // Save first conversion -> quotation becomes converted
    await saveSalesDocument(conversion1, false);

    // Try to save second conversion pointing to same quotation
    const conversion2 = {
      ...data.invoices[0],
      id: 'conversion-2',
      docType: 'TAX_INVOICE' as const,
      refDocId: quotation.id,
      status: 'FINAL' as const,
      number: 'INV/9992',
    };

    try {
      await saveSalesDocument(conversion2, false);
      expect.fail('Should have failed double conversion');
    } catch (err) {
      const e = err as UserError;
      expect(e.message).toContain('Already converted');
    }
  });

  it('Y4: prevents credit note from exceeding original invoice total', async () => {
    // Clear existing credit notes to avoid seed data interference
    data.invoices = data.invoices.filter((d) => d.docType !== 'CREDIT_NOTE');

    const invoice = data.invoices.find((d) => d.docType === 'TAX_INVOICE' && d.status === 'FINAL');
    expect(invoice).toBeDefined();
    if (!invoice) return;

    // Sum is limited to original totals.total
    const invTotal = invoice.totals.total;

    // Create first credit note taking up 60% of total
    const cn1: SalesDocument = {
      ...data.invoices[0],
      id: 'cn-1',
      docType: 'CREDIT_NOTE',
      refDocId: invoice.id,
      refDocNumber: invoice.number,
      refDocDate: invoice.date,
      status: 'FINAL',
      number: 'CN/0001',
      totals: { ...data.invoices[0].totals, total: invTotal * 0.6 },
    };
    await saveSalesDocument(cn1, false);

    // Create second credit note taking up 50% of total (total 110%)
    const cn2: SalesDocument = {
      ...data.invoices[0],
      id: 'cn-2',
      docType: 'CREDIT_NOTE',
      refDocId: invoice.id,
      refDocNumber: invoice.number,
      refDocDate: invoice.date,
      status: 'FINAL',
      number: 'CN/0002',
      totals: { ...data.invoices[0].totals, total: invTotal * 0.5 },
    };

    try {
      await saveSalesDocument(cn2, false);
      expect.fail('Should have failed credit note totals limit');
    } catch (err) {
      const e = err as UserError;
      expect(e.details.join('\n')).toContain('exceeds the original invoice total');
    }
  });

  it('Y5: clearing transport and dispatch details during copy, duplicate and conversion', () => {
    const source = {
      ...data.invoices[0],
      dispatch: {
        buyerOrderNo: 'PO-1234',
        vehicleNo: 'KA-01-1234',
        ewayBillNo: '123456789012',
      },
    };

    // duplicate (freshCopy via duplicateDocument)
    const duplicate = duplicateDocument(source);
    expect(duplicate.dispatch.buyerOrderNo).toBe('');
    expect(duplicate.dispatch.vehicleNo).toBe('');
    expect(duplicate.dispatch.ewayBillNo).toBe('');

    // recurring (makeRecurringCopy)
    const recurring = makeRecurringCopy(source, '2026-11-01');
    expect(recurring.dispatch.buyerOrderNo).toBe('');
    expect(recurring.dispatch.vehicleNo).toBe('');
    expect(recurring.dispatch.ewayBillNo).toBe('');
  });

  it('CO 14 & 15: enforces credit note citation and November 30 next FY time limits', async () => {
    const invoice = data.invoices.find((d) => d.docType === 'TAX_INVOICE' && d.status === 'FINAL');
    expect(invoice).toBeDefined();
    if (!invoice) return;

    // CO 14: Credit note must cite original invoice
    const cnMissingRef = {
      ...data.invoices[0],
      id: 'cn-err',
      docType: 'CREDIT_NOTE' as const,
      refDocId: '', // Missing!
      refDocNumber: '',
      refDocDate: '',
      status: 'FINAL' as const,
      number: 'CN/0099',
    };
    try {
      await saveSalesDocument(cnMissingRef, false);
      expect.fail('Should have failed missing refDocId');
    } catch (err) {
      const e = err as UserError;
      expect(e.details.join('\n')).toContain('must cite the original invoice');
    }

    // CO 15: Credit note date past 30 November of the next financial year
    // If invoice is 2025-10-15 (FY 2025-26), deadline is 2026-11-30.
    const cnOutofTime = {
      ...data.invoices[0],
      id: 'cn-too-late',
      docType: 'CREDIT_NOTE' as const,
      refDocId: invoice.id,
      refDocNumber: invoice.number,
      refDocDate: '2025-10-15', // FY 25-26
      date: '2026-12-01', // Past 2026-11-30 deadline!
      status: 'FINAL' as const,
      number: 'CN/0100',
    };
    try {
      await saveSalesDocument(cnOutofTime, false);
      expect.fail('Should have failed out-of-time credit note');
    } catch (err) {
      const e = err as UserError;
      expect(e.details.join('\n')).toContain('Credit note date cannot be after 30 November');
    }
  });
});
