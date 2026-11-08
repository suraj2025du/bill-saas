import { useEffect } from 'react';
import { create } from 'zustand';
import type { AppSettings } from '../core/model';
import { setUnlocked } from '../store/store';

/** Set by the service worker when a newer version of the app is ready. */
export const useAppUpdate = create<{ ready: boolean; apply: (() => void) | null }>(() => ({ ready: false, apply: null }));

const EXPORT_KEY = 'fgb:lastExport';

/** Date of the last backup file the user downloaded (kept per browser). */
export function lastExportDate(): string {
  try {
    return localStorage.getItem(EXPORT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function markExported(date: string): void {
  try {
    localStorage.setItem(EXPORT_KEY, date);
  } catch {
    // Private mode: nothing to remember.
  }
}

/** Lock the app after `autoLockMinutes` without keyboard, mouse or touch input. */
export function useIdleLock(settings: AppSettings): void {
  const minutes = settings.pin ? settings.autoLockMinutes : 0;
  useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const mark = () => {
      last = Date.now();
    };
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    const timer = window.setInterval(() => {
      if (Date.now() - last > minutes * 60_000) setUnlocked(false);
    }, 15_000);
    return () => {
      for (const e of events) window.removeEventListener(e, mark);
      window.clearInterval(timer);
    };
  }, [minutes]);
}
