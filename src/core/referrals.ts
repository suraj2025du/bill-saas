/**
 * CA & Tax Practitioner Affiliate Referral Engine.
 * Enables local Chartered Accountants, Tax Advocates, and Business Consultants
 * to onboard clients with a partner referral code and earn 20% lifetime commission.
 */

export interface CaPartner {
  id: string;
  name: string;
  firmName: string;
  phone: string;
  city: string;
  referralCode: string;
  commissionRatePct: number; // Defaults to 20%
  totalReferredShops: number;
  totalEarningsInr: number;
  unpaidEarningsInr: number;
  upiVpa: string;
  createdAt: string;
}

export interface ReferralLead {
  id: string;
  partnerCode: string;
  shopName: string;
  ownerPhone: string;
  planPurchased: 'MONTHLY' | 'STARTER' | 'ENTERPRISE';
  amountPaidInr: number;
  commissionEarnedInr: number;
  date: string;
}

const STORAGE_PARTNERS_KEY = 'billsaas_ca_partners_v1';
const STORAGE_LEADS_KEY = 'billsaas_referral_leads_v1';

export function getCaPartners(): CaPartner[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_PARTNERS_KEY);
    if (!raw) {
      // Seed default demo CA partner
      const defaultPartner: CaPartner = {
        id: 'ca_default_01',
        name: 'CA Rajesh Aggarwal',
        firmName: 'Aggarwal & Associates',
        phone: '9811002233',
        city: 'Delhi',
        referralCode: 'CA-DELHI-101',
        commissionRatePct: 20,
        totalReferredShops: 4,
        totalEarningsInr: 1200,
        unpaidEarningsInr: 1200,
        upiVpa: 'rajeshca@oksbi',
        createdAt: '2026-11-01',
      };
      localStorage.setItem(STORAGE_PARTNERS_KEY, JSON.stringify([defaultPartner]));
      return [defaultPartner];
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveCaPartner(partner: CaPartner): void {
  const current = getCaPartners();
  const index = current.findIndex(p => p.id === partner.id);
  if (index >= 0) {
    current[index] = partner;
  } else {
    current.push(partner);
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_PARTNERS_KEY, JSON.stringify(current));
  }
}

export function registerReferralSale(params: {
  referralCode: string;
  shopName: string;
  ownerPhone: string;
  planPurchased: 'MONTHLY' | 'STARTER' | 'ENTERPRISE';
  amountPaid: number;
}): ReferralLead | null {
  const code = params.referralCode.trim().toUpperCase();
  const partners = getCaPartners();
  const partner = partners.find(p => p.referralCode.toUpperCase() === code);
  
  if (!partner) return null;

  const commission = Math.round((params.amountPaid * (partner.commissionRatePct || 20)) / 100);

  partner.totalReferredShops += 1;
  partner.totalEarningsInr += commission;
  partner.unpaidEarningsInr += commission;
  saveCaPartner(partner);

  const lead: ReferralLead = {
    id: 'ref_' + Date.now().toString(36),
    partnerCode: code,
    shopName: params.shopName,
    ownerPhone: params.ownerPhone,
    planPurchased: params.planPurchased,
    amountPaidInr: params.amountPaid,
    commissionEarnedInr: commission,
    date: new Date().toISOString().split('T')[0],
  };

  try {
    const rawLeads = localStorage.getItem(STORAGE_LEADS_KEY);
    const leads: ReferralLead[] = rawLeads ? JSON.parse(rawLeads) : [];
    leads.unshift(lead);
    localStorage.setItem(STORAGE_LEADS_KEY, JSON.stringify(leads));
  } catch {
    // ignore
  }

  return lead;
}
