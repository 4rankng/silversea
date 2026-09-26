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
  if (previous === 0) return current > 0 ? 'Mới' : '—';
  const pct = ((current - previous) / previous * 100).toFixed(1);
  return `${Number(pct) >= 0 ? '+' : ''}${pct}%`;
}

export function yoyClass(current: number | null, previous: number | null): string {
  if (current == null || previous == null) return '';
  return current >= previous ? 'pnl-row__pct--up' : 'pnl-row__pct--down';
}

const runningSum = (arr: number[]): number[] => {
  let acc = 0;
  return arr.map((value) => (acc += value));
};

interface FinanceDerivedInput {
  allTrips: TripDetail[];
  report?: PnlReport;
  prevReport?: PnlReport;
  capTableRaw: CapTableHistory[];
  yearlyData: (PnlReport | null)[];
  month: number;
  chartView: 'day' | 'month';
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

export function useFinanceDerived({ allTrips, report, prevReport, capTableRaw, yearlyData, month, chartView }: FinanceDerivedInput) {

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

    const trimmedChartData = useMemo(() => {
      const firstDataIdx = revenueChartData.findIndex(d => d['Doanh thu'] > 0 || d['LN gộp'] > 0);
      if (firstDataIdx < 0) return [];
      const lastDataIdx = [...revenueChartData].reverse().findIndex(d => d['Doanh thu'] > 0 || d['LN gộp'] > 0);
      return revenueChartData.slice(firstDataIdx, revenueChartData.length - lastDataIdx);
    }, [revenueChartData]);

    const currentChartMonthIdx = useMemo(() => {
      return trimmedChartData.findIndex(d => d.name === `T${month}`);
    }, [trimmedChartData, month]);

    const dailyChartData = useMemo(() => {
      const dayMap = new Map<string, { revenue: number; gross: number }>();
      for (const t of allTrips) {
        if (t.status === 'CANCELED') continue;
        const dateKey = t.departureDate?.slice(0, 10);
        if (!dateKey) continue;
        const rev = Number(t.revenue) || 0;
        const gp = Number(t.grossProfit) || 0;
        const existing = dayMap.get(dateKey) ?? { revenue: 0, gross: 0 };
        existing.revenue += rev;
        existing.gross += gp;
        dayMap.set(dateKey, existing);
      }
      const sorted = Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, v]) => v.revenue > 0 || v.gross > 0);
      return {
        labels: sorted.map(([d]) => String(parseInt(d.slice(8, 10), 10))),
        revenue: runningSum(sorted.map(([, v]) => v.revenue / 1_000_000)),
        gross: runningSum(sorted.map(([, v]) => v.gross / 1_000_000)),
      };
    }, [allTrips]);

    const activeChartData = useMemo(() => {
      if (chartView === 'day') {
        return {
          months: dailyChartData.labels,
          revenue: dailyChartData.revenue,
          gross: dailyChartData.gross,
          currentIdx: undefined,
        };
      }
      return {
        months: trimmedChartData.map(d => d.name as string),
        revenue: trimmedChartData.map(d => d['Doanh thu'] as number),
        gross: trimmedChartData.map(d => d['LN gộp'] as number),
        currentIdx: currentChartMonthIdx >= 0 ? currentChartMonthIdx : undefined,
      };
    }, [chartView, dailyChartData, trimmedChartData, currentChartMonthIdx]);

    const hasChartData = chartView === 'day' ? dailyChartData.labels.length > 0 : trimmedChartData.length > 0;

    // Completed-trip presence for the ACTIVE view — the no-trip empty state
    // must key on THIS, never on the chart series (all-zero buckets are
    // filtered out of the series, which used to make a completed-but-zero
    // month claim "no completed trips"). Day view counts the month-scoped
    // trips; month view sums the yearly reports' real tripCount field.
    const completedTripCount = chartView === 'day'
      ? allTrips.filter((t) => t.status === 'COMPLETED').length
      : yearlyData.reduce((sum, r) => sum + (r?.tripCount ?? 0), 0);
  return {
    fuelCost, roadCost, driverCost, tollAndTicketsCost, maintenanceCost, fleetDepreciationCost, fleetFixedCost, otherTripCost, companyExpenses,
    totalRevenue, otherRevenue, transRevenue, totalCosts, grossProfit, netProfit,
    totalRevenueLY, otherRevenueLY, transRevenueLY, totalCostsLY, grossProfitLY,
    companyExpensesLY, netProfitLY, activeCapTable, revenueChartData, costPieData,
    topTrucks, categoryBreakdown, truckBreakdown, trimmedChartData, activeChartData, hasChartData, completedTripCount,
  };
}
