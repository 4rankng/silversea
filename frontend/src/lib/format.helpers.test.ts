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
  it('renders short date-time for valid timestamps (vi-VN: time first, short date)', () => {
    // vi-VN short formatting is "HH:mm dd/M/yy" e.g. "17:30 19/8/26"
    expect(formatDateTimeShort('2026-08-19T10:30:00Z')).toMatch(/^\d{2}:\d{2} \d{1,2}\/\d{1,2}\/\d{2,4}$/);
  });
  it('renders an em dash for empty or invalid input', () => {
    expect(formatDateTimeShort(null)).toBe('—');
    expect(formatDateTimeShort('')).toBe('—');
    expect(formatDateTimeShort('garbage')).toBe('—');
  });
});
