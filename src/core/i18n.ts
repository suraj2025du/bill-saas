/**
 * Multi-Language Regional Localization Engine for BillSaaS Pro.
 * Supports English, Hindi (हिंदी), Gujarati (ગુજરાતી), and Marathi (मराठी).
 */

export type LanguageCode = 'en' | 'hi' | 'gu' | 'mr';

export interface LanguageOption {
  code: LanguageCode;
  label: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'mr', label: 'मराठी' },
];

const DICTIONARY: Record<LanguageCode, Record<string, string>> = {
  en: {
    dashboard: 'Dashboard',
    dailyBoard: 'Daily & Price Board',
    sales: 'Sales',
    invoices: 'Invoices & Documents',
    payments: 'Payments',
    parties: 'Parties & Customers',
    inventory: 'Inventory',
    products: 'Products',
    bulkEdit: 'Bulk Edit',
    stockValuation: 'Stock & Valuation',
    gstTax: 'GST & Tax',
    settings: 'Settings',
    trialActive: 'Free Trial Active',
    createBill: 'Create New Bill',
    mandiRates: 'Daily Mandi Rates',
    weatherInfo: 'Local Weather Status',
    storeSetup: 'Configure Store Profiles',
    helpSupport: 'Help & Merchant Support',
    customerKhata: 'Customer Udhaar Khata',
    totalBalance: 'Total Pending Balance',
    addPayment: 'Record Payment',
    whatsappShare: 'Share on WhatsApp',
    thermalPrint: 'Thermal Print',
    totalAmount: 'Total Amount',
  },
  hi: {
    dashboard: 'डैशबोर्ड (मुख्य)',
    dailyBoard: 'दैनिक भाव एवं मौसम',
    sales: 'बिक्री / सेल्स',
    invoices: 'इनवॉइस और दस्तावेज',
    payments: 'भुगतान रसीदें',
    parties: 'ग्राहक और पार्टियाँ',
    inventory: 'सामान / इन्वेंटरी',
    products: 'उत्पाद सूची',
    bulkEdit: 'एक साथ बदलाव करें',
    stockValuation: 'कुल स्टॉक मूल्यांकन',
    gstTax: 'जीएसटी और टैक्स',
    settings: 'सॉफ़्टवेयर सेटिंग्स',
    trialActive: 'फ्री ट्रायल चालू है',
    createBill: 'नया बिल बनाएं (F1)',
    mandiRates: 'आज के दैनिक मंडी भाव',
    weatherInfo: 'स्थानीय मौसम की जानकारी',
    storeSetup: 'दुकान की प्रोफाइल सेट करें',
    helpSupport: 'सहायता एवं कस्टमर केयर',
    customerKhata: 'ग्राहक उधारी खाता',
    totalBalance: 'कुल बकाया राशि',
    addPayment: 'भुगतान जमा करें',
    whatsappShare: 'व्हाट्सएप पर भेजें',
    thermalPrint: 'थर्मल प्रिंट रसीद',
    totalAmount: 'कुल राशि',
  },
  gu: {
    dashboard: 'ડેશબોર્ડ (મુખ્ય)',
    dailyBoard: 'દૈનિક બજાર ભાવ અને હવામાન',
    sales: 'વેચાણ / સેલ્સ',
    invoices: 'ઇન્વૉઇસ અને દસ્તાવેજો',
    payments: 'ચુકવણીઓ',
    parties: 'ગ્રાહકો અને પાર્ટીઓ',
    inventory: 'સ્ટોક / ઇન્વેન્ટરી',
    products: 'પ્રોડક્ટ્સ યાદી',
    bulkEdit: 'જથ્થાબંધ ફેરફાર',
    stockValuation: 'કુલ સ્ટોક મૂલ્યાંકન',
    gstTax: 'જીએસટી અને ટેક્સ',
    settings: 'સોફ્ટવેર સેટિંગ્સ',
    trialActive: 'ફ્રી ટ્રાયલ ચાલુ છે',
    createBill: 'નવું બિલ બનાવો',
    mandiRates: 'આજના દૈનિક બજાર ભાવ',
    weatherInfo: 'સ્થાનિક હવામાન માહિતી',
    storeSetup: 'દુકાનની પ્રોફાઇલ સેટ કરો',
    helpSupport: 'મદદ અને મર્ચન્ટ સપોર્ટ',
    customerKhata: 'ગ્રાહક ઉધાર ખાતું',
    totalBalance: 'કુલ બાકી રકમ',
    addPayment: 'ચુકવણી જમા કરો',
    whatsappShare: 'વોટ્સએપ પર મોકલો',
    thermalPrint: 'થર્મલ પ્રિન્ટ રસીદ',
    totalAmount: 'કુલ રકમ',
  },
  mr: {
    dashboard: 'डॅशबोर्ड (मुख्य)',
    dailyBoard: 'दैनिक बाजार भाव व हवामान',
    sales: 'विक्री / सेल्स',
    invoices: 'इनव्हॉइस आणि दस्तऐवज',
    payments: 'पेमेंट्स आणि पावत्या',
    parties: 'ग्राहक व व्यापारी मित्र',
    inventory: 'स्टॉक व माल',
    products: 'उत्पादन यादी',
    bulkEdit: 'एकत्र बदल करा',
    stockValuation: 'एकूण स्टॉक मूल्यांकन',
    gstTax: 'जीएसटी आणि टॅक्स',
    settings: 'सॉफ्टवेअर सेटिंग्स',
    trialActive: 'फ्री ट्रायल सुरू आहे',
    createBill: 'नवीन बिल तयार करा',
    mandiRates: 'आजचे दैनिक बाजार भाव',
    weatherInfo: 'हवामानाची सद्यस्थिती',
    storeSetup: 'दुकान प्रोफाइल सेट करा',
    helpSupport: 'मदत व ग्राहक सेवा',
    customerKhata: 'ग्राहक उधारी खाते',
    totalBalance: 'एकूण प्रलंबित रक्कम',
    addPayment: 'पेमेंट जमा करा',
    whatsappShare: 'व्हाट्सएपवर पाठवा',
    thermalPrint: 'थर्मल प्रिंट पावती',
    totalAmount: 'एकूण रक्कम',
  },
};

const STORAGE_LANG_KEY = 'billsaas_lang_v1';

export function getActiveLanguage(): LanguageCode {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = localStorage.getItem(STORAGE_LANG_KEY);
    if (saved && ['en', 'hi', 'gu', 'mr'].includes(saved)) {
      return saved as LanguageCode;
    }
  } catch {
    // ignore
  }
  return 'en';
}

export function setActiveLanguage(code: LanguageCode): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_LANG_KEY, code);
    } catch {
      // ignore
    }
  }
}

/**
 * Translator helper. Returns localized text for a key, falling back to English.
 */
export function t(key: string): string {
  const currentLang = getActiveLanguage();
  const translations = DICTIONARY[currentLang] || DICTIONARY['en'];
  return translations[key] || DICTIONARY['en'][key] || key;
}
