import { ArrowLeft, Loader2, X } from 'lucide-react';
import { createContext, forwardRef, useContext, useEffect, useId, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, busy, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      {...rest}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/** Id of the control a <Field> label points to; the first unlabelled control inside takes it. */
const FieldIdContext = createContext<string | undefined>(undefined);

/** The id a form control should use: its own, or the surrounding Field's when it has no aria label. */
export function useFieldId(own: string | undefined, labelled: boolean): string | undefined {
  const ctx = useContext(FieldIdContext);
  return own ?? (labelled ? undefined : ctx);
}

const hasAriaLabel = (p: { 'aria-label'?: string; 'aria-labelledby'?: string }) => !!(p['aria-label'] || p['aria-labelledby']);

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const auto = useId();
  const id = htmlFor ?? auto;
  const noteId = `${id}-note`;
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <FieldIdContext.Provider value={label ? id : undefined}>{children}</FieldIdContext.Provider>
      {error ? (
        <p id={noteId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, id, ...rest }, ref) {
  const fieldId = useFieldId(id, hasAriaLabel(rest));
  return <input ref={ref} id={fieldId} aria-invalid={invalid || undefined} className={cx('input', invalid && 'input-error', className)} {...rest} />;
});

/** Text field bound to a string value; calls onValue with the new text. */
export function TextInput({
  value,
  onValue,
  ...rest
}: { value: string; onValue: (v: string) => void } & Omit<InputProps, 'value' | 'onChange'>) {
  return <Input value={value} onChange={(e) => onValue(e.target.value)} {...rest} />;
}

function numberText(v: number, emptyZero: boolean): string {
  if (!Number.isFinite(v)) return '';
  if (v === 0 && emptyZero) return '';
  return String(v);
}

/**
 * Numeric field that keeps what the user types (e.g. "12." or "") while
 * reporting a clean number on every keystroke.
 */
export function NumberInput({
  value,
  onValue,
  emptyZero = false,
  className,
  invalid,
  ...rest
}: {
  value: number;
  onValue: (n: number) => void;
  emptyZero?: boolean;
  invalid?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [text, setText] = useState(() => numberText(value, emptyZero));
  const [focused, setFocused] = useState(false);
  const fieldId = useFieldId(rest.id, hasAriaLabel(rest));
  const shown = focused ? text : numberText(value, emptyZero);
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      id={fieldId}
      aria-invalid={invalid || undefined}
      className={cx('input text-right tabular-nums', invalid && 'input-error', className)}
      value={shown}
      onFocus={(e) => {
        setText(numberText(value, emptyZero));
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,-]/g, '');
        setText(t);
        const n = parseFloat(t.replace(/,/g, ''));
        onValue(Number.isFinite(n) ? n : 0);
      }}
      {...rest}
    />
  );
}

export interface Option<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export function Select<V extends string>({
  value,
  onValue,
  options,
  className,
  invalid,
  placeholder,
  ...rest
}: {
  value: V;
  onValue: (v: V) => void;
  options: readonly Option<V>[];
  invalid?: boolean;
  placeholder?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  const fieldId = useFieldId(rest.id, hasAriaLabel(rest));
  return (
    <select
      id={fieldId}
      aria-invalid={invalid || undefined}
      className={cx('input pr-8', invalid && 'input-error', className)}
      value={value}
      onChange={(e) => onValue(e.target.value as V)}
      {...rest}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Textarea({
  value,
  onValue,
  className,
  ...rest
}: { value: string; onValue: (v: string) => void } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const fieldId = useFieldId(rest.id, hasAriaLabel(rest));
  return <textarea id={fieldId} className={cx('input', className)} value={value} onChange={(e) => onValue(e.target.value)} {...rest} />;
}

export function Checkbox({
  checked,
  onValue,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onValue: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx('flex items-start gap-2', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onValue(e.target.checked)}
      />
      <label htmlFor={id} className="text-sm text-slate-700">
        {label}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </label>
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: string | true;
}) {
  const navigate = useNavigate();
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        {back && (
          <button
            type="button"
            className="btn btn-ghost mt-0.5 px-1.5"
            aria-label="Back"
            onClick={() => (back === true ? navigate(-1) : navigate(back))}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  gray: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-sky-100 text-sky-800',
  brand: 'bg-brand-100 text-brand-800',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('chip', TONES[tone], className)}>{children}</span>;
}

export function Tabs<V extends string>({
  tabs,
  value,
  onValue,
  className,
}: {
  tabs: readonly { value: V; label: ReactNode; count?: number }[];
  value: V;
  onValue: (v: V) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('flex flex-wrap gap-1 border-b border-slate-200', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={t.value === value}
          className={cx(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
            t.value === value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
          onClick={() => onValue(t.value)}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

function useEscape(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

const SIZES = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' } as const;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
}) {
  useEscape(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('card my-auto w-full', SIZES[size])}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" className="btn btn-ghost px-1.5" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  useEscape(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx('flex h-full w-full flex-col bg-white shadow-xl', width)} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" className="btn btn-ghost px-1.5" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {text && <p className="max-w-md text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'gray' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  const ring = { gray: '', green: 'border-l-emerald-500', amber: 'border-l-amber-500', red: 'border-l-red-500', blue: 'border-l-sky-500', brand: 'border-l-brand-500' }[tone];
  return (
    <div className={cx('card border-l-4 px-4 py-3', ring || 'border-l-slate-300')}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function Alert({ tone = 'amber', title, children }: { tone?: 'amber' | 'red' | 'blue' | 'green'; title?: ReactNode; children?: ReactNode }) {
  const cls = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-800',
    blue: 'border-sky-200 bg-sky-50 text-sky-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];
  return (
    <div className={cx('rounded-md border px-3 py-2 text-sm', cls)} role={tone === 'red' ? 'alert' : 'status'}>
      {title && <p className="font-medium">{title}</p>}
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{children}</kbd>;
}
