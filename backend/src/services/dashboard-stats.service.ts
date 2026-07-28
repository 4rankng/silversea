/**
 * Dashboard Stats Service
 *
 * Dashboard summary: current-month KPIs, top overdue customer, top shareholder.
 */

import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, sql, gte, desc, inArray } from 'drizzle-orm';
import { TripStatus, parseThreshold, type DashboardDecisionItem } from '@tingting/shared';
import { getReceivablesSummary, getTopOverdueCustomer, CURRENT_AGING_RANGE } from './aging.service';
import { cacheGet } from '../lib/redis';
import { salaryPeriodDateRange, localDateStr, resolveCapTableSnapshot, tripCompletionBusinessDateSql } from './reporting-shared';
import { getPnlReport } from './pnl.service';
import { getRenewalReminders } from './expense.service';

export async function getDashboardStats() {
  return cacheGet('reports:dashboard', 30, async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const { start: monthStart, end: monthEnd } = await salaryPeriodDateRange(month, year);
    const completionBusinessDate = tripCompletionBusinessDateSql();
    const officialTripPeriod = and(
      isNull(s.trips.deletedAt),
      sql`${s.trips.completedAt} is not null`,
      gte(completionBusinessDate, monthStart),
      sql`${completionBusinessDate} < ${monthEnd}`,
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
        tripCount: sql<number>`count(*) filter (where ${s.trips.status} in ('COMPLETED', 'LOCKED'))`,
        completedTrips: sql<number>`count(*) filter (where ${s.trips.status} = 'COMPLETED')`,
        lockedTrips: sql<number>`count(*) filter (where ${s.trips.status} = 'LOCKED')`,
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
      db.select({ count: sql<number>`count(*)` }).from(s.trips).where(and(
        officialTripPeriod,
        inArray(s.trips.status, [TripStatus.COMPLETED, TripStatus.LOCKED]),
        sql`(
          coalesce(${s.trips.revenue}, 0) <= 0
          OR coalesce(${s.trips.fuelLiters}, 0) <= 0
          OR coalesce(${s.trips.totalRoadAllowance}, 0) <= 0
          OR coalesce(${s.trips.driverSalary}, 0) <= 0
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
        tripId: s.trips.id,
        fuelLiters: s.trips.fuelLiters,
        totalKm: sql<number>`coalesce(sum(${s.tripLegs.km}), 0)`,
      })
        .from(s.trips)
        .leftJoin(s.tripLegs, eq(s.tripLegs.tripId, s.trips.id))
        .where(and(
          officialTripPeriod,
          inArray(s.trips.status, [TripStatus.COMPLETED, TripStatus.LOCKED]),
        ))
        .groupBy(s.trips.id),
    ]);

    const topShareholder = resolveTopShareholder(capRows);

    const revenue = Number(pnlReport.totalRevenue || 0);
    const costs = Number(pnlReport.totalCosts || 0);
    const grossProfit = Number(pnlReport.grossProfit || 0);
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
    });

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
