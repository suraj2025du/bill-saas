export interface SaasTenant {
  id: string;
  shopName: string;
  ownerName: string;
  phone: string;
  city: string;
  stateCode: string;
  gstin?: string;
  plan: 'TRIAL' | 'STARTER' | 'ENTERPRISE';
  invoicesCount: number;
  registeredAt: string;
  lastActiveAt: string;
}

const STORAGE_KEY = 'bill_saas_registered_tenants_v1';

export function getTenants(): SaasTenant[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultTenants();
    const parsed = JSON.parse(raw) as SaasTenant[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : getDefaultTenants();
  } catch {
    return getDefaultTenants();
  }
}

export function saveTenants(tenants: SaasTenant[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tenants));
  } catch {
    // Ignore storage quota errors
  }
}

export function registerTenant(input: {
  shopName: string;
  ownerName: string;
  phone: string;
  city: string;
  stateCode: string;
  gstin?: string;
}): SaasTenant {
  const tenants = getTenants();
  const existing = tenants.find((t) => t.phone === input.phone || (input.gstin && t.gstin === input.gstin));
  const now = new Date().toISOString();

  if (existing) {
    existing.shopName = input.shopName || existing.shopName;
    existing.ownerName = input.ownerName || existing.ownerName;
    existing.city = input.city || existing.city;
    existing.stateCode = input.stateCode || existing.stateCode;
    existing.lastActiveAt = now;
    saveTenants(tenants);
    return existing;
  }

  const newTenant: SaasTenant = {
    id: `tenant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    shopName: input.shopName,
    ownerName: input.ownerName,
    phone: input.phone,
    city: input.city,
    stateCode: input.stateCode,
    gstin: input.gstin || '',
    plan: 'TRIAL',
    invoicesCount: 0,
    registeredAt: now,
    lastActiveAt: now,
  };

  tenants.unshift(newTenant);
  saveTenants(tenants);
  void dispatchLeadNotification(newTenant);
  return newTenant;
}

export function updateTenantActivity(phoneOrId: string, count: number): void {
  const tenants = getTenants();
  const t = tenants.find((item) => item.id === phoneOrId || item.phone === phoneOrId);
  if (t) {
    t.invoicesCount = count;
    t.lastActiveAt = new Date().toISOString();
    saveTenants(tenants);
  }
}

export function updateTenantPlan(tenantId: string, plan: 'STARTER' | 'ENTERPRISE'): void {
  const tenants = getTenants();
  const t = tenants.find((item) => item.id === tenantId);
  if (t) {
    t.plan = plan;
    t.lastActiveAt = new Date().toISOString();
    saveTenants(tenants);
  }
}

function getDefaultTenants(): SaasTenant[] {
  return [
    {
      id: 'tenant_demo_1',
      shopName: 'Sharma General & Grocery Store',
      ownerName: 'Ramesh Sharma',
      phone: '9812345678',
      city: 'Kanpur',
      stateCode: '09',
      gstin: '09ABCDE1234F1Z5',
      plan: 'TRIAL',
      invoicesCount: 14,
      registeredAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      lastActiveAt: new Date().toISOString(),
    },
    {
      id: 'tenant_demo_2',
      shopName: 'Patel Electronics & Mobile Hub',
      ownerName: 'Jignesh Patel',
      phone: '9876543210',
      city: 'Ahmedabad',
      stateCode: '24',
      gstin: '24AAACP1234A1ZP',
      plan: 'STARTER',
      invoicesCount: 89,
      registeredAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      lastActiveAt: new Date().toISOString(),
    },
  ];
}

const WEBHOOK_KEY = 'bill_saas_lead_webhook_url';

export function getLeadWebhookUrl(): string {
  try {
    return localStorage.getItem(WEBHOOK_KEY) || '';
  } catch {
    return '';
  }
}

export function setLeadWebhookUrl(url: string): void {
  try {
    localStorage.setItem(WEBHOOK_KEY, url.trim());
  } catch {
    // ignore
  }
}

export async function dispatchLeadNotification(tenant: SaasTenant): Promise<boolean> {
  const webhookUrl = getLeadWebhookUrl();
  if (!webhookUrl) return false;

  try {
    const payload = {
      event: 'NEW_SAAS_TRIAL_SIGNUP',
      timestamp: new Date().toISOString(),
      tenant: {
        shopName: tenant.shopName,
        ownerName: tenant.ownerName,
        phone: tenant.phone,
        city: tenant.city,
        stateCode: tenant.stateCode,
        gstin: tenant.gstin || 'N/A',
        plan: tenant.plan,
        registeredAt: tenant.registeredAt,
      },
      text: `🚀 *New BillSaaS Signup Notification!*\n\n🏪 *Shop Name:* ${tenant.shopName}\n👤 *Owner Name:* ${tenant.ownerName}\n📱 *WhatsApp Contact:* +91 ${tenant.phone}\n📍 *City:* ${tenant.city} (GST Code: ${tenant.stateCode})\n⭐ *Plan Level:* ${tenant.plan}\n📅 *Registered At:* ${new Date(tenant.registeredAt).toLocaleString()}`,
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'no-cors',
    });
    return true;
  } catch (err) {
    console.error('[webhook] Lead notification failed:', err);
    return false;
  }
}
