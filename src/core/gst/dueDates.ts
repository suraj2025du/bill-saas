import { addMonths, daysBetween, fyOf, quarterOf } from '../dates';
import type { ISODate } from '../model';

/**
 * QRMP GSTR-3B is due on the 22nd for these states/UTs and on the 24th for
 * all others (CGST Notification 76/2020 categories).
 */
const QRMP_22ND = new Set(['22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37']);

export interface Deadline {
  id: string;
  form: 'GSTR-1' | 'GSTR-3B';
  /** Return period label, e.g. 'Oct 2026' or 'Q3 (Oct-Dec 2026)'. */
  period: string;
  due: ISODate;
  daysLeft: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function onDay(monthStart: ISODate, day: number): ISODate {
  return `${monthStart.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

/**
 * Upcoming GSTR-1 / GSTR-3B deadlines within `horizonDays` of `today`
 * (including ones already overdue by up to 10 days).
 */
export function gstDeadlines(
  today: ISODate,
  filing: 'MONTHLY' | 'QUARTERLY',
  stateCode: string,
  horizonDays = 10,
): Deadline[] {
  const out: Deadline[] = [];
  const thisMonth = `${today.slice(0, 7)}-01`;
  for (const offset of [-1, 0]) {
    const periodStart = addMonths(thisMonth, offset);
    const dueMonth = addMonths(periodStart, 1);
    const ym = periodStart.slice(0, 7);
    if (filing === 'MONTHLY') {
      const label = `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
      out.push({ id: `gstr1-${ym}`, form: 'GSTR-1', period: label, due: onDay(dueMonth, 11), daysLeft: 0 });
      out.push({ id: `gstr3b-${ym}`, form: 'GSTR-3B', period: label, due: onDay(dueMonth, 20), daysLeft: 0 });
    } else {
      const q = quarterOf(periodStart);
      if (q.end.slice(0, 7) !== ym) continue; // only the last month of a quarter has returns due
      const fy = fyOf(periodStart).label;
      out.push({ id: `gstr1-${fy}-q${q.q}`, form: 'GSTR-1', period: q.label, due: onDay(dueMonth, 13), daysLeft: 0 });
      out.push({ id: `gstr3b-${fy}-q${q.q}`, form: 'GSTR-3B', period: q.label, due: onDay(dueMonth, QRMP_22ND.has(stateCode) ? 22 : 24), daysLeft: 0 });
    }
  }
  return out
    .map((d) => ({ ...d, daysLeft: daysBetween(today, d.due) }))
    .filter((d) => d.daysLeft <= horizonDays && d.daysLeft >= -10)
    .sort((a, b) => (a.due < b.due ? -1 : 1));
}
