import { describe, expect, it } from 'vitest';

import { deriveTripCostBreakdown, yoyClass, yoyPct } from './finance-derived';
import type { PnlReport } from '../hooks/useQueries';

describe('recognized report comparisons (UI75)', () => {
  it('preserves actual movement across negative and zero baselines', () => {
    expect(yoyPct(2_850_000, -110_000)).toBe('+2690.9%');
    expect(yoyPct(-200, -100)).toBe('-100.0%');
    expect(yoyPct(-50, -100)).toBe('+50.0%');
    expect(yoyPct(-100, 0)).toBe('Mới');
    expect(yoyPct(0, 0)).toBe('0%');
    expect(yoyPct(-100, -100)).toBe('0.0%');
    expect(yoyPct(null, 0)).toBe('—');
    expect(yoyPct(100, null)).toBe('—');
  });

  it('keeps expenses lower-favorable and equality/unknown neutral', () => {
    expect(yoyClass(100, 50, 'down')).toBe('pnl-row__pct--down');
    expect(yoyClass(50, 100, 'down')).toBe('pnl-row__pct--up');
    expect(yoyClass(100, 100)).toBe('');
    expect(yoyClass(100, null)).toBe('');
    expect(yoyClass(-50, -100)).toBe('pnl-row__pct--up');
    expect(yoyClass(-200, -100)).toBe('pnl-row__pct--down');
  });
});

describe('deriveTripCostBreakdown', () => {
  it('uses authoritative trip details and reconciles residual cost back to totalCosts', () => {
    const report = {
      totalCosts: 1_000,
      maintenanceExpensesTotal: 200,
      fleetDepreciationTotal: 150,
      fleetMonthlyFixedCostTotal: 50,
      companyExpenses: 80,
      tripDetails: [
        {
          id: 1,
          financialPostingVersionId: 11,
          financialPostingVersion: 1,
          tripCode: 'A',
          departureDate: '2026-08-01',
          routeName: 'R1',
          revenue: 500,
          customerCommission: 0,
          fuelOrHireCost: 100,
          roadAllowance: 50,
          tollAndCompanyTickets: 25,
          driverAndAllowances: 75,
          totalCost: 280,
          allocatedFleetFixedCost: 0,
          totalCostWithFleetFixedCost: 280,
          profit: 220,
          netProfitAfterFleetFixedCost: 220,
          costDifference: 30,
          costMatches: false,
          isExternal: false,
          vehicleBucketId: 1,
        },
        {
          id: 2,
          financialPostingVersionId: 12,
          financialPostingVersion: 1,
          tripCode: 'B',
          departureDate: '2026-08-02',
          routeName: 'R2',
          revenue: 400,
          customerCommission: 0,
          fuelOrHireCost: 120,
          roadAllowance: 40,
          tollAndCompanyTickets: 10,
          driverAndAllowances: 55,
          totalCost: 240,
          allocatedFleetFixedCost: 0,
          totalCostWithFleetFixedCost: 240,
          profit: 160,
          netProfitAfterFleetFixedCost: 160,
          costDifference: 15,
          costMatches: false,
          isExternal: false,
          vehicleBucketId: 1,
        },
      ],
    } as unknown as PnlReport;

    const breakdown = deriveTripCostBreakdown(report);

    expect(breakdown.fuelCost).toBe(220);
    expect(breakdown.roadCost).toBe(90);
    expect(breakdown.driverCost).toBe(130);
    expect(breakdown.tollAndTicketsCost).toBe(35);
    expect(breakdown.otherTripCost).toBe(125);
    expect(
      breakdown.fuelCost! + breakdown.roadCost! + breakdown.driverCost!
      + breakdown.tollAndTicketsCost! + breakdown.otherTripCost!
      + breakdown.maintenanceCost! + breakdown.fleetDepreciationCost!
      + breakdown.fleetFixedCost!,
    ).toBe(report.totalCosts);
  });

  it('propagates missing sources as null — an absent report nulls every cell', () => {
    const breakdown = deriveTripCostBreakdown(undefined);
    expect(breakdown).toEqual({
      fuelCost: null, roadCost: null, driverCost: null, tollAndTicketsCost: null,
      maintenanceCost: null, fleetDepreciationCost: null, fleetFixedCost: null,
      otherTripCost: null, companyExpenses: null,
    });
  });

  it('propagates field-level nulls on an existing report (missing source ≠ 0)', () => {
    const report = { maintenanceExpensesTotal: null, companyExpenses: null, tripDetails: [] } as unknown as PnlReport;
    const breakdown = deriveTripCostBreakdown(report);
    expect(breakdown.maintenanceCost).toBeNull();
    expect(breakdown.companyExpenses).toBeNull();
    // A defined tripDetails array is a well-defined set: the reduce over it
    // stays arithmetic (0 here), distinct from a missing source.
    expect(breakdown.fuelCost).toBe(0);
  });

  it('keeps real zeros — a computed 0 still renders 0, not —', () => {
    const report = {
      maintenanceExpensesTotal: 0,
      companyExpenses: 0,
      tripDetails: [{ fuelOrHireCost: 0, roadAllowance: 0, tollAndCompanyTickets: 0, driverAndAllowances: 0 }] as never,
    } as unknown as PnlReport;
    const breakdown = deriveTripCostBreakdown(report);
    expect(breakdown.maintenanceCost).toBe(0);
    expect(breakdown.companyExpenses).toBe(0);
    expect(breakdown.fuelCost).toBe(0);
  });
});
