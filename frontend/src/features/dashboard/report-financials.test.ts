import { describe, expect, it } from 'vitest';
import { deriveDashboardReportFinancials } from './report-financials';
import fixture from '../../pages/finance-recognized-reports.fixture.json';

const october = fixture.reports.find(report => report.period.month === 10)!;
const august = fixture.reports.find(report => report.period.month === 8)!;
const january = fixture.reports.find(report => report.period.month === 1)!;

// The primary inputs are existing recorded200 monthly report projections.
// Numeric mutations below exercise presentation contracts only: no API mock,
// database fixture or claim that a native account contains those adjustments.
describe('selected recognized Dashboard report (UI81)', () => {
  it('reconciles all twelve retained actual monthly reports without departure-cost fallback', () => {
    for (const report of fixture.reports) {
      const result = deriveDashboardReportFinancials(report);
      expect(result.costs).toBe(report.totalCosts);
      expect(result.costTotal).toBe(report.totalCosts);
      expect(result.costComplete).toBe(true);
      expect(result.costComponents).toHaveLength(8);
      expect(result.costComponents.reduce((sum, row) => sum + (row.value ?? 0), 0)).toBe(report.totalCosts);
    }
    const result = deriveDashboardReportFinancials(october);
    expect(result.costComponents[0].value).toBe(1_150_000);
    expect(result.costComponents[1].value).toBe(500_000);
    expect(result.costTotal).toBe(1_650_000);
    expect(result.displayRoutes).toEqual([{ name: 'Hải Phòng-NEWEB', trips: 2, profit: 2_850_000, meta: '2 chuyến đã ghi nhận' }]);
  });

  it('excludes company expenditure and external hire from the gross-cost composition', () => {
    expect(august.companyExpenses).toBe(2_150_000);
    expect(deriveDashboardReportFinancials(august).costTotal).toBe(68_373_420);
    // Reuse the existing finance-trip-details external7m contract amount.
    const external = october.tripDetails.find(trip => trip.isExternal)!;
    const withExternalHire = { ...october, tripDetails: october.tripDetails.map(trip => trip === external ? { ...trip, fuelOrHireCost: 7_000_000 } : trip) };
    expect(deriveDashboardReportFinancials(withExternalHire).costComponents).toEqual(deriveDashboardReportFinancials(october).costComponents);
  });

  it('preserves missing sources rather than zero, stats substitution, or guessed OWN identity', () => {
    const unknown = deriveDashboardReportFinancials(undefined);
    expect([unknown.revenue, unknown.costs, unknown.grossProfit, unknown.netProfit]).toEqual([null, null, null, null]);
    expect(unknown.costComplete).toBe(false);
    expect(unknown.displayRoutes).toEqual([]);
    const { tripDetails: omittedDetails, ...withoutDetails } = october;
    expect(omittedDetails).toHaveLength(2);
    expect(deriveDashboardReportFinancials(withoutDetails).costComplete).toBe(false);
    const missingOwner = { ...october, tripDetails: october.tripDetails.map(trip => ({ ...trip, isExternal: undefined })) };
    expect(deriveDashboardReportFinancials(missingOwner).costComponents[0].value).toBeNull();
    const missingFuel = { ...october, tripDetails: october.tripDetails.map(trip => trip.isExternal ? trip : { ...trip, fuelOrHireCost: undefined }) };
    expect(deriveDashboardReportFinancials(missingFuel).costComponents[0].value).toBeNull();
    const missingFixed = { ...october, fleetMonthlyFixedCostTotal: undefined };
    expect(deriveDashboardReportFinancials(missingFixed).costComplete).toBe(false);
    const mismatched = deriveDashboardReportFinancials({ ...october, totalCosts: 1_650_001 });
    expect(mismatched.costTotal).toBe(1_650_001);
    expect(mismatched.costComplete).toBe(false);
    expect(mismatched.costComponents).toEqual(deriveDashboardReportFinancials(october).costComponents.map(row => ({ ...row, pct: null })));
  });

  it('retains zero, signed net and small components using shared monetary precision', () => {
    const zero = deriveDashboardReportFinancials(january);
    expect(zero.costTotal).toBe(0);
    expect(zero.costComplete).toBe(true);
    expect(zero.costComponents.every(row => row.value === 0 && row.pct === null)).toBe(true);
    const own = october.tripDetails.find(trip => trip.isExternal === false)!;
    const details = [{ ...own, fuelOrHireCost: 100, driverAndAllowances: 0, roadAllowance: 0, tollAndCompanyTickets: 0, reconciledExtraCost: -30, costDifference: 0 }];
    const signed = deriveDashboardReportFinancials({ ...october, tripCount: 1, totalCosts: 70, tripDetails: details });
    expect(signed.costTotal).toBe(70);
    expect(signed.costComplete).toBe(true);
    expect(signed.costComponents[4].value).toBe(-30);
    expect(signed.costComponents.every(row => row.pct === null)).toBe(true);
    const small = deriveDashboardReportFinancials({ ...october, tripCount: 1, totalCosts: 100.25, tripDetails: [{ ...details[0], reconciledExtraCost: 0.25 }] });
    expect(small.costComponents[4]).toMatchObject({ value: 0.25, pct: 0 });
    const fractional = deriveDashboardReportFinancials({ ...october, tripCount: 1, totalCosts: 0.3, tripDetails: [{ ...details[0], fuelOrHireCost: 0.1, reconciledExtraCost: 0.2 }] });
    expect(fractional.costComplete).toBe(true);
    expect(fractional.costTotal).toBe(0.3);
  });
});
