import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  BookOpen,
  Boxes,
  Calculator,
  ChartColumn,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Landmark,
  LayoutDashboard,
  Package,
  Receipt,
  Scale,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  Warehouse,
  ArrowRightLeft,
  Rows3,
  BadgePercent,
  HardDrive,
} from 'lucide-react';
import type { Business } from '../core/model';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra words for the command palette. */
  keywords?: string;
  show?: (b: Business) => boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  show?: (b: Business) => boolean;
}

const india = (b: Business) => b.countryCode === 'IN';
const inventory = (b: Business) => b.features.inventory;

export const NAV: NavGroup[] = [
  {
    label: '',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home overview' },
      { to: '/daily', label: 'Daily & Price Board', icon: Calculator, keywords: 'daily work price check rate list mrp gst calculator busy tally' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/sales', label: 'Invoices & documents', icon: FileText, keywords: 'tax invoice quotation proforma challan credit note bill of supply' },
      { to: '/payments', label: 'Payments', icon: Banknote, keywords: 'receipts money received paid' },
      { to: '/parties', label: 'Parties', icon: Users, keywords: 'customers suppliers clients ledger statement' },
    ],
  },
  {
    label: 'Inventory',
    show: inventory,
    items: [
      { to: '/inventory/products', label: 'Products', icon: Package, keywords: 'items goods services hsn stock' },
      { to: '/inventory/bulk', label: 'Bulk edit', icon: Rows3, keywords: 'price update' },
      { to: '/inventory/godowns', label: 'Godowns', icon: Warehouse, keywords: 'warehouse location', show: (b) => b.features.godowns },
      { to: '/inventory/stock', label: 'Stock & valuation', icon: Boxes, keywords: 'closing stock report batch' },
    ],
  },
  {
    label: 'Purchases',
    items: [
      { to: '/purchases', label: 'Purchase bills', icon: ShoppingCart, keywords: 'supplier bill itc ocr' },
      { to: '/expenses', label: 'Expenses', icon: Wallet, keywords: 'rent salary electricity' },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { to: '/accounts/vouchers', label: 'Vouchers', icon: ArrowRightLeft, keywords: 'payment receipt contra journal f4 f5 f6 f7' },
      { to: '/accounts/ledgers', label: 'Ledgers', icon: BookOpen, keywords: 'chart of accounts' },
      { to: '/accounts/books', label: 'Day, cash & bank book', icon: ClipboardList, keywords: 'daybook cashbook bankbook' },
      { to: '/accounts/outstanding', label: 'Outstanding & ageing', icon: Receipt, keywords: 'receivable payable due' },
      { to: '/accounts/trial-balance', label: 'Trial balance', icon: Scale },
      { to: '/accounts/pnl', label: 'Profit & loss', icon: ChartColumn, keywords: 'income statement monthly' },
      { to: '/accounts/balance-sheet', label: 'Balance sheet', icon: Landmark },
    ],
  },
  {
    label: 'GST & tax',
    items: [
      { to: '/gst/gstr1', label: 'GSTR-1', icon: FileSpreadsheet, keywords: 'outward json b2b b2c hsn', show: india },
      { to: '/gst/gstr3b', label: 'GSTR-3B', icon: FileSpreadsheet, keywords: 'itc set off liability', show: india },
      { to: '/gst/gstr2b', label: 'GSTR-2B reconciliation', icon: FileSpreadsheet, keywords: 'match purchases', show: india },
      { to: '/gst/tds', label: 'TDS / TCS', icon: BadgePercent, keywords: '26q 27eq form 140 143' },
      { to: '/itr', label: 'Income tax helper', icon: Calculator, keywords: 'itr old new regime 44ad 234b 234c', show: india },
    ],
  },
  {
    label: '',
    items: [
      { to: '/portal', label: 'Company Portal & USB', icon: HardDrive, keywords: 'company portal busy tally pen drive portable download license pricing' },
      { to: '/settings', label: 'Settings', icon: Settings, keywords: 'business print backup pin units' },
    ],
  },
];

export function visibleNav(b: Business): NavGroup[] {
  return NAV.filter((g) => !g.show || g.show(b))
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.show || i.show(b)) }))
    .filter((g) => g.items.length);
}

export const SETTINGS_SECTIONS: { to: string; label: string; keywords: string }[] = [
  { to: '/settings/business', label: 'Business profile', keywords: 'gstin address logo bank upi' },
  { to: '/settings/businesses', label: 'All businesses', keywords: 'multi gstin switch add' },
  { to: '/settings/print', label: 'Print & PDF design', keywords: 'template colours margins language watermark copies thermal' },
  { to: '/settings/numbering', label: 'Invoice numbering', keywords: 'series prefix' },
  { to: '/settings/units', label: 'Units', keywords: 'uom uqc custom unit' },
  { to: '/settings/features', label: 'Features', keywords: 'preset modules' },
  { to: '/settings/security', label: 'PIN lock', keywords: 'security password' },
  { to: '/settings/backup', label: 'Backup & restore', keywords: 'export import json' },
  { to: '/settings/drive', label: 'Google Drive', keywords: 'cloud backup oauth' },
  { to: '/settings/trash', label: 'Trash bin', keywords: 'deleted restore' },
  { to: '/settings/diagnostics', label: 'Diagnostics', keywords: 'version errors data check support' },
  { to: '/settings/super-admin', label: 'Super Admin SaaS & Licensing', keywords: 'saas subscription key generator activation licensing client tenants billing' },
];
