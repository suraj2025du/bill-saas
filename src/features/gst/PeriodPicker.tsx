import { useMemo } from 'react';
import { fyForStartYear, fyOf } from '../../core/dates';
import { monthPeriod, quarterPeriod, yearPeriod } from '../../core/gst/returns/period';
import type { ReturnPeriod } from '../../core/gst/returns/period';
import { useBusiness, useToday } from '../../store/hooks';
import { Input, Select } from '../../ui/kit';

export type PeriodKind = 'MONTH' | 'QUARTER' | 'YEAR';

export interface PeriodChoice {
  kind: PeriodKind;
  month: string;
  fy: string;
  quarter: 1 | 2 | 3 | 4;
}

export function defaultChoice(today: string, filing: 'MONTHLY' | 'QUARTERLY', fyStartMonth: number): PeriodChoice {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const lastMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const fy = fyOf(`${lastMonth}-01`, fyStartMonth);
  const monthIndex = (Number(lastMonth.slice(5, 7)) - fyStartMonth + 12) % 12;
  return { kind: filing === 'QUARTERLY' ? 'QUARTER' : 'MONTH', month: lastMonth, fy: fy.label, quarter: (Math.floor(monthIndex / 3) + 1) as 1 | 2 | 3 | 4 };
}

export function choiceToPeriod(c: PeriodChoice, fyStartMonth: number): ReturnPeriod {
  if (c.kind === 'MONTH') return monthPeriod(c.month);
  if (c.kind === 'QUARTER') return quarterPeriod(c.fy, c.quarter, fyStartMonth);
  return yearPeriod(c.fy, fyStartMonth);
}

export function PeriodPicker({ value, onChange, allowYear = false }: { value: PeriodChoice; onChange: (c: PeriodChoice) => void; allowYear?: boolean }) {
  const biz = useBusiness();
  const today = useToday();
  const fys = useMemo(() => {
    const current = fyOf(today, biz.fyStartMonth).startYear;
    return Array.from({ length: 6 }, (_, i) => fyForStartYear(current - i, biz.fyStartMonth).label);
  }, [today, biz.fyStartMonth]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select<PeriodKind>
        className="w-36"
        aria-label="Period type"
        value={value.kind}
        onValue={(kind) => onChange({ ...value, kind })}
        options={[
          { value: 'MONTH', label: 'Monthly' },
          { value: 'QUARTER', label: 'Quarterly (QRMP)' },
          ...(allowYear ? [{ value: 'YEAR' as const, label: 'Whole year' }] : []),
        ]}
      />
      {value.kind === 'MONTH' ? (
        <Input type="month" className="w-44" aria-label="Month" value={value.month} onChange={(e) => e.target.value && onChange({ ...value, month: e.target.value })} />
      ) : (
        <>
          <Select className="w-32" aria-label="Financial year" value={value.fy} onValue={(fy) => onChange({ ...value, fy })} options={fys.map((f) => ({ value: f, label: `FY ${f}` }))} />
          {value.kind === 'QUARTER' && (
            <Select
              className="w-36"
              aria-label="Quarter"
              value={String(value.quarter)}
              onValue={(q) => onChange({ ...value, quarter: Number(q) as 1 | 2 | 3 | 4 })}
              options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: quarterPeriod(value.fy, q as 1 | 2 | 3 | 4, biz.fyStartMonth).label }))}
            />
          )}
        </>
      )}
    </div>
  );
}
