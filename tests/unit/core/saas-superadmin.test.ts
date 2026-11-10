// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSaasConfig,
  saveSaasConfig,
  verifyAdminPin,
  updateAdminPin,
  DEFAULT_SAAS_CONFIG,
} from '../../../src/core/saasConfig';
import {
  isLicenseExpired,
  getDaysRemaining,
  getBillingDocsCount,
  checkInvoiceLimit,
  checkBusinessLimit,
  PLAN_QUOTAS,
  generateLicenseKey,
  validateLicenseKey,
  getSoftwareLockState,
  isGreatPlanActive,
  buildLicenseActivationPatch,
  verifyUpiUtrAndBuildActivation,
} from '../../../src/core/licensing';
import {
  getTenants,
  saveTenants,
  updateTenantPlan,
  getLeadWebhookUrl,
  setLeadWebhookUrl,
  type SaasTenant,
} from '../../../src/core/tenants';

describe('SaaS SuperAdmin & Licensing System', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('SaaS Config & Master PIN Gate', () => {
    it('returns default SaaS configuration on fresh initialization', () => {
      const cfg = getSaasConfig();
      expect(cfg.starterPrice).toBe(DEFAULT_SAAS_CONFIG.starterPrice);
      expect(cfg.enterprisePrice).toBe(DEFAULT_SAAS_CONFIG.enterprisePrice);
      expect(cfg.adminUpiVpa).toBe(DEFAULT_SAAS_CONFIG.adminUpiVpa);
      expect(cfg.adminPhone).toBe(DEFAULT_SAAS_CONFIG.adminPhone);
    });

    it('persists and updates SaaS configuration in localStorage', () => {
      saveSaasConfig({
        adminPhone: '919988776655',
        adminUpiVpa: 'mybusiness@icici',
        adminPayeeName: 'SaaS Pro Pvt Ltd',
        monthlyPrice: 349,
        starterPrice: 1299,
        enterprisePrice: 3499,
      });

      const updated = getSaasConfig();
      expect(updated.adminPhone).toBe('919988776655');
      expect(updated.adminUpiVpa).toBe('mybusiness@icici');
      expect(updated.monthlyPrice).toBe(349);
      expect(updated.starterPrice).toBe(1299);
      expect(updated.enterprisePrice).toBe(3499);
    });

    it('verifies default master PIN and handles PIN updates', () => {
      // Default pin is admin8888
      expect(verifyAdminPin('admin8888')).toBe(true);
      expect(verifyAdminPin('000000')).toBe(false);

      // Update PIN (must be stored as salted ARX commitment digest, never plaintext)
      updateAdminPin('998877');
      expect(verifyAdminPin('998877')).toBe(true);
      expect(verifyAdminPin('admin8888')).toBe(false);
      expect(getSaasConfig().adminPinHash).toMatch(/^arx1:[0-9a-f]{16}$/);
      expect(getSaasConfig().adminPinHash).not.toBe('998877');
    });
  });

  describe('Licensing Quotas & Expiry Validation', () => {
    it('identifies plan quota specifications correctly', () => {
      expect(PLAN_QUOTAS.TRIAL.maxInvoices).toBe(50);
      expect(PLAN_QUOTAS.TRIAL.maxBusinesses).toBe(1);
      expect(PLAN_QUOTAS.TRIAL.hasWatermark).toBe(true);

      expect(PLAN_QUOTAS.STARTER.maxInvoices).toBe(500);
      expect(PLAN_QUOTAS.STARTER.maxBusinesses).toBe(2);
      expect(PLAN_QUOTAS.STARTER.hasWatermark).toBe(false);

      expect(PLAN_QUOTAS.ENTERPRISE.maxInvoices).toBe(Infinity);
      expect(PLAN_QUOTAS.ENTERPRISE.maxBusinesses).toBe(Infinity);
      expect(PLAN_QUOTAS.ENTERPRISE.hasWatermark).toBe(false);
    });

    it('correctly calculates remaining days and expiry state', () => {
      const now = new Date();
      const future = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
      const past = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      expect(getDaysRemaining({ licenseExpiry: future.toISOString() })).toBe(10);
      expect(getDaysRemaining({ licenseExpiry: past.toISOString() })).toBe(0);

      const activeSettings = {
        licenseType: 'STARTER' as const,
        licenseExpiry: future.toISOString().split('T')[0],
      };
      expect(isLicenseExpired(activeSettings)).toBe(false);

      const expiredSettings = {
        licenseType: 'STARTER' as const,
        licenseExpiry: past.toISOString().split('T')[0],
      };
      expect(isLicenseExpired(expiredSettings)).toBe(true);

      // Enterprise or lifetime without expiry never expires
      const enterpriseSettings = {
        licenseType: 'ENTERPRISE' as const,
        licenseExpiry: undefined,
      };
      expect(isLicenseExpired(enterpriseSettings)).toBe(false);
    });

    it('checks billing docs count and invoice limits across tiers', () => {
      const invoices = [
        { docType: 'TAX_INVOICE' },
        { docType: 'BILL_OF_SUPPLY' },
        { docType: 'QUOTATION' },
        { docType: 'DELIVERY_CHALLAN' },
      ];

      expect(getBillingDocsCount(invoices)).toBe(2);

      // Check TRIAL limits at 50
      const fiftyInvoices = Array.from({ length: 50 }, () => ({ docType: 'TAX_INVOICE' }));
      const trialCheck = checkInvoiceLimit(fiftyInvoices, { licenseType: 'TRIAL' });
      expect(trialCheck.allowed).toBe(false);
      expect(trialCheck.max).toBe(50);

      const fortyNineInvoices = Array.from({ length: 49 }, () => ({ docType: 'TAX_INVOICE' }));
      const trialUnder = checkInvoiceLimit(fortyNineInvoices, { licenseType: 'TRIAL' });
      expect(trialUnder.allowed).toBe(true);

      // Check STARTER limits at 500
      const fiveHundredInvoices = Array.from({ length: 500 }, () => ({ docType: 'TAX_INVOICE' }));
      const starterCheck = checkInvoiceLimit(fiveHundredInvoices, { licenseType: 'STARTER' });
      expect(starterCheck.allowed).toBe(false);

      const starterUnder = checkInvoiceLimit(fortyNineInvoices, { licenseType: 'STARTER' });
      expect(starterUnder.allowed).toBe(true);

      // Check ENTERPRISE limit
      const entCheck = checkInvoiceLimit(fiveHundredInvoices, { licenseType: 'ENTERPRISE' });
      expect(entCheck.allowed).toBe(true);
    });

    it('enforces multi-business limits per tier', () => {
      expect(checkBusinessLimit(1, { licenseType: 'TRIAL' }).allowed).toBe(false);
      expect(checkBusinessLimit(0, { licenseType: 'TRIAL' }).allowed).toBe(true);

      expect(checkBusinessLimit(2, { licenseType: 'STARTER' }).allowed).toBe(false);
      expect(checkBusinessLimit(1, { licenseType: 'STARTER' }).allowed).toBe(true);

      expect(checkBusinessLimit(50, { licenseType: 'ENTERPRISE' }).allowed).toBe(true);
    });
  });

  describe('Customer CRM & Lead Pipeline', () => {
    it('manages tenants list and plan upgrades', () => {
      const sampleTenants: SaasTenant[] = [
        {
          id: 'lead_1',
          shopName: 'Sharma Electronics',
          ownerName: 'Rohit Sharma',
          phone: '9876543210',
          city: 'Noida',
          stateCode: '09',
          plan: 'TRIAL',
          invoicesCount: 15,
          registeredAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        },
      ];

      saveTenants(sampleTenants);
      expect(getTenants().length).toBe(1);
      expect(getTenants()[0].plan).toBe('TRIAL');

      // Upgrade tenant to STARTER
      updateTenantPlan('lead_1', 'STARTER');
      expect(getTenants()[0].plan).toBe('STARTER');

      // Upgrade tenant to ENTERPRISE
      updateTenantPlan('lead_1', 'ENTERPRISE');
      expect(getTenants()[0].plan).toBe('ENTERPRISE');
    });

    it('persists and retrieves Lead Webhook URL', () => {
      expect(getLeadWebhookUrl()).toBe('');
      setLeadWebhookUrl('https://discord.com/api/webhooks/test-hook');
      expect(getLeadWebhookUrl()).toBe('https://discord.com/api/webhooks/test-hook');
    });
  });

  describe('Monthly Auto-Disable, Anti-Tamper Security & Great Plan', () => {
    it('generates and validates MONTHLY, STARTER, and ENTERPRISE keys with mod-31 signature', () => {
      const mKey = generateLicenseKey('MONTHLY');
      expect(mKey.startsWith('M')).toBe(true);
      expect(validateLicenseKey(mKey)).toEqual({ valid: true, type: 'MONTHLY' });

      const sKey = generateLicenseKey('STARTER');
      expect(sKey.startsWith('S')).toBe(true);
      expect(validateLicenseKey(sKey)).toEqual({ valid: true, type: 'STARTER' });

      const eKey = generateLicenseKey('ENTERPRISE');
      expect(eKey.startsWith('E')).toBe(true);
      expect(validateLicenseKey(eKey)).toEqual({ valid: true, type: 'ENTERPRISE' });
    });

    it('auto-disables MONTHLY plan when subscription expires (non-payment)', () => {
      const mKey = generateLicenseKey('MONTHLY');
      const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const lockState = getSoftwareLockState({
        licenseType: 'MONTHLY',
        licenseKey: mKey,
        licenseExpiry: pastDate,
      });
      expect(lockState.disabled).toBe(true);
      expect(lockState.kind).toBe('MONTHLY_EXPIRED');
    });

    it('detects clock rollback tampering (>24h backward) and locks software', () => {
      const mKey = generateLicenseKey('MONTHLY');
      const futureClock = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      const lockState = getSoftwareLockState({
        licenseType: 'MONTHLY',
        licenseKey: mKey,
        lastVerifiedClock: futureClock,
      });
      expect(lockState.disabled).toBe(true);
      expect(lockState.kind).toBe('SECURITY_TAMPER');
    });

    it('activates Business Pro Annual (ENTERPRISE) for 365 days (no lifetime plan) and verifies instant UPI UTR activation', () => {
      const eKey = generateLicenseKey('ENTERPRISE');
      const patchRes = buildLicenseActivationPatch(eKey, 'Sharma Traders');
      expect(patchRes.valid).toBe(true);
      expect(patchRes.type).toBe('ENTERPRISE');
      expect(patchRes.patch?.licenseExpiry).not.toBe('2099-12-31');
      expect(getDaysRemaining(patchRes.patch!)).toBeGreaterThanOrEqual(364);
      expect(isGreatPlanActive(patchRes.patch!)).toBe(true);
      expect(isGreatPlanActive({ licenseType: 'ENTERPRISE', licenseKey: '' })).toBe(false);

      // Test Instant 12-Digit UPI UTR Self-Serve Checkout Activation
      const utrRes = verifyUpiUtrAndBuildActivation('412345678901', 'STARTER', 'Verma Kirana Store');
      expect(utrRes.valid).toBe(true);
      expect(utrRes.utrClean).toBe('412345678901');
      expect(utrRes.patch?.licenseType).toBe('STARTER');
      expect(getDaysRemaining(utrRes.patch!)).toBeGreaterThanOrEqual(364);

      // Reject invalid UTR
      const badUtr = verifyUpiUtrAndBuildActivation('12345', 'MONTHLY', 'Verma Kirana Store');
      expect(badUtr.valid).toBe(false);
    });
  });
});
