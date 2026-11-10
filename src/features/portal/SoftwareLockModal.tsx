import { useState } from 'react';
import {
  Lock,
  Copy,
  Zap,
  AlertOctagon,
  Crown,
} from 'lucide-react';
import {
  getSoftwareLockState,
  buildLicenseActivationPatch,
  verifyUpiUtrAndBuildActivation,
} from '../../core/licensing';
import { getSaasConfig, verifyAdminPin } from '../../core/saasConfig';
import { QrSvg, upiLink } from '../../print/codes';
import { useSettings, useBusiness } from '../../store/hooks';
import { updateSettings } from '../../store/actions';
import { toast } from '../../ui/feedback';

export function SoftwareLockModal() {
  const settings = useSettings();
  const biz = useBusiness();
  const saasConfig = getSaasConfig();

  const lockState = getSoftwareLockState(settings);

  const [selectedPlan, setSelectedPlan] = useState<'MONTHLY' | 'STARTER' | 'ENTERPRISE'>('STARTER');
  const [unlockKey, setUnlockKey] = useState('');
  const [upiUtr, setUpiUtr] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);

  // If software is not disabled, render nothing
  if (!lockState.disabled) {
    return null;
  }

  const currentPrice =
    selectedPlan === 'MONTHLY'
      ? saasConfig.monthlyPrice
      : selectedPlan === 'STARTER'
      ? saasConfig.starterPrice
      : saasConfig.enterprisePrice;

  const paymentUri = upiLink(
    saasConfig.adminUpiVpa,
    saasConfig.adminPayeeName,
    currentPrice,
    'INR',
    `BillSaaS Unlock - ${selectedPlan}`
  );

  const cleanPhone = saasConfig.adminPhone.replace(/\D/g, '');
  const waMsg = `Namaste! Mera BillSaaS software lock/disable ho gaya hai (${lockState.kind}). Maine ₹${currentPrice} (${selectedPlan}) UPI par pay kar diya hai. Kripya mera unlock key WhatsApp par bhein.
Vyapaar: ${biz?.name || settings.licenseOwner || 'My Business'}
Phone: ${biz?.phone || ''}`;
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;

  const handleUnlock = async () => {
    const rawKey = unlockKey.trim();
    if (!rawKey) {
      toast.error('Kripya apna License Key ya Master Unlock PIN dalein.');
      return;
    }

    setIsUnlocking(true);

    // 1. Check if Master Admin PIN was entered
    if (verifyAdminPin(rawKey)) {
      try {
        await updateSettings({
          licenseDisabled: false,
          licenseDisabledReason: '',
          securityTamperDetected: false,
          lastVerifiedClock: new Date().toISOString(),
        });
        toast.success('Master Admin PIN verify ho gaya! Software successfully unlock ho gaya hai.');
        setUnlockKey('');
      } catch (err) {
        toast.error('Unlock save error: ' + String(err));
      } finally {
        setIsUnlocking(false);
      }
      return;
    }

    // 2. Otherwise verify as cryptographic license key
    const res = buildLicenseActivationPatch(rawKey, biz?.name || settings.licenseOwner);
    if (!res.valid || !res.patch) {
      toast.error(res.error || 'Amanay (Invalid) Key! Kripya sahi key ya Master PIN dalein.');
      setIsUnlocking(false);
      return;
    }

    try {
      await updateSettings(res.patch);
      toast.success(`Mubarak ho! Software successfully unlock ho gaya hai (${res.type} Plan).`);
      setUnlockKey('');
    } catch (err) {
      toast.error('Unlock save error: ' + String(err));
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleUpiUtrUnlock = async () => {
    const res = verifyUpiUtrAndBuildActivation(
      upiUtr,
      selectedPlan,
      biz?.name || settings.licenseOwner || 'Indian MSME Subscriber',
    );
    if (!res.valid || !res.patch) {
      toast.error(res.error || 'Invalid 12-digit UPI UTR Number.');
      return;
    }
    setIsUnlocking(true);
    try {
      await updateSettings(res.patch);
      toast.success(`Payment Verified (UTR: ${res.utrClean})! Software unlocked till ${res.patch.licenseExpiry}.`);
      setUpiUtr('');
    } catch (err) {
      toast.error('Unlock save error: ' + String(err));
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl bg-slate-900 border-2 border-red-500/80 rounded-2xl shadow-2xl overflow-hidden my-auto text-slate-100">
        
        {/* Header Warning Bar */}
        <div className="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 px-6 py-4 flex items-center gap-3">
          <AlertOctagon className="h-7 w-7 text-white shrink-0 animate-bounce" />
          <div>
            <h2 className="text-lg font-black text-white tracking-wide uppercase">
              {lockState.kind === 'SECURITY_TAMPER'
                ? 'सुरक्षा चेतावनी • सॉफ़्टवेयर डिसेबल है (Security Tampered)'
                : 'मासिक पेमेंट समाप्त • सॉफ़्टवेयर डिसेबल है (Monthly Expired)'}
            </h2>
            <p className="text-xs text-white/90 font-medium">
              BillSaaS Pro Commercial Protection Engine
            </p>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-5 text-sm">
          
          {/* Detailed Hindi Alert Note */}
          <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-500/40 text-red-200 text-xs sm:text-sm leading-relaxed">
            <p className="font-bold mb-1 text-red-300">
              {lockState.kind === 'SECURITY_TAMPER'
                ? '⚠️ सुरक्षा कारणों से सॉफ़्टवेयर को लॉक कर दिया गया है:'
                : '⚠️ मासिक सब्सक्रिप्शन की समय सीमा समाप्त हो चुकी है:'}
            </p>
            <p className="text-slate-300">
              {lockState.kind === 'SECURITY_TAMPER'
                ? 'सिस्टम की तारीख़ (Clock Rollback) या लाइसेंस फ़ाइलों में छेड़छाड़ पाई गई है। सॉफ़्टवेयर को दोबारा चालू करने के लिए व्यवस्थापक (Admin) द्वारा नया लाइसेंस की दर्ज करें।'
                : `सॉफ़्टवेयर का उपयोग जारी रखने के लिए अपना प्लान रिन्यू करें: Dukaan Monthly (₹${saasConfig.monthlyPrice}/माह), Vyapaar Starter (₹${saasConfig.starterPrice}/साल), या Business Pro Annual (₹${saasConfig.enterprisePrice}/साल Unlimited)।`}
            </p>
          </div>

          {/* Quick Plan Switcher (3 Recurring MSME Plans — No Lifetime Plan) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => setSelectedPlan('MONTHLY')}
              className={`p-3 rounded-xl border text-left transition ${
                selectedPlan === 'MONTHLY'
                  ? 'border-indigo-500 bg-indigo-950/60 ring-2 ring-indigo-500/40'
                  : 'border-slate-700 bg-slate-800/40'
              }`}
            >
              <div className="text-[11px] font-bold text-amber-400">🏪 Dukaan Monthly</div>
              <div className="text-lg font-black text-white mt-0.5">₹{saasConfig.monthlyPrice}<span className="text-[10px] font-normal text-slate-400">/mo</span></div>
              <div className="text-[10px] text-slate-400 mt-1">30 Days • 250 Bills</div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedPlan('STARTER')}
              className={`p-3 rounded-xl border text-left transition ${
                selectedPlan === 'STARTER'
                  ? 'border-indigo-400 bg-indigo-950/70 ring-2 ring-indigo-400/40'
                  : 'border-slate-700 bg-slate-800/40'
              }`}
            >
              <div className="text-[11px] font-bold text-indigo-300">⭐ Vyapaar Starter</div>
              <div className="text-lg font-black text-white mt-0.5">₹{saasConfig.starterPrice}<span className="text-[10px] font-normal text-slate-400">/yr</span></div>
              <div className="text-[10px] text-slate-400 mt-1">1 Year • 500 Bills</div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedPlan('ENTERPRISE')}
              className={`p-3 rounded-xl border text-left transition ${
                selectedPlan === 'ENTERPRISE'
                  ? 'border-amber-500 bg-amber-950/60 ring-2 ring-amber-500/40'
                  : 'border-slate-700 bg-slate-800/40'
              }`}
            >
              <div className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                <Crown className="h-3 w-3" /> Business Pro (1 Yr)
              </div>
              <div className="text-lg font-black text-amber-300 mt-0.5">₹{saasConfig.enterprisePrice}<span className="text-[10px] font-normal text-slate-400">/yr</span></div>
              <div className="text-[10px] text-slate-400 mt-1">1 Year • Unlimited Bills</div>
            </button>
          </div>

          {/* Scannable UPI QR & Instant 12-Digit UTR Self-Serve Unlock */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-center gap-4">
            <div className="p-1.5 bg-white rounded-lg shrink-0 flex flex-col items-center">
              <QrSvg text={paymentUri} size={90} title="Scan to Unlock" />
              <span className="text-[9px] font-bold text-slate-700 mt-0.5">Scan UPI</span>
            </div>
            <div className="flex-1 text-xs space-y-2 w-full">
              <div className="font-bold text-slate-200">
                Pay ₹{currentPrice} for {selectedPlan === 'MONTHLY' ? 'Dukaan Monthly (30 Days)' : selectedPlan === 'STARTER' ? 'Vyapaar Starter (1 Year)' : 'Business Pro Annual (1 Year Unlimited)'}
              </div>
              <div className="flex items-center gap-1.5 font-mono text-slate-400 bg-slate-800/80 px-2 py-1 rounded">
                <span className="truncate">{saasConfig.adminUpiVpa}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(saasConfig.adminUpiVpa);
                    toast.success('UPI ID copied!');
                  }}
                  className="text-indigo-400"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  maxLength={12}
                  value={upiUtr}
                  onChange={(e) => setUpiUtr(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter 12-digit UPI UTR / Ref No."
                  className="flex-1 bg-slate-900 border border-emerald-600/60 px-2.5 py-1.5 rounded font-mono text-xs text-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleUpiUtrUnlock}
                  disabled={isUnlocking}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded text-[11px] transition shrink-0"
                >
                  ⚡ Verify UTR
                </button>
              </div>
              <div>
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-emerald-300 font-bold px-2.5 py-1 rounded text-[11px] transition"
                >
                  💬 Or Send Screenshot on WhatsApp
                </a>
              </div>
            </div>
          </div>

          {/* Instant Unlock Key / Admin PIN Form */}
          <div className="pt-2 border-t border-slate-800">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-indigo-400" /> Enter Activation Key or Master Admin PIN to Unlock:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={unlockKey}
                onChange={(e) => setUnlockKey(e.target.value)}
                placeholder="MXXXX-XXXXX-XXXXX-XXXXX or Admin PIN"
                className="flex-1 bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg font-mono text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleUnlock}
                disabled={isUnlocking}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2 rounded-lg text-xs transition flex items-center gap-1 shadow"
              >
                <Zap className="h-3.5 w-3.5" />
                {isUnlocking ? 'Unlocking...' : 'Unlock Now'}
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
