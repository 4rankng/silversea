import { describe, expect, it } from 'vitest';
import { settlementBalanceSummary } from './SettlementPrintPage';

describe('direct advance-settlement accounting policy', () => {
  it('shows the persisted refund separately from the remaining settlement difference', () => {
    expect(settlementBalanceSummary(700_000, 630_000, 70_000)).toEqual({
      balance: 0,
      label: 'Chênh lệch sau quyết toán',
    });
    expect(settlementBalanceSummary(700_000, 630_000, 0)).toEqual({
      balance: 70_000,
      label: 'Còn dư chưa hoàn',
    });
  });
});
