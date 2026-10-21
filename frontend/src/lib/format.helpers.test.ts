import { describe, expect, it } from 'vitest';
import { formatISODate, formatMoney, formatDateTimeShort, formatVolumeCbm, formatWeight } from './format';

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
    expect(formatDateTimeShort('2026-08-19T10:30:00Z')).toBe('17:30 19/08/2026');
    // Midnight and the zero-padded hour stay on the 24h clock.
    expect(formatDateTimeShort('2026-08-19T17:00:00Z')).toBe('00:00 20/08/2026');
    expect(formatDateTimeShort('2026-08-19T10:30:00Z')).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
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
    expect(formatDateTimeShort('2026-09-13T13:30')).toBe('13:30 13/09/2026');
    // Same wall-clock, different wire shape — the two forms must agree.
    expect(formatDateTimeShort('2026-09-13T06:30:00Z')).toBe('13:30 13/09/2026');
  });
  it('keeps naive entry on the 24h clock across the day', () => {
    expect(formatDateTimeShort('2026-08-19T00:15')).toBe('00:15 19/08/2026');
    expect(formatDateTimeShort('2026-08-19T23:45')).toBe('23:45 19/08/2026');
  });
});

describe('formatVolumeCbm (FB-091)', () => {
  it('groups like every house measure and drops the stored trailing zeros', () => {
    expect(formatVolumeCbm('4.000')).toBe('4 CBM');
    expect(formatVolumeCbm(4)).toBe('4 CBM');
    expect(formatVolumeCbm('52.5')).toBe('52,5 CBM');
    expect(formatVolumeCbm('1250.75')).toBe('1.250,75 CBM');
  });
  it('keeps the column\'s third fraction digit and rounds nothing away', () => {
    // cargo_volume_cbm is numeric(12,3): a stored 4.125 must survive, and a
    // 4th digit is the one thing the 3-digit cap is allowed to drop.
    expect(formatVolumeCbm('4.125')).toBe('4,125 CBM');
    expect(formatVolumeCbm('4.1254')).toBe('4,125 CBM');
  });
  it('renders an em dash for null/empty and echoes a bad column value verbatim', () => {
    expect(formatVolumeCbm(null)).toBe('—');
    expect(formatVolumeCbm(undefined)).toBe('—');
    expect(formatVolumeCbm('')).toBe('—');
    // A bad column value is echoed exactly as the record states it, with no unit
    // appended — the same contract formatWeight keeps ("NaN tấn" is never shown).
    expect(formatVolumeCbm('n/a')).toBe('n/a');
    // Whitespace is not "empty": Number('   ') is 0, exactly as formatWeight
    // treats it ("0 tấn"). Pinned so the two house measures cannot drift apart.
    expect(formatVolumeCbm('   ')).toBe(formatWeight('   ').replace('tấn', 'CBM'));
  });
});

describe('formatWeight in tấn (CUS-08, QA 21/10 — tickets 211026125242/211026125715/211026125815)', () => {
  // The customer doc writes container weights as "5.000" / "18.500" and wants
  // "5" / "18,5": storage is kg (numeric(10,2) — "21000.00"), display is tấn
  // with the vi-VN decimal comma and no dead zeros after it.
  it('converts stored kg to tấn and strips the dead decimals', () => {
    expect(formatWeight('5000')).toBe('5 tấn');
    expect(formatWeight('18500')).toBe('18,5 tấn');
    expect(formatWeight('4000.00')).toBe('4 tấn');
    expect(formatWeight('21000.00')).toBe('21 tấn');
    expect(formatWeight(17500)).toBe('17,5 tấn');
    expect(formatWeight('1922')).toBe('1,922 tấn');
    expect(formatWeight('500')).toBe('0,5 tấn');
    expect(formatWeight('0')).toBe('0 tấn');
  });
  it('keeps the empty and verbatim-echo contract of the other house measures', () => {
    expect(formatWeight(null)).toBe('—');
    expect(formatWeight(undefined)).toBe('—');
    expect(formatWeight('')).toBe('—');
    expect(formatWeight('n/a')).toBe('n/a');
  });
});
