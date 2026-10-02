import { describe, expect, test } from 'vitest';
import { formatDepositDate, nextExpectedRefundDefault, parseDepositAmount } from './DepositRefundTrackerPage';

describe('card 20260921_19 - deposit tracker FE helpers', () => {
  test('money parser preserves whole VND and rejects signs, decimals and malformed grouping', () => {
    for (const value of ['4000000', '4.000.000', '4,000,000']) expect(parseDepositAmount(value)).toBe(4000000);
    expect(parseDepositAmount('999999999999999')).toBe(999999999999999);
    for (const value of ['', '0', '-4000000', '1.5', '1,50', '1e6', '4.000,000', '9007199254740992', '1000000000000000']) {
      expect(() => parseDepositAmount(value)).toThrow('Số tiền cược phải là số nguyên dương.');
    }
  });
  test('formatDepositDate renders dd/mm/yy and dashes for null', () => {
    expect(formatDepositDate('2026-09-28')).toBe('28/09/26');
    expect(formatDepositDate(null)).toBe('—');
  });

  test('nextExpectedRefundDefault adds 14 days to the CV date', () => {
    expect(nextExpectedRefundDefault('2026-09-28')).toBe('2026-10-12');
    expect(nextExpectedRefundDefault(null)).toBeNull();
  });
});
