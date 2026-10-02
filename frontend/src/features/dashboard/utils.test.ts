import { describe, expect, it } from 'vitest';
import { buildPieSlices, fmtMoM, monthlyChange, previousComparisonValues, previousPeriodOf, splitKpi } from './utils';

describe('splitKpi', () => {
  it('keeps VND KPI amounts as full Vietnamese numbers', () => {
    expect(splitKpi(30_430_000)).toEqual({ num: '30.430.000', suffix: '' });
  });
});

describe('previousPeriodOf', () => {
  it('returns the previous calendar month in the same year', () => {
    // The dashboard's MoM pills must compare Aug 2026 against Jul 2026 —
    // not Aug 2025, which always came back empty and rendered "Mới".
    expect(previousPeriodOf(8, 2026)).toEqual({ month: 7, year: 2026 });
    expect(previousPeriodOf(12, 2026)).toEqual({ month: 11, year: 2026 });
  });

  it('rolls January back to December of the prior year', () => {
    expect(previousPeriodOf(1, 2026)).toEqual({ month: 12, year: 2025 });
  });
});

describe('fmtMoM', () => {
  it('renders a signed percentage when a previous value exists', () => {
    expect(fmtMoM(110, 100)).toBe('+10.0%');
    expect(fmtMoM(90, 100)).toBe('-10.0%');
  });

  it('distinguishes unknown previous data from a genuine zero baseline', () => {
    expect(fmtMoM(110, null)).toBe('—');
    expect(fmtMoM(110, 0)).toBe('Mới');
    expect(fmtMoM(0, 0)).toBe('0%');
  });

  it('keeps the direction of recovery and deepening loss against a negative baseline', () => {
    expect(fmtMoM(2_850_000, -110_000)).toBe('+2690.9%');
    expect(fmtMoM(-200, -100)).toBe('-100.0%');
    expect(fmtMoM(-50, -100)).toBe('+50.0%');
    expect(fmtMoM(-100, -100)).toBe('0.0%');
    expect(fmtMoM(-100, 0)).toBe('Mới');
  });
});

describe('monthly comparison direction and source', () => {
  it('distinguishes numerical movement from an unknown or zero prior report', () => {
    expect(monthlyChange(-100, 0)).toEqual({ label: 'Mới', direction: 'down' });
    expect(monthlyChange(100, 0)).toEqual({ label: 'Mới', direction: 'up' });
    expect(monthlyChange(0, 0)).toEqual({ label: '0%', direction: 'flat' });
    expect(monthlyChange(100, null)).toEqual({ label: '—', direction: 'flat' });
    expect(monthlyChange(-50, -100)).toEqual({ label: '+50.0%', direction: 'up' });
  });

  it('preserves missing prior report fields as unknown while retaining real zero and loss', () => {
    expect(previousComparisonValues(undefined)).toEqual({ prevRevenue: null, prevCosts: null, prevGross: null, prevNet: null });
    expect(previousComparisonValues({ totalRevenue: 0, totalCosts: 110_000, grossProfit: -110_000, netProfit: null }))
      .toEqual({ prevRevenue: 0, prevCosts: 110_000, prevGross: -110_000, prevNet: null });
  });
});


describe('recognized cost distribution (UI81)', () => {
  it('retains signed adjustments and exposes no positive partition for a signed net', () => {
    const rows = buildPieSlices([
      { label: 'Fuel', value: 100, color: 'green' },
      { label: 'Adjustment', value: -30, color: 'red' },
    ]);
    expect(rows.totalPie).toBe(70);
    expect(rows.slicesWithPct.map(row => row.value)).toEqual([100, -30]);
    expect(rows.slicesWithPct.every(row => row.pct === null)).toBe(true);
    expect(rows.conicGradient).toBe('none');
  });

  it('retains a sub-unit amount and a rounded zero-percent row', () => {
    const rows = buildPieSlices([
      { label: 'Fuel', value: 1000, color: 'green' },
      { label: 'Small adjustment', value: 0.25, color: 'red' },
    ]);
    expect(rows.totalPie).toBe(1000.25);
    expect(rows.slicesWithPct).toHaveLength(2);
    expect(rows.slicesWithPct[1]).toMatchObject({ value: 0.25, pct: 0 });
    expect(rows.slicesWithPct.reduce((sum, row) => sum + (row.pct ?? 0), 0)).toBe(100);
  });

  it('keeps true zero and cancelling costs instead of inventing a denominator', () => {
    expect(buildPieSlices([])).toMatchObject({ totalPie: 0, slicesWithPct: [], conicGradient: 'none' });
    const cancelled = buildPieSlices([{ label: 'Debit', value: 1, color: 'green' }, { label: 'Credit', value: -1, color: 'red' }]);
    expect(cancelled.totalPie).toBe(0);
    expect(cancelled.slicesWithPct).toHaveLength(2);
    expect(cancelled.conicGradient).toBe('none');
    expect(monthlyChange(null, 100)).toEqual({ label: '—', direction: 'flat' });
  });
});
