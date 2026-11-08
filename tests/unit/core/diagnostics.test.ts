import { describe, expect, it } from 'vitest';
import { MAX_ERRORS, addError, describeError, errorNotification, isNoise } from '../../../src/core/diagnostics';
import type { ErrorRecord } from '../../../src/core/diagnostics';

const entry = (at: string, message: string, route = '/sales', detail = '') => ({ at, source: 'action' as const, message, detail, route, version: '1.0.0' });

describe('diagnostics log', () => {
  it('describes anything that was thrown', () => {
    const boom = new Error('Boom');
    expect(describeError(boom).message).toBe('Boom');
    expect(describeError(boom).detail).toContain('Boom');
    expect(describeError(new TypeError('')).message).toBe('TypeError');
    expect(describeError('plain text')).toEqual({ message: 'plain text', detail: '' });
    expect(describeError({ code: 7 })).toEqual({ message: '{"code":7}', detail: '' });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular).message).toBe('[object Object]');
    expect(describeError(undefined).message).toBe('undefined');
    expect(describeError('x'.repeat(400)).message).toHaveLength(300);
  });

  it('ignores browser notices that are not app errors', () => {
    expect(isNoise('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isNoise('Script error.')).toBe(true);
    expect(isNoise('Cannot read properties of undefined')).toBe(false);
  });

  it('counts repeats per screen and day, newest first', () => {
    let log: ErrorRecord[] = [];
    log = addError(log, entry('2026-11-06T10:00:00.000Z', 'A', '/sales', 'stack 1'));
    log = addError(log, entry('2026-11-06T10:05:00.000Z', 'A'));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ count: 2, at: '2026-11-06T10:05:00.000Z', detail: 'stack 1' });
    log = addError(log, entry('2026-11-06T11:00:00.000Z', 'A', '/parties'));
    log = addError(log, entry('2026-11-07T09:00:00.000Z', 'A'));
    expect(log.map((r) => [r.route, r.at.slice(0, 10), r.count])).toEqual([
      ['/sales', '2026-11-07', 1],
      ['/parties', '2026-11-06', 1],
      ['/sales', '2026-11-06', 2],
    ]);
    expect(new Set(log.map((r) => r.id)).size).toBe(3);
  });

  it(`keeps only the newest ${MAX_ERRORS} errors`, () => {
    let log: ErrorRecord[] = [];
    for (let i = 0; i < 60; i++) log = addError(log, entry(`2026-11-06T10:00:${String(i).padStart(2, '0')}.000Z`, `E${i}`));
    expect(log).toHaveLength(MAX_ERRORS);
    expect(log[0].message).toBe('E59');
    expect(log[MAX_ERRORS - 1].message).toBe('E10');
  });

  it('raises one bell notice for problems since the last visit to Diagnostics', () => {
    expect(errorNotification([], '')).toBeNull();
    let log: ErrorRecord[] = [];
    log = addError(log, entry('2026-11-06T10:00:00.000Z', 'A'));
    log = addError(log, entry('2026-11-06T10:01:00.000Z', 'A'));
    log = addError(log, entry('2026-11-07T09:00:00.000Z', 'Saving failed'));
    expect(errorNotification(log, '')).toEqual({
      id: 'errors-2026-11-07T09:00:00.000Z',
      kind: 'ERROR',
      severity: 'warning',
      title: '3 app problems recorded',
      detail: 'Saving failed',
      href: '/settings/diagnostics',
    });
    expect(errorNotification(log, '2026-11-06T12:00:00.000Z')?.title).toBe('1 app problem recorded');
    expect(errorNotification(log, '2026-11-07T09:00:00.000Z')).toBeNull();
  });
});
