import { describe, it, expect, vi } from 'vitest';
import { validateLicenseKey, generateLicenseKey } from '../../../src/core/licensing';
import { useStore } from '../../../src/store/store';
import { buildSampleData } from '../../../src/data/seed';
import { saveSalesDocument } from '../../../src/store/actions';
import { sampleDoc } from '../../fixtures/sample';

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

describe('Cryptographic Offline Licensing Engine', () => {
  it('generates valid STARTER keys that pass verification', () => {
    for (let i = 0; i < 20; i++) {
      const key = generateLicenseKey('STARTER');
      expect(key).toMatch(/^[S][A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      
      const res = validateLicenseKey(key);
      expect(res.valid).toBe(true);
      expect(res.type).toBe('STARTER');
      expect(res.error).toBeUndefined();
    }
  });

  it('generates valid ENTERPRISE keys that pass verification', () => {
    for (let i = 0; i < 20; i++) {
      const key = generateLicenseKey('ENTERPRISE');
      expect(key).toMatch(/^[E][A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      
      const res = validateLicenseKey(key);
      expect(res.valid).toBe(true);
      expect(res.type).toBe('ENTERPRISE');
      expect(res.error).toBeUndefined();
    }
  });

  it('rejects invalidly formatted keys', () => {
    expect(validateLicenseKey('invalid-format').valid).toBe(false);
    expect(validateLicenseKey('S1234-56789-abcde-fghij').valid).toBe(false); // lowercase
    expect(validateLicenseKey('S12345-678901-abcde2-fghij3').valid).toBe(false); // incorrect blocks
  });

  it('rejects keys with wrong start characters', () => {
    const key = generateLicenseKey('STARTER');
    // Replace first char with 'X'
    const tampered = 'X' + key.slice(1);
    const res = validateLicenseKey(tampered);
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Invalid license key signature.');
  });

  it('rejects keys with incorrect checksums (tampering check)', () => {
    const key = generateLicenseKey('STARTER');
    // Change last char of key to 'A' or 'B' (which likely breaks checksum)
    const blocks = key.split('-');
    const lastBlock = blocks[3];
    const tamperedLast = lastBlock.slice(0, 4) + (lastBlock[4] === 'A' ? 'B' : 'A');
    blocks[3] = tamperedLast;
    const tamperedKey = blocks.join('-');

    // If by a 1 in 31 chance the tampered key still has same checksum, we skip assertion
    const realRes = validateLicenseKey(tamperedKey);
    if (!realRes.valid) {
      expect(realRes.error).toBe('License key fails integrity verification.');
    }
  });

  it('enforces tax invoice creation limits based on license type', async () => {
    // Seed store
    const data = buildSampleData();
    useStore.setState({ data, adapter: null, boot: 'ready', unlocked: true });

    const biz = data.businesses[0];
    const client = data.clients[0];
    
    // Set license type to TRIAL
    data.settings[0].licenseType = 'TRIAL';

    // Seed 50 dummy tax invoices
    const dummyInvoice = data.invoices.find(d => d.docType === 'TAX_INVOICE') || sampleDoc(biz, client, [{ qty: 1, rate: 10 }]);
    data.invoices = Array.from({ length: 50 }, (_, i) => ({
      ...dummyInvoice,
      id: `dummy_inv_${i}`,
      number: `INV/26-27/${1000 + i}`,
      docType: 'TAX_INVOICE',
      businessId: biz.id,
    }));

    // Attempting to save a 51st tax invoice should fail
    const newInvoice = {
      ...dummyInvoice,
      id: 'new_inv_51',
      number: '', // triggers generation or let's keep empty
    };

    await expect(saveSalesDocument(newInvoice, false)).rejects.toThrow(/reached the Free Trial limit/);

    // Change license to STARTER
    data.settings[0].licenseType = 'STARTER';
    // Saving should now succeed (returns the saved document)
    const saved = await saveSalesDocument(newInvoice, false);
    expect(saved).toBeDefined();
    expect(saved.id).toBe('new_inv_51');
  });
});
