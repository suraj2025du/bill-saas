import { create } from 'zustand';
import { addError, describeError, isNoise } from '../core/diagnostics';
import type { ErrorRecord, ErrorSource } from '../core/diagnostics';
import { APP_VERSION } from '../version';

// Kept per browser in localStorage, next to the other small per-device notes.
const KEY = 'fgb:errors';
const SEEN_KEY = 'fgb:errorsSeen';

function load(): ErrorRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? (value as ErrorRecord[]) : [];
  } catch {
    return [];
  }
}

function loadSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked or full: keep the log in memory only.
  }
}

export const useErrorLog = create<{ log: ErrorRecord[]; seenAt: string }>(() => ({ log: load(), seenAt: loadSeen() }));

/** Record an unexpected error. Never throws, so it is safe inside error handlers. */
export function recordError(source: ErrorSource, err: unknown): void {
  try {
    const { message, detail } = describeError(err);
    if (!message || isNoise(message)) return;
    const route = typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '').split('?')[0] || '/';
    const log = addError(useErrorLog.getState().log, { at: new Date().toISOString(), source, message, detail, route, version: APP_VERSION });
    save(KEY, JSON.stringify(log));
    useErrorLog.setState({ log });
  } catch {
    // Recording must never cause a second error.
  }
}

/** The user has looked at the log: the bell stops counting these errors. */
export function markErrorsSeen(): void {
  const at = useErrorLog.getState().log[0]?.at ?? '';
  if (!at || at === useErrorLog.getState().seenAt) return;
  save(SEEN_KEY, at);
  useErrorLog.setState({ seenAt: at });
}

export function clearErrors(): void {
  save(KEY, '[]');
  useErrorLog.setState({ log: [] });
}

let installed = false;

/** Catch errors nothing else handled (event handlers, timers, unhandled promises). */
export function installErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => recordError('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => recordError('promise', e.reason));
}
