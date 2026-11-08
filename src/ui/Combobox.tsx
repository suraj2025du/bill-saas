import { ChevronDown, Plus } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { cx, useFieldId } from './kit';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
  keywords?: string;
}

/**
 * Searchable picker with keyboard support. When `onCreate` is given, the
 * typed text can be used as a new entry (e.g. a one-off customer name).
 */
export function Combobox({
  value,
  options,
  onValue,
  onCreate,
  createLabel = 'Use',
  placeholder = 'Search...',
  className,
  inputClassName,
  invalid,
  displayValue,
  autoFocus,
  ariaLabel,
}: {
  value: string;
  options: readonly ComboOption[];
  onValue: (value: string) => void;
  onCreate?: (text: string) => void;
  createLabel?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  invalid?: boolean;
  /** Text to show when the value is not one of the options (e.g. a typed name). */
  displayValue?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const listId = useId();
  const inputId = useFieldId(undefined, !!ariaLabel);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  const shown = open ? query : (selected?.label ?? displayValue ?? '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((o) => `${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q))
      : options;
    return list.slice(0, 60);
  }, [options, query]);

  const canCreate = !!onCreate && query.trim().length > 0 && !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());
  const total = filtered.length + (canCreate ? 1 : 0);

  const choose = (i: number) => {
    if (i < filtered.length) onValue(filtered[i].value);
    else if (canCreate) onCreate?.(query.trim());
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={cx('relative', className)}>
      <input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={open && total > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className={cx('input pr-8', invalid && 'input-error', inputClassName)}
        placeholder={placeholder}
        value={shown}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setActive(0);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, Math.max(0, total - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && total > 0) {
            e.preventDefault();
            choose(active);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <ChevronDown className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-slate-400" aria-hidden />
      {open && total > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full min-w-[16rem] overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={cx('cursor-pointer px-3 py-1.5', i === active ? 'bg-brand-50 text-brand-900' : 'text-slate-700')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <span className="block truncate">{o.label}</span>
              {o.hint && <span className="block truncate text-xs text-slate-600">{o.hint}</span>}
            </li>
          ))}
          {canCreate && (
            <li
              role="option"
              aria-selected={false}
              className={cx('flex cursor-pointer items-center gap-1.5 border-t border-slate-100 px-3 py-1.5 text-brand-700', active === filtered.length && 'bg-brand-50')}
              onMouseEnter={() => setActive(filtered.length)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(filtered.length);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> {createLabel} &quot;{query.trim()}&quot;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
