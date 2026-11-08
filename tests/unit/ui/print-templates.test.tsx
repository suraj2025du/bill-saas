import { describe, expect, it } from 'vitest';
import { sampleBusiness, sampleDoc, sampleParty } from '../../fixtures/sample';
import { labelsFor } from '../../../src/print/labels';
import { docView } from '../../../src/features/sales/common';
import { buildPaymentIndex } from '../../../src/core/docs/payments';

describe('print templates and view formatting (Batch 06)', () => {
  const biz = sampleBusiness();
  const party = sampleParty(biz.id, {
    billing: { line1: '123 MG Road', line2: '', city: 'Bengaluru', pincode: '560001', stateCode: '29', countryCode: 'IN' },
    gstin: '29ABCDE1234F1Z5',
  });

  it('prints amountInWords for Grand Total even with TDS/TCS (CR Y9)', () => {
    const doc = sampleDoc(biz, party, [{ qty: 1, rate: 100_000, gstRate: 18 }], {
      tds: { section: '194J', rate: 10, base: 100_000, amount: 10_000 },
    });
    const emptyIndex = buildPaymentIndex([], [], [], [], biz);
    const view = docView(doc, biz, emptyIndex);
    expect(doc.totals.total).toBe(118_000);
    expect(doc.totals.net).toBe(108_000);
    expect(view.amountInWords).toMatch(/One Lakh Eighteen Thousand/);
  });

  it('provides duplicate for supplier on services invoices under Rule 48 (CO 17)', () => {
    const serviceDoc = sampleDoc(biz, party, [{ qty: 1, rate: 50_000, gstRate: 18, unit: 'OTH', hsn: '998311' }]);
    const emptyIndex = buildPaymentIndex([], [], [], [], biz);
    const view = docView(serviceDoc, biz, emptyIndex, {
      ...biz.print,
      copies: { original: true, duplicate: true, triplicate: true },
    });
    expect(view.copies).toContain('Original for Recipient');
    expect(view.copies).toContain('Duplicate for Supplier');
    expect(view.copies).not.toContain('Duplicate for Transporter');
    expect(view.copies).not.toContain('Triplicate for Supplier');
  });

  it('supports bilingual labels for duplicateSupplier', () => {
    const hiLabels = labelsFor('hi', false);
    expect(hiLabels.duplicateSupplier).toBe('आपूर्तिकर्ता हेतु द्वितीय प्रति');
    const biLabels = labelsFor('hi', true);
    expect(biLabels.duplicateSupplier).toBe('आपूर्तिकर्ता हेतु द्वितीय प्रति / Duplicate for Supplier');
  });
});
