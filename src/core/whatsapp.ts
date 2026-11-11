/**
 * WhatsApp Integration & Communication Templates for BillSaaS Pro.
 * Facilitates direct 1-click sharing of Invoices and Outstanding Khata balances
 * with prefilled localized Indian merchant messages and direct payment links.
 */

import { getSaasConfig } from './saasConfig';

/**
 * Sanitizes phone number to standard Indian 10-digit format (adding 91 prefix)
 */
export function sanitizeIndianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return '91' + digits;
  }
  return digits;
}

/**
 * Generates WhatsApp share URL for a fresh Invoice
 */
export function getWhatsAppInvoiceMessage(params: {
  merchantName: string;
  customerName: string;
  invoiceNum: string;
  amount: number;
  paymentLink?: string;
}): { text: string; url: string } {
  const { merchantName, customerName, invoiceNum, amount, paymentLink } = params;
  const cfg = getSaasConfig();
  
  const text = `*प्रणाम ${customerName} ji!* 🙏\n` +
    `*${merchantName}* की तरफ से आपका बिल तैयार है।\n\n` +
    `📄 *Bill No:* #${invoiceNum}\n` +
    `💰 *Total Amount:* ₹${amount.toFixed(2)}\n` +
    (paymentLink ? `🔗 *Pay Online via UPI:* ${paymentLink}\n` : `🏦 *UPI ID:* ${cfg.adminUpiVpa}\n`) +
    `\nThank you for business! Have a great day! ✨\n` +
    `_Sent via BillSaaS Pro Invoicing_`;

  const encodedText = encodeURIComponent(text);
  return {
    text,
    url: `https://wa.me/?text=${encodedText}`
  };
}

/**
 * Generates WhatsApp share URL for Outstanding Udhaar/Khata balance reminders
 */
export function getWhatsAppKhataReminder(params: {
  merchantName: string;
  customerName: string;
  balance: number;
  phone: string;
}): { text: string; url: string } {
  const { merchantName, customerName, balance, phone } = params;
  const cfg = getSaasConfig();
  const targetPhone = sanitizeIndianPhone(phone);
  
  // High-converting, extremely polite recovery message template
  const text = `*सादर प्रणाम ${customerName} ji!* 🙏\n` +
    `यह *${merchantName}* की तरफ से एक सौम्य अनुस्मारक (Gentle Reminder) है।\n\n` +
    `आपका कुल पुराना बकाया (Pending Balance) *₹${balance.toFixed(2)}* है।\n` +
    `कृपया नीचे दिए गए UPI ID या QR कोड के माध्यम से भुगतान पूरा करने की कृपा करें:\n\n` +
    `🏦 *UPI ID:* ${cfg.adminUpiVpa}\n` +
    `👤 *Payee Name:* ${cfg.adminPayeeName}\n\n` +
    `सहयोग के लिए बहुत-बहुत धन्यवाद! 😊\n` +
    `_Sent via BillSaaS Pro Khata Book_`;

  const encodedText = encodeURIComponent(text);
  const waUrl = targetPhone 
    ? `https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodedText}`
    : `https://wa.me/?text=${encodedText}`;

  return {
    text,
    url: waUrl
  };
}
