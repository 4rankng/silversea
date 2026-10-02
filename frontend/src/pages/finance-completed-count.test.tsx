import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PnlReport, TripDetail } from '@tingting/shared';

import { useFinanceDerived } from './finance-derived';

const baseReport = (over: Partial<PnlReport> = {}): PnlReport => ({
  period: { month: 9, year: 2026 },
  totalRevenue: 0,
  totalCosts: 0,
  grossProfit: 0,
  managementFee: 0,
  otherIncome: 0,
  netProfit: 0,
  tripCount: 4,
  trucks: [],
  maintenanceExpensesTotal: 0,
  maintenanceExpensesByTruck: {},
  maintenanceByComponent: {},
  companyExpenses: 0,
  categoryBreakdown: [],
  ...over,
});

const completedZeroTrip = (id: number) => ({
  id,
  status: 'COMPLETED',
  departureDate: '2026-09-10',
  revenue: '0',
  grossProfit: 0,
}) as unknown as TripDetail;

function runDerived(over: Partial<Parameters<typeof useFinanceDerived>[0]> = {}) {
  const { result } = renderHook(() => useFinanceDerived({
    allTrips: [completedZeroTrip(1), completedZeroTrip(2), completedZeroTrip(3), completedZeroTrip(4)],
    report: baseReport(),
    capTableRaw: [],
    yearlyData: Array.from({ length: 12 }, (_, i) => (i === 8 ? baseReport() : null)),
    month: 9,
    ...over,
  }));
  return result.current;
}

// The no-trip empty state must key on completed-trip presence, never on the
// chart series: all-zero buckets are filtered OUT of the series, which used
// to make completed-but-zero report data claim "no completed trips".
describe('useFinanceDerived completedTripCount', () => {
  it('the card state — 4 completed zero-revenue trips — counts 4 with an empty chart series', () => {
    const d = runDerived();
    expect(d.completedTripCount).toBe(4);
    expect(d.hasChartData).toBe(false);
  });

  it('reports with no recognized trips count 0 regardless of operational work', () => {
    const d = runDerived({
      allTrips: [{ id: 9, status: 'CREATED', departureDate: '2026-09-10' } as unknown as TripDetail],
      yearlyData: Array.from({ length: 12 }, (_, i) => i === 8 ? baseReport({ tripCount: 0 }) : null),
    });
    expect(d.completedTripCount).toBe(0);
  });

  it('the monthly chart sums the yearly reports’ real tripCount field', () => {
    const d = runDerived({
      yearlyData: Array.from({ length: 12 }, (_, i) => (i === 7 || i === 8 ? baseReport({ tripCount: i === 7 ? 5 : 4 }) : null)),
    });
    expect(d.completedTripCount).toBe(9);
  });

  it('positive-revenue months keep the chart (unchanged behavior)', () => {
    const d = runDerived({
      allTrips: [{ ...completedZeroTrip(1), revenue: '10000000', grossProfit: 2000000 } as unknown as TripDetail],
      report: baseReport({ totalRevenue: 10_000_000, grossProfit: 2_000_000 }),
      yearlyData: Array.from({ length: 12 }, (_, i) => i === 8 ? baseReport({ totalRevenue: 10_000_000, grossProfit: 2_000_000 }) : null),
    });
    expect(d.hasChartData).toBe(true);
  });
});
