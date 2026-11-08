import { Bell, BellOff, CircleAlert, Info, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorNotification } from '../core/diagnostics';
import { computeNotifications } from '../core/notifications';
import type { AppNotification } from '../core/notifications';
import { updateSettings } from '../store/actions';
import { useErrorLog } from '../store/errorLog';
import { useBusiness, useMine, usePaymentIndex, useSettings, useStock, useToday } from '../store/hooks';
import { attempt } from '../ui/feedback';
import { cx } from '../ui/kit';
import { lastExportDate, useAppUpdate } from './appState';

export function NotificationBell() {
  const biz = useBusiness();
  const settings = useSettings();
  const invoices = useMine('invoices');
  const products = useMine('products');
  const stock = useStock();
  const payments = usePaymentIndex();
  const today = useToday();
  const update = useAppUpdate();
  const errors = useErrorLog();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const list = useMemo<AppNotification[]>(() => {
    const base = computeNotifications({
      today,
      business: biz,
      invoices,
      products,
      stock,
      payments,
      lastBackup: lastExportDate(),
      dismissed: settings.dismissedNotifications,
    });
    const problems = errorNotification(errors.log, errors.seenAt);
    if (problems && !settings.dismissedNotifications.includes(problems.id)) {
      // After the urgent (danger) items, before the informational ones.
      const at = base.findIndex((n) => n.severity === 'info');
      base.splice(at < 0 ? base.length : at, 0, problems);
    }
    if (update.ready) {
      base.unshift({ id: 'app-update', kind: 'UPDATE', severity: 'info', title: 'A new version of the app is ready', detail: 'Reload to start using it. Your data is not affected.', href: '' });
    }
    return base;
  }, [today, biz, invoices, products, stock, payments, settings.dismissedNotifications, update.ready, errors]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const dismiss = (ids: string[]) =>
    attempt(() => updateSettings({ dismissedNotifications: [...settings.dismissedNotifications, ...ids].slice(-300) }));

  const urgent = list.filter((n) => n.severity !== 'info').length;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn btn-ghost relative px-2"
        aria-label={`Notifications (${list.length})`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="h-5 w-5" />
        {list.length > 0 && (
          <span className={cx('absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full px-1 text-[10px] font-bold leading-[18px] text-white', urgent ? 'bg-red-600' : 'bg-brand-600')}>
            {list.length > 99 ? '99+' : list.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {list.length > 0 && (
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => void dismiss(list.filter((n) => n.kind !== 'UPDATE').map((n) => n.id))}>
                Clear all
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {list.length === 0 && (
              <li className="flex flex-col items-center gap-1 px-4 py-8 text-sm text-slate-500">
                <BellOff className="h-6 w-6 text-slate-300" /> You are all caught up.
              </li>
            )}
            {list.map((n) => (
              <li key={n.id} className="flex gap-2 border-b border-slate-50 px-3 py-2 hover:bg-slate-50">
                <span className="mt-0.5">
                  {n.kind === 'UPDATE' ? (
                    <RefreshCw className="h-4 w-4 text-brand-600" />
                  ) : n.severity === 'danger' ? (
                    <CircleAlert className="h-4 w-4 text-red-600" />
                  ) : n.severity === 'warning' ? (
                    <TriangleAlert className="h-4 w-4 text-amber-500" />
                  ) : (
                    <Info className="h-4 w-4 text-sky-600" />
                  )}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setOpen(false);
                    if (n.kind === 'UPDATE') update.apply?.();
                    else if (n.href) navigate(n.href);
                  }}
                >
                  <span className="block text-sm font-medium text-slate-800">{n.title}</span>
                  <span className="block text-xs text-slate-500">{n.detail}</span>
                </button>
                {n.kind !== 'UPDATE' && (
                  <button type="button" aria-label="Dismiss" className="self-start text-slate-400 hover:text-slate-700" onClick={() => void dismiss([n.id])}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
