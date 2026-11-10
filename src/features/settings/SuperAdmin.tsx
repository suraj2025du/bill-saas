import {
  Key,
  RefreshCw,
  Clipboard,
  Database,
  Shield,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Play,
  Check,
  ShieldAlert,
  Users,
  MessageSquare,
  MapPin,
  Phone,
  Globe,
  Lock,
  Unlock,
  DollarSign,
  Settings as SettingsIcon,
  Search,
  Download,
  Trash2,
  Copy,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { validateLicenseKey, generateLicenseKey } from '../../core/licensing';
import { getTenants, saveTenants, updateTenantPlan, getLeadWebhookUrl, setLeadWebhookUrl, dispatchLeadNotification, type SaasTenant } from '../../core/tenants';
import { getSaasConfig, saveSaasConfig, verifyAdminPin, updateAdminPin, type SaasConfig } from '../../core/saasConfig';
import { QrSvg, upiLink } from '../../print/codes';
import { updateSettings } from '../../store/actions';
import { useSettings } from '../../store/hooks';
import { useStore, commit } from '../../store/store';
import { attempt, toast } from '../../ui/feedback';
import {
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Select,
  TextInput,
} from '../../ui/kit';
import {
  newProduct,
  newParty,
  newSalesDocument,
  newLedger,
} from '../../core/factories';
import { putOp } from '../../data/adapter';

export function SuperAdminPage() {
  const settings = useSettings();
  const data = useStore((s) => s.data);

  // Authentication State with Master PIN
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem('billsaas_superadmin_auth') === 'true';
  });
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  // SaaS Master Config State
  const [saasConfig, setSaasConfigState] = useState<SaasConfig>(() => getSaasConfig());
  const [newPinInput, setNewPinInput] = useState('');

  const [tenants, setTenants] = useState(() => getTenants());
  const [webhookUrl, setWebhookUrlInput] = useState(() => getLeadWebhookUrl());
  const [testingWebhook, setTestingWebhook] = useState(false);

  const handleUnlock = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (verifyAdminPin(pinInput)) {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('billsaas_superadmin_auth', 'true');
      }
      setIsAuthenticated(true);
      setPinError('');
      toast.success('SuperAdmin Portal Unlocked!');
    } else {
      setPinError('Invalid Master PIN! Please try again.');
      toast.error('Galat PIN! Access denied.');
    }
  };

  const handleLockSession = () => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('billsaas_superadmin_auth');
    }
    setIsAuthenticated(false);
    setPinInput('');
    toast.success('Admin Session Locked.');
  };

  const handleSaveSaasConfig = () => {
    saveSaasConfig(saasConfig);
    if (newPinInput.trim()) {
      if (newPinInput.trim().length < 4) {
        toast.error('Naya PIN kam se kam 4 characters ka hona chahiye.');
        return;
      }
      updateAdminPin(newPinInput.trim());
      setNewPinInput('');
      toast.success('SaaS Settings aur Naya Master PIN successfully update ho gaya!');
    } else {
      toast.success('SaaS Global Settings (WhatsApp, UPI, Pricing) successfully update ho gayi!');
    }
  };

  const handleUpgradeTenant = (id: string, plan: 'MONTHLY' | 'STARTER' | 'ENTERPRISE') => {
    updateTenantPlan(id, plan);
    setTenants(getTenants());
    toast.success(`Tenant upgraded to ${plan} successfully!`);
  };

  const handleSaveWebhook = () => {
    setLeadWebhookUrl(webhookUrl);
    toast.success('SaaS Lead Sync Webhook URL updated successfully! Naye registrations ab directly is URL par post honge.');
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl.trim()) {
      toast.error('Kripya pehle ek Webhook URL dakhil karein.');
      return;
    }
    setTestingWebhook(true);
    setLeadWebhookUrl(webhookUrl);
    
    const testTenant = {
      id: 'tenant_test',
      shopName: 'Test Dukaan India',
      ownerName: 'Suraj Admin Test',
      phone: '9999999999',
      city: 'Delhi',
      stateCode: '07',
      plan: 'TRIAL' as const,
      invoicesCount: 1,
      registeredAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    
    const success = await dispatchLeadNotification(testTenant);
    setTestingWebhook(false);
    if (success) {
      toast.success('Test notification sent! Apne webhook logs (Discord, Telegram or Zapier) check karein.');
    } else {
      toast.error('Test dispatch failed. Check network or URL CORS parameters.');
    }
  };

  const [inputKey, setInputKey] = useState('');
  const [ownerName, setOwnerName] = useState('');
  
  // Key Generator State
  const [genType, setGenType] = useState<'MONTHLY' | 'STARTER' | 'ENTERPRISE'>('MONTHLY');
  const [generatedKey, setGeneratedKey] = useState('');
  
  // Diagnostics State
  const [diagnosticResult, setDiagnosticResult] = useState<{
    ran: boolean;
    errors: string[];
    warnings: string[];
    integrityScore: number;
  } | null>(null);

  const licenseType = settings.licenseType || 'TRIAL';
  const licenseExpiry = settings.licenseExpiry || '';
  const licenseOwner = settings.licenseOwner || '';
  const licenseKey = settings.licenseKey || '';

  // Calculate days remaining
  const daysRemaining = (() => {
    if (!licenseExpiry) return 0;
    const diff = Date.parse(licenseExpiry) - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  })();

  const handleActivate = async () => {
    if (!inputKey.trim()) {
      toast.info('Please enter an activation key.');
      return;
    }

    const res = validateLicenseKey(inputKey);
    if (!res.valid) {
      toast.error(res.error || 'Invalid key.');
      return;
    }

    const tierName =
      res.type === 'MONTHLY'
        ? 'Dukaan Monthly (30 Days)'
        : res.type === 'STARTER'
        ? 'Vyapaar Starter (1 Year)'
        : 'Business Pro Annual (1 Year Unlimited)';
    const now = new Date();
    const d = new Date(now);
    if (res.type === 'MONTHLY') {
      d.setDate(d.getDate() + 30);
    } else {
      d.setDate(d.getDate() + 365);
    }
    const expiryDate = d.toISOString().split('T')[0];

    await attempt(async () => {
      await updateSettings({
        licenseType: res.type!,
        licenseKey: inputKey.trim().toUpperCase(),
        licenseOwner: ownerName.trim() || 'Premium SaaS Subscriber',
        licenseExpiry: expiryDate,
        licenseActivatedAt: now.toISOString().split('T')[0],
        licenseDisabled: false,
        licenseDisabledReason: '',
        securityTamperDetected: false,
        lastVerifiedClock: now.toISOString(),
      });
      setInputKey('');
      setOwnerName('');
    }, `${tierName} License Activated Successfully! Enjoy premium capabilities.`);
  };

  // SuperAdmin Navigation Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'crm' | 'keys' | 'payments' | 'diagnostics'>('overview');

  // CRM Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState<'ALL' | 'TRIAL' | 'MONTHLY' | 'STARTER' | 'ENTERPRISE'>('ALL');

  // Key Generator History
  const [generatedKeysList, setGeneratedKeysList] = useState<Array<{ id: string; key: string; plan: 'MONTHLY' | 'STARTER' | 'ENTERPRISE'; createdAt: string }>>([]);

  const handleExportCsv = () => {
    if (tenants.length === 0) {
      toast.info('No tenants to export.');
      return;
    }
    const headers = ['ID', 'Shop Name', 'Owner Name', 'Phone', 'City', 'State Code', 'GSTIN', 'Plan', 'Invoices Count', 'Registered At', 'Last Active At'];
    const rows = tenants.map((t) => [
      t.id,
      `"${t.shopName.replace(/"/g, '""')}"`,
      `"${t.ownerName.replace(/"/g, '""')}"`,
      `"${t.phone}"`,
      `"${t.city.replace(/"/g, '""')}"`,
      t.stateCode,
      t.gstin || '',
      t.plan,
      t.invoicesCount,
      t.registeredAt,
      t.lastActiveAt,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `BillSaaS_Tenants_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Customer CRM list exported to CSV successfully!');
  };

  const handleDeleteTenant = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to remove customer lead "${name}"?`)) {
      const updated = tenants.filter((t) => t.id !== id);
      saveTenants(updated);
      setTenants(updated);
      toast.success(`Tenant ${name} removed.`);
    }
  };

  const handleAddSampleTenant = () => {
    const sample: SaasTenant = {
      id: `tenant_${Date.now().toString(36)}`,
      shopName: 'Aggarwal Sweets & Namkeen',
      ownerName: 'Manoj Aggarwal',
      phone: '9811223344',
      city: 'Ghaziabad',
      stateCode: '09',
      gstin: '09AAACA1234A1Z1',
      plan: 'TRIAL',
      invoicesCount: 8,
      registeredAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    const updated = [sample, ...tenants];
    saveTenants(updated);
    setTenants(updated);
    toast.success('Sample customer added to CRM!');
  };

  const handleGenerateKey = () => {
    const key = generateLicenseKey(genType);
    setGeneratedKey(key);
    setGeneratedKeysList((prev) => [
      { id: Date.now().toString(), key, plan: genType, createdAt: new Date().toLocaleTimeString() },
      ...prev,
    ]);
    toast.success(`${genType} License key generated successfully.`);
  };

  const handleGenerateBulkKeys = () => {
    const batch = Array.from({ length: 5 }, () => ({
      id: `${Date.now()}_${Math.random()}`,
      key: generateLicenseKey(genType),
      plan: genType,
      createdAt: new Date().toLocaleTimeString(),
    }));
    setGeneratedKeysList((prev) => [...batch, ...prev]);
    toast.success(`Generated 5 batch ${genType} keys!`);
  };

  const handleCopyKey = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    toast.success('Key copied to clipboard!');
  };

  const handleDiagnostics = () => {
    const errs: string[] = [];
    const warns: string[] = [];

    // Verify references integrity
    const bizIds = new Set(data.businesses.map((b) => b.id));
    
    data.invoices.forEach((inv) => {
      if (!bizIds.has(inv.businessId)) {
        errs.push(`Invoice ${inv.number} refers to missing business ID ${inv.businessId}.`);
      }
    });

    data.products.forEach((p) => {
      if (!bizIds.has(p.businessId)) {
        errs.push(`Product "${p.name}" refers to missing business ID ${p.businessId}.`);
      }
    });

    data.ledgers.forEach((l) => {
      if (!bizIds.has(l.businessId)) {
        errs.push(`Ledger "${l.name}" refers to missing business ID ${l.businessId}.`);
      }
    });

    // Check duplicate invoice numbers per business
    const invMap = new Map<string, string[]>();
    data.invoices.forEach((inv) => {
      const key = `${inv.businessId}-${inv.docType}-${inv.number}`;
      if (invMap.has(key)) {
        invMap.get(key)!.push(inv.id);
      } else {
        invMap.set(key, [inv.id]);
      }
    });

    invMap.forEach((ids, key) => {
      if (ids.length > 1) {
        warns.push(`Duplicate active invoice numbers found for key prefix "${key}": IDs [${ids.join(', ')}].`);
      }
    });

    const score = Math.max(0, 100 - errs.length * 15 - warns.length * 5);
    setDiagnosticResult({
      ran: true,
      errors: errs,
      warnings: warns,
      integrityScore: score,
    });
    toast.success('Diagnostics completed.');
  };

  const handleSeedDemoData = async (bizId: string) => {
    const confirmSeed = window.confirm('Are you sure you want to seed professional demo data for this business? This will add products, parties, ledger groups, and sales documents to showcase software capabilities.');
    if (!confirmSeed) return;

    await attempt(async () => {
      // 1. Create Demo Products
      const p1 = newProduct(bizId, { name: 'Premium Office Laptop i7', hsn: '84713010', sellingPrice: 75000, cessRate: 0, unit: 'PCS', gstRate: 18 });
      const p2 = newProduct(bizId, { name: 'Ergonomic Mesh Chair', hsn: '94033000', sellingPrice: 12000, cessRate: 0, unit: 'PCS', gstRate: 18 });
      const p3 = newProduct(bizId, { name: 'Cloud SaaS Setup & Consulting', hsn: '998313', sellingPrice: 25000, cessRate: 0, unit: 'SAC', gstRate: 18 });

      // 2. Create Demo Customers & Suppliers
      const c1 = newParty(bizId, {
        name: 'Acme Digital Solutions Pvt Ltd',
        gstin: '27AAAAA1111A1Z1',
        kind: 'CUSTOMER',
        billing: { line1: 'Corporate Park', line2: '', city: 'Mumbai', stateCode: '27', pincode: '400001', countryCode: 'IN' }
      });
      const s1 = newParty(bizId, {
        name: 'Wholesale Furniture Hub',
        gstin: '27BBBBB2222B2Z2',
        kind: 'SUPPLIER',
        billing: { line1: 'Furniture Market', line2: '', city: 'Mumbai', stateCode: '27', pincode: '400001', countryCode: 'IN' }
      });

      // 3. Create Demo Ledgers
      const l1 = newLedger(bizId, 'HDFC Salary Bank Account', 'BANK');
      const l2 = newLedger(bizId, 'Rent Expenses', 'INDIRECT_EXPENSES');

      // 4. Create standard Sales Invoices
      const business = data.businesses.find((b) => b.id === bizId)!;
      const doc1 = newSalesDocument(business, 'TAX_INVOICE', {
        date: new Date().toISOString().split('T')[0],
        partyId: c1.id,
        party: {
          name: c1.name,
          gstin: c1.gstin,
          pan: '',
          registration: 'REGULAR',
          address: { line1: 'Corporate Park', line2: '', city: 'Mumbai', stateCode: '27', pincode: '400001', countryCode: 'IN' },
          phone: '',
          email: '',
        },
        items: [
          {
            id: 'item-1',
            productId: p1.id,
            name: p1.name,
            description: '',
            hsn: p1.hsn,
            qty: 2,
            rate: 75000,
            unit: 'PCS',
            discountPct: 5,
            gstRate: 18,
            cessRate: 0,
            taxable: 142500,
            cgst: 12825,
            sgst: 12825,
            utgst: 0,
            igst: 0,
            cess: 0,
            total: 168150,
            godownId: '',
            batchNo: '',
          },
          {
            id: 'item-2',
            productId: p3.id,
            name: p3.name,
            description: '',
            hsn: p3.hsn,
            qty: 1,
            rate: 25000,
            unit: 'SAC',
            discountPct: 0,
            gstRate: 18,
            cessRate: 0,
            taxable: 25000,
            cgst: 2250,
            sgst: 2250,
            utgst: 0,
            igst: 0,
            cess: 0,
            total: 29500,
            godownId: '',
            batchNo: '',
          },
        ],
      });

      // Assemble batch updates using putOp adaptors
      const batch = {
        puts: [
          putOp('products', p1),
          putOp('products', p2),
          putOp('products', p3),
          putOp('clients', c1),
          putOp('clients', s1),
          putOp('ledgers', l1),
          putOp('ledgers', l2),
          putOp('invoices', doc1),
        ],
        removes: [],
      };

      await commit(batch);
    }, 'Professional demo data seeded successfully!');
  };

  const handleResetTrial = async () => {
    const confirmReset = window.confirm('Are you sure you want to reset the licensing state back to TRIAL? This will wipe the active subscription details, but keep your data intact.');
    if (!confirmReset) return;

    await attempt(async () => {
      const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await updateSettings({
        licenseType: 'TRIAL',
        licenseKey: '',
        licenseOwner: '',
        licenseExpiry: thirtyDaysLater,
        licenseActivatedAt: '',
      });
    }, 'Subscription reset to Trial Mode.');
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-white border border-slate-200 rounded-2xl shadow-xl text-center">
        <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-indigo-700 rounded-2xl mx-auto flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 mb-4">
          <ShieldAlert className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">SuperAdmin Control Gate</h2>
        <p className="text-xs text-slate-500 mt-1 mb-6">
          Security Protected. Enter Master PIN to access SaaS Key Generator, Revenue Metrics &amp; Tenant Database.
        </p>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <input
              type="password"
              autoFocus
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value);
                setPinError('');
              }}
              placeholder="Enter Master PIN (Default: admin8888)"
              className="w-full text-center text-lg tracking-widest font-mono py-2.5 px-4 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 placeholder:text-xs placeholder:tracking-normal placeholder:font-sans"
            />
            {pinError && <p className="text-xs text-red-600 font-semibold mt-1.5">{pinError}</p>}
          </div>

          <Button type="submit" variant="primary" className="w-full py-2.5 flex items-center justify-center gap-2">
            <Unlock className="h-4 w-4" /> Unlock Admin Portal
          </Button>
        </form>

        <p className="text-[11px] text-slate-400 mt-5">
          🔒 Master security protection ensures regular billing users cannot access key generation or modify licensing.
        </p>
      </div>
    );
  }

  // Calculate SaaS Commercial Metrics
  const monthlyCount = tenants.filter((t) => t.plan === 'MONTHLY').length;
  const starterCount = tenants.filter((t) => t.plan === 'STARTER').length;
  const enterpriseCount = tenants.filter((t) => t.plan === 'ENTERPRISE').length;
  const trialCount = tenants.filter((t) => t.plan === 'TRIAL').length;
  const monthlyRevenue = monthlyCount * saasConfig.monthlyPrice;
  const starterRevenue = starterCount * saasConfig.starterPrice;
  const enterpriseRevenue = enterpriseCount * saasConfig.enterprisePrice;
  const totalRevenue = monthlyRevenue + starterRevenue + enterpriseRevenue;

  const filteredTenants = tenants.filter((t) => {
    const matchesSearch =
      !searchQuery.trim() ||
      t.shopName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.ownerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.phone.includes(searchQuery) ||
      t.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.gstin && t.gstin.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesPlan = planFilter === 'ALL' || t.plan === planFilter;
    return matchesSearch && matchesPlan;
  });

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Super Admin SaaS &amp; Licensing"
        subtitle="Website Owner Control Center: CRM Leads, Pricing, UPI QR, License Keys, and Multi-Tenant Diagnostics."
        actions={
          <Button variant="ghost" onClick={handleLockSession} className="text-slate-500 hover:text-red-600 flex items-center gap-1.5">
            <Lock className="h-4 w-4" /> Lock Admin Session
          </Button>
        }
      />

      {/* SuperAdmin Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto bg-white p-1 rounded-xl shadow-sm border">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition whitespace-nowrap ${
            activeTab === 'overview'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <DollarSign className="h-4 w-4" /> 1. Overview &amp; Revenue
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('crm')}
          className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition whitespace-nowrap ${
            activeTab === 'crm'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="h-4 w-4" /> 2. Customer CRM ({tenants.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('keys')}
          className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition whitespace-nowrap ${
            activeTab === 'keys'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Key className="h-4 w-4" /> 3. License Studio &amp; Ledger
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('payments')}
          className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition whitespace-nowrap ${
            activeTab === 'payments'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <SettingsIcon className="h-4 w-4" /> 4. Payment &amp; UPI Setup
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('diagnostics')}
          className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition whitespace-nowrap ${
            activeTab === 'diagnostics'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Zap className="h-4 w-4" /> 5. Webhooks &amp; Database
        </button>
      </div>

      {/* TAB 1: OVERVIEW & REVENUE */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-4 bg-gradient-to-br from-indigo-50 to-white border-indigo-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-500 flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" /> Est. Gross Revenue
              </span>
              <div className="text-2xl font-black text-indigo-900 mt-1">
                ₹{totalRevenue.toLocaleString('en-IN')}
              </div>
              <span className="text-[10px] text-indigo-600 font-medium">Starter + Enterprise Paid</span>
            </Card>

            <Card className="p-4 bg-gradient-to-br from-emerald-50 to-white border-emerald-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> Total Customers
              </span>
              <div className="text-2xl font-black text-emerald-900 mt-1">
                {tenants.length}
              </div>
              <span className="text-[10px] text-emerald-600 font-medium">{trialCount} currently on Free Trial</span>
            </Card>

            <Card className="p-4 bg-gradient-to-br from-blue-50 to-white border-blue-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-500">
                Starter Active (₹{saasConfig.starterPrice}/yr)
              </span>
              <div className="text-2xl font-black text-blue-900 mt-1">
                {starterCount}
              </div>
              <span className="text-[10px] text-blue-600 font-medium">₹{starterRevenue.toLocaleString('en-IN')} collected</span>
            </Card>

            <Card className="p-4 bg-gradient-to-br from-purple-50 to-white border-purple-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-purple-600">
                Business Pro (₹{saasConfig.enterprisePrice}/yr)
              </span>
              <div className="text-2xl font-black text-purple-900 mt-1">
                {enterpriseCount}
              </div>
              <span className="text-[10px] text-purple-600 font-medium">₹{enterpriseRevenue.toLocaleString('en-IN')} collected</span>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <Card className="flex flex-col justify-between p-5 border-l-4 border-l-brand-500">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">License Status</span>
                  {licenseType === 'TRIAL' ? (
                    <Badge tone="amber">Trial Mode</Badge>
                  ) : licenseType === 'STARTER' ? (
                    <Badge tone="brand">Starter SaaS</Badge>
                  ) : (
                    <Badge tone="green">Enterprise Pro</Badge>
                  )}
                </div>
                <h3 className="text-2xl font-bold text-slate-800 capitalize">
                  {licenseType} tier
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {licenseType === 'TRIAL'
                    ? `Limited to 50 sales invoices. ${daysRemaining} days remaining.`
                    : licenseType === 'STARTER'
                    ? 'Limited to 500 sales invoices. Commercial use.'
                    : 'Unlimited invoices & databases. SaaS Premium.'}
                </p>
              </div>
              {licenseType !== 'TRIAL' && (
                <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500">
                  <p><b>Owner:</b> {licenseOwner}</p>
                  <p className="truncate"><b>Key:</b> {licenseKey}</p>
                </div>
              )}
            </Card>

            <Card className="p-5 flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Database Size</span>
                <h3 className="text-2xl font-bold text-slate-800 mt-2">
                  {data.businesses.length} Businesses
                </h3>
                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <p>Invoices: <b>{data.invoices.length}</b></p>
                  <p>Products: <b>{data.products.length}</b></p>
                  <p>Ledgers: <b>{data.ledgers.length}</b></p>
                  <p>Vouchers: <b>{data.vouchers.length}</b></p>
                </div>
              </div>
              <div className="mt-4 pt-2">
                <Button size="sm" variant="ghost" className="w-full flex items-center justify-center gap-1" onClick={handleDiagnostics}>
                  <RefreshCw className="h-3 w-3" />
                  Verify Integrity
                </Button>
              </div>
            </Card>

            <Card className="p-5 flex flex-col justify-between bg-slate-50/50">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Licensing Restrictions</span>
                <div className="mt-2 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">TRIAL Invoice Count</span>
                    <span className="font-semibold text-slate-700">{data.invoices.filter((i) => i.docType === 'TAX_INVOICE' || i.docType === 'BILL_OF_SUPPLY').length} / 50</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    <div
                      className="bg-amber-500 h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, (data.invoices.filter((i) => i.docType === 'TAX_INVOICE' || i.docType === 'BILL_OF_SUPPLY').length / 50) * 100)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs mt-2">
                    <span className="text-slate-500">STARTER Invoice Count</span>
                    <span className="font-semibold text-slate-700">{data.invoices.filter((i) => i.docType === 'TAX_INVOICE' || i.docType === 'BILL_OF_SUPPLY').length} / 500</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5">
                    <div
                      className="bg-brand-500 h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, (data.invoices.filter((i) => i.docType === 'TAX_INVOICE' || i.docType === 'BILL_OF_SUPPLY').length / 500) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-2 space-y-2">
                {licenseType !== 'TRIAL' && (
                  <Button size="sm" variant="ghost" className="w-full text-red-500 hover:bg-red-50" onClick={handleResetTrial}>
                    Reset to Trial Mode
                  </Button>
                )}
                {settings.licenseDisabled ? (
                  <Button
                    size="sm"
                    variant="primary"
                    className="w-full text-xs flex items-center justify-center gap-1"
                    onClick={() =>
                      void attempt(
                        () =>
                          updateSettings({
                            licenseDisabled: false,
                            licenseDisabledReason: '',
                            securityTamperDetected: false,
                            lastVerifiedClock: new Date().toISOString(),
                          }),
                        'Software Unlocked Successfully!'
                      )
                    }
                  >
                    <Unlock className="h-3.5 w-3.5" /> Unlock Disabled Software
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full text-xs text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100 flex items-center justify-center gap-1"
                    onClick={() =>
                      void attempt(
                        () =>
                          updateSettings({
                            licenseDisabled: true,
                            licenseDisabledReason: `Aapka subscription samapt ho gaya hai. Kripya Dukaan Monthly (₹${saasConfig.monthlyPrice}/mo), Vyapaar Starter (₹${saasConfig.starterPrice}/yr) ya Business Pro Annual (₹${saasConfig.enterprisePrice}/yr) se renew karein.`,
                          }),
                        'Software Locked (Monthly Unpaid State Activated)!'
                      )
                    }
                  >
                    <Lock className="h-3.5 w-3.5" /> Test Monthly Unpaid Lock Screen
                  </Button>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: CUSTOMER CRM & WHATSAPP LEADS */}
      {activeTab === 'crm' && (
        <Card className="p-5 border-l-4 border-l-indigo-500 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-600" />
                Customer CRM &amp; WhatsApp Lead Pipeline
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage registered business owners, check their live invoices count, and dispatch instant license keys via WhatsApp.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={handleAddSampleTenant} className="text-xs flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Add Sample Lead
              </Button>
              <Button size="sm" variant="secondary" onClick={handleExportCsv} className="text-xs flex items-center gap-1">
                <Download className="h-3.5 w-3.5" /> Export to CSV
              </Button>
            </div>
          </div>

          {/* Search & Plan Filter Bar */}
          <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div className="flex-1 min-w-[220px] relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Shop, Owner, Phone, City or GSTIN..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 text-slate-800"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <span>Filter:</span>
              {(['ALL', 'TRIAL', 'MONTHLY', 'STARTER', 'ENTERPRISE'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlanFilter(p)}
                  className={`px-2.5 py-1 rounded text-xs transition ${
                    planFilter === p
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead>
                <tr className="border-b border-slate-200 font-semibold text-xs text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5">Shop &amp; Owner</th>
                  <th className="py-2.5">WhatsApp Contact</th>
                  <th className="py-2.5">City &amp; GSTIN</th>
                  <th className="py-2.5 text-center">Invoices</th>
                  <th className="py-2.5 text-center">Plan</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No matching customer leads found.
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((tenant) => {
                    const waUrl = `https://wa.me/91${tenant.phone.replace(/\D/g, '')}?text=Hello%20${encodeURIComponent(tenant.ownerName)}%20ji,%20thanks%20for%20registering%20on%20BillSaaS.%20Aapka%20trial%20active%20hai.%20Kya%20aapko%20GST%20billing%20ya%20print%20set%20karne%20me%20koi%20help%20chahiye?`;

                    const handleSendKeyWhatsApp = (targetPlan: 'MONTHLY' | 'STARTER' | 'ENTERPRISE') => {
                      const key = generateLicenseKey(targetPlan);
                      const planLabel = targetPlan === 'MONTHLY' ? 'Dukaan Monthly (30 Days)' : targetPlan === 'STARTER' ? 'Vyapaar Starter (1 Year)' : 'Business Pro Annual (1 Year Unlimited)';
                      const msg = `Namaste ${tenant.ownerName} ji, Aapka BillSaaS ${planLabel} key successfully activate ho gaya hai!\n\n🔑 Key: *${key}*\n\nApne Settings -> Activation ya Lock Screen me is key ko enter karein aur billing start karein. Thank you!`;
                      const url = `https://wa.me/91${tenant.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
                      window.open(url, '_blank');
                      toast.success(`${targetPlan} Key generated and WhatsApp dispatch opened!`);
                    };

                    return (
                      <tr key={tenant.id} className="hover:bg-slate-50/60 transition">
                        <td className="py-3">
                          <span className="block font-bold text-slate-800 text-sm">{tenant.shopName}</span>
                          <span className="block text-slate-500 font-medium">Owner: {tenant.ownerName}</span>
                        </td>
                        <td className="py-3">
                          <span className="block font-mono text-slate-700 flex items-center gap-1 font-semibold">
                            <Phone className="h-3 w-3 text-slate-400" /> {tenant.phone}
                          </span>
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-green-600 font-bold hover:underline mt-0.5"
                          >
                            <MessageSquare className="h-3 w-3" /> Chat on WhatsApp
                          </a>
                        </td>
                        <td className="py-3">
                          <span className="block text-slate-800 flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-slate-400" /> {tenant.city} (GST: {tenant.stateCode})
                          </span>
                          {tenant.gstin && <span className="block font-mono text-[10px] text-slate-400">{tenant.gstin}</span>}
                        </td>
                        <td className="py-3 text-center font-bold text-slate-800">{tenant.invoicesCount}</td>
                        <td className="py-3 text-center">
                          <Badge tone={tenant.plan === 'ENTERPRISE' ? 'green' : tenant.plan === 'STARTER' ? 'blue' : 'amber'}>
                            {tenant.plan}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {tenant.plan === 'TRIAL' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSendKeyWhatsApp('MONTHLY')}
                                  className="px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold text-[11px] transition"
                                >
                                  🗓️ Monthly Key
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSendKeyWhatsApp('STARTER')}
                                  className="px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-[11px] transition"
                                >
                                  ⚡ Starter Key
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSendKeyWhatsApp('ENTERPRISE')}
                                  className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-[11px] transition"
                                >
                                  👑 Business Pro Key
                                </button>
                              </>
                            )}
                            {tenant.plan === 'STARTER' && (
                              <button
                                type="button"
                                onClick={() => handleSendKeyWhatsApp('ENTERPRISE')}
                                className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-[11px] transition"
                              >
                                👑 Go Enterprise
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleUpgradeTenant(tenant.id, tenant.plan === 'TRIAL' ? 'STARTER' : 'ENTERPRISE')}
                              className="px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold text-[11px] transition"
                              title="Manual Upgrade without sending key"
                            >
                              Direct {tenant.plan === 'TRIAL' ? 'Starter' : 'Enterprise'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTenant(tenant.id, tenant.shopName)}
                              className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                              title="Delete Lead"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 3: LICENSE KEY STUDIO & LEDGER */}
      {activeTab === 'keys' && (
        <div className="space-y-6">
          {/* Key Generator Tool */}
          <Card className="p-5 bg-slate-900 border-slate-800 text-slate-100">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
              <Shield className="h-5 w-5 text-brand-400" />
              Cryptographic Key Generator Studio
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Generates genuine license keys with modular-31 checksum verification.
            </p>

            <div className="grid gap-4 sm:grid-cols-4 items-end">
              <Field label={<span className="text-slate-300">Target License Plan</span>}>
                <Select
                  className="bg-slate-800 border-slate-700 text-slate-100"
                  value={genType}
                  onValue={(v) => setGenType(v as 'MONTHLY' | 'STARTER' | 'ENTERPRISE')}
                  options={[
                    { value: 'MONTHLY', label: 'Dukaan Monthly (30 days, M signature)' },
                    { value: 'STARTER', label: 'Vyapaar Starter (1 Year, 500 limit, S signature)' },
                    { value: 'ENTERPRISE', label: 'Business Pro Annual (1 Year Unlimited, E signature)' },
                  ]}
                />
              </Field>
              <div>
                <Button className="w-full flex items-center justify-center gap-2" variant="primary" onClick={handleGenerateKey}>
                  <Zap className="h-4 w-4" />
                  Generate 1 Key
                </Button>
              </div>
              <div>
                <Button className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white" onClick={handleGenerateBulkKeys}>
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  Generate 5 Batch Keys
                </Button>
              </div>
              {generatedKey && (
                <div className="flex gap-2 p-2 bg-slate-800 rounded border border-slate-700 text-sm items-center justify-between">
                  <span className="font-mono text-brand-400 font-bold select-all truncate">{generatedKey}</span>
                  <button
                    onClick={handleCopyKey}
                    className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white shrink-0"
                    title="Copy Key"
                  >
                    <Clipboard className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </Card>

          {/* Generated Keys History Table */}
          {generatedKeysList.length > 0 && (
            <Card className="p-5">
              <h4 className="font-bold text-slate-800 text-sm mb-3">Recently Generated Keys in this Session:</h4>
              <div className="space-y-2">
                {generatedKeysList.map((item) => (
                  <div key={item.id} className="flex items-center justify-between bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <Badge tone={item.plan === 'ENTERPRISE' ? 'green' : 'blue'}>{item.plan}</Badge>
                      <span className="font-bold text-slate-800">{item.key}</span>
                      <span className="text-slate-400 text-[10px]">({item.createdAt})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(item.key);
                        toast.success(`Copied ${item.key}`);
                      }}
                      className="text-indigo-600 hover:text-indigo-800 font-sans font-semibold text-xs flex items-center gap-1"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Direct Key Activation Box */}
          <Card className="p-5">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <Key className="h-5 w-5 text-brand-500" />
              Manual Account License Activation
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Manually apply a key to the current business session.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Registered Owner Name or Email">
                <TextInput
                  placeholder="e.g. contact@business.com"
                  value={ownerName}
                  onValue={(v) => setOwnerName(v)}
                />
              </Field>
              <Field label="Cryptographic License Key">
                <TextInput
                  placeholder="e.g. SXXXX-XXXXX-XXXXX-XXXXX"
                  value={inputKey}
                  onValue={(v) => setInputKey(v)}
                />
              </Field>
            </div>

            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={handleActivate}>
                Verify &amp; Activate License
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 4: PAYMENT & UPI CONFIGURATION */}
      {activeTab === 'payments' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-5 md:col-span-2 border-l-4 border-l-indigo-600">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-1">
              <SettingsIcon className="h-5 w-5 text-indigo-600" />
              SaaS Payment, Support &amp; Pricing Configuration
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Yeh details customer ke upgrade dialog aur payment QR code par dynamically reflect hoti hain.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Admin WhatsApp Support Number">
                <TextInput
                  placeholder="e.g. 919876543210"
                  value={saasConfig.adminPhone}
                  onValue={(v) => setSaasConfigState({ ...saasConfig, adminPhone: v })}
                />
              </Field>
              <Field label="Admin UPI ID (VPA)">
                <TextInput
                  placeholder="e.g. billsaas@icici ya suraj@upi"
                  value={saasConfig.adminUpiVpa}
                  onValue={(v) => setSaasConfigState({ ...saasConfig, adminUpiVpa: v })}
                />
              </Field>
              <Field label="UPI Payee Name">
                <TextInput
                  placeholder="e.g. BillSaaS Pro"
                  value={saasConfig.adminPayeeName}
                  onValue={(v) => setSaasConfigState({ ...saasConfig, adminPayeeName: v })}
                />
              </Field>
              <Field label="Change Master Admin PIN">
                <TextInput
                  type="password"
                  placeholder="Leave empty to keep current"
                  value={newPinInput}
                  onValue={(v) => setNewPinInput(v)}
                />
              </Field>
              <Field label="Dukaan Monthly Plan Price (₹ / 30 Days)">
                <TextInput
                  type="number"
                  placeholder="199"
                  value={String(saasConfig.monthlyPrice)}
                  onValue={(v) => setSaasConfigState({ ...saasConfig, monthlyPrice: Number(v) || 199 })}
                />
              </Field>
              <Field label="Vyapaar Starter Plan Price (₹ / 1 Year)">
                <TextInput
                  type="number"
                  placeholder="799"
                  value={String(saasConfig.starterPrice)}
                  onValue={(v) => setSaasConfigState({ ...saasConfig, starterPrice: Number(v) || 799 })}
                />
              </Field>
              <Field label="Business Pro Annual Price (₹ / 1 Year Unlimited)">
                <TextInput
                  type="number"
                  placeholder="1499"
                  value={String(saasConfig.enterprisePrice)}
                  onValue={(v) => setSaasConfigState({ ...saasConfig, enterprisePrice: Number(v) || 1499 })}
                />
              </Field>
            </div>

            <div className="mt-5 flex justify-end">
              <Button variant="primary" onClick={handleSaveSaasConfig}>
                Save SaaS Settings
              </Button>
            </div>
          </Card>

          {/* Real-Time Live QR Preview */}
          <Card className="p-5 flex flex-col items-center justify-center text-center bg-amber-50/40 border-amber-200">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-2">
              Live Customer QR Preview
            </span>
            <div className="bg-white p-3 rounded-xl border border-amber-300 shadow-sm">
              <QrSvg
                text={upiLink(saasConfig.adminUpiVpa, saasConfig.adminPayeeName, saasConfig.starterPrice, 'INR', 'BillSaaS Starter')}
                size={140}
                title="Scan to Test Pay"
              />
            </div>
            <p className="text-xs font-bold text-slate-800 mt-3">{saasConfig.adminPayeeName}</p>
            <p className="text-xs font-mono text-slate-500">{saasConfig.adminUpiVpa}</p>
            <span className="mt-2 text-[10px] text-slate-400">
              Apne mobile UPI app se scan karke VPA test karein.
            </span>
          </Card>
        </div>
      )}

      {/* TAB 5: WEBHOOKS & MULTI-TENANT DIAGNOSTICS */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-6">
          {/* Real-Time Lead Webhook */}
          <Card className="p-5 border-l-4 border-l-brand-500 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Globe className="h-5 w-5 text-brand-400" />
                  Real-Time Lead Webhook &amp; Mobile Alerts
                </h3>
                <p className="text-sm text-slate-300 mt-1">
                  Jab bhi koi naya customer live site par register karega, unki details directly aapke Webhook URL (Discord, Telegram Bot, Zapier, n8n ya Make) par post ho jayengi!
                </p>
              </div>
              <Badge tone="blue">Cloud CRM Sync</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-4 items-end mt-4">
              <div className="sm:col-span-3">
                <Field label={<span className="text-slate-200">Webhook POST Endpoint URL</span>}>
                  <TextInput
                    placeholder="https://discord.com/api/webhooks/... or https://hook.eu2.make.com/..."
                    value={webhookUrl}
                    onValue={(v) => setWebhookUrlInput(v)}
                    className="bg-slate-800 border-slate-700 text-white placeholder-slate-400 font-mono text-sm"
                  />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={handleSaveWebhook}
                >
                  Save URL
                </Button>
                <Button
                  variant="ghost"
                  disabled={testingWebhook}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-200 whitespace-nowrap"
                  onClick={() => { void handleTestWebhook(); }}
                >
                  {testingWebhook ? 'Testing...' : 'Test Ping'}
                </Button>
              </div>
            </div>
          </Card>

          {/* Client Businesses Inspector */}
          <Card className="p-5">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <Database className="h-5 w-5 text-slate-600" />
              Client Tenants &amp; Business Databases
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead>
                  <tr className="border-b border-slate-100 font-medium text-slate-400">
                    <th className="py-2">Business / Tenant Name</th>
                    <th className="py-2">GSTIN</th>
                    <th className="py-2 text-center">Tax Invoices</th>
                    <th className="py-2 text-center">Products</th>
                    <th className="py-2 text-center">Ledgers</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.businesses.map((biz) => {
                    const invCount = data.invoices.filter((i) => i.businessId === biz.id && (i.docType === 'TAX_INVOICE' || i.docType === 'BILL_OF_SUPPLY')).length;
                    const prodCount = data.products.filter((p) => p.businessId === biz.id).length;
                    const ledgerCount = data.ledgers.filter((l) => l.businessId === biz.id).length;
                    return (
                      <tr key={biz.id} className="hover:bg-slate-50/50">
                        <td className="py-3 pr-2 font-medium text-slate-800">{biz.name}</td>
                        <td className="py-3 font-mono">{biz.gstin || 'No GSTIN'}</td>
                        <td className="py-3 text-center font-semibold">{invCount}</td>
                        <td className="py-3 text-center">{prodCount}</td>
                        <td className="py-3 text-center">{ledgerCount}</td>
                        <td className="py-3 text-right">
                          <Button size="sm" variant="ghost" className="text-brand-500 hover:bg-brand-50 flex items-center gap-1 ml-auto" onClick={() => handleSeedDemoData(biz.id)}>
                            <Play className="h-3 w-3" />
                            Seed Demo Data
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Diagnostic Integrity Report */}
          {diagnosticResult && (
            <Card className="p-5 border-t-4 border-t-slate-800">
              <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Integrity Verification Diagnostic Report
              </h3>
              <p className="text-sm text-slate-500 mb-4">
                System checked database structure against cross-tenant isolation and invoice uniqueness standards.
              </p>

              <div className="flex items-center gap-4 mb-4">
                <div className="text-center p-3 bg-slate-100 rounded-lg min-w-24">
                  <span className="block text-xs uppercase text-slate-400 font-semibold">Integrity Score</span>
                  <span className="text-3xl font-extrabold text-slate-800">{diagnosticResult.integrityScore}%</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    {diagnosticResult.integrityScore === 100 ? 'Database Integrity Perfect' : 'Review Warnings & Anomalies Below'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Processed {data.businesses.length} businesses, {data.invoices.length} total invoice vouchers, and {data.ledgers.length} ledger postings.
                  </p>
                </div>
              </div>

              {diagnosticResult.errors.length > 0 && (
                <div className="space-y-2 mb-4">
                  <span className="text-xs font-bold text-red-500 uppercase flex items-center gap-1">
                    <ShieldAlert className="h-4 w-4" /> Errors ({diagnosticResult.errors.length})
                  </span>
                  <ul className="text-xs bg-red-50/50 p-3 rounded border border-red-100 text-red-700 list-disc list-inside space-y-1">
                    {diagnosticResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {diagnosticResult.warnings.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-yellow-600 uppercase flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Warnings ({diagnosticResult.warnings.length})
                  </span>
                  <ul className="text-xs bg-yellow-50/50 p-3 rounded border border-yellow-100 text-yellow-800 list-disc list-inside space-y-1">
                    {diagnosticResult.warnings.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}

              {diagnosticResult.errors.length === 0 && diagnosticResult.warnings.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50/50 border border-green-100 p-3 rounded">
                  <Check className="h-4 w-4 stroke-[3px]" />
                  No dangling business pointers or duplicate invoice identifiers found in current database session.
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
