import { describe, expect, it } from 'vitest';
import {
  formatTimeShortDate,
  formatVietnamDateTimeInput,
  localDateTimeToIso,
} from './shipment-operations';

describe('shipment operational timestamps', () => {
  it('encodes Vietnam wall-clock input with an explicit offset', () => {
    expect(localDateTimeToIso('2026-07-29T10:00')).toBe('2026-07-29T10:00:00+07:00');
    expect(new Date(localDateTimeToIso('2026-07-29T10:00')!).toISOString())
      .toBe('2026-07-29T03:00:00.000Z');
  });

  it('round-trips stored instants through Vietnam wall-clock time', () => {
    const input = formatVietnamDateTimeInput('2026-07-29T03:00:00.000Z');
    expect(input).toBe('2026-07-29T10:00');
    expect(new Date(localDateTimeToIso(input)!).toISOString())
      .toBe('2026-07-29T03:00:00.000Z');
  });

  it('rejects impossible calendar dates', () => {
    expect(() => localDateTimeToIso('2026-02-30T10:00'))
      .toThrow('Thời gian vận hành không hợp lệ.');
  });

  // SIL-483: the drawer's ghost appointment mask drops the year — "HH:mm
  // DD/MM" over the naive local draft; empty/invalid stays ''.
  it('masks the appointment as HH:mm DD/MM (year rides the title)', () => {
    expect(formatTimeShortDate('2026-09-11T09:05')).toBe('09:05 11/09');
    expect(formatTimeShortDate('2026-12-01T23:59')).toBe('23:59 01/12');
    expect(formatTimeShortDate(null)).toBe('');
    expect(formatTimeShortDate('not-a-date')).toBe('');
  });
});
