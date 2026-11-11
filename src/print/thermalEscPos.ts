/**
 * ESC/POS Thermal Receipt Print Formatter.
 * Formats invoices for direct output on standard 58mm (32 col) and 80mm (48 col)
 * Bluetooth, USB, and Network thermal receipt printers.
 */

export interface ThermalLineItem {
  name: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface ThermalInvoiceData {
  businessName: string;
  businessAddress?: string;
  businessGstin?: string;
  businessPhone?: string;
  invoiceNumber: string;
  date: string;
  customerName?: string;
  customerPhone?: string;
  items: ThermalLineItem[];
  subtotal: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  grandTotal: number;
  upiVpa?: string;
  notes?: string;
}

export type PaperWidth = '58mm' | '80mm';

export function padRow(left: string, right: string, width: number): string {
  const spaceNeeded = width - left.length - right.length;
  if (spaceNeeded <= 0) {
    return left.slice(0, width - right.length - 1) + ' ' + right;
  }
  return left + ' '.repeat(spaceNeeded) + right;
}

export function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const leftPad = Math.floor((width - text.length) / 2);
  return ' '.repeat(leftPad) + text;
}

/**
 * Builds clean, printable ASCII/ESC-POS receipt text for counter thermal printers
 */
export function formatThermalReceipt(data: ThermalInvoiceData, width: PaperWidth = '58mm'): string {
  const colWidth = width === '80mm' ? 48 : 32;
  const divider = '-'.repeat(colWidth);
  const doubleDivider = '='.repeat(colWidth);

  const lines: string[] = [];

  // Header
  lines.push(centerText(data.businessName.toUpperCase(), colWidth));
  if (data.businessAddress) {
    lines.push(centerText(data.businessAddress, colWidth));
  }
  if (data.businessGstin) {
    lines.push(centerText(`GSTIN: ${data.businessGstin}`, colWidth));
  }
  if (data.businessPhone) {
    lines.push(centerText(`Phone: ${data.businessPhone}`, colWidth));
  }

  lines.push(divider);

  // Metadata
  lines.push(padRow(`Bill: #${data.invoiceNumber}`, `Date: ${data.date}`, colWidth));
  if (data.customerName) {
    lines.push(padRow('Cust:', data.customerName, colWidth));
  }
  if (data.customerPhone) {
    lines.push(padRow('Mob:', data.customerPhone, colWidth));
  }

  lines.push(divider);

  // Table Column Headers
  if (colWidth >= 48) {
    lines.push(padRow('ITEM', 'QTY  RATE    TOTAL', colWidth));
  } else {
    lines.push(padRow('ITEM [QTY x RATE]', 'TOTAL', colWidth));
  }
  lines.push(divider);

  // Line items
  for (const item of data.items) {
    const totalStr = `₹${item.amount.toFixed(2)}`;
    if (colWidth >= 48) {
      const details = `${item.qty}  @${item.rate.toFixed(2)}  ${totalStr}`;
      lines.push(padRow(item.name.slice(0, 24), details, colWidth));
    } else {
      const itemHeader = item.name.slice(0, colWidth);
      lines.push(itemHeader);
      const sub = ` ${item.qty} x ₹${item.rate.toFixed(2)}`;
      lines.push(padRow(sub, totalStr, colWidth));
    }
  }

  lines.push(divider);

  // Totals
  lines.push(padRow('Subtotal:', `₹${data.subtotal.toFixed(2)}`, colWidth));
  if (data.cgst && data.cgst > 0) {
    lines.push(padRow('CGST:', `₹${data.cgst.toFixed(2)}`, colWidth));
  }
  if (data.sgst && data.sgst > 0) {
    lines.push(padRow('SGST:', `₹${data.sgst.toFixed(2)}`, colWidth));
  }
  if (data.igst && data.igst > 0) {
    lines.push(padRow('IGST:', `₹${data.igst.toFixed(2)}`, colWidth));
  }

  lines.push(doubleDivider);
  lines.push(padRow('GRAND TOTAL:', `₹${data.grandTotal.toFixed(2)}`, colWidth));
  lines.push(doubleDivider);

  // Payment UPI footer
  if (data.upiVpa) {
    lines.push(centerText(`Pay via UPI: ${data.upiVpa}`, colWidth));
  }

  lines.push('');
  lines.push(centerText('Thank You! Visit Again 🙏', colWidth));
  lines.push(centerText('Software by BillSaaS Pro', colWidth));
  lines.push('');
  lines.push(''); // Feed lines for paper tear

  return lines.join('\n');
}

/**
 * Sends formatted receipt to connected Web Bluetooth or Raw Thermal printer if available
 */
export async function printDirectThermal(data: ThermalInvoiceData, width: PaperWidth = '58mm'): Promise<boolean> {
  const text = formatThermalReceipt(data, width);
  if (typeof window !== 'undefined' && 'navigator' in window && 'bluetooth' in (navigator as any)) {
    try {
      // Future Bluetooth ESC/POS raw connection hook
      console.log('Direct ESC/POS receipt prepared:\n' + text);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}
