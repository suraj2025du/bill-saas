export interface SaasConfig {
  adminPhone: string; // e.g. '919999999999' or configurable
  adminUpiVpa: string; // e.g. 'billsaas@upi'
  adminPayeeName: string; // e.g. 'BillSaaS Pro Payments'
  monthlyPrice: number; // e.g. 199 (Dukaan Monthly)
  starterPrice: number; // e.g. 799 (Vyapaar Starter 1-Year)
  enterprisePrice: number; // e.g. 1499 (Business Pro 1-Year Unlimited)
  leadWebhookUrl: string;
  adminPinHash?: string;
}

const SAAS_CONFIG_KEY = 'bill_saas_global_config_v1';
const DEFAULT_ADMIN_PIN_COMMITMENT = 'arx1:638e4a611804d8cc';

/**
 * Derives a salted 64-bit chained FNV-1a / ARX commitment digest so plaintext Master PINs
 * are never embedded in source bundles or persisted in localStorage.
 */
export function deriveAdminPinCommitment(pin: string): string {
  const clean = pin.trim();
  let laneA = 0x811c9dc5;
  let laneB = 0x9e3779b9;
  const salt = 'gst-saas-pin-v2::';
  const payload = `${salt}${clean}::${clean.length}`;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    laneA = Math.imul(laneA ^ ch, 0x01000193) >>> 0;
    laneB = (Math.imul(laneB ^ ((ch << 5) | (ch >>> 3)), 0x85ebca6b) + laneA) >>> 0;
    laneA = ((laneA << 13) | (laneA >>> 19)) ^ laneB;
  }
  const hexA = (laneA >>> 0).toString(16).padStart(8, '0');
  const hexB = (laneB >>> 0).toString(16).padStart(8, '0');
  return `arx1:${hexA}${hexB}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export const DEFAULT_SAAS_CONFIG: SaasConfig = {
  adminPhone: '919999999999',
  adminUpiVpa: 'billsaas@upi',
  adminPayeeName: 'BillSaaS Pro Payments',
  monthlyPrice: 199,
  starterPrice: 799,
  enterprisePrice: 1499,
  leadWebhookUrl: '',
};

export function getSaasConfig(): SaasConfig {
  try {
    const raw = localStorage.getItem(SAAS_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_SAAS_CONFIG };
    const parsed = JSON.parse(raw) as Partial<SaasConfig>;
    return {
      adminPhone: parsed.adminPhone || DEFAULT_SAAS_CONFIG.adminPhone,
      adminUpiVpa: parsed.adminUpiVpa || DEFAULT_SAAS_CONFIG.adminUpiVpa,
      adminPayeeName: parsed.adminPayeeName || DEFAULT_SAAS_CONFIG.adminPayeeName,
      monthlyPrice: parsed.monthlyPrice ?? DEFAULT_SAAS_CONFIG.monthlyPrice,
      starterPrice: parsed.starterPrice ?? DEFAULT_SAAS_CONFIG.starterPrice,
      enterprisePrice: parsed.enterprisePrice ?? DEFAULT_SAAS_CONFIG.enterprisePrice,
      leadWebhookUrl: parsed.leadWebhookUrl || DEFAULT_SAAS_CONFIG.leadWebhookUrl,
      adminPinHash: parsed.adminPinHash,
    };
  } catch {
    return { ...DEFAULT_SAAS_CONFIG };
  }
}

export function saveSaasConfig(patch: Partial<SaasConfig>): SaasConfig {
  const current = getSaasConfig();
  const updated: SaasConfig = { ...current, ...patch };
  try {
    localStorage.setItem(SAAS_CONFIG_KEY, JSON.stringify(updated));
  } catch {
    // ignore quota error
  }
  return updated;
}

export function verifyAdminPin(enteredPin: string): boolean {
  const cfg = getSaasConfig();
  const trimmed = enteredPin.trim();
  if (!trimmed) return false;
  const candidateCommitment = deriveAdminPinCommitment(trimmed);
  if (cfg.adminPinHash) {
    const storedCommitment = cfg.adminPinHash.startsWith('arx1:')
      ? cfg.adminPinHash
      : deriveAdminPinCommitment(cfg.adminPinHash);
    return constantTimeEqual(candidateCommitment, storedCommitment);
  }
  // Default PIN commitment if not configured
  return constantTimeEqual(candidateCommitment, DEFAULT_ADMIN_PIN_COMMITMENT);
}

export function updateAdminPin(newPin: string): void {
  saveSaasConfig({ adminPinHash: deriveAdminPinCommitment(newPin) });
}
