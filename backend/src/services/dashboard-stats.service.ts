/**
 * Dashboard Stats Service
 *
 * Dashboard summary: current-month KPIs, top overdue customer, top shareholder.
 */

import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, sql, gte, desc } from 'drizzle-orm';
import { TripStatus, parseThreshold, type DashboardDecisionItem } from '@tingting/shared';
import { getCustomerAgingList, getReceivablesSummary, getTopOverdueCustomer, CURRENT_AGING_RANGE } from './aging.service';
import { cacheGet } from '../lib/redis';
import { dashboardCacheKey } from '../lib/report-cache';
import { salaryPeriodDateRange, localDateStr, resolveCapTableSnapshot, tripCompletionBusinessDateSql } from './reporting-shared';
import { getPnlReport } from './pnl.service';
import { getRenewalReminders } from './expense.service';
import { getTreasuryPositions } from './treasury.service';
import { getProfitabilityReport } from './profitability.service';

/**
 * O2C flow-congestion thresholds (Step 4 Dev Notes — "Dashboard cảnh báo tắc
 * nghẽn luồng"). These flag parallel-branch stall conditions so the dispatcher
 * can act before a shipment misses its yard/cutoff window. MVP constants;
 * candidates for a config row once the threshold needs per-customer tuning.
 */
export const DISPATCH_NO_ORDER_STALL_HOURS = 24;
export const YARD_EXPIRY_WINDOW_HOURS = 48;

/**
 * Read-only count of parallel-branch stall conditions (exported for direct
 * testing without the dashboard cache). Returns the inputs buildDecisionItems
 * needs to emit the two congestion alerts.
 */
export async function getCongestionAlertCounts(): Promise<{
  stalledDispatchedNoOrder: number;
  stalledOrderNoTruck: number;
  stalledOrderNoTruckOverdue: number;
}> {
  const [stallNoOrderResult, stallYardExpiryResult] = await Promise.all([
    // Stall A: dispatched (truck assigned) but Ops order-exchange not done for
    // over DISPATCH_NO_ORDER_STALL_HOURS. Branch 1 complete, Branch 2 stuck.
    db.select({
      count: sql<number>`count(distinct ${s.shipments.id})::int`,
    }).from(s.shipments)
      .innerJoin(s.trips, and(
        eq(s.trips.shipmentId, s.shipments.id),
        isNull(s.trips.deletedAt),
        sql`${s.trips.status} <> 'CANCELED'`,
        sql`${s.trips.truckId} IS NOT NULL`,
      ))
      .where(and(
        isNull(s.shipments.deletedAt),
        sql`${s.shipments.status} IN ('READY_FOR_DISPATCH','DISPATCHED')`,
        sql`${s.shipments.orderExchangeCompletedAt} IS NULL`,
        sql`${s.trips.createdAt} < now() - (${DISPATCH_NO_ORDER_STALL_HOURS} || ' hours')::interval`,
      )),
    // Stall B: order-exchange done but no truck yet, and the customs cutoff is
    // within YARD_EXPIRY_WINDOW_HOURS or already past. Also reports how many
    // are already past-due so the decision can escalate to critical.
    db.select({
      count: sql<number>`count(distinct ${s.shipments.id})::int`,
      overdue: sql<number>`count(distinct ${s.shipments.id}) filter (where ${s.shipments.customsCutoffAt} < now())::int`,
    }).from(s.shipments)
      .leftJoin(s.trips, and(
        eq(s.trips.shipmentId, s.shipments.id),
        isNull(s.trips.deletedAt),
        sql`${s.trips.status} <> 'CANCELED'`,
      ))
      .where(and(
        isNull(s.shipments.deletedAt),
        sql`${s.shipments.status} IN ('READY_FOR_DISPATCH','DISPATCHED')`,
        sql`${s.shipments.orderExchangeCompletedAt} IS NOT NULL`,
        sql`${s.shipments.customsCutoffAt} IS NOT NULL`,
        sql`NOT EXISTS (
          SELECT 1 FROM trips dispatched
          WHERE dispatched.shipment_id = ${s.shipments.id}
            AND dispatched.deleted_at IS NULL
            AND dispatched.status <> 'CANCELED'
            AND dispatched.truck_id IS NOT NULL
        )`,
        sql`${s.shipments.customsCutoffAt} <= now() + (${YARD_EXPIRY_WINDOW_HOURS} || ' hours')::interval`,
      )),
  ]);
  return {
    stalledDispatchedNoOrder: Number(stallNoOrderResult[0]?.count || 0),
    stalledOrderNoTruck: Number(stallYardExpiryResult[0]?.count || 0),
    stalledOrderNoTruckOverdue: Number(stallYardExpiryResult[0]?.overdue || 0),
  };
}

export async function getDashboardStats(options: { includeExecutive?: boolean } = {}) {
  const includeExecutive = options.includeExecutive === true;
  return cacheGet(dashboardCacheKey(includeExecutive), 30, async () => {
    const now = new Date();
    const businessDateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(now);
    const year = Number(businessDateParts.find(part => part.type === 'year')?.value);
    const month = Number(businessDateParts.find(part => part.type === 'month')?.value);
    const { start: monthStart, end: monthEnd } = await salaryPeriodDateRange(month, year);
    const completionBusinessDate = tripCompletionBusinessDateSql();
    const officialTripPeriod = and(
      isNull(s.trips.deletedAt),
      sql`${s.trips.completedAt} is not null`,
      gte(completionBusinessDate, monthStart),
      sql`${completionBusinessDate} < ${monthEnd}`,
    );
    // Trips-split: composite-view twin of officialTripPeriod for the queries
    // that read financial columns (a fragment bound to the `trips` table
    // cannot resolve inside a FROM trips_composite query).
    const officialCompositeCompletionDate = sql<string>`(${s.tripsComposite.completedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
    const officialTripPeriodComposite = and(
      isNull(s.tripsComposite.deletedAt),
      sql`${s.tripsComposite.completedAt} is not null`,
      gte(officialCompositeCompletionDate, monthStart),
      sql`${officialCompositeCompletionDate} < ${monthEnd}`,
    );

    const [
      [stats],
      [driverCount],
      truckStatusCounts,
      capRows,
      [inTransitResult],
      topOverdueCustomer,
      receivablesSummary,
      pnlReport,
      [createdTripsResult],
      [missingFinancialResult],
      completedTripsForLock,
      completedPhotoRows,
      renewalReminders,
      [fuelConfig],
      fuelCheckRows,
    ] = await Promise.all([
      db.select({
        tripCount: sql<number>`count(*) filter (where ${s.trips.status} = 'COMPLETED')`,
        completedTrips: sql<number>`count(*) filter (where ${s.trips.status} = 'COMPLETED')`,
        lockedTrips: sql<number>`0`,
      }).from(s.trips).where(officialTripPeriod),
      db.select({ count: sql<number>`count(*)` }).from(s.drivers).where(isNull(s.drivers.deletedAt)),
      db.select({
        status: s.trucks.status,
        count: sql<number>`count(*)`,
      }).from(s.trucks).where(isNull(s.trucks.deletedAt)).groupBy(s.trucks.status),
      db.select().from(s.capTableHistory)
        .orderBy(desc(s.capTableHistory.effectiveDate)),
      db.select({
        count: sql<number>`count(*)`,
      }).from(s.trips).where(and(
        isNull(s.trips.deletedAt),
        eq(s.trips.status, TripStatus.IN_TRANSIT),
      )),
      getTopOverdueCustomer(),
      getReceivablesSummary(),
      getPnlReport(month, year),
      db.select({ count: sql<number>`count(*)` }).from(s.trips).where(and(
        isNull(s.trips.deletedAt),
        eq(s.trips.status, TripStatus.CREATED),
      )),
      db.select({ count: sql<number>`count(*)` }).from(s.tripsComposite).where(and(
        officialTripPeriodComposite,
        eq(s.tripsComposite.status, TripStatus.COMPLETED),
        sql`(
          coalesce(${s.tripsComposite.revenue}, 0) <= 0
          OR coalesce(${s.tripsComposite.fuelLiters}, 0) <= 0
          OR coalesce(${s.tripsComposite.totalRoadAllowance}, 0) <= 0
          OR coalesce(${s.tripsComposite.driverSalary}, 0) <= 0
        )`,
      )),
      db.select({
        id: s.trips.id,
      }).from(s.trips).where(and(
        officialTripPeriod,
        eq(s.trips.status, TripStatus.COMPLETED),
      )),
      db.select({
        tripId: s.tripPhotos.tripId,
        count: sql<number>`count(*)`,
      }).from(s.tripPhotos).groupBy(s.tripPhotos.tripId),
      getRenewalReminders(db),
      db.select().from(s.fuelConfig).where(isNull(s.fuelConfig.deletedAt)).limit(1),
      db.select({
        tripId: s.tripsComposite.id,
        fuelLiters: s.tripsComposite.fuelLiters,
        totalKm: sql<number>`coalesce(sum(${s.tripLegs.km}), 0)`,
      })
        .from(s.tripsComposite)
        .leftJoin(s.tripLegs, eq(s.tripLegs.tripId, s.tripsComposite.id))
        .where(and(
          officialTripPeriodComposite,
          eq(s.tripsComposite.status, TripStatus.COMPLETED),
        ))
        // Group by every selected non-aggregate: trips_composite is a view,
        // so Postgres does not extend trips' primary-key functional
        // dependency to fuel_liters (42803 on the pre-split table's shape).
        .groupBy(s.tripsComposite.id, s.tripsComposite.fuelLiters),
    ]);

    const topShareholder = resolveTopShareholder(capRows);

    const revenue = Number(pnlReport.totalRevenue || 0);
    const costs = Number(pnlReport.totalCosts || 0);
    const grossProfit = Number(pnlReport.grossProfit || 0);
    const congestionCounts = await getCongestionAlertCounts();
    const decisionItems = buildDecisionItems({
      year,
      month,
      revenue,
      overdueAmount: receivablesSummary.buckets
        .filter((bucket) => bucket.range !== CURRENT_AGING_RANGE)
        .reduce((sum, bucket) => sum + Number(bucket.amount || 0), 0),
      overdueCustomers: receivablesSummary.overdueCustomers,
      createdTrips: Number(createdTripsResult?.count || 0),
      renewalReminders,
      missingFinancialTrips: Number(missingFinancialResult?.count || 0),
      completedTripsForLock,
      completedPhotoRows,
      fuelWarningTrips: countFuelWarningTrips(fuelCheckRows, fuelConfig),
      ...congestionCounts,
    });

    let executive: Record<string, unknown> | undefined;
    if (includeExecutive) {
      const asOf = new Date();
      const today = localDateStr(asOf);
      const [todayRevenueRows, customerProfitability, debtors, treasuryAccountRows] = await Promise.all([
        db.select({
          total: sql<string>`coalesce(sum(${s.profitabilitySnapshots.revenue}::numeric), 0)`,
        }).from(s.profitabilitySnapshots)
          .innerJoin(s.tripFinancialPostings, and(
            eq(s.tripFinancialPostings.id, s.profitabilitySnapshots.financialPostingId),
            eq(s.tripFinancialPostings.status, 'ACTIVE'),
          ))
          .where(eq(s.profitabilitySnapshots.completedBusinessDate, today)),
        getProfitabilityReport({ month, year, dimension: 'CUSTOMER', page: 1, limit: 10 }),
        getCustomerAgingList({ asOfDate: today, page: 1, limit: 10 }),
        db.select({ id: s.treasuryAccounts.id }).from(s.treasuryAccounts)
          .where(eq(s.treasuryAccounts.status, 'ACTIVE')),
      ]);
      const treasuryPositions = await getTreasuryPositions(treasuryAccountRows.map(account => account.id));
      const treasuryByType = (type: 'CASH' | 'BANK') => {
        const accounts = treasuryPositions.filter(account => account.type === type);
        return {
          bookBalance: accounts.reduce((sum, account) => sum + account.bookBalance, 0),
          completeness: accounts.length > 0 && accounts.every(account => account.completeness === 'COMPLETE')
            ? 'COMPLETE' as const
            : 'PARTIAL' as const,
          accountCount: accounts.length,
        };
      };
      const overdueReceivables = receivablesSummary.buckets
        .filter(bucket => bucket.range !== CURRENT_AGING_RANGE)
        .reduce((sum, bucket) => sum + Number(bucket.amount || 0), 0);
      executive = {
        asOf: asOf.toISOString(),
        timezone: 'Asia/Ho_Chi_Minh',
        definitionVersion: 'executive-dashboard-v1',
        revenueToday: Number(todayRevenueRows[0]?.total ?? 0),
        revenueMonth: Number(pnlReport.totalRevenue ?? 0),
        costMonth: Number(pnlReport.totalCosts ?? 0) + Number(pnlReport.companyExpenses ?? 0),
        profitMonth: Number(pnlReport.netProfit ?? 0),
        accountsReceivable: Number(receivablesSummary.totalOutstanding ?? 0),
        overdueAccountsReceivable: overdueReceivables,
        cash: treasuryByType('CASH'),
        bank: treasuryByType('BANK'),
        topCustomers: customerProfitability.items,
        topDebtors: debtors.customers,
        costByType: pnlReport.categoryBreakdown,
        profitByVehicle: pnlReport.trucks,
        reconciliation: customerProfitability.reconciliation,
      };
    }

    return {
      revenue,
      costs,
      grossProfit,
      // tripCount reflects ALL active trips in the period (for display in trip list stats).
      // lockedTrips reflects the trips whose revenue/cost are included in the KPIs.
      tripCount: Number(stats?.tripCount || 0),
      lockedTrips: Number(stats?.lockedTrips || 0),
      completedTrips: Number(stats?.completedTrips || 0),
      inTransitTrips: Number(inTransitResult?.count || 0),
      totalTrucks: truckStatusCounts.reduce((sum: number, r: { status: string | null; count: number }) => sum + r.count, 0),
      totalDrivers: Number(driverCount?.count || 0),
      fleetStatus: Object.fromEntries(
        truckStatusCounts.map((r: { status: string | null; count: number }) => [r.status, Number(r.count)])
      ) as Record<string, number>,
      topOverdueCustomer,
      topShareholder,
      decisionItems,
      executive,
    };
  });
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function resolveTopShareholder(capRows: typeof s.capTableHistory.$inferSelect[]) {
  let topShareholder: { name: string; percentage: number } | null = null;
  if (capRows.length > 0) {
    const today = localDateStr();
    const partners = resolveCapTableSnapshot(capRows, today);
    const sorted = partners
      .sort((a, b) => b.percentage - a.percentage);
    const top = sorted[0];
    topShareholder = top ? { name: top.partnerName, percentage: top.percentage } : null;
  }
  return topShareholder;
}

function buildDecisionItems(input: {
  year: number;
  month: number;
  revenue: number;
  overdueAmount: number;
  overdueCustomers: number;
  createdTrips: number;
  renewalReminders: Awaited<ReturnType<typeof getRenewalReminders>>;
  missingFinancialTrips: number;
  completedTripsForLock: Array<{ id: number }>;
  completedPhotoRows: Array<{ tripId: number; count: number }>;
  fuelWarningTrips: number;
  stalledDispatchedNoOrder: number;
  stalledOrderNoTruck: number;
  stalledOrderNoTruckOverdue: number;
}): DashboardDecisionItem[] {
  const items: DashboardDecisionItem[] = [];

  if (input.overdueAmount > 0) {
    items.push({
      id: 'overdue-receivables',
      kind: 'receivables',
      severity: 'critical',
      title: `${input.overdueCustomers} khách có công nợ quá hạn`,
      subtitle: `Tổng quá hạn ${formatVnd(input.overdueAmount)} cần nhắc thu`,
      actionLabel: 'Xem công nợ',
      route: '/debt',
      priority: 100,
    });
  }

  if (input.createdTrips > 0) {
    items.push({
      id: 'dispatch-created-trips',
      kind: 'dispatch',
      severity: 'warning',
      title: `${input.createdTrips} đơn hàng chờ phân xe`,
      subtitle: 'Phân xe để không trễ giờ xuất phát',
      actionLabel: 'Phân xe',
      route: '/dispatch',
      priority: 90,
    });
  }

  // O2C Step 4 — flow-congestion alerts (parallel-branch stalls).
  if (input.stalledDispatchedNoOrder > 0) {
    items.push({
      id: 'dispatch-stall-no-order',
      kind: 'dispatch',
      severity: 'warning',
      title: `${input.stalledDispatchedNoOrder} lô đã phân xe chờ đổi lệnh`,
      subtitle: 'Xe đã gán nhưng Ops chưa hoàn tất đổi lệnh quá lâu',
      actionLabel: 'Xem điều vận',
      route: '/dispatch',
      priority: 88,
    });
  }

  if (input.stalledOrderNoTruck > 0) {
    const overdue = input.stalledOrderNoTruckOverdue > 0;
    items.push({
      id: 'dispatch-stall-no-truck-near-cutoff',
      kind: 'dispatch',
      severity: overdue ? 'critical' : 'warning',
      title: `${input.stalledOrderNoTruck} lô đổi lệnh xong sắp hết hạn lưu bãi${overdue ? ' (đã quá hạn)' : ''}`,
      subtitle: 'Đã đổi lệnh nhưng chưa phân xe, hạn lưu bãi sắp tới',
      actionLabel: 'Phân xe gấp',
      route: '/dispatch',
      priority: overdue ? 92 : 84,
    });
  }

  const overdueRenewals = input.renewalReminders.filter((item) => item.daysRemaining < 0).length;
  if (input.renewalReminders.length > 0) {
    items.push({
      id: 'renewal-reminders',
      kind: 'renewal',
      severity: overdueRenewals > 0 ? 'critical' : 'warning',
      title: `${input.renewalReminders.length} hạng mục cần gia hạn`,
      subtitle: overdueRenewals > 0
        ? `${overdueRenewals} hạng mục đã quá hạn`
        : 'Bảo hiểm, đăng kiểm hoặc phí đường bộ sắp đến hạn',
      actionLabel: 'Xem chi phí',
      route: '/expenses',
      priority: overdueRenewals > 0 ? 86 : 70,
    });
  }

  const tripIdsWithPhotos = new Set(
    input.completedPhotoRows
      .filter((row) => Number(row.count || 0) > 0)
      .map((row) => row.tripId),
  );
  const noPhotoCompleted = input.completedTripsForLock
    .filter((trip) => !tripIdsWithPhotos.has(trip.id))
    .length;
  if (noPhotoCompleted > 0) {
    items.push({
      id: 'completed-missing-photo',
      kind: 'trip-lock',
      severity: 'warning',
      title: `${noPhotoCompleted} chuyến hoàn thành thiếu ảnh`,
      subtitle: 'Bổ sung bằng chứng trước khi chốt chuyến',
      actionLabel: 'Xem chuyến',
      route: '/trips?status=COMPLETED',
      priority: 82,
    });
  }

  const readyToLock = input.completedTripsForLock.length - noPhotoCompleted;
  if (readyToLock > 0) {
    items.push({
      id: 'completed-ready-to-lock',
      kind: 'trip-lock',
      severity: 'info',
      title: `${readyToLock} chuyến sẵn sàng chốt`,
      subtitle: 'Kiểm tra lần cuối để ghi nhận vào P&L',
      actionLabel: 'Chốt chuyến',
      route: '/trips?status=COMPLETED',
      priority: 76,
    });
  }

  if (input.missingFinancialTrips > 0) {
    items.push({
      id: 'missing-trip-financials',
      kind: 'trip-data',
      severity: 'warning',
      title: `${input.missingFinancialTrips} chuyến thiếu số liệu`,
      subtitle: 'Cần đủ doanh thu, dầu, tiền đường và lương lái xe',
      actionLabel: 'Bổ sung',
      route: '/trips',
      priority: 74,
    });
  }

  if (input.fuelWarningTrips > 0) {
    items.push({
      id: 'fuel-threshold-warnings',
      kind: 'fuel',
      severity: 'warning',
      title: `${input.fuelWarningTrips} chuyến vượt định mức dầu`,
      subtitle: 'Đối chiếu km, số lít và khai báo bổ sung',
      actionLabel: 'Xem chuyến',
      route: '/trips?fuelWarn=1',
      priority: 68,
    });
  }

  if (input.revenue > 0) {
    items.push({
      id: 'profit-close-ready',
      kind: 'profit-close',
      severity: items.some((item) => item.severity === 'critical' || item.severity === 'warning') ? 'info' : 'success',
      title: `Báo cáo lợi nhuận ${input.month}/${input.year} sẵn sàng`,
      subtitle: 'Xem lại số liệu trước khi phân bổ lợi nhuận',
      actionLabel: 'Xem',
      route: '/profit',
      priority: 20,
    });
  }

  if (items.length === 0) {
    items.push({
      id: 'all-clear',
      kind: 'all-clear',
      severity: 'success',
      title: 'Không có quyết định đang chờ',
      subtitle: 'Công nợ, phân xe, gia hạn và số liệu đều ổn',
      priority: 0,
    });
  }

  return items.sort((a, b) => b.priority - a.priority);
}

function countFuelWarningTrips(
  rows: Array<{ tripId: number; fuelLiters: string | null; totalKm: number }>,
  fuelConfig: typeof s.fuelConfig.$inferSelect | undefined,
): number {
  const warnThreshold = parseThreshold(fuelConfig?.warningThreshold, 0);
  if (warnThreshold <= 0) return 0;

  return rows.filter((row) => {
    const totalKm = Number(row.totalKm || 0);
    const fuelLiters = Number(row.fuelLiters || 0);
    if (totalKm <= 0 || fuelLiters <= 0) return false;
    return (fuelLiters / totalKm) * 100 > warnThreshold;
  }).length;
}

function formatVnd(value: number): string {
  return `${Math.round(value).toLocaleString('vi-VN')} đ`;
}
