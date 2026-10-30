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

  // SIL-483 / SIL-613: the drawer's ghost appointment mask drops the year — "DD/MM
  // HH:mm" over the naive local draft; empty/invalid stays ''.
  it('masks the appointment as DD/MM HH:mm (year rides the title)', () => {
    expect(formatTimeShortDate('2026-09-11T09:05')).toBe('11/09 09:05');
    expect(formatTimeShortDate('2026-12-01T23:59')).toBe('01/12 23:59');
    expect(formatTimeShortDate(null)).toBe('');
    expect(formatTimeShortDate('not-a-date')).toBe('');
  });

  // SIL-595 (id 695) — the CUS drawer's "Đóng / trả" column and "Lịch cont"
  // lines feed RAW server instants (`Date.toISOString()` — Z-suffixed UTC)
  // into this mask. Zone-suffixed values must render the Vietnam wall-clock;
  // naive drafts keep the string-surgery contract above.
  it('SIL-595-C1: renders a Z-suffixed instant in the Vietnam hour, not the UTC digits', () => {
    expect(formatTimeShortDate('2026-10-30T07:30:00.000Z')).toBe('30/10 14:30');
    // UTC-midnight-adjacent instant rolls to the next VN calendar day.
    expect(formatTimeShortDate('2026-10-29T17:00:00.000Z')).toBe('30/10 00:00');
  });

  it('SIL-595-C2: a +07:00 instant keeps its wall-clock digits; naive drafts are untouched', () => {
    expect(formatTimeShortDate('2026-10-30T14:30:00+07:00')).toBe('30/10 14:30');
    expect(formatTimeShortDate('2026-10-30T14:30')).toBe('30/10 14:30');
  });

  it('SIL-595-C2b: naive-with-seconds stays string surgery; a colon-less offset is still a real instant', () => {
    expect(formatTimeShortDate('2026-10-30T14:30:00')).toBe('30/10 14:30');
    // '+0000' (no colon) is a zone suffix too — never naive digits (review).
    expect(formatTimeShortDate('2026-10-30T07:30:00+0000')).toBe('30/10 14:30');
  });
});
