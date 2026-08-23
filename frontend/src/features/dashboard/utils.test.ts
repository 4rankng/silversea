import { describe, expect, it } from 'vitest';
import { fmtMoM, previousPeriodOf, splitKpi } from './utils';

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
});
