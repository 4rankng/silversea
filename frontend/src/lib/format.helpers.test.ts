import { describe, expect, it } from 'vitest';
import { formatISODate, formatMoney, formatDateTimeShort, formatCardTimeShort } from './format';

describe('formatMoney', () => {
  it('formats integers with vi-VN grouping and no symbol', () => {
    expect(formatMoney(12500000)).toBe('12.500.000');
  });
  it('accepts numeric strings from API payloads', () => {
    expect(formatMoney('3450000')).toBe('3.450.000');
  });
  it('renders an em dash for null/invalid', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('not-a-number')).toBe('—');
  });
});

describe('formatISODate', () => {
  it('renders zero-padded dd/mm/yyyy from an ISO date string', () => {
    expect(formatISODate('2026-08-19')).toBe('19/08/2026');
  });
  it('ignores any time component', () => {
    expect(formatISODate('2026-08-19T14:35:00Z')).toBe('19/08/2026');
  });
  it('renders an em dash for empty input and passes through non-dates', () => {
    expect(formatISODate(null)).toBe('—');
    expect(formatISODate('')).toBe('—');
    expect(formatISODate('pending')).toBe('pending');
  });
});

describe('formatDateTimeShort', () => {
  it('renders deterministic time-first 24h short date-time (Vietnam wall-clock)', () => {
    // Explicit time-first order regardless of engine locale ordering —
    // Node renders vi-VN toLocaleString time-first but Chrome date-first,
    // so the implementation must not rely on locale order (2026-09-09
    // hard requirement: time first, 24h, whenever date+time show together).
    expect(formatDateTimeShort('2026-08-19T10:30:00Z')).toBe('17:30 19/8/26');
    // Midnight and the zero-padded hour stay on the 24h clock.
    expect(formatDateTimeShort('2026-08-19T17:00:00Z')).toBe('00:00 20/8/26');
    expect(formatDateTimeShort('2026-08-19T10:30:00Z')).toMatch(/^\d{2}:\d{2} \d{1,2}\/\d{1,2}\/\d{2,4}$/);
  });
  it('renders an em dash for empty or invalid input', () => {
    expect(formatDateTimeShort(null)).toBe('—');
    expect(formatDateTimeShort('')).toBe('—');
    expect(formatDateTimeShort('garbage')).toBe('—');
  });
  it('renders naive draft values as Vietnam wall-clock, never the host zone', () => {
    // The ledger draft wire shape ("YYYY-MM-DDTHH:mm", +07:00 by convention
    // via localDateTimeToIso) must render identically to the equivalent +07
    // instant on ANY host — a GMT+8 host used to show 12:30 for a 13:30 draft.
    expect(formatDateTimeShort('2026-09-13T13:30')).toBe('13:30 13/9/26');
    // Same wall-clock, different wire shape — the two forms must agree.
    expect(formatDateTimeShort('2026-09-13T06:30:00Z')).toBe('13:30 13/9/26');
  });
  it('keeps naive entry on the 24h clock across the day', () => {
    expect(formatDateTimeShort('2026-08-19T00:15')).toBe('00:15 19/8/26');
    expect(formatDateTimeShort('2026-08-19T23:45')).toBe('23:45 19/8/26');
  });
});

describe('formatCardTimeShort', () => {
  it('pins the journey-card time to Vietnam wall-clock regardless of device timezone', () => {
    // 02:05Z = 09:05 VN — a device in UTC+8 must NOT show 10:05.
    expect(formatCardTimeShort('2026-09-07T02:05:00Z')).toBe('09:05 - 07/09');
  });
  it('rolls the date at the VN midnight boundary', () => {
    // 17:30Z on Sep 6 = 00:30 VN on Sep 7 — the date follows the hour.
    expect(formatCardTimeShort('2026-09-06T17:30:00Z')).toBe('00:30 - 07/09');
  });
  it('keeps the compact zero-padded no-year shape', () => {
    expect(formatCardTimeShort('2026-01-02T03:04:00Z')).toMatch(/^\d{2}:\d{2} - \d{2}\/\d{2}$/);
  });
  it('renders an em dash for empty or invalid input', () => {
    expect(formatCardTimeShort(null)).toBe('—');
    expect(formatCardTimeShort('')).toBe('—');
    expect(formatCardTimeShort('garbage')).toBe('—');
  });
});
