import { describe, expect, test } from 'vitest';
import { formatDepositDate, nextExpectedRefundDefault } from './DepositRefundTrackerPage';

describe('card 20260921_19 - deposit tracker FE helpers', () => {
  test('formatDepositDate renders dd/mm/yy and dashes for null', () => {
    expect(formatDepositDate('2026-09-28')).toBe('28/09/26');
    expect(formatDepositDate(null)).toBe('—');
  });

  test('nextExpectedRefundDefault adds 14 days to the CV date', () => {
    expect(nextExpectedRefundDefault('2026-09-28')).toBe('2026-10-12');
    expect(nextExpectedRefundDefault(null)).toBeNull();
  });
});
