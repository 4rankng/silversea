import { describe, expect, it } from 'vitest';
import {
  businessDateISO,
  formatBusinessRef,
  formatCurrency,
  formatDate,
  formatDateTimeShort,
  formatISODate,
  formatKm,
  formatLiters,
  formatMoney,
  formatNumber,
  formatPercent,
  formatViMonth,
} from './format';

describe('businessDateISO', () => {
  it('uses the Vietnam calendar date around the UTC rollover', () => {
    expect(businessDateISO(new Date('2026-07-27T17:30:00.000Z'))).toBe('2026-07-28');
    expect(businessDateISO(new Date('2026-07-28T16:59:59.000Z'))).toBe('2026-07-28');
    expect(businessDateISO(new Date('2026-07-28T17:00:00.000Z'))).toBe('2026-07-29');
  });
});

describe('formatDateTimeShort', () => {
  it('pins Vietnam wall-clock regardless of host timezone', () => {
    // 06:30Z = 13:30 +07 — the unpinned formatter rendered 14:30 on a +08 host.
    expect(formatDateTimeShort('2026-09-11T06:30:00Z')).toBe('13:30 11/09/2026');
    // Day rollover across zones: 17:30Z = 00:30 next day +07.
    expect(formatDateTimeShort('2026-09-10T17:30:00Z')).toBe('00:30 11/09/2026');
    expect(formatDateTimeShort('not-a-date')).toBe('—');
    expect(formatDateTimeShort(null)).toBe('—');
  });
});

// Card 20260922_52 — internal ids and machine-generated placeholders never
// render (design law §8 / card 20260919_38). The operator's 23/09 screenshot
// showed the fixture row's raw values on the board.
describe('formatBusinessRef', () => {
  it('hides the leaked q10 fixture signature and the INV-EMPTY placeholder', () => {
    expect(formatBusinessRef('INV-EMPTY-1790165053059-q10-8h9x64')).toBe('—');
    expect(formatBusinessRef('INV-EMPTY-1790038443239-q10-q63uv3')).toBe('—');
    expect(formatBusinessRef('Q10-1790165053059-q10-8h9x64-3')).toBe('—');
    expect(formatBusinessRef('Q10 customer 1790165053059-q10-8h9x64 3')).toBe('—');
  });

  it('keeps real business identifiers, and renders absent values as the house empty token', () => {
    expect(formatBusinessRef('HD-C18-01')).toBe('HD-C18-01');
    expect(formatBusinessRef('SHP-2609-00020')).toBe('SHP-2609-00020');
    expect(formatBusinessRef('INV-77/decl 1023456')).toBe('INV-77/decl 1023456');
    expect(formatBusinessRef('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH')).toBe('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH');
    expect(formatBusinessRef(null)).toBe('—');
    expect(formatBusinessRef('   ')).toBe('—');
  });
});

// Card 20260930_231 — the app-wide formatting convergence contract. One table
// per axis; per-feature aliases must never reintroduce their own rounding,
// timezone, or empty-state behavior.
describe('money rounding contract (formatMoney)', () => {
  it.each([
    [0, '0'],
    [12500, '12.500'],
    [1234567890, '1.234.567.890'],
    // Intl vi-VN at zero fraction digits rounds half-away-from-zero —
    // pinned here as THE rounding (Math.round and default-Intl per-feature
    // variants are gone).
    [1234.5, '1.235'],
    [1235.5, '1.236'],
    [-1234.5, '-1.235'],
    ['12500', '12.500'],
  ])('formatMoney(%p) → %p', (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });
});

describe('empty-state contract', () => {
  it.each([
    [null], [undefined as unknown as null], [NaN],
  ])('renders the house empty token for %p across formatters', (input) => {
    expect(formatMoney(input)).toBe('—');
    expect(formatNumber(input)).toBe('—');
    expect(formatCurrency(input)).toBe('— ₫');
    expect(formatDate(input as string | null)).toBe('—');
    expect(formatISODate(input as string | null)).toBe('—');
  });

  it('pins the pre-existing edge semantics exactly as the canonical module behaves', () => {
    // Number('') === 0 — a blank string parses to zero in formatMoney but to
    // NaN in formatNumber (parseFloat). Pinned as-is: convergence changes
    // per-feature aliases, not the canonical module's public behavior.
    expect(formatMoney('')).toBe('0');
    expect(formatNumber('')).toBe('—');
    // formatNumber rejects NaN only — Infinity renders via Intl. Real inputs
    // never carry it; the pin keeps the contract explicit.
    expect(formatNumber(Infinity)).toBe('∞');
    expect(formatMoney(Infinity)).toBe('—');
    // formatISODate echoes junk non-empty strings back (raw fallback).
    expect(formatISODate('abc')).toBe('abc');
  });

  it('honors the per-surface empty label override', () => {
    expect(formatMoney(null, { empty: '-' })).toBe('-');
    expect(formatCurrency(null, { empty: 'Chưa có' })).toBe('Chưa có');
    expect(formatISODate(null, { empty: 'Chưa có dữ liệu lịch sử' })).toBe('Chưa có dữ liệu lịch sử');
    expect(formatISODate('', { empty: 'Chưa có ngày' })).toBe('Chưa có ngày');
  });
});

describe('timezone pinning (dates read as Vietnam wall-clock on any host)', () => {
  it('formatDate rolls to the Vietnam calendar day across the UTC boundary', () => {
    // 17:30Z on Sep 10 is already 00:30 Sep 11 in +07.
    expect(formatDate('2026-09-10T17:30:00Z')).toBe('11/09/2026');
    expect(formatDate('2026-09-11T06:30:00Z')).toBe('11/09/2026');
  });

  it('formatISODate converts instants but reads date-only strings directly (the app-settings formatViDate drift)', () => {
    expect(formatISODate('2026-06-01T18:30:00Z')).toBe('02/06/2026');
    expect(formatISODate('2026-06-02T00:30:00+07:00')).toBe('02/06/2026');
    // Date-only strings must never shift, whatever the host timezone.
    expect(formatISODate('2026-06-02')).toBe('02/06/2026');
  });
});

describe('unit formatters (axis absorbed from the per-feature alias modules)', () => {
  it.each([
    [94.8, '94,8 L'],
    [100, '100,0 L'],
    [0, '0,0 L'],
  ])('formatLiters(%p) → %p', (input, expected) => {
    expect(formatLiters(input)).toBe(expected);
  });

  it.each([
    [135, '135 km'],
    [1234.6, '1.235 km'],
  ])('formatKm(%p) → %p', (input, expected) => {
    expect(formatKm(input)).toBe(expected);
  });

  it.each([
    [60.9, '60,9'],
    [0, '0,0'],
  ])('formatPercent(%p) → %p', (input, expected) => {
    expect(formatPercent(input)).toBe(expected);
  });

  it.each([
    ['2026-06-18', '06/2026'],
    ['2026-11', '11/2026'],
    ['', '—'],
  ])('formatViMonth(%p) → %p', (input, expected) => {
    expect(formatViMonth(input)).toBe(expected);
  });

  it('caps fraction digits for non-money measures without rounding money', () => {
    expect(formatNumber(94.85, { decimals: 1 })).toBe('94,9');
    expect(formatNumber(94.84, { decimals: 1 })).toBe('94,8');
    expect(formatNumber(1234.5678, { decimals: 4 })).toBe('1.234,5678');
    expect(formatNumber(100, { decimals: 1 })).toBe('100');
  });

  it('renders the house empty token for missing measures', () => {
    expect(formatLiters(null)).toBe('—');
    expect(formatKm(null)).toBe('—');
    expect(formatPercent(null)).toBe('—');
  });
});
