import { describe, expect, it } from 'vitest';
import { summarizeSettlementExpenses } from './admin-advance-settlement-summary';

describe('summarizeSettlementExpenses', () => {
  it('describes an empty settlement without inventing linked scope', () => {
    expect(summarizeSettlementExpenses(undefined)).toEqual({
      expenseCount: 0,
      tripCount: 0,
      containerCount: 0,
      label: '0 khoản chi · Chưa có phạm vi liên kết',
    });
  });

  it('counts expenses while deduplicating trips and normalized containers', () => {
    const summary = summarizeSettlementExpenses([
      { tripId: 101, containerNumber: ' FTAU1655851 ' },
      { tripId: 101, containerNumber: 'FTAU1655851' },
      { tripId: 102, containerNumber: 'DFSU7612721' },
      { tripId: 103, containerNumber: null },
    ]);

    expect(summary).toEqual({
      expenseCount: 4,
      tripCount: 3,
      containerCount: 2,
      label: '4 khoản chi · 3 chuyến · 2 container',
    });
  });

  it('does not count blank container labels as containers', () => {
    const summary = summarizeSettlementExpenses([
      { tripId: 201, containerNumber: '' },
      { tripId: 202, containerNumber: '   ' },
    ]);

    expect(summary.containerCount).toBe(0);
    expect(summary.label).toBe('2 khoản chi · 2 chuyến · 0 container');
  });
});
