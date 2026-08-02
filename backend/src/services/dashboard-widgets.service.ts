// Dashboard widgets — M11.5 (PRD M11-05-01/03).
//
// New KPIs for the director dashboard:
//   - Two-way-cargo ratio: % of completed trips with hasReturnCargo = true.
//   - Fleet attention list: trucks in MAINTENANCE/INACTIVE + trucks with
//     no completed trip in the last 7 days (underutilized).
//   - Period-over-period: revenue + profit delta vs. the previous month.
//
// These supplement the existing getDashboardStats (revenue/cost/profit/
// tripCount/fleetStatus). This service is read-only and cached.

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, sql, isNull, gte, lte, desc, count, ne } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';
import { getPnlReport } from './pnl.service';
import { cacheGet } from '../lib/redis';
import { salaryPeriodDateRange, tripCompletionBusinessDateSql } from './reporting-shared';

export interface DashboardWidgets {
  twoWayCargoRatio: {
    /** % of billable trips this month with return cargo (0-100). */
    percentage: number;
    tripsWithReturnCargo: number;
    totalBillableTrips: number;
  };
  fleetAttention: Array<{
    truckId: number;
    licensePlate: string;
    status: string;
    /** Days since the truck's last completed trip (null = never). */
    daysSinceLastTrip: number | null;
    reason: string;
  }>;
  periodOverPeriod: {
    currentRevenue: number;
    previousRevenue: number;
    revenueChangePct: number;
    currentProfit: number;
    previousProfit: number;
    profitChangePct: number;
  };
}

export async function getDashboardWidgets(month?: number, year?: number, skipCache = false): Promise<DashboardWidgets> {
  const compute = async (): Promise<DashboardWidgets> => {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    const { start: periodStart, end: periodEnd } = await salaryPeriodDateRange(m, y);
    const completionBusinessDate = tripCompletionBusinessDateSql();

    // ─── Two-way-cargo ratio ──────────────────────────────────────────────
    const billableTrips = await db.select({
      hasReturnCargo: s.trips.hasReturnCargo,
    }).from(s.trips).where(and(
      inArrayStatus(),
      isNull(s.trips.deletedAt),
      sql`${s.trips.completedAt} is not null`,
      gte(completionBusinessDate, periodStart),
      sql`${completionBusinessDate} < ${periodEnd}`,
    ));
    const totalBillableTrips = billableTrips.length;
    const tripsWithReturnCargo = billableTrips.filter(t => t.hasReturnCargo).length;
    const percentage = totalBillableTrips > 0
      ? Math.round((tripsWithReturnCargo / totalBillableTrips) * 100)
      : 0;

    // ─── Fleet attention list ─────────────────────────────────────────────
    // 1. Trucks in MAINTENANCE or INACTIVE status.
    // 2. ACTIVE trucks with no completed trip in the last 7 days.
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    const allTrucks = await db.select({
      id: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
      status: s.trucks.status,
    }).from(s.trucks).where(isNull(s.trucks.deletedAt));

    // Last completed trip date per truck.
    const lastTrips = await db.select({
      truckId: s.trips.truckId,
      lastDate: sql<string>`max(${completionBusinessDate})`.as('last_date'),
    }).from(s.trips).where(and(
      inArrayStatus(),
      isNull(s.trips.deletedAt),
      sql`${s.trips.completedAt} is not null`,
      sql`${s.trips.truckId} IS NOT NULL`,
    )).groupBy(s.trips.truckId);
    const lastTripByTruck = new Map(lastTrips.map(r => [r.truckId, r.lastDate]));

    const fleetAttention: DashboardWidgets['fleetAttention'] = [];
    for (const truck of allTrucks) {
      const lastDate = truck.id ? lastTripByTruck.get(truck.id) ?? null : null;
      const daysSince = lastDate
        ? Math.floor((now.getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      if (truck.status === 'MAINTENANCE') {
        fleetAttention.push({
          truckId: truck.id, licensePlate: truck.licensePlate,
          status: truck.status, daysSinceLastTrip: daysSince,
          reason: 'Đang bảo dưỡng',
        });
      } else if (truck.status === 'INACTIVE') {
        fleetAttention.push({
          truckId: truck.id, licensePlate: truck.licensePlate,
          status: truck.status, daysSinceLastTrip: daysSince,
          reason: 'Ngừng hoạt động',
        });
      } else if (truck.status === 'ACTIVE' && (daysSince === null || daysSince > 7)) {
        fleetAttention.push({
          truckId: truck.id, licensePlate: truck.licensePlate,
          status: truck.status, daysSinceLastTrip: daysSince,
          reason: daysSince === null ? 'Chưa có chuyến' : `Không hoạt động ${daysSince} ngày`,
        });
      }
    }

    // ─── Period-over-period (current vs. previous month) ──────────────────
    const currentPnl = await getPnlReport(m, y);
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const prevPnl = await getPnlReport(prevM, prevY);

    const currentRevenue = Number(currentPnl.totalRevenue || 0);
    const previousRevenue = Number(prevPnl.totalRevenue || 0);
    const currentProfit = Number(currentPnl.netProfit || currentPnl.grossProfit || 0);
    const previousProfit = Number(prevPnl.netProfit || prevPnl.grossProfit || 0);

    const revenueChangePct = previousRevenue > 0
      ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100)
      : 0;
    const profitChangePct = previousProfit > 0
      ? Math.round(((currentProfit - previousProfit) / previousProfit) * 100)
      : 0;

    return {
      twoWayCargoRatio: { percentage, tripsWithReturnCargo, totalBillableTrips },
      fleetAttention,
      periodOverPeriod: {
        currentRevenue, previousRevenue, revenueChangePct,
        currentProfit, previousProfit, profitChangePct,
      },
    };
  };

  if (skipCache) return compute();
  return cacheGet(`reports:dashboard-widgets:${month ?? 'current'}:${year ?? ''}`, 60, compute);
}

/** Helper: billable trip statuses as a SQL IN clause. */
function inArrayStatus() {
  return sql`${s.trips.status} = 'COMPLETED'`;
}
