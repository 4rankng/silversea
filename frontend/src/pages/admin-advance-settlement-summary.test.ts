import { describe, expect, it } from 'vitest';
import { groupSettlementExpensesByTrip, summarizeSettlementExpenses } from './admin-advance-settlement-summary';

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

  it('counts each numberless LCL lot as 1 virtual cont (SIL-601)', () => {
    const summary = summarizeSettlementExpenses([
      { tripId: 301, shipmentId: 901, containerNumber: null, cargoMode: 'LCL' },
      { tripId: 301, shipmentId: 901, containerNumber: null, cargoMode: 'LCL' },
      { tripId: 302, shipmentId: 902, containerNumber: null, cargoMode: 'LCL' },
      { tripId: 303, shipmentId: 903, containerNumber: 'FTAU0000001', cargoMode: 'FCL' },
    ]);

    // 2 numberless LCL lots = 2 cont; the FCL number stays 1.
    expect(summary.containerCount).toBe(3);
    expect(summary.label).toBe('4 khoản chi · 3 chuyến · 3 container');
  });

  it('one LCL lot moved via several trips still counts 1 (SIL-601 review M1)', () => {
    const summary = summarizeSettlementExpenses([
      { tripId: 311, shipmentId: 911, containerNumber: null, cargoMode: 'LCL' },
      { tripId: 312, shipmentId: 911, containerNumber: null, cargoMode: 'LCL' },
    ]);

    expect(summary.containerCount).toBe(1);
    expect(summary.label).toBe('2 khoản chi · 2 chuyến · 1 container');
  });

  it('an LCL trip whose expense carries a cont number is counted once (SIL-601)', () => {
    const summary = summarizeSettlementExpenses([
      { tripId: 401, containerNumber: 'FTAU0000002', cargoMode: 'LCL' },
      { tripId: 401, containerNumber: null, cargoMode: 'LCL' },
    ]);

    expect(summary.containerCount).toBe(1);
  });
});

describe('groupSettlementExpensesByTrip', () => {
  const baseExpense = {
    expenseType: 'FUEL',
    buyAmount: '100000',
  };

  it('an LCL plan row reads 1 cont regardless of numbers (SIL-601)', () => {
    const rows = groupSettlementExpensesByTrip([
      { ...baseExpense, tripId: 501, containerNumber: null, cargoMode: 'LCL', tripContainerCount: null },
      { ...baseExpense, tripId: 501, containerNumber: null, cargoMode: 'LCL', tripContainerCount: null },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].containerCount).toBe(1);
  });

  it('FCL plan rows keep the max(numbers, trip count) law', () => {
    const rows = groupSettlementExpensesByTrip([
      { ...baseExpense, tripId: 601, containerNumber: 'FTAU0000003', cargoMode: 'FCL', tripContainerCount: 2 },
      { ...baseExpense, tripId: 601, containerNumber: 'FTAU0000004', cargoMode: 'FCL', tripContainerCount: 2 },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].containerCount).toBe(2);
  });
});
