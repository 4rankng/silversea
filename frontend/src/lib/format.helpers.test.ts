import { describe, expect, it } from 'vitest';
import { formatISODate, formatMoney, formatDateTimeShort } from './format';

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
});
