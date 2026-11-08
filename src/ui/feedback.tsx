import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { recordError } from '../store/errorLog';
import { UserError, errorText } from '../store/errors';
import { Button, Input, Modal } from './kit';

// ---------------------------------------------------------------- toasts

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  details: string[];
}

const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }));
let seq = 0;

function push(kind: Toast['kind'], title: string, details: string[] = [], ms = kind === 'error' ? 9000 : 3500) {
  const id = ++seq;
  useToasts.setState((s) => ({ list: [...s.list.slice(-4), { id, kind, title, details }] }));
  window.setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), ms);
}

export const toast = {
  success: (title: string) => push('success', title),
  info: (title: string, details: string[] = []) => push('info', title, details),
  error: (title: string, details: string[] = []) => push('error', title, details),
  /** Show any thrown error in a readable way; unexpected ones also go to the diagnostics log. */
  fromError: (e: unknown) => {
    if (!(e instanceof UserError)) recordError('action', e);
    const t = errorText(e);
    push('error', t.title, t.details);
  },
};

export function Toaster() {
  const list = useToasts((s) => s.list);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${
            t.kind === 'error' ? 'border-red-200 bg-red-50 text-red-900' : t.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-800'
          }`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          {t.kind === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : t.kind === 'success' ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t.title}</p>
            {t.details.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {t.details.slice(0, 8).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100" onClick={() => useToasts.setState((s) => ({ list: s.list.filter((x) => x.id !== t.id) }))}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- confirm / prompt

interface DialogRequest {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  confirmLabel: string;
  danger: boolean;
  label?: string;
  initial?: string;
  required?: boolean;
  resolve: (v: string | boolean | null) => void;
}

const useDialog = create<{ req: DialogRequest | null }>(() => ({ req: null }));

export function confirmDialog(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useDialog.setState({
      req: { kind: 'confirm', title: opts.title, message: opts.message, confirmLabel: opts.confirmLabel ?? 'OK', danger: !!opts.danger, resolve: (v) => resolve(v === true) },
    });
  });
}

export function promptDialog(opts: { title: string; message?: string; label?: string; initial?: string; confirmLabel?: string; required?: boolean; danger?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    useDialog.setState({
      req: {
        kind: 'prompt',
        title: opts.title,
        message: opts.message,
        label: opts.label,
        initial: opts.initial ?? '',
        required: opts.required ?? false,
        confirmLabel: opts.confirmLabel ?? 'OK',
        danger: !!opts.danger,
        resolve: (v) => resolve(typeof v === 'string' ? v : null),
      },
    });
  });
}

function PromptBody({ req, onDone }: { req: DialogRequest; onDone: (v: string | boolean | null) => void }) {
  const [text, setText] = useState(req.initial ?? '');
  const ok = !req.required || text.trim().length > 0;
  return (
    <Modal
      open
      size="sm"
      title={req.title}
      onClose={() => onDone(req.kind === 'confirm' ? false : null)}
      footer={
        <>
          <Button onClick={() => onDone(req.kind === 'confirm' ? false : null)}>Cancel</Button>
          <Button
            variant={req.danger ? 'danger' : 'primary'}
            disabled={req.kind === 'prompt' && !ok}
            onClick={() => onDone(req.kind === 'confirm' ? true : text.trim())}
            autoFocus={req.kind === 'confirm'}
          >
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      {req.message && <p className="whitespace-pre-line text-sm text-slate-700">{req.message}</p>}
      {req.kind === 'prompt' && (
        <div className="mt-3">
          {req.label && <label className="label">{req.label}</label>}
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ok) onDone(text.trim());
            }}
          />
        </div>
      )}
    </Modal>
  );
}

export function DialogHost() {
  const req = useDialog((s) => s.req);
  useEffect(() => () => useDialog.setState({ req: null }), []);
  if (!req) return null;
  const done = (v: string | boolean | null) => {
    useDialog.setState({ req: null });
    req.resolve(v);
  };
  return <PromptBody key={req.title + (req.initial ?? '')} req={req} onDone={done} />;
}

/** Run an async action and report failure as a toast; returns true on success. */
export async function attempt(task: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await task();
    if (success) toast.success(success);
    return true;
  } catch (e) {
    toast.fromError(e);
    return false;
  }
}
