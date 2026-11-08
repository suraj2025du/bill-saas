import type { Business, Ledger, LedgerGroup, Party } from './model';

/**
 * Ledger references
 * - `sys:<key>`         built-in ledgers listed below (same for every business)
 * - `party:<partyId>`   one ledger per customer/supplier (Sundry Debtors/Creditors)
 * - `bank:<bankId>`     one ledger per bank account of the business
 * - `<ledger.id>`       custom ledgers stored in the `ledgers` collection
 */
export interface SystemLedgerDef {
  id: string;
  name: string;
  group: LedgerGroup;
}

const L = (id: string, name: string, group: LedgerGroup): SystemLedgerDef => ({ id, name, group });

export const SYSTEM_LEDGERS: readonly SystemLedgerDef[] = [
  L('sys:cash', 'Cash', 'CASH'),
  L('sys:capital', 'Capital Account', 'CAPITAL'),
  L('sys:sales', 'Sales', 'SALES'),
  L('sys:sales-exempt', 'Sales - Exempt / Bill of Supply', 'SALES'),
  L('sys:sales-export', 'Sales - Export / SEZ', 'SALES'),
  L('sys:sales-return', 'Sales Returns', 'SALES'),
  L('sys:purchase', 'Purchases', 'PURCHASE'),
  L('sys:out-cgst', 'Output CGST', 'DUTIES_TAXES'),
  L('sys:out-sgst', 'Output SGST', 'DUTIES_TAXES'),
  L('sys:out-utgst', 'Output UTGST', 'DUTIES_TAXES'),
  L('sys:out-igst', 'Output IGST', 'DUTIES_TAXES'),
  L('sys:out-cess', 'Output Cess', 'DUTIES_TAXES'),
  L('sys:in-cgst', 'Input CGST', 'DUTIES_TAXES'),
  L('sys:in-sgst', 'Input SGST', 'DUTIES_TAXES'),
  L('sys:in-utgst', 'Input UTGST', 'DUTIES_TAXES'),
  L('sys:in-igst', 'Input IGST', 'DUTIES_TAXES'),
  L('sys:in-cess', 'Input Cess', 'DUTIES_TAXES'),
  L('sys:rcm-payable', 'GST Payable on Reverse Charge', 'DUTIES_TAXES'),
  L('sys:out-vat', 'Output Tax (VAT / Sales Tax)', 'DUTIES_TAXES'),
  L('sys:in-vat', 'Input Tax (VAT / Sales Tax)', 'DUTIES_TAXES'),
  L('sys:purchase-services', 'Purchase - Services', 'PURCHASE'),
  L('sys:fixed-assets', 'Fixed Assets (Capital Goods)', 'FIXED_ASSETS'),
  L('sys:tcs-receivable', 'TCS Receivable', 'LOANS_ADVANCES'),
  L('sys:tds-receivable', 'TDS Receivable', 'LOANS_ADVANCES'),
  L('sys:tds-payable', 'TDS Payable', 'DUTIES_TAXES'),
  L('sys:tcs-payable', 'TCS Payable', 'DUTIES_TAXES'),
  L('sys:round-off', 'Round Off', 'INDIRECT_EXPENSES'),
  // Difference between the rate a foreign-currency bill was booked at and the rate it was paid at
  // (under Indirect Expenses, as in ERPNext's standard chart of accounts; a gain shows as a credit).
  L('sys:fx-gain-loss', 'Exchange Gain/Loss', 'INDIRECT_EXPENSES'),
  L('sys:suspense', 'Suspense Account', 'SUSPENSE'),
  // Counter-parties without a saved party record (walk-in / one-off)
  L('sys:walkin', 'Walk-in Customers', 'SUNDRY_DEBTORS'),
  L('sys:other-suppliers', 'Other Suppliers', 'SUNDRY_CREDITORS'),
  L('sys:expense-payable', 'Expenses Payable', 'CURRENT_LIABILITIES'),
  // Expense categories (used by the expense register)
  L('sys:exp-rent', 'Rent', 'INDIRECT_EXPENSES'),
  L('sys:exp-salary', 'Salaries & Wages', 'INDIRECT_EXPENSES'),
  L('sys:exp-electricity', 'Electricity', 'INDIRECT_EXPENSES'),
  L('sys:exp-telephone', 'Telephone & Internet', 'INDIRECT_EXPENSES'),
  L('sys:exp-travel', 'Travelling & Conveyance', 'INDIRECT_EXPENSES'),
  L('sys:exp-fuel', 'Fuel', 'INDIRECT_EXPENSES'),
  L('sys:exp-office', 'Office Expenses', 'INDIRECT_EXPENSES'),
  L('sys:exp-printing', 'Printing & Stationery', 'INDIRECT_EXPENSES'),
  L('sys:exp-repairs', 'Repairs & Maintenance', 'INDIRECT_EXPENSES'),
  L('sys:exp-professional', 'Professional Fees', 'INDIRECT_EXPENSES'),
  L('sys:exp-advertising', 'Advertising & Marketing', 'INDIRECT_EXPENSES'),
  L('sys:exp-bank-charges', 'Bank Charges', 'INDIRECT_EXPENSES'),
  L('sys:exp-insurance', 'Insurance', 'INDIRECT_EXPENSES'),
  L('sys:exp-software', 'Software & Subscriptions', 'INDIRECT_EXPENSES'),
  L('sys:exp-freight', 'Freight & Cartage', 'DIRECT_EXPENSES'),
  L('sys:exp-misc', 'Miscellaneous Expenses', 'INDIRECT_EXPENSES'),
];

export const EXPENSE_LEDGERS: readonly SystemLedgerDef[] = SYSTEM_LEDGERS.filter((l) => l.id.startsWith('sys:exp-'));

export const GROUP_LABELS: Record<LedgerGroup, string> = {
  CAPITAL: 'Capital Account',
  RESERVES: 'Reserves & Surplus',
  LOANS: 'Loans (Liability)',
  CURRENT_LIABILITIES: 'Current Liabilities',
  DUTIES_TAXES: 'Duties & Taxes',
  PROVISIONS: 'Provisions',
  SUNDRY_CREDITORS: 'Sundry Creditors',
  FIXED_ASSETS: 'Fixed Assets',
  INVESTMENTS: 'Investments',
  CURRENT_ASSETS: 'Current Assets',
  SUNDRY_DEBTORS: 'Sundry Debtors',
  CASH: 'Cash-in-Hand',
  BANK: 'Bank Accounts',
  STOCK: 'Stock-in-Hand',
  LOANS_ADVANCES: 'Loans & Advances (Asset)',
  DEPOSITS: 'Deposits (Asset)',
  SALES: 'Sales Accounts',
  PURCHASE: 'Purchase Accounts',
  DIRECT_INCOME: 'Direct Incomes',
  DIRECT_EXPENSES: 'Direct Expenses',
  INDIRECT_INCOME: 'Indirect Incomes',
  INDIRECT_EXPENSES: 'Indirect Expenses',
  SUSPENSE: 'Suspense Account',
};

/** Groups whose balances belong in the Profit & Loss account. */
export const PNL_GROUPS: ReadonlySet<LedgerGroup> = new Set<LedgerGroup>([
  'SALES',
  'PURCHASE',
  'DIRECT_INCOME',
  'DIRECT_EXPENSES',
  'INDIRECT_INCOME',
  'INDIRECT_EXPENSES',
]);

export const partyLedgerId = (partyId: string): string => `party:${partyId}`;
export const bankLedgerId = (bankId: string): string => `bank:${bankId}`;

export type LedgerRefKind = 'system' | 'party' | 'bank' | 'custom';

export function parseLedgerRef(id: string): { kind: LedgerRefKind; key: string } {
  if (id.startsWith('sys:')) return { kind: 'system', key: id };
  if (id.startsWith('party:')) return { kind: 'party', key: id.slice(6) };
  if (id.startsWith('bank:')) return { kind: 'bank', key: id.slice(5) };
  return { kind: 'custom', key: id };
}

export function getSystemLedger(id: string): SystemLedgerDef | undefined {
  return SYSTEM_LEDGERS.find((l) => l.id === id);
}

export interface LedgerLookup {
  business: Business;
  parties: readonly Party[];
  ledgers: readonly Ledger[];
}

export interface ResolvedLedger {
  id: string;
  name: string;
  group: LedgerGroup;
  kind: LedgerRefKind;
}

/** Name + group of any ledger reference, or null when it no longer exists. */
export function resolveLedger(id: string, ctx: LedgerLookup): ResolvedLedger | null {
  const ref = parseLedgerRef(id);
  if (ref.kind === 'system') {
    const sys = getSystemLedger(id);
    return sys ? { id, name: sys.name, group: sys.group, kind: 'system' } : null;
  }
  if (ref.kind === 'party') {
    const p = ctx.parties.find((x) => x.id === ref.key);
    if (!p) return null;
    return { id, name: p.name, group: p.kind === 'SUPPLIER' ? 'SUNDRY_CREDITORS' : 'SUNDRY_DEBTORS', kind: 'party' };
  }
  if (ref.kind === 'bank') {
    const b = ctx.business.bankAccounts.find((x) => x.id === ref.key);
    if (!b) return null;
    const tail = b.accountNumber.slice(-4);
    return { id, name: `${b.bankName || b.label}${tail ? ` ...${tail}` : ''}`, group: 'BANK', kind: 'bank' };
  }
  const l = ctx.ledgers.find((x) => x.id === id);
  return l ? { id, name: l.name, group: l.group, kind: 'custom' } : null;
}

/** Every ledger available to a business (system + parties + banks + custom). */
export function allLedgers(ctx: LedgerLookup): ResolvedLedger[] {
  const out: ResolvedLedger[] = SYSTEM_LEDGERS.map((l) => ({ id: l.id, name: l.name, group: l.group, kind: 'system' as const }));
  for (const b of ctx.business.bankAccounts) {
    const r = resolveLedger(bankLedgerId(b.id), ctx);
    if (r) out.push(r);
  }
  for (const p of ctx.parties) {
    if (p.businessId !== ctx.business.id) continue;
    const r = resolveLedger(partyLedgerId(p.id), ctx);
    if (r) out.push(r);
  }
  for (const l of ctx.ledgers) {
    if (l.businessId === ctx.business.id) out.push({ id: l.id, name: l.name, group: l.group, kind: 'custom' });
  }
  return out;
}
