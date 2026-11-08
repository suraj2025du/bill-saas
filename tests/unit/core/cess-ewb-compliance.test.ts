import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildEwayBill } from '../../../src/core/gst/eway';
import { validateSalesDocument } from '../../../src/core/docs/validate';
import { savePurchase } from '../../../src/store/actions';
import { sampleBusiness, sampleParty, sampleDoc, samplePurchase } from '../../fixtures/sample';
import { useStore } from '../../../src/store/store';
import type { UserError } from '../../../src/store/errors';
import { buildSampleData } from '../../../src/data/seed';

vi.mock('../../../src/store/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/store/store')>();
  const { applyBatch } = await import('../../../src/data/apply');
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

describe('Batch 14 Compliance (E-way bill & Cess cutoff)', () => {
  beforeAll(() => {
    // Lock system time to 2026-11-08
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    const data = buildSampleData();
    useStore.setState({ data, adapter: null, boot: 'ready', unlocked: true });
  });

  it('enforces 180-day document age limit on E-way bills', () => {
    const biz = sampleBusiness();
    const party = sampleParty(biz.id);
    
    // Document dated 2026-10-10 (within 180 days of 2026-11-08)
    const freshDoc = sampleDoc(biz, party, [{ qty: 1, rate: 100 }], {
      date: '2026-10-10',
      status: 'FINAL',
      dispatch: {
        buyerOrderNo: '', buyerOrderDate: '', dispatchDocNo: '', deliveryNoteDate: '', dispatchedThrough: '', destination: '',
        transportMode: 'ROAD', vehicleNo: 'MH-12 AB-1234', vehicleType: 'REGULAR', transporterId: '', transporterName: '',
        transportDocNo: '', transportDocDate: '', distanceKm: 100, termsOfDelivery: '', ewayBillNo: ''
      }
    });
    const resFresh = buildEwayBill(biz, freshDoc);
    const hasAgeErrorFresh = resFresh.errors.some((e: string) => e.includes('180 days'));
    expect(hasAgeErrorFresh).toBe(false);

    // Document dated 2026-01-01 (more than 180 days in the past from 2026-11-08)
    const staleDoc = sampleDoc(biz, party, [{ qty: 1, rate: 100 }], {
      date: '2026-01-01',
      status: 'FINAL',
      dispatch: {
        buyerOrderNo: '', buyerOrderDate: '', dispatchDocNo: '', deliveryNoteDate: '', dispatchedThrough: '', destination: '',
        transportMode: 'ROAD', vehicleNo: 'MH-12 AB-1234', vehicleType: 'REGULAR', transporterId: '', transporterName: '',
        transportDocNo: '', transportDocDate: '', distanceKm: 100, termsOfDelivery: '', ewayBillNo: ''
      }
    });
    const resStale = buildEwayBill(biz, staleDoc);
    expect(resStale.errors).toContain('The document date is more than 180 days in the past.');
  });

  it('validates special vehicle registration number formats on E-way bills', () => {
    const biz = sampleBusiness();
    const party = sampleParty(biz.id);

    const checkVehicle = (vNo: string) => {
      const doc = sampleDoc(biz, party, [{ qty: 1, rate: 100 }], {
        date: '2026-10-10',
        status: 'FINAL',
        dispatch: {
          buyerOrderNo: '', buyerOrderDate: '', dispatchDocNo: '', deliveryNoteDate: '', dispatchedThrough: '', destination: '',
          transportMode: 'ROAD', vehicleNo: vNo, vehicleType: 'REGULAR', transporterId: '', transporterName: '',
          transportDocNo: '', transportDocDate: '', distanceKm: 100, termsOfDelivery: '', ewayBillNo: ''
        }
      });
      return buildEwayBill(biz, doc).warnings.join(' ');
    };

    // Valid formats should produce no vehicle-format warnings
    expect(checkVehicle('MH12AB1234')).not.toContain('does not look like');
    expect(checkVehicle('MH123A1234')).not.toContain('does not look like');
    expect(checkVehicle('DF123456')).not.toContain('does not look like');
    expect(checkVehicle('TM1234567')).not.toContain('does not look like');
    expect(checkVehicle('BP1234567')).not.toContain('does not look like');
    expect(checkVehicle('NP1234567')).not.toContain('does not look like');

    // Invalid format should trigger the vehicle-format warning
    expect(checkVehicle('A')).toContain('does not look like');
  });

  it('enforces compensation cess cutoff on sales documents', () => {
    const biz = sampleBusiness();
    const party = sampleParty(biz.id);

    // After Feb 1, 2026: Cess rate > 0 should error out for any product
    const docPostFeb = sampleDoc(biz, party, [{ qty: 1, rate: 100, cessRate: 5 }], { date: '2026-02-15' });
    const issuesPostFeb = validateSalesDocument(docPostFeb, biz);
    expect(issuesPostFeb.some((i) => i.message.includes('ended on 1 February 2026'))).toBe(true);

    // Between Sep 22, 2025 and Jan 31, 2026: Cess on non-tobacco should trigger a warning
    const docNonTobacco = sampleDoc(biz, party, [{ qty: 1, rate: 100, cessRate: 5, hsn: '1234' }], { date: '2025-10-10' });
    const issuesNonTobacco = validateSalesDocument(docNonTobacco, biz);
    expect(issuesNonTobacco.some((i) => i.level === 'warning' && i.message.includes('removed for non-tobacco goods'))).toBe(true);

    // Between Sep 22, 2025 and Jan 31, 2026: Cess on tobacco (chapter 24) should have no warning
    const docTobacco = sampleDoc(biz, party, [{ qty: 1, rate: 100, cessRate: 5, hsn: '2401' }], { date: '2025-10-10' });
    const issuesTobacco = validateSalesDocument(docTobacco, biz);
    expect(issuesTobacco.some((i) => i.message.includes('removed for non-tobacco goods'))).toBe(false);
  });

  it('enforces compensation cess cutoff on purchase bills', async () => {
    const biz = sampleBusiness();
    const supplier = sampleParty(biz.id, { kind: 'SUPPLIER' });

    // After Feb 1, 2026: Cess should trigger user error
    const purchasePostFeb = samplePurchase(biz, supplier, [{ qty: 1, rate: 100, cessRate: 5 }], { billDate: '2026-02-15' });
    try {
      await savePurchase(purchasePostFeb);
      expect.fail('should have thrown UserError');
    } catch (err) {
      const e = err as UserError;
      expect(e.message).toBe('Please fix the purchase bill:');
      expect(e.details).toContain('Item 1: Compensation cess ended on 1 February 2026 and cannot be charged.');
    }

    // Between Sep 22, 2025 and Jan 31, 2026: Cess on non-tobacco should trigger user error
    const purchaseNonTobacco = samplePurchase(biz, supplier, [{ qty: 1, rate: 100, cessRate: 5, hsn: '1234' }], { billDate: '2025-10-10' });
    try {
      await savePurchase(purchaseNonTobacco);
      expect.fail('should have thrown UserError');
    } catch (err) {
      const e = err as UserError;
      expect(e.message).toBe('Please fix the purchase bill:');
      expect(e.details).toContain('Item 1: Compensation cess was removed for non-tobacco goods on 22 Sep 2025.');
    }
  });
});
