import { Database, RefreshCw, TriangleAlert } from 'lucide-react';
import { Fragment, Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link, RouterProvider, createHashRouter, useLocation, useRouteError } from 'react-router';
import { Dashboard } from './features/dashboard/Dashboard';
import { PrintHost } from './print/printing';
import { Layout } from './shell/Layout';
import { LockScreen } from './shell/LockScreen';
import { runStartupTasks } from './store/actions';
import { recordError } from './store/errorLog';
import { useBusinessOrNull, useSettings } from './store/hooks';
import { boot, useStore } from './store/store';
import { DialogHost, Toaster, toast } from './ui/feedback';
import { Button, EmptyState, Spinner } from './ui/kit';

/** Editors keep their state per visit: a new navigation gives a fresh screen. */
function Remount({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <Fragment key={location.key}>{children}</Fragment>;
}

function RouteError() {
  const error = useRouteError();
  useEffect(() => recordError('screen', error), [error]);
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'statusText' in error ? String((error as { statusText: unknown }).statusText) : String(error);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="card max-w-lg p-6 text-center">
        <TriangleAlert className="mx-auto h-10 w-10 text-amber-500" />
        <h1 className="mt-2 text-lg font-semibold">This screen hit a problem</h1>
        <p className="mt-1 text-sm text-slate-600">{message}</p>
        <p className="mt-1 text-xs text-slate-500">Your saved data is safe. Go back or reload the app.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Link className="btn btn-secondary" to="/">
            Dashboard
          </Link>
          <Button variant="primary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}

const NotFound = () => <EmptyState title="Page not found" action={<Link className="btn btn-secondary" to="/">Go to dashboard</Link>} />;
// Shown once per install, so it is not part of the start-up bundle.
const SetupWizard = lazy(() => import('./features/setup/SetupWizard').then((m) => ({ default: m.SetupWizard })));
const SuperAdminLazy = lazy(() => import('./features/settings/SuperAdmin').then((m) => ({ default: m.SuperAdminPage })));
const CompanyHomeLazy = lazy(() => import('./features/portal/CompanyHomePage').then((m) => ({ default: m.CompanyHomePage })));
const PageLoading = () => (
  <div className="flex justify-center p-10">
    <Spinner />
  </div>
);

/**
 * A screen that is downloaded on its first visit, so the app starts with a small bundle.
 * `remount` gives editors a fresh state on every navigation (see Remount).
 */
function screen<M>(load: () => Promise<M>, pick: (m: M) => ComponentType, remount = false) {
  return {
    lazy: async () => {
      const Screen = pick(await load());
      return { element: remount ? <Remount><Screen /></Remount> : <Screen /> };
    },
  };
}

const sales = {
  list: () => import('./features/sales/SalesList'),
  editor: () => import('./features/sales/DocEditor'),
  view: () => import('./features/sales/DocView'),
  payments: () => import('./features/sales/PaymentsPage'),
};
const parties = () => import('./features/parties/Parties');
const products = () => import('./features/inventory/Products');
const purchases = () => import('./features/purchases/Purchases');
const vouchers = () => import('./features/accounting/Vouchers');
const ledgers = () => import('./features/accounting/Ledgers');
const reports = () => import('./features/accounting/Reports');
const businessSettings = () => import('./features/settings/BusinessSettings');
const otherSettings = () => import('./features/settings/OtherSettings');
const dataSettings = () => import('./features/settings/DataSettings');

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <PageLoading />,
    children: [
      { errorElement: <RouteError />, children: [
        { index: true, element: <Dashboard /> },
        { path: 'sales', ...screen(sales.list, (m) => m.SalesList) },
        { path: 'sales/new', ...screen(sales.editor, (m) => m.DocEditor, true) },
        { path: 'sales/:id', ...screen(sales.view, (m) => m.DocView, true) },
        { path: 'sales/:id/edit', ...screen(sales.editor, (m) => m.DocEditor, true) },
        { path: 'payments', ...screen(sales.payments, (m) => m.PaymentsPage) },
        { path: 'parties', ...screen(parties, (m) => m.PartyList) },
        { path: 'parties/new', ...screen(parties, (m) => m.PartyEditor, true) },
        { path: 'parties/:id', ...screen(parties, (m) => m.PartyDetail, true) },
        { path: 'parties/:id/edit', ...screen(parties, (m) => m.PartyEditor, true) },
        { path: 'inventory/products', ...screen(products, (m) => m.ProductList) },
        { path: 'inventory/products/new', ...screen(products, (m) => m.ProductEditor, true) },
        { path: 'inventory/products/:id', ...screen(products, (m) => m.ProductEditor, true) },
        { path: 'inventory/bulk', ...screen(products, (m) => m.BulkEdit) },
        { path: 'inventory/godowns', ...screen(products, (m) => m.Godowns) },
        { path: 'inventory/stock', ...screen(() => import('./features/inventory/Stock'), (m) => m.StockReport) },
        { path: 'purchases', ...screen(purchases, (m) => m.PurchaseList) },
        { path: 'purchases/new', ...screen(purchases, (m) => m.PurchaseEditor, true) },
        { path: 'purchases/:id', ...screen(purchases, (m) => m.PurchaseEditor, true) },
        { path: 'expenses', ...screen(() => import('./features/expenses/Expenses'), (m) => m.ExpensesPage) },
        { path: 'accounts/vouchers', ...screen(vouchers, (m) => m.VoucherList) },
        { path: 'accounts/vouchers/new', ...screen(vouchers, (m) => m.VoucherEditor, true) },
        { path: 'accounts/vouchers/:id', ...screen(vouchers, (m) => m.VoucherEditor, true) },
        { path: 'accounts/ledgers', ...screen(ledgers, (m) => m.LedgersPage) },
        { path: 'accounts/ledger/:ledgerId', ...screen(ledgers, (m) => m.LedgerStatementPage, true) },
        { path: 'accounts/books', ...screen(() => import('./features/accounting/Books'), (m) => m.BooksPage) },
        { path: 'accounts/outstanding', ...screen(reports, (m) => m.OutstandingPage) },
        { path: 'accounts/trial-balance', ...screen(reports, (m) => m.TrialBalancePage) },
        { path: 'accounts/pnl', ...screen(reports, (m) => m.PnlPage) },
        { path: 'accounts/balance-sheet', ...screen(reports, (m) => m.BalanceSheetPage) },
        { path: 'gst/gstr1', ...screen(() => import('./features/gst/Gstr1Page'), (m) => m.Gstr1Page) },
        { path: 'gst/gstr3b', ...screen(() => import('./features/gst/Gstr3bPage'), (m) => m.Gstr3bPage) },
        { path: 'gst/gstr2b', ...screen(() => import('./features/gst/Gstr2bPage'), (m) => m.Gstr2bPage) },
        { path: 'gst/tds', ...screen(() => import('./features/gst/TdsPage'), (m) => m.TdsPage) },
        { path: 'itr', ...screen(() => import('./features/itr/ItrPage'), (m) => m.ItrPage) },
        { path: 'settings', ...screen(() => import('./features/settings/SettingsHome'), (m) => m.SettingsHome) },
        { path: 'settings/business', ...screen(businessSettings, (m) => m.BusinessProfile, true) },
        { path: 'settings/businesses', ...screen(businessSettings, (m) => m.BusinessesPage) },
        { path: 'settings/print', ...screen(() => import('./features/settings/PrintSettings'), (m) => m.PrintSettingsPage, true) },
        { path: 'settings/numbering', ...screen(otherSettings, (m) => m.NumberingPage, true) },
        { path: 'settings/units', ...screen(otherSettings, (m) => m.UnitsPage) },
        { path: 'settings/features', ...screen(otherSettings, (m) => m.FeaturesPage, true) },
        { path: 'settings/security', ...screen(otherSettings, (m) => m.SecurityPage) },
        { path: 'settings/backup', ...screen(dataSettings, (m) => m.BackupPage) },
        { path: 'settings/drive', ...screen(dataSettings, (m) => m.DrivePage) },
        { path: 'settings/trash', ...screen(dataSettings, (m) => m.TrashPage) },
        { path: 'settings/diagnostics', ...screen(() => import('./features/settings/Diagnostics'), (m) => m.DiagnosticsPage) },
        { path: 'settings/super-admin', ...screen(() => import('./features/settings/SuperAdmin'), (m) => m.SuperAdminPage) },
        { path: 'super-admin', ...screen(() => import('./features/settings/SuperAdmin'), (m) => m.SuperAdminPage) },
        { path: 'portal', ...screen(() => import('./features/portal/CompanyHomePage'), (m) => m.CompanyHomePage) },
        { path: 'daily', ...screen(() => import('./features/portal/CompanyHomePage'), (m) => m.CompanyHomePage) },
        { path: '*', element: <NotFound /> },
      ] },
    ],
  },
]);

let startupDone = false;

function BootError({ message }: { message: string }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="card max-w-lg p-6 text-center">
        <Database className="mx-auto h-10 w-10 text-red-500" />
        <h1 className="mt-2 text-lg font-semibold">Could not open your data</h1>
        <p className="mt-1 text-sm text-slate-600">{message}</p>
        <p className="mt-2 text-xs text-slate-500">
          The browser may be blocking storage (private window, or site data disabled). Allow storage for this site, or run the app with Start-GST-Billing.cmd to keep data in files.
        </p>
        <Button className="mt-4" variant="primary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void boot()}>
          Try again
        </Button>
      </div>
    </div>
  );
}

export function App() {
  const state = useStore((s) => s.boot);
  const bootError = useStore((s) => s.bootError);
  const unlocked = useStore((s) => s.unlocked);
  const settings = useSettings();
  const biz = useBusinessOrNull();
  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void boot();
    }
  }, []);

  const ready = state === 'ready' && settings.setupComplete && !!biz;
  useEffect(() => {
    if (!ready || !unlocked || startupDone) return;
    startupDone = true;
    void runStartupTasks().then((notes) => {
      for (const n of notes) toast.info(n);
    });
  }, [ready, unlocked]);

  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const isSuperAdminRoute = hash.includes('super-admin');
  const isPortalRoute = hash.includes('portal') || hash.includes('daily');

  let body: ReactNode;
  if (state === 'loading') body = <Spinner label="Opening your books..." />;
  else if (state === 'error') body = <BootError message={bootError} />;
  else if (!settings.setupComplete || !biz)
    body = isSuperAdminRoute ? (
      <Suspense fallback={<Spinner label="Opening Super Admin..." />}>
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
          <div className="mx-auto max-w-7xl">
            <div className="mb-4 flex justify-end">
              <a href="#/" className="btn btn-secondary text-xs">← Back to Setup Wizard</a>
            </div>
            <SuperAdminLazy />
          </div>
        </div>
      </Suspense>
    ) : isPortalRoute ? (
      <Suspense fallback={<Spinner label="Opening Company Portal..." />}>
        <CompanyHomeLazy />
      </Suspense>
    ) : (
      <Suspense fallback={<Spinner label="Opening the setup..." />}>
        <SetupWizard />
      </Suspense>
    );
  else body = <RouterProvider router={router} />;

  return (
    <>
      {body}
      {!unlocked && ready && <LockScreen overlay />}
      <Toaster />
      <DialogHost />
      <PrintHost />
    </>
  );
}
