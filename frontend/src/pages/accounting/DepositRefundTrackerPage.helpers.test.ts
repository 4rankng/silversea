import { describe, expect, test, vi } from 'vitest';
import { depositRecovered, depositRemaining, nextExpectedRefundDefault, parseDepositAmount, vnTodayIso } from './DepositRefundTrackerPage';

describe('card 20260921_19 - deposit tracker FE helpers', () => {
  test('money parser preserves whole VND and rejects signs, decimals and malformed grouping', () => {
    for (const value of ['4000000', '4.000.000', '4,000,000']) expect(parseDepositAmount(value)).toBe(4000000);
    expect(parseDepositAmount('999999999999999')).toBe(999999999999999);
    for (const value of ['', '0', '-4000000', '1.5', '1,50', '1e6', '4.000,000', '9007199994740992', '1000000000000000']) {
      expect(() => parseDepositAmount(value)).toThrow('Số tiền cược phải là số nguyên dương.');
    }
  });

  test('nextExpectedRefundDefault adds 14 days to the CV date', () => {
    expect(nextExpectedRefundDefault('2026-09-28')).toBe('2026-10-12');
    expect(nextExpectedRefundDefault(null)).toBeNull();
  });

  // SIL-1061 — đã hoàn/còn lại đọc từ cột mới; dòng cũ không cột = chưa hoàn gì.
  test('deposit recovered/remaining read the partial-recovery fields', () => {
    expect(depositRecovered({ depositAmount: '2000000', recoveredAmount: '500000' })).toBe(500000);
    expect(depositRecovered({ depositAmount: '2000000', recoveredAmount: null })).toBe(0);
    expect(depositRemaining({ depositAmount: '2000000', recoveredAmount: '500000' })).toBe(1500000);
    expect(depositRemaining({ depositAmount: '2000000', recoveredAmount: null })).toBe(2000000);
    expect(depositRemaining({ depositAmount: '2000000', recoveredAmount: '2000000' })).toBe(0);
  });

  test('vnTodayIso returns the VN calendar day (fixed UTC+7)', () => {
    // 25/11 20:00 UTC đã là 26/11 tại VN.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-25T20:00:00Z'));
    try {
      expect(vnTodayIso()).toBe('2026-11-26');
      vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-25T16:00:00Z'));
      expect(vnTodayIso()).toBe('2026-11-25');
    } finally {
      vi.restoreAllMocks();
    }
  });
});
