import type { AppNotification } from './notifications';

/**
 * Local error log for Settings > Diagnostics. Nothing is sent anywhere: the log stays on
 * this computer and the user can download it to share with whoever helps them.
 */
export type ErrorSource = 'error' | 'promise' | 'screen' | 'action';

export interface ErrorRecord {
  id: string;
  /** ISO date-time of the latest occurrence. */
  at: string;
  source: ErrorSource;
  message: string;
  /** Stack trace or other detail, trimmed. */
  detail: string;
  /** Screen (hash route) the error happened on. */
  route: string;
  version: string;
  /** Occurrences of the same message on the same screen and day. */
  count: number;
}

export const MAX_ERRORS = 50;
export const ERROR_SOURCE_LABELS: Record<ErrorSource, string> = {
  error: 'Program error',
  promise: 'Background task',
  screen: 'Screen failed',
  action: 'Action failed',
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** A readable message and detail for anything that was thrown. */
export function describeError(err: unknown): { message: string; detail: string } {
  if (err instanceof Error) return { message: clip(err.message || err.name, 300), detail: clip(err.stack ?? '', 2000) };
  if (typeof err === 'string') return { message: clip(err, 300), detail: '' };
  try {
    const text = JSON.stringify(err);
    return { message: clip(text ?? String(err), 300), detail: '' };
  } catch {
    return { message: clip(String(err), 300), detail: '' };
  }
}

/** Browser notices that are not app errors and would only fill the log. */
export function isNoise(message: string): boolean {
  return /ResizeObserver loop|^Script error\.?$/i.test(message.trim());
}

function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Add an error to the newest-first log. The same message on the same screen and day only
 * raises its count; the log keeps the newest MAX_ERRORS entries.
 */
export function addError(log: readonly ErrorRecord[], entry: Omit<ErrorRecord, 'id' | 'count'>): ErrorRecord[] {
  const day = entry.at.slice(0, 10);
  const same = log.find((r) => r.message === entry.message && r.route === entry.route && r.at.slice(0, 10) === day);
  if (same) return [{ ...same, at: entry.at, detail: entry.detail || same.detail, count: same.count + 1 }, ...log.filter((r) => r !== same)];
  const id = `${entry.at}-${shortHash(`${entry.route}|${entry.message}`)}`;
  return [{ ...entry, id, count: 1 }, ...log].slice(0, MAX_ERRORS);
}

/** Bell notice for errors recorded after `seenAt` (when the user last opened Diagnostics). */
export function errorNotification(log: readonly ErrorRecord[], seenAt: string): AppNotification | null {
  const fresh = log.filter((r) => r.at > seenAt);
  if (!fresh.length) return null;
  const n = fresh.reduce((s, r) => s + r.count, 0);
  return {
    id: `errors-${fresh[0].at}`,
    kind: 'ERROR',
    severity: 'warning',
    title: `${n} app problem${n === 1 ? '' : 's'} recorded`,
    detail: fresh[0].message,
    href: '/settings/diagnostics',
  };
}
