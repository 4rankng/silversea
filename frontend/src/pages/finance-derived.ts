import { useMemo } from 'react';
import { getActiveCapTable } from '../lib/cap-table';
import type { TripDetail, CapTableHistory } from '@tingting/shared';
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

export function marginPct(grossProfit: number, totalRevenue: number): string {
  return totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0.0';
}

export function yoyPct(current: number, previous: number): string {
  if (previous == null || previous === 0) return current > 0 ? 'Mới' : '—';
  const pct = ((current - previous) / previous * 100).toFixed(1);
  return `${Number(pct) >= 0 ? '+' : ''}${pct}%`;
}

export function yoyClass(current: number, previous: number): string {
  if (previous == null) return '';
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

export function useFinanceDerived({ allTrips, report, prevReport, capTableRaw, yearlyData, month, chartView }: FinanceDerivedInput) {

    const {
      fuelCost, roadCost, driverCost, maintenanceCost, companyExpenses,
      totalRevenue, otherRevenue, transRevenue, totalCosts, grossProfit, netProfit,
      totalRevenueLY, otherRevenueLY, transRevenueLY, totalCostsLY, grossProfitLY, companyExpensesLY, netProfitLY,
      activeCapTable, revenueChartData, costPieData, topTrucks, categoryBreakdown, truckBreakdown,
    } = useMemo(() => {
      const activeTrips = allTrips.filter((t: TripDetail) => t.status !== 'CANCELED');
      const realFuelCost = activeTrips.reduce((s, t) => s + parseFloat(t.totalFuelCost || '0'), 0);
      const realRoadCost = activeTrips.reduce((s, t) => s + parseFloat(t.totalRoadAllowance || '0'), 0);
      const realDriverCost = activeTrips.reduce((s, t) => s + parseFloat(t.driverSalary || '0'), 0);
      const totalCosts = report?.totalCosts ?? 0;

      const hasRealCosts = realFuelCost + realRoadCost + realDriverCost > 0;
      const fuelCost   = hasRealCosts ? realFuelCost   : Math.round(totalCosts * 0.55);
      const roadCost   = hasRealCosts ? realRoadCost   : Math.round(totalCosts * 0.25);
      const driverCost = hasRealCosts ? realDriverCost : Math.round(totalCosts * 0.20);
      const maintenanceCost = report?.maintenanceExpensesTotal ?? 0;
      const companyExpenses = report?.companyExpenses ?? 0;

      const operatingRevenue = report?.totalRevenue ?? 0;
      const otherRevenue = report?.otherIncome ?? 0;
      const externalMargin = report?.externalMarginTotal ?? 0;
      const serviceMargin = report?.serviceMarginTotal ?? 0;
      const transRevenue = operatingRevenue - externalMargin - serviceMargin;
      const totalRevenue = operatingRevenue + otherRevenue;
      // totalCosts is already defined above
      const grossProfit = report?.grossProfit ?? (totalRevenue - totalCosts);
      const netProfit = report?.netProfit ?? (grossProfit - companyExpenses + otherRevenue);

      const operatingRevenueLY = prevReport?.totalRevenue ?? 0;
      const otherRevenueLY = prevReport?.otherIncome ?? 0;
      const transRevenueLY = operatingRevenueLY
        - (prevReport?.externalMarginTotal ?? 0)
        - (prevReport?.serviceMarginTotal ?? 0);
      const totalRevenueLY = operatingRevenueLY + otherRevenueLY;
      const totalCostsLY = prevReport?.totalCosts ?? 0;
      const grossProfitLY = prevReport?.grossProfit ?? (totalRevenueLY - totalCostsLY);
      const companyExpensesLY = prevReport?.companyExpenses ?? 0;
      const netProfitLY = prevReport?.netProfit ?? (grossProfitLY - companyExpensesLY + otherRevenueLY);

      const activeCapTable = getActiveCapTable(capTableRaw)
        .map(c => ({ name: c.partnerName, pct: c.percentage }));

      const revenueChartData = yearlyData.map((r, i) => ({
        name: `T${i + 1}`,
        'Doanh thu': (r?.totalRevenue ?? 0) / 1_000_000,
        'LN gộp': (r?.grossProfit ?? 0) / 1_000_000,
      }));

      const costPieData = [
        { name: 'Nhiên liệu', value: fuelCost, fill: '#059669' },
        { name: 'Tiền đi đường', value: roadCost, fill: '#D97706' },
        { name: 'Lương lái xe', value: driverCost, fill: '#2563EB' },
        { name: 'Bảo dưỡng', value: maintenanceCost, fill: '#DC2626' },
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
      let truckBreakdown: Array<{ id: number; plate: string; trips: number; revenue: number; costs: number; profit: number }>;
      if (report?.trucks?.length) {
        truckBreakdown = report.trucks
          .filter(t => t.id !== 0) // "Xe ngoài" rendered as its own row below; keep own+unassigned together
          .map(t => ({
            id: t.id,
            plate: t.plate,
            trips: t.trips,
            revenue: t.revenue,
            costs: t.costs,
            profit: t.profit,
          }));
        // Re-append the external bucket last, if present, to preserve "own first" ordering.
        const ext = report.trucks.find(t => t.id === 0);
        if (ext) {
          truckBreakdown.push({ id: ext.id, plate: ext.plate, trips: ext.trips, revenue: ext.revenue, costs: ext.costs, profit: ext.profit });
        }
        truckBreakdown.sort((a, b) => b.profit - a.profit);
      } else {
        const truckMap = new Map<number, { id: number; plate: string; trips: number; revenue: number; costs: number; profit: number }>();
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
          } else {
            truckMap.set(key, { id: key, plate, trips: 1, revenue: rev, costs: cost, profit: gp });
          }
        }
        truckBreakdown = [...truckMap.values()].sort((a, b) => b.profit - a.profit);
      }

      return {
        fuelCost, roadCost, driverCost, maintenanceCost, companyExpenses,
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
  return {
    fuelCost, roadCost, driverCost, maintenanceCost, companyExpenses,
    totalRevenue, otherRevenue, transRevenue, totalCosts, grossProfit, netProfit,
    totalRevenueLY, otherRevenueLY, transRevenueLY, totalCostsLY, grossProfitLY,
    companyExpensesLY, netProfitLY, activeCapTable, revenueChartData, costPieData,
    topTrucks, categoryBreakdown, truckBreakdown, trimmedChartData, activeChartData, hasChartData,
  };
}
