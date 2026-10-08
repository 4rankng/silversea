import { round2dp, type PnlReport, type PnlTripDetail } from '@tingting/shared';
import { buildPieSlices, FALLBACK_COLORS } from './utils';

// A presentation projection of supplied report fields. Incomplete historical
// DTOs stay incomplete; operational stats and departure-based trips are not inputs.
type ReportSource = Partial<Pick<PnlReport,
  'totalRevenue' | 'totalCosts' | 'grossProfit' | 'netProfit' | 'tripCount'
  | 'maintenanceExpensesTotal' | 'fleetDepreciationTotal' | 'fleetMonthlyFixedCostTotal'
>> & { tripDetails?: readonly Partial<Pick<PnlTripDetail,
  'routeName' | 'profit' | 'isExternal' | 'fuelOrHireCost' | 'roadAllowance'
  | 'driverAndAllowances' | 'tollAndCompanyTickets' | 'reconciledExtraCost' | 'costDifference'
>>[] };

type ReportTrip = NonNullable<ReportSource['tripDetails']>[number];
type CostKey = 'fuelOrHireCost' | 'driverAndAllowances' | 'roadAllowance'
  | 'tollAndCompanyTickets' | 'reconciledExtraCost' | 'costDifference';

export interface DashboardCostComponent {
  label: string;
  value: number | null;
  color: string;
  pct: number | null;
}

const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? round2dp(value) : null;

function ownCost(rows: readonly ReportTrip[] | null, key: CostKey): number | null {
  if (!rows || rows.some(row => amount(row[key]) === null)) return null;
  return round2dp(rows.reduce((sum, row) => sum + row[key]!, 0));
}

export function deriveDashboardReportFinancials(report?: ReportSource | null) {
  const revenue = amount(report?.totalRevenue);
  const costs = amount(report?.totalCosts);
  const grossProfit = amount(report?.grossProfit);
  const netProfit = amount(report?.netProfit);
  const details = report?.tripDetails;
  const detailsComplete = Array.isArray(details)
    && typeof report?.tripCount === 'number'
    && Number.isInteger(report.tripCount) && report.tripCount >= 0
    && details.length === report.tripCount
    && details.every(row => typeof row.isExternal === 'boolean');
  const own = detailsComplete ? details!.filter(row => row.isExternal === false) : null;
  const extras = ownCost(own, 'reconciledExtraCost');
  const difference = ownCost(own, 'costDifference');
  const components: Array<Omit<DashboardCostComponent, 'pct'>> = [
    { label: 'Nhiên liệu', value: ownCost(own, 'fuelOrHireCost'), color: 'var(--brand)' },
    { label: 'Lương lái xe · phụ cấp', value: ownCost(own, 'driverAndAllowances'), color: 'var(--info)' },
    { label: 'Tiền đi đường', value: ownCost(own, 'roadAllowance'), color: 'var(--warning)' },
    { label: 'Vé cầu đường · phí công ty', value: ownCost(own, 'tollAndCompanyTickets'), color: FALLBACK_COLORS[0] },
    { label: 'Chi phí chuyến khác · điều chỉnh', value: extras === null || difference === null ? null : round2dp(extras + difference), color: FALLBACK_COLORS[1] },
    { label: 'Bảo dưỡng', value: amount(report?.maintenanceExpensesTotal), color: FALLBACK_COLORS[2] },
    { label: 'Khấu hao đội xe', value: amount(report?.fleetDepreciationTotal), color: FALLBACK_COLORS[3] },
    { label: 'Chi phí cố định đội xe', value: amount(report?.fleetMonthlyFixedCostTotal), color: FALLBACK_COLORS[4] },
  ];
  // EXTERNAL hire/extras are already netted into report revenue; company
  // expenditure is outside gross costs. CategoryBreakdown mixes those scopes.
  const knownTotal = components.every(row => row.value !== null)
    ? round2dp(components.reduce((sum, row) => sum + row.value!, 0)) : null;
  const costComplete = costs !== null && knownTotal !== null && round2dp(knownTotal - costs) === 0;
  const distribution = costComplete
    ? buildPieSlices(components.map(row => ({ ...row, value: row.value! }))) : null;
  const costComponents: DashboardCostComponent[] = components.map(row => ({
    ...row, pct: distribution?.slicesWithPct.find(slice => slice.label === row.label)?.pct ?? null,
  }));

  const routesComplete = detailsComplete && details!.every(row =>
    typeof row.routeName === 'string' && row.routeName.trim() !== '' && amount(row.profit) !== null,
  );
  const routeMap = new Map<string, { name: string; trips: number; profit: number }>();
  if (routesComplete) for (const row of details!) {
    const name = row.routeName!.trim();
    const route = routeMap.get(name) ?? { name, trips: 0, profit: 0 };
    route.trips++;
    route.profit = round2dp(route.profit + row.profit!);
    routeMap.set(name, route);
  }
  const displayRoutes = [...routeMap.values()].sort((a, b) => b.profit - a.profit).slice(0, 5)
    .map(route => ({ ...route, meta: `${route.trips} chuyến đã ghi nhận` }));

  return { revenue, costs, grossProfit, netProfit, costTotal: costs, costComplete,
    costComponents, routesComplete, displayRoutes };
}
