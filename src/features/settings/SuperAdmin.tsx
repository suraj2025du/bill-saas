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
  Store,
  Globe,
} from 'lucide-react';
import { useState } from 'react';
import { validateLicenseKey, generateLicenseKey } from '../../core/licensing';
import { getTenants, updateTenantPlan, getLeadWebhookUrl, setLeadWebhookUrl, dispatchLeadNotification } from '../../core/tenants';
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

  const [tenants, setTenants] = useState(() => getTenants());
  const [webhookUrl, setWebhookUrlInput] = useState(() => getLeadWebhookUrl());
  const [testingWebhook, setTestingWebhook] = useState(false);

  const handleUpgradeTenant = (id: string, plan: 'STARTER' | 'ENTERPRISE') => {
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
  const [genType, setGenType] = useState<'STARTER' | 'ENTERPRISE'>('STARTER');
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

    const tierName = res.type === 'STARTER' ? 'Starter' : 'Enterprise';
    const expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 1 Year

    await attempt(async () => {
      await updateSettings({
        licenseType: res.type!,
        licenseKey: inputKey.trim().toUpperCase(),
        licenseOwner: ownerName.trim() || 'Premium SaaS Subscriber',
        licenseExpiry: expiryDate,
        licenseActivatedAt: new Date().toISOString().split('T')[0],
      });
      setInputKey('');
      setOwnerName('');
    }, `${tierName} License Activated Successfully! Enjoy premium capabilities.`);
  };

  const handleGenerateKey = () => {
    const key = generateLicenseKey(genType);
    setGeneratedKey(key);
    toast.success(`${genType} License key generated successfully.`);
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

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Super Admin SaaS & Licensing"
        subtitle="Configure commercial packaging, license activations, and multi-tenant diagnostics."
      />

      {/* 1. SaaS Status Card */}
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
                <span className="font-semibold text-slate-700">{data.invoices.filter((i) => i.docType === 'TAX_INVOICE').length} / 50</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div
                  className="bg-amber-500 h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, (data.invoices.filter((i) => i.docType === 'TAX_INVOICE').length / 50) * 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs mt-2">
                <span className="text-slate-500">STARTER Invoice Count</span>
                <span className="font-semibold text-slate-700">{data.invoices.filter((i) => i.docType === 'TAX_INVOICE').length} / 500</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div
                  className="bg-brand-500 h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, (data.invoices.filter((i) => i.docType === 'TAX_INVOICE').length / 500) * 100)}%` }}
                />
              </div>
            </div>
          </div>
          {licenseType !== 'TRIAL' && (
            <div className="mt-4 pt-2">
              <Button size="sm" variant="ghost" className="w-full text-red-500 hover:bg-red-50" onClick={handleResetTrial}>
                Reset to Trial Mode
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* 2. Activation Panel */}
      <Card className="p-5">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
          <Key className="h-5 w-5 text-brand-500" />
          Activate Commercial License Key
        </h3>
        <p className="text-sm text-slate-500 mb-4">
          Unlock commercial SaaS billing tiers instantly. Our license engine verifies cryptographic checksum activation parameters.
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
            Verify & Activate License
          </Button>
        </div>
      </Card>

      {/* 3. Cryptographic Key Generator (Secret Tool) */}
      <Card className="p-5 bg-slate-900 border-slate-800 text-slate-100">
        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
          <Shield className="h-5 w-5 text-brand-400" />
          Admin Cryptographic Key Generator
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          Generates valid license keys matching offline-cryptographic modulus 31 validation logic.
        </p>

        <div className="grid gap-4 sm:grid-cols-3 items-end">
          <Field label={<span className="text-slate-300">Select License Tier</span>}>
            <Select
              className="bg-slate-800 border-slate-700 text-slate-100"
              value={genType}
              onValue={(v) => setGenType(v as 'STARTER' | 'ENTERPRISE')}
              options={[
                { value: 'STARTER', label: 'Starter (500 limit, S signature)' },
                { value: 'ENTERPRISE', label: 'Enterprise (Unlimited, E signature)' },
              ]}
            />
          </Field>
          <div>
            <Button className="w-full flex items-center justify-center gap-2" variant="primary" onClick={handleGenerateKey}>
              <Zap className="h-4 w-4" />
              Generate Production Key
            </Button>
          </div>
          {generatedKey && (
            <div className="flex gap-2 p-2 bg-slate-800 rounded border border-slate-700 text-sm items-center justify-between">
              <span className="font-mono text-brand-400 font-bold select-all">{generatedKey}</span>
              <button
                onClick={handleCopyKey}
                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
                title="Copy Key"
              >
                <Clipboard className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* 3.5 SaaS Registered Tenants & WhatsApp Leads */}
      <Card className="p-5 border-l-4 border-l-indigo-500">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            SaaS Registered Customers &amp; WhatsApp Leads
          </h3>
          <Badge tone="blue">{tenants.length} Registered Tenants</Badge>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Jab bhi koi naya customer live site par trial account register karega, unka shop name, owner name, WhatsApp number aur city details automatically yahan sync ho jayengi. Aap unhe direct message karke sales leads convert kar sakte hain.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead>
              <tr className="border-b border-slate-100 font-medium text-slate-400">
                <th className="py-2">Owner &amp; Shop Name</th>
                <th className="py-2">WhatsApp Contact</th>
                <th className="py-2">City &amp; State</th>
                <th className="py-2 text-center">Invoices</th>
                <th className="py-2 text-center">Plan Status</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenants.map((tenant) => {
                const waUrl = `https://wa.me/91${tenant.phone.replace(/\D/g, '')}?text=Hello%20${encodeURIComponent(tenant.ownerName)}%20ji,%20thanks%20for%20registering%20on%20BillSaaS.%20Aapka%20trial%20active%20hai.%20Kya%20aapko%20GST%20billing%20ya%20print%20set%20karne%20me%20koi%20help%20chahiye?`;
                return (
                  <tr key={tenant.id} className="hover:bg-slate-50/50">
                    <td className="py-3">
                      <span className="block font-semibold text-slate-800">{tenant.ownerName}</span>
                      <span className="block text-xs text-slate-500 flex items-center gap-1">
                        <Store className="h-3.5 w-3.5 inline text-slate-400" /> {tenant.shopName}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="block font-mono text-slate-700 flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5 text-slate-400" /> {tenant.phone}
                      </span>
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-green-600 font-bold hover:underline mt-0.5"
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> Chat on WhatsApp
                      </a>
                    </td>
                    <td className="py-3">
                      <span className="block text-slate-800 flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-slate-400" /> {tenant.city}
                      </span>
                      <span className="block text-xs text-slate-500">GST Code: {tenant.stateCode}</span>
                    </td>
                    <td className="py-3 text-center font-bold text-slate-800">{tenant.invoicesCount}</td>
                    <td className="py-3 text-center">
                      <Badge tone={tenant.plan === 'ENTERPRISE' ? 'green' : tenant.plan === 'STARTER' ? 'blue' : 'amber'}>
                        {tenant.plan}
                      </Badge>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {tenant.plan === 'TRIAL' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-brand-600 hover:bg-brand-50"
                            onClick={() => handleUpgradeTenant(tenant.id, 'STARTER')}
                          >
                            Activate Starter
                          </Button>
                        )}
                        {tenant.plan !== 'ENTERPRISE' && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleUpgradeTenant(tenant.id, 'ENTERPRISE')}
                          >
                            Go Enterprise
                          </Button>
                        )}
                        {tenant.plan === 'ENTERPRISE' && (
                          <span className="text-xs text-green-600 font-bold flex items-center gap-0.5">
                            <Check className="h-3.5 w-3.5" /> Lifetime Active
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 4. Real-Time SaaS Lead Webhook & Mobile Alerts */}
      <Card className="p-5 border-l-4 border-l-brand-500 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Globe className="h-5 w-5 text-brand-400" />
              Real-Time Lead Webhook & Mobile Alerts
            </h3>
            <p className="text-sm text-slate-300 mt-1">
              Jab bhi koi naya customer live site par register karega, unki details (Shop, Owner, WhatsApp, City) directly aapke Webhook URL (Discord, Telegram Bot, Zapier, n8n ya Make) par post ho jayengi!
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

      {/* 4. Multi-Tenant Business Inspector */}
      <Card className="p-5">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
          <Database className="h-5 w-5 text-slate-600" />
          Client Tenants & Business Databases
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
                const invCount = data.invoices.filter((i) => i.businessId === biz.id && i.docType === 'TAX_INVOICE').length;
                const prodCount = data.products.filter((p) => p.businessId === biz.id).length;
                const ledgerCount = data.ledgers.filter((l) => l.businessId === biz.id).length;
                return (
                  <tr key={biz.id} className="hover:bg-slate-50/50">
                    <td className="py-3 pr-2 font-medium text-slate-800">{biz.name}</td>
                    <td className="py-3 text-mono">{biz.gstin || 'No GSTIN'}</td>
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

      {/* 5. Diagnostic Integrity Report */}
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
  );
}
