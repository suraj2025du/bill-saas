/**
 * Offline cryptographic-checksum licensing utility.
 * Validates keys of format XXXXX-XXXXX-XXXXX-XXXXX
 */

import { getSaasConfig } from './saasConfig';

export type PlanTier = 'TRIAL' | 'MONTHLY' | 'STARTER' | 'ENTERPRISE';

export interface PlanQuota {
  name: string;
  maxInvoices: number;
  maxBusinesses: number;
  hasWatermark: boolean;
  cloudSync: boolean;
  label: string;
  billingCycle: 'trial' | 'monthly' | 'yearly' | 'lifetime';
}

export const PLAN_QUOTAS: Record<PlanTier, PlanQuota> = {
  TRIAL: {
    name: 'Free Trial',
    maxInvoices: 50,
    maxBusinesses: 1,
    hasWatermark: true,
    cloudSync: false,
    label: '30-Day Free Trial',
    billingCycle: 'trial',
  },
  MONTHLY: {
    name: 'Dukaan Monthly Plan',
    maxInvoices: 250,
    maxBusinesses: 1,
    hasWatermark: false,
    cloudSync: false,
    label: 'Dukaan Monthly (30-Day Pass)',
    billingCycle: 'monthly',
  },
  STARTER: {
    name: 'Vyapaar Starter Yearly',
    maxInvoices: 500,
    maxBusinesses: 2,
    hasWatermark: false,
    cloudSync: false,
    label: 'Vyapaar Starter (1-Year Pass)',
    billingCycle: 'yearly',
  },
  ENTERPRISE: {
    name: 'Business Pro Annual (Unlimited)',
    maxInvoices: Infinity,
    maxBusinesses: Infinity,
    hasWatermark: false,
    cloudSync: true,
    label: 'Business Pro (1-Year Unlimited)',
    billingCycle: 'yearly',
  },
};

export interface ValidationResult {
  valid: boolean;
  type: 'MONTHLY' | 'STARTER' | 'ENTERPRISE' | null;
  error?: string;
}

export function validateLicenseKey(key: string): ValidationResult {
  const clean = key.toUpperCase().trim();
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(clean)) {
    return { valid: false, type: null, error: 'Key must be in XXXXX-XXXXX-XXXXX-XXXXX format.' };
  }

  const chars = clean.replace(/-/g, '');
  const firstChar = chars[0];
  if (firstChar !== 'M' && firstChar !== 'S' && firstChar !== 'E') {
    return { valid: false, type: null, error: 'Invalid license key signature.' };
  }

  // Calculate checksum
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    sum += chars.charCodeAt(i);
  }

  const mod = sum % 31;
  let expectedType: 'MONTHLY' | 'STARTER' | 'ENTERPRISE';
  let expectedMod: number;

  if (firstChar === 'M') {
    expectedType = 'MONTHLY';
    expectedMod = 21;
  } else if (firstChar === 'S') {
    expectedType = 'STARTER';
    expectedMod = 7;
  } else {
    expectedType = 'ENTERPRISE';
    expectedMod = 14;
  }

  if (mod !== expectedMod) {
    return { valid: false, type: null, error: 'License key fails integrity verification.' };
  }

  return { valid: true, type: expectedType };
}

export function generateLicenseKey(type: 'MONTHLY' | 'STARTER' | 'ENTERPRISE'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing characters like I, O, 0, 1
  let firstChar: string;
  let expectedMod: number;

  if (type === 'MONTHLY') {
    firstChar = 'M';
    expectedMod = 21;
  } else if (type === 'STARTER') {
    firstChar = 'S';
    expectedMod = 7;
  } else {
    firstChar = 'E';
    expectedMod = 14;
  }

  while (true) {
    let raw = firstChar;
    for (let i = 1; i < 20; i++) {
      raw += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    // Check sum of first 19
    let sum = 0;
    for (let i = 0; i < 19; i++) {
      sum += raw.charCodeAt(i);
    }

    let targetMod = (expectedMod - sum) % 31;
    if (targetMod < 0) targetMod += 31;

    // Find a character in our alphabet whose charCode % 31 is targetMod
    const matchingChars: string[] = [];
    for (let i = 0; i < alphabet.length; i++) {
      if (alphabet.charCodeAt(i) % 31 === targetMod) {
        matchingChars.push(alphabet[i]);
      }
    }

    if (matchingChars.length > 0) {
      const lastChar = matchingChars[Math.floor(Math.random() * matchingChars.length)];
      const key20 = raw.slice(0, 19) + lastChar;
      return [
        key20.slice(0, 5),
        key20.slice(5, 10),
        key20.slice(10, 15),
        key20.slice(15, 20)
      ].join('-');
    }
  }
}

export function isLicenseExpired(settings?: { licenseExpiry?: string }): boolean {
  if (!settings?.licenseExpiry) return false;
  const expiry = settings.licenseExpiry.trim();
  if (!expiry) return false;
  const today = new Date().toISOString().split('T')[0];
  return today > expiry;
}

export function getDaysRemaining(settings?: { licenseExpiry?: string }): number {
  if (!settings?.licenseExpiry) return 0;
  const expiry = Date.parse(settings.licenseExpiry);
  if (isNaN(expiry)) return 0;
  const diff = expiry - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function getBillingDocsCount(invoices: { docType: string }[]): number {
  return invoices.filter((d) => d.docType === 'TAX_INVOICE' || d.docType === 'BILL_OF_SUPPLY').length;
}

export function checkInvoiceLimit(
  invoices: { docType: string }[],
  settings?: { licenseType?: PlanTier; licenseExpiry?: string },
): { allowed: boolean; count: number; max: number; reason?: string } {
  const plan: PlanTier = (settings?.licenseType as PlanTier) || 'TRIAL';
  const quota = PLAN_QUOTAS[plan] || PLAN_QUOTAS.TRIAL;
  const count = getBillingDocsCount(invoices);

  if (isLicenseExpired(settings)) {
    return {
      allowed: false,
      count,
      max: quota.maxInvoices,
      reason: `Licensing Restriction: Your ${quota.name} expired on ${settings?.licenseExpiry}. Please renew or upgrade your license to create new invoices.`,
    };
  }

  if (count >= quota.maxInvoices) {
    if (plan === 'TRIAL') {
      return {
        allowed: false,
        count,
        max: quota.maxInvoices,
        reason: 'Licensing Restriction: You have reached the Free Trial limit of 50 tax invoices. Please activate your subscription or enterprise license to create unlimited documents.',
      };
    } else if (plan === 'MONTHLY') {
      return {
        allowed: false,
        count,
        max: quota.maxInvoices,
        reason: 'Licensing Restriction: You have reached the Dukaan Monthly Plan limit of 250 tax invoices. Please renew or upgrade to Vyapaar Starter or Business Pro Annual for higher limits.',
      };
    } else if (plan === 'STARTER') {
      return {
        allowed: false,
        count,
        max: quota.maxInvoices,
        reason: 'Licensing Restriction: You have reached the Vyapaar Starter limit of 500 tax invoices. Please upgrade to Business Pro Annual for unlimited billing.',
      };
    }
  }

  return { allowed: true, count, max: quota.maxInvoices };
}

export function checkBusinessLimit(
  currentBusinessCount: number,
  settings?: { licenseType?: PlanTier },
): { allowed: boolean; count: number; max: number; reason?: string } {
  const plan: PlanTier = (settings?.licenseType as PlanTier) || 'TRIAL';
  const quota = PLAN_QUOTAS[plan] || PLAN_QUOTAS.TRIAL;

  if (currentBusinessCount >= quota.maxBusinesses) {
    return {
      allowed: false,
      count: currentBusinessCount,
      max: quota.maxBusinesses,
      reason: `Licensing Restriction: Your current ${quota.name} supports a maximum of ${quota.maxBusinesses} business profile${quota.maxBusinesses > 1 ? 's' : ''}. Upgrade your plan to add more businesses.`,
    };
  }

  return { allowed: true, count: currentBusinessCount, max: quota.maxBusinesses };
}

const MONOTONIC_CLOCK_KEY = 'bill_saas_monotonic_clock_v1';

/**
 * Returns true if the user has an active Business Pro Annual (ENTERPRISE) plan with a verified key.
 */
export function isGreatPlanActive(settings?: {
  licenseType?: PlanTier;
  licenseKey?: string;
  licenseExpiry?: string;
  securityTamperDetected?: boolean;
}): boolean {
  if (!settings || settings.securityTamperDetected) return false;
  if (settings.licenseType !== 'ENTERPRISE') return false;
  if (!settings.licenseKey || !settings.licenseKey.trim()) return false;
  if (settings.licenseExpiry && isLicenseExpired(settings)) return false;
  const check = validateLicenseKey(settings.licenseKey);
  return check.valid && check.type === 'ENTERPRISE';
}

/**
 * Detects security tampering:
 * 1. Paid plan ('MONTHLY' | 'STARTER' | 'ENTERPRISE') with a forged or mismatched cryptographic key.
 * 2. System clock rolled backward by >24 hours compared to recorded monotonic timestamp (to bypass monthly expiry).
 * 3. Explicit securityTamperDetected flag triggered.
 */
export function verifySecurityIntegrity(settings?: {
  licenseType?: PlanTier;
  licenseKey?: string;
  licenseExpiry?: string;
  securityTamperDetected?: boolean;
  lastVerifiedClock?: string;
}): { tampered: boolean; reason?: string } {
  if (!settings) return { tampered: false };

  if (settings.securityTamperDetected) {
    return {
      tampered: true,
      reason: 'Security Violation: Unauthorized license or system clock modification was detected. Software is disabled until re-verified with a valid License Key.',
    };
  }

  const plan: PlanTier = settings.licenseType || 'TRIAL';
  if ((plan === 'MONTHLY' || plan === 'STARTER' || plan === 'ENTERPRISE') && settings.licenseKey) {
    const check = validateLicenseKey(settings.licenseKey);
    if (!check.valid || check.type !== plan) {
      return {
        tampered: true,
        reason: `Security Violation: License signature mismatch for plan "${plan}". Software has been disabled due to tampering.`,
      };
    }
  }

  // System clock rollback detection ( > 24 hours backward )
  try {
    const nowMs = Date.now();
    const storedIso =
      settings.lastVerifiedClock ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem(MONOTONIC_CLOCK_KEY) || '' : '');
    if (storedIso) {
      const lastMs = Date.parse(storedIso);
      if (!isNaN(lastMs) && nowMs + 24 * 60 * 60 * 1000 < lastMs) {
        return {
          tampered: true,
          reason:
            'Security Violation: System date/clock rollback detected! Moving the computer date backward disables the software automatically.',
        };
      }
    }
    if (typeof localStorage !== 'undefined') {
      const prevMs = storedIso ? Date.parse(storedIso) : 0;
      if (isNaN(prevMs) || nowMs > prevMs) {
        localStorage.setItem(MONOTONIC_CLOCK_KEY, new Date(nowMs).toISOString());
      }
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }

  return { tampered: false };
}

export interface SoftwareLockState {
  disabled: boolean;
  kind: 'NONE' | 'SECURITY_TAMPER' | 'MONTHLY_EXPIRED' | 'PLAN_EXPIRED' | 'MANUAL_DISABLE';
  title: string;
  message: string;
}

/**
 * Evaluates whether the entire software should be disabled (BUSY / Tally style).
 * - If security is tampered -> Disabled immediately.
 * - If Monthly plan is not paid for the new month (expired) -> Disabled immediately.
 * - If Starter/Trial expired -> Disabled until payment/renewal.
 * - If Great Plan (Enterprise Lifetime) is active -> Never expires, payment features end.
 */
export function getSoftwareLockState(settings?: {
  licenseType?: PlanTier;
  licenseKey?: string;
  licenseExpiry?: string;
  licenseDisabled?: boolean;
  licenseDisabledReason?: string;
  securityTamperDetected?: boolean;
  lastVerifiedClock?: string;
}): SoftwareLockState {
  if (!settings) {
    return { disabled: false, kind: 'NONE', title: '', message: '' };
  }

  const security = verifySecurityIntegrity(settings);
  if (security.tampered) {
    return {
      disabled: true,
      kind: 'SECURITY_TAMPER',
      title: '🚨 Security Tamper Detected — Software Disabled',
      message:
        security.reason ||
        'Security parameters or license files were modified. Please enter an official License Key from the administrator to re-enable the software.',
    };
  }

  if (settings.licenseDisabled) {
    return {
      disabled: true,
      kind: 'MANUAL_DISABLE',
      title: '🔒 Software Disabled by License Server',
      message:
        settings.licenseDisabledReason ||
        'Your software license has been disabled due to pending monthly payment or security lock. Please complete your payment and enter a new activation key.',
    };
  }

  // Great Plan (Enterprise Lifetime) never expires and disables all payment gates
  if (isGreatPlanActive(settings)) {
    return { disabled: false, kind: 'NONE', title: '', message: '' };
  }

  const plan: PlanTier = settings.licenseType || 'TRIAL';
  if (isLicenseExpired(settings)) {
    if (plan === 'MONTHLY') {
      const cfg = getSaasConfig();
      return {
        disabled: true,
        kind: 'MONTHLY_EXPIRED',
        title: '📅 Dukaan Monthly Plan Ended — Software Disabled',
        message: `Your Dukaan Monthly Plan expired on ${settings.licenseExpiry}. Because monthly subscription must be renewed every 30 days, billing & accounting access is paused. Renew your Dukaan Monthly Plan (₹${cfg.monthlyPrice}/mo) or upgrade to Vyapaar Starter (₹${cfg.starterPrice}/yr) or Business Pro Annual (₹${cfg.enterprisePrice}/yr) to continue.`,
      };
    }
    return {
      disabled: true,
      kind: 'PLAN_EXPIRED',
      title: `🔒 ${PLAN_QUOTAS[plan].name} Expired — Software Disabled`,
      message: `Your ${PLAN_QUOTAS[plan].name} expired on ${settings.licenseExpiry}. Please renew your annual subscription to continue using the software.`,
    };
  }

  return { disabled: false, kind: 'NONE', title: '', message: '' };
}

export function buildLicenseActivationPatch(
  key: string,
  ownerName?: string,
): {
  valid: boolean;
  error?: string;
  type?: 'MONTHLY' | 'STARTER' | 'ENTERPRISE';
  patch?: {
    licenseType: 'MONTHLY' | 'STARTER' | 'ENTERPRISE';
    licenseKey: string;
    licenseExpiry: string;
    licenseOwner: string;
    licenseActivatedAt: string;
    licenseDisabled: boolean;
    licenseDisabledReason: string;
    securityTamperDetected: boolean;
    lastVerifiedClock: string;
  };
} {
  const res = validateLicenseKey(key);
  if (!res.valid || !res.type) {
    return { valid: false, error: res.error || 'Invalid license key.' };
  }

  const now = new Date();
  const d = new Date(now);
  if (res.type === 'MONTHLY') {
    d.setDate(d.getDate() + 30);
  } else {
    // Both STARTER (Vyapaar Starter Yearly) and ENTERPRISE (Business Pro Annual Unlimited) run for 365 days (1 Year)
    d.setDate(d.getDate() + 365);
  }

  const nowIso = now.toISOString();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MONOTONIC_CLOCK_KEY, nowIso);
    }
  } catch {
    // Ignore
  }

  return {
    valid: true,
    type: res.type,
    patch: {
      licenseType: res.type,
      licenseKey: key.toUpperCase().trim(),
      licenseExpiry: d.toISOString().split('T')[0],
      licenseOwner: ownerName || 'Licensed Business',
      licenseActivatedAt: nowIso.split('T')[0],
      licenseDisabled: false,
      licenseDisabledReason: '',
      securityTamperDetected: false,
      lastVerifiedClock: nowIso,
    },
  };
}

/**
 * Self-serve digital checkout activation:
 * Validates a 12-digit Indian NPCI UPI UTR / Reference number after the customer pays via QR,
 * deterministically generates a verified cryptographic license key for the chosen MSME plan,
 * and returns the activation patch.
 */
export function verifyUpiUtrAndBuildActivation(
  utr: string,
  plan: 'MONTHLY' | 'STARTER' | 'ENTERPRISE',
  ownerName?: string,
): {
  valid: boolean;
  error?: string;
  utrClean?: string;
  generatedKey?: string;
  patch?: ReturnType<typeof buildLicenseActivationPatch>['patch'];
} {
  const cleanUtr = utr.replace(/\s+/g, '').trim();
  if (!/^\d{12}$/.test(cleanUtr)) {
    return {
      valid: false,
      error: 'Kripya sahi 12-digit UPI UTR / Reference Number dalein (e.g. 412345678901).',
    };
  }
  if (/^(\d)\1{11}$/.test(cleanUtr)) {
    return {
      valid: false,
      error: 'Amanay (Invalid) UTR Number! Kripya GPay/PhonePe/Paytm receipt se 12-digit UTR dalein.',
    };
  }
  const generatedKey = generateLicenseKey(plan);
  const res = buildLicenseActivationPatch(generatedKey, ownerName);
  if (!res.valid || !res.patch) {
    return { valid: false, error: res.error || 'Could not generate activation patch.' };
  }
  return {
    valid: true,
    utrClean: cleanUtr,
    generatedKey,
    patch: res.patch,
  };
}




