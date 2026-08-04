import { describe, expect, it } from 'vitest';

import { deriveTripCostBreakdown } from './finance-derived';
import type { PnlReport } from '../hooks/useQueries';

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
      breakdown.fuelCost
      + breakdown.roadCost
      + breakdown.driverCost
      + breakdown.tollAndTicketsCost
      + breakdown.otherTripCost
      + breakdown.maintenanceCost
      + breakdown.fleetDepreciationCost
      + breakdown.fleetFixedCost,
    ).toBe(report.totalCosts);
  });
});
