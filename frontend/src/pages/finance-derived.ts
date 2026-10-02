import { useMemo } from 'react';
import { getActiveCapTable } from '../lib/cap-table';
import type { TripDetail, CapTableHistory, PnlTruck } from '@tingting/shared';
import type { PnlReport } from '../hooks/useQueries';

export const EMPTY_TRIPS: TripDetail[] = [];
export const EMPTY_CAP: CapTableHistory[] = [];
export const EMPTY_YEARLY: (PnlReport | null)[] = [];

export function compactNum(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}tỷ`.replace('.0', '');
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}tr`.replace('.0', '');
  return `${(value / 1e3).toFixed(0)}k`;
}

export function marginPct(grossProfit: number | null, totalRevenue: number | null): string {
  if (grossProfit == null || totalRevenue == null) return '—';
  return totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0.0';
}

export function yoyPct(current: number | null, previous: number | null): string {
  if (current == null || previous == null) return '—';
  if (previous === 0) return current !== 0 ? 'Mới' : '0%';
  const pct = ((current - previous) / Math.abs(previous) * 100).toFixed(1);
  return `${Number(pct) > 0 ? '+' : ''}${pct}%`;
}

export function yoyClass(current: number | null, previous: number | null, favorableDirection: 'up' | 'down' = 'up'): string {
  if (current == null || previous == null || current === previous) return '';
  const direction = current > previous ? 'up' : 'down';
  return direction === favorableDirection ? 'pnl-row__pct--up' : 'pnl-row__pct--down';
}

type MonthlyFinanceSource = Pick<PnlReport, 'totalRevenue' | 'grossProfit' | 'tripCount'>;

/** Financial reports supply monthly recognition; operational trips do not. */
export function deriveMonthlyFinanceChart(reports: (MonthlyFinanceSource | null)[], month: number) {
  const points = reports.map((report, index) => ({
    month: `T${index + 1}`,
    revenue: (report?.totalRevenue ?? 0) / 1_000_000,
    gross: (report?.grossProfit ?? 0) / 1_000_000,
  }));
  const hasValue = (point: typeof points[number]) => point.revenue !== 0 || point.gross !== 0;
  const first = points.findIndex(hasValue);
  const lastFromEnd = [...points].reverse().findIndex(hasValue);
  const visible = first < 0 ? [] : points.slice(first, points.length - lastFromEnd);
  const currentIdx = visible.findIndex(point => point.month === `T${month}`);
  return {
    months: visible.map(point => point.month),
    revenue: visible.map(point => point.revenue),
    gross: visible.map(point => point.gross),
    currentIdx: currentIdx >= 0 ? currentIdx : undefined,
    hasChartData: visible.length > 0,
    completedTripCount: reports.reduce((sum, report) => sum + (report?.tripCount ?? 0), 0),
  };
}

interface FinanceDerivedInput {
  allTrips: TripDetail[];
  report?: PnlReport;
  prevReport?: PnlReport;
  capTableRaw: CapTableHistory[];
  yearlyData: (PnlReport | null)[];
  month: number;
}

export function deriveTripCostBreakdown(report?: PnlReport) {
  // Missing source at the CONTAINER level (no report at all) → every display
  // cell is missing ('—'), never a fabricated 0 (PRD QuyTrinhO2C §7.9: 0
  // means computed-from-complete-inputs, absent means no source). Arithmetic
  // that genuinely needs numbers seeds them at the consumption site below.
  if (!report) {
    return {
      fuelCost: null, roadCost: null, driverCost: null, tollAndTicketsCost: null,
      maintenanceCost: null, fleetDepreciationCost: null, fleetFixedCost: null,
      otherTripCost: null, companyExpenses: null,
    };
  }
  const tripDetails = report.tripDetails ?? [];
  const fuelCost = tripDetails.reduce((sum, trip) => sum + (trip.fuelOrHireCost ?? 0), 0);
  const roadCost = tripDetails.reduce((sum, trip) => sum + (trip.roadAllowance ?? 0), 0);
  const driverCost = tripDetails.reduce((sum, trip) => sum + (trip.driverAndAllowances ?? 0), 0);
  const tollAndTicketsCost = tripDetails.reduce((sum, trip) => sum + (trip.tollAndCompanyTickets ?? 0), 0);
  // Field-level missing source on an EXISTING report also propagates: the
  // backend computed totals are the authoritative sources for these cells.
  const maintenanceCost = report.maintenanceExpensesTotal ?? null;
  const fleetDepreciationCost = report.fleetDepreciationTotal ?? null;
  const fleetFixedCost = report.fleetMonthlyFixedCostTotal ?? null;
  const companyExpenses = report.companyExpenses ?? null;
  const otherTripCost = Math.round(
    (report.totalCosts ?? 0)
      - fuelCost
      - roadCost
      - driverCost
      - tollAndTicketsCost
      - (report.maintenanceExpensesTotal ?? 0)
      - (report.fleetDepreciationTotal ?? 0)
      - (report.fleetMonthlyFixedCostTotal ?? 0),
  );
  return {
    fuelCost,
    roadCost,
    driverCost,
    tollAndTicketsCost,
    maintenanceCost,
    fleetDepreciationCost,
    fleetFixedCost,
    otherTripCost,
    companyExpenses,
  };
}

export function useFinanceDerived({ allTrips, report, prevReport, capTableRaw, yearlyData, month }: FinanceDerivedInput) {

    const {
      fuelCost, roadCost, driverCost, tollAndTicketsCost, maintenanceCost, fleetDepreciationCost, fleetFixedCost, otherTripCost, companyExpenses,
      totalRevenue, otherRevenue, transRevenue, totalCosts, grossProfit, netProfit,
      totalRevenueLY, otherRevenueLY, transRevenueLY, totalCostsLY, grossProfitLY, companyExpensesLY, netProfitLY,
      activeCapTable, revenueChartData, costPieData, topTrucks, categoryBreakdown, truckBreakdown,
    } = useMemo(() => {
      const activeTrips = allTrips.filter((t: TripDetail) => t.status !== 'CANCELED');
      const totalCosts = report?.totalCosts ?? null;
      const {
        fuelCost,
        roadCost,
        driverCost,
        tollAndTicketsCost,
        maintenanceCost,
        fleetDepreciationCost,
        fleetFixedCost,
        otherTripCost,
        companyExpenses,
      } = deriveTripCostBreakdown(report);

      // Field-level missing sources propagate to display cells; arithmetic
      // that needs numbers seeds them locally (charts, YoY math).
      const operatingRevenue = report?.totalRevenue ?? null;
      const otherRevenue = report?.otherIncome ?? null;
      const externalMargin = report?.externalMarginTotal ?? null;
      const serviceMargin = report?.serviceMarginTotal ?? null;
      const transRevenue = operatingRevenue != null && externalMargin != null && serviceMargin != null
        ? operatingRevenue - externalMargin - serviceMargin
        : null;
      const totalRevenue = operatingRevenue != null && otherRevenue != null
        ? operatingRevenue + otherRevenue
        : null;
      // totalCosts is already defined above
      const grossProfit = report?.grossProfit
        ?? (totalRevenue != null && totalCosts != null ? totalRevenue - totalCosts : null);
      const netProfit = report?.netProfit
        ?? (grossProfit != null && companyExpenses != null && otherRevenue != null
          ? grossProfit - companyExpenses + otherRevenue
          : null);

      const operatingRevenueLY = prevReport?.totalRevenue ?? null;
      const otherRevenueLY = prevReport?.otherIncome ?? null;
      const transRevenueLY = operatingRevenueLY != null
        && (prevReport?.externalMarginTotal ?? null) != null
        && (prevReport?.serviceMarginTotal ?? null) != null
        ? operatingRevenueLY - (prevReport!.externalMarginTotal as number) - (prevReport!.serviceMarginTotal as number)
        : null;
      const totalRevenueLY = operatingRevenueLY != null && otherRevenueLY != null
        ? operatingRevenueLY + otherRevenueLY
        : null;
      const totalCostsLY = prevReport?.totalCosts ?? null;
      const grossProfitLY = prevReport?.grossProfit
        ?? (totalRevenueLY != null && totalCostsLY != null ? totalRevenueLY - totalCostsLY : null);
      const companyExpensesLY = prevReport?.companyExpenses ?? null;
      const netProfitLY = prevReport?.netProfit
        ?? (grossProfitLY != null && companyExpensesLY != null && otherRevenueLY != null
          ? grossProfitLY - companyExpensesLY + otherRevenueLY
          : null);

      const activeCapTable = getActiveCapTable(capTableRaw)
        .map(c => ({ name: c.partnerName, pct: c.percentage }));

      const revenueChartData = yearlyData.map((r, i) => ({
        name: `T${i + 1}`,
        'Doanh thu': (r?.totalRevenue ?? 0) / 1_000_000,
        'LN gộp': (r?.grossProfit ?? 0) / 1_000_000,
      }));

      const costPieData = [
        { name: 'Nhiên liệu', value: fuelCost ?? 0, fill: '#177448' },
        { name: 'Phụ cấp đường', value: roadCost ?? 0, fill: '#A45D1C' },
        { name: 'Lương lái xe', value: driverCost ?? 0, fill: '#2E675E' },
        { name: 'Vé cầu đường · phí công ty', value: tollAndTicketsCost ?? 0, fill: '#0EA5E9' },
        { name: 'Chi phí chuyến khác · điều chỉnh', value: otherTripCost ?? 0, fill: '#64748B' },
        { name: 'Bảo dưỡng', value: maintenanceCost ?? 0, fill: '#DC2626' },
        { name: 'Khấu hao', value: fleetDepreciationCost ?? 0, fill: '#7C3AED' },
        { name: 'Cố định đội xe', value: fleetFixedCost ?? 0, fill: '#0F766E' },
      ].filter(d => d.value > 0.5);

      const categoryBreakdown: Array<{ categoryName: string; total: number }> =
        (report?.categoryBreakdown ?? []).map(c => ({
          categoryName: c.categoryName,
          total: parseFloat(c.total),
        }));

      const topTrucks = [...(report?.trucks ?? [])]
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 5)
        .map(t => ({
          name: t.plate,
          'LN gộp': t.profit,
          maintenance: t.maintenanceExpenses ?? 0,
        }));

      // Per-truck breakdown. Prefer the backend P&L `report.trucks` — it is the
      // authoritative, reconciling breakdown (ex-VAT revenue, correct cost
      // attribution incl. maintenance, and synthetic "Chưa gắn xe" / "Xe ngoài"
      // buckets for unassigned-OWN and external trips). Re-deriving from raw
      // trips here would (a) label null-truck trips "Truck #null", (b) read the
      // stale denormalized `trips.grossProfit`, and (c) fail to reconcile with
      // the P&L totals shown elsewhere on the page. Fall back to derivation only
      // when the report is not yet loaded.
      let truckBreakdown: PnlTruck[];
      if (report?.trucks?.length) {
        truckBreakdown = report.trucks
          .filter(t => t.id !== 0) // "Xe ngoài" rendered as its own row below; keep own+unassigned together
          .map(t => ({ ...t }));
        // Re-append the external bucket last, if present, to preserve "own first" ordering.
        const ext = report.trucks.find(t => t.id === 0);
        if (ext) {
          truckBreakdown.push({ ...ext });
        }
        truckBreakdown.sort((a, b) => b.profit - a.profit);
      } else {
        const truckMap = new Map<number, {
          id: number;
          plate: string;
          trips: number;
          revenue: number;
          costs: number;
          profit: number;
          maintenanceExpenses: number;
          variableTripCosts: number;
          allocatedFleetFixedCost: number;
          unallocatedFleetFixedCost: number;
          monthlyDepreciation: number;
          monthlyFixedCost: number;
          eligibleRevenue: number;
          allocationReasonCodes: PnlTruck['allocationReasonCodes'];
          profileVersionId: null;
          profileEffectiveFrom: null;
          profileSource: 'UNCONFIGURED';
        }>();
        for (const t of activeTrips) {
          const isExternal = t.carrierType === 'EXTERNAL';
          const key = isExternal ? 0 : (t.truckId ?? -1);
          const plate = isExternal ? 'Xe ngoài' : (t.truck?.licensePlate ?? 'Chưa gắn xe');
          const rev = parseFloat(t.revenue ?? '0') + parseFloat(t.revenueEmptyReturn ?? '0');
          const cost = parseFloat(t.totalCost ?? '0');
          const gp = rev - cost; // recompute; avoid stale denormalized grossProfit
          const existing = truckMap.get(key);
          if (existing) {
            existing.trips++;
            existing.revenue += rev;
            existing.costs += cost;
            existing.profit += gp;
            existing.variableTripCosts += cost;
          } else {
            truckMap.set(key, {
              id: key,
              plate,
              trips: 1,
              revenue: rev,
              costs: cost,
              profit: gp,
              maintenanceExpenses: 0,
              variableTripCosts: cost,
              allocatedFleetFixedCost: 0,
              unallocatedFleetFixedCost: 0,
              monthlyDepreciation: 0,
              monthlyFixedCost: 0,
              eligibleRevenue: 0,
              allocationReasonCodes: [],
              profileVersionId: null,
              profileEffectiveFrom: null,
              profileSource: 'UNCONFIGURED',
            });
          }
        }
        truckBreakdown = [...truckMap.values()].sort((a, b) => b.profit - a.profit);
      }

      return {
        fuelCost, roadCost, driverCost, tollAndTicketsCost, maintenanceCost, fleetDepreciationCost, fleetFixedCost, otherTripCost, companyExpenses,
        totalRevenue, otherRevenue, transRevenue, totalCosts, grossProfit, netProfit,
        totalRevenueLY, otherRevenueLY, transRevenueLY, totalCostsLY, grossProfitLY, companyExpensesLY, netProfitLY,
        activeCapTable, revenueChartData, costPieData, topTrucks, categoryBreakdown, truckBreakdown,
      };
    }, [allTrips, report, prevReport, capTableRaw, yearlyData]);

    const activeChartData = useMemo(() => deriveMonthlyFinanceChart(yearlyData, month), [yearlyData, month]);
    const { hasChartData, completedTripCount } = activeChartData;
  return {
    fuelCost, roadCost, driverCost, tollAndTicketsCost, maintenanceCost, fleetDepreciationCost, fleetFixedCost, otherTripCost, companyExpenses,
    totalRevenue, otherRevenue, transRevenue, totalCosts, grossProfit, netProfit,
    totalRevenueLY, otherRevenueLY, transRevenueLY, totalCostsLY, grossProfitLY,
    companyExpensesLY, netProfitLY, activeCapTable, revenueChartData, costPieData,
    topTrucks, categoryBreakdown, truckBreakdown, activeChartData, hasChartData, completedTripCount,
  };
}
