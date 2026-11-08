import { addDays, addMonths, daysBetween } from '../dates';
import { emptyDispatch } from '../factories';
import { newId, nowISO } from '../ids';
import type { ISODate, RecurringFrequency, RecurringRule, SalesDocument } from '../model';

export function nextRecurringDate(date: ISODate, frequency: RecurringFrequency): ISODate {
  switch (frequency) {
    case 'WEEKLY':
      return addDays(date, 7);
    case 'MONTHLY':
      return addMonths(date, 1);
    case 'QUARTERLY':
      return addMonths(date, 3);
    case 'YEARLY':
      return addMonths(date, 12);
  }
}

export interface RecurringRun {
  source: SalesDocument;
  /** Dates of the copies to create (oldest first). */
  dates: ISODate[];
  /** Rule to store on the source after generating. */
  nextRule: RecurringRule;
}

/** Recurring sources with copies due on or before `today` (capped per source to avoid floods). */
export function dueRecurringRuns(docs: readonly SalesDocument[], today: ISODate, maxPerSource = 12): RecurringRun[] {
  const runs: RecurringRun[] = [];
  for (const source of docs) {
    const rule = source.recurring;
    if (!rule?.enabled || source.status === 'CANCELLED') continue;
    const dates: ISODate[] = [];
    let next = rule.nextDate;
    while (next <= today && (!rule.endDate || next <= rule.endDate) && dates.length < maxPerSource) {
      dates.push(next);
      next = nextRecurringDate(next, rule.frequency);
    }
    if (!dates.length) continue;
    const ended = Boolean(rule.endDate) && next > rule.endDate;
    runs.push({ source, dates, nextRule: { ...rule, nextDate: next, enabled: !ended } });
  }
  return runs;
}

/**
 * A FINAL copy of the source dated `date` (number left blank for the caller
 * to assign from the series). Due date keeps the source's credit period.
 */
export function makeRecurringCopy(source: SalesDocument, date: ISODate): SalesDocument {
  const now = nowISO();
  const credit = source.dueDate ? Math.max(0, daysBetween(source.date, source.dueDate)) : 0;
  return {
    ...source,
    id: newId('doc'),
    status: 'FINAL',
    number: '',
    date,
    dueDate: source.dueDate ? addDays(date, credit) : '',
    items: source.items.map((i) => ({ ...i, id: newId('li') })),
    dispatch: emptyDispatch(),
    recurring: null,
    recurringSourceId: source.id,
    convertedToId: '',
    refDocId: '',
    refDocNumber: '',
    refDocDate: '',
    cancelReason: '',
    cancelledAt: '',
    createdAt: now,
    updatedAt: now,
  };
}
