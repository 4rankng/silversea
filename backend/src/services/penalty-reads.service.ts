/**
 * Penalty read-side service — paginated admin list + KPI insights.
 *
 * Split from financial.service.ts along the reads/writes seam: mutations
 * (create/cancel + governance) stay with the ledger code there, while these
 * query-side functions live here under the LOC budget.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, desc, isNull, gte, lte, ilike, or, count, sum, max } from 'drizzle-orm';
import { type PenaltyStatus } from '@tingting/shared';
import { escapeLikeTerm } from '../lib/format';
import { resolveSalaryPeriodDateRange } from './salary-period.service';
import { currentVietnamMonthStart } from './financial-reporting-policy.service';

/**
 * Filters shared by the penalty list and insights reads. Dates are ISO
 * (YYYY-MM-DD), inclusive on both ends, and scope penalties.date.
 */
export interface PenaltyListFilters {
  page?: number;
  limit?: number;
  search?: string;
  driverId?: number;
  dateFrom?: string;
  dateTo?: string;
  status?: PenaltyStatus;
}

export interface PenaltyInsightsMonth {
  /** Số vụ vi phạm trong kỳ lương đang chọn. */
  incidentCount: number;
  /** Tổng tiền phạt trong kỳ. */
  totalAmount: number;
  /** Số vụ trong kỳ lương liền trước. */
  prevMonthCount: number;
  /** Nhãn so sánh với kỳ trước — mirror monthComparison phía PenaltyTable. */
  comparisonLabel: string;
}

export interface PenaltyInsightsScoreboardRow {
  driverId: number;
  name: string;
  /** Số ngày liên tục không vi phạm (toàn bộ lịch sử) — mirror computeStreak. */
  streakDays: number;
  violations7d: number;
  violations30d: number;
  violations90d: number;
  violationsYtd: number;
  /** Tổng tiền phạt từ đầu năm. */
  fineYtd: number;
  /** Hạng A+/A/B/C theo vi phạm 90 ngày (cửa sổ mặc định) — mirror getViolationGrade. */
  grade: string;
  truckPlate: string | null;
}

export interface PenaltyInsights {
  month: PenaltyInsightsMonth;
  ytd: { count: number; total: number };
  /** Lái xe ACTIVE không có vi phạm nào trong kỳ. */
  safeDriverCount: number;
  driverTotal: number;
  /** Toàn bộ lái xe ACTIVE, sắp xếp theo chuỗi an toàn giảm dần. */
  scoreboard: PenaltyInsightsScoreboardRow[];
  longestStreak: number;
  streakLeader: string;
  avgStreak: number;
  driversOver90: number;
  driversOver6m: number;
}

/**
 * Shared where-clause for penalty reads: soft-delete + list filters.
 * `omitStatus` drops the status condition so chip counts stay full-set while
 * a status filter is active (mirrors the advance-list pattern).
 */
function buildPenaltyConditions(filters: {
  search?: string;
  driverId?: number;
  dateFrom?: string;
  dateTo?: string;
  status?: PenaltyStatus;
}, options?: { omitStatus?: boolean }) {
  const conditions = [isNull(s.penalties.deletedAt)];
  if (filters.driverId) conditions.push(eq(s.penalties.driverId, filters.driverId));
  if (filters.dateFrom) conditions.push(gte(s.penalties.date, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(s.penalties.date, filters.dateTo));
  if (!options?.omitStatus && filters.status) conditions.push(eq(s.penalties.status, filters.status));
  if (filters.search) {
    const like = `%${escapeLikeTerm(filters.search)}%`;
    const matcher = or(
      ilike(s.drivers.name, like),
      ilike(s.trips.tripCode, like),
      ilike(s.penaltyReasons.reasonText, like),
      ilike(s.penalties.customReason, like),
    );
    if (matcher) conditions.push(matcher);
  }
  return and(...conditions);
}

const DAY_MS = 86_400_000;

/**
 * List penalties — server-side pagination + filters (driver, inclusive date
 * range, status, free-text search over driver name / trip code / reason).
 * `statusCounts` (all/ACTIVE/CANCELED) rides along so the UI status chips are
 * full-set numbers, never page-derived.
 */
export async function getPenalties(filters: PenaltyListFilters = {}) {
  const page = Math.max(1, Math.floor(filters.page || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(filters.limit || 50)));
  const where = buildPenaltyConditions(filters);
  const whereAll = buildPenaltyConditions(filters, { omitStatus: true });

  const [items, countRows, statusRows] = await Promise.all([
    db.select({
      id: s.penalties.id, driverId: s.penalties.driverId, tripId: s.penalties.tripId,
      reasonId: s.penalties.reasonId, customReason: s.penalties.customReason,
      amount: s.penalties.amount, date: s.penalties.date, status: s.penalties.status,
      driverName: s.drivers.name,
      reasonText: s.penaltyReasons.reasonText,
      tripCode: s.trips.tripCode,
    }).from(s.penalties)
      .leftJoin(s.drivers, eq(s.penalties.driverId, s.drivers.id))
      .leftJoin(s.penaltyReasons, eq(s.penalties.reasonId, s.penaltyReasons.id))
      .leftJoin(s.trips, eq(s.penalties.tripId, s.trips.id))
      .where(where)
      .orderBy(desc(s.penalties.date), desc(s.penalties.id))
      .limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(s.penalties)
      .leftJoin(s.drivers, eq(s.penalties.driverId, s.drivers.id))
      .leftJoin(s.penaltyReasons, eq(s.penalties.reasonId, s.penaltyReasons.id))
      .leftJoin(s.trips, eq(s.penalties.tripId, s.trips.id))
      .where(where),
    db.select({ status: s.penalties.status, count: count() }).from(s.penalties)
      .leftJoin(s.drivers, eq(s.penalties.driverId, s.drivers.id))
      .leftJoin(s.penaltyReasons, eq(s.penalties.reasonId, s.penaltyReasons.id))
      .leftJoin(s.trips, eq(s.penalties.tripId, s.trips.id))
      .where(whereAll)
      .groupBy(s.penalties.status),
  ]);

  const statusCounts: Record<string, number> = {};
  let statusTotal = 0;
  for (const row of statusRows) {
    statusCounts[row.status] = row.count;
    statusTotal += row.count;
  }
  statusCounts.all = statusTotal;

  return { items, total: Number(countRows[0]?.total ?? 0), page, pageSize: limit, statusCounts };
}

/** getViolationGrade transplant from frontend features/penalties/utils. */
function penaltyViolationGrade(violationCount: number): string {
  if (violationCount === 0) return 'A+';
  if (violationCount <= 2) return 'A';
  if (violationCount <= 5) return 'B';
  return 'C';
}

/**
 * Server-computed KPI block for the penalty screen — replaces the client-side
 * computation PenaltyTable used to run over the full list. Month figures use
 * salary-period boundaries (same resolver as the config endpoint); window
 * cutoffs and streaks mirror the frontend formulas exactly so the swap is
 * behavior-identical.
 */
export async function getPenaltyInsights(input: { month?: number; year?: number } = {}): Promise<PenaltyInsights> {
  const now = new Date();
  const vnMonthStart = currentVietnamMonthStart(now);
  const month = input.month ?? Number(vnMonthStart.slice(5, 7));
  const year = input.year ?? Number(vnMonthStart.slice(0, 4));
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const [period, prevPeriod] = await Promise.all([
    resolveSalaryPeriodDateRange(month, year),
    resolveSalaryPeriodDateRange(prevMonth, prevYear),
  ]);

  // Window cutoffs mirror PenaltyTable: mutate now, slice the UTC ISO date.
  const cutoff = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const yearStart = `${now.getFullYear()}-01-01`;
  const alive = isNull(s.penalties.deletedAt);
  const inRange = (start: string, end: string) => and(
    alive,
    gte(s.penalties.date, start),
    lte(s.penalties.date, end),
  );

  const [monthRows, prevCountRows, ytdRows, w7Rows, w30Rows, w90Rows, lastRows, rosterRows] = await Promise.all([
    db.select({ driverId: s.penalties.driverId, count: count(), amount: sum(s.penalties.amount) })
      .from(s.penalties).where(inRange(period.start, period.end)).groupBy(s.penalties.driverId),
    db.select({ total: count() }).from(s.penalties).where(inRange(prevPeriod.start, prevPeriod.end)),
    db.select({ driverId: s.penalties.driverId, count: count(), amount: sum(s.penalties.amount) })
      .from(s.penalties).where(and(alive, gte(s.penalties.date, yearStart))).groupBy(s.penalties.driverId),
    db.select({ driverId: s.penalties.driverId, count: count() })
      .from(s.penalties).where(and(alive, gte(s.penalties.date, cutoff(7)))).groupBy(s.penalties.driverId),
    db.select({ driverId: s.penalties.driverId, count: count() })
      .from(s.penalties).where(and(alive, gte(s.penalties.date, cutoff(30)))).groupBy(s.penalties.driverId),
    db.select({ driverId: s.penalties.driverId, count: count() })
      .from(s.penalties).where(and(alive, gte(s.penalties.date, cutoff(90)))).groupBy(s.penalties.driverId),
    db.select({ driverId: s.penalties.driverId, lastDate: max(s.penalties.date) })
      .from(s.penalties).where(alive).groupBy(s.penalties.driverId),
    // Roster mirrors the frontend: config list (soft-delete filtered) plus the
    // client-side status==='ACTIVE' filter; truck plate for the scoreboard row.
    db.select({ id: s.drivers.id, name: s.drivers.name, createdAt: s.drivers.createdAt, plate: s.trucks.licensePlate })
      .from(s.drivers)
      .leftJoin(s.trucks, eq(s.drivers.assignedTruckId, s.trucks.id))
      .where(and(isNull(s.drivers.deletedAt), eq(s.drivers.status, 'ACTIVE'))),
  ]);

  const incidentCount = monthRows.reduce((acc, row) => acc + row.count, 0);
  const totalAmount = monthRows.reduce((acc, row) => acc + Number(row.amount ?? 0), 0);
  const prevMonthCount = Number(prevCountRows[0]?.total ?? 0);
  const comparisonLabel = prevMonthCount > 0
    ? `Giảm ${Math.round((1 - incidentCount / prevMonthCount) * 100)}% so với ${String(prevMonth).padStart(2, '0')}/${String(prevYear).slice(-2)}`
    : incidentCount === 0 ? 'Tháng an toàn' : '';

  const penalizedInPeriod = new Set(monthRows.map((row) => row.driverId));
  const ytdByDriver = new Map(ytdRows.map((row) => [row.driverId, row]));
  const countByDriver = (rows: { driverId: number; count: number }[]) => new Map(rows.map((row) => [row.driverId, row.count]));
  const w7ByDriver = countByDriver(w7Rows);
  const w30ByDriver = countByDriver(w30Rows);
  const w90ByDriver = countByDriver(w90Rows);
  const lastByDriver = new Map(lastRows.map((row) => [row.driverId, row.lastDate]));

  const scoreboard: PenaltyInsightsScoreboardRow[] = rosterRows.map((driver) => {
    const lastPenaltyDate = lastByDriver.get(driver.id) ?? null;
    const streakDays = lastPenaltyDate
      ? Math.max(0, Math.floor((now.getTime() - new Date(lastPenaltyDate).getTime()) / DAY_MS))
      : Math.max(0, Math.floor((now.getTime() - driver.createdAt.getTime()) / DAY_MS));
    const violations90d = w90ByDriver.get(driver.id) ?? 0;
    return {
      driverId: driver.id,
      name: driver.name,
      streakDays,
      violations7d: w7ByDriver.get(driver.id) ?? 0,
      violations30d: w30ByDriver.get(driver.id) ?? 0,
      violations90d,
      violationsYtd: ytdByDriver.get(driver.id)?.count ?? 0,
      fineYtd: Number(ytdByDriver.get(driver.id)?.amount ?? 0),
      grade: penaltyViolationGrade(violations90d),
      truckPlate: driver.plate ?? null,
    };
  }).sort((a, b) => b.streakDays - a.streakDays || a.violations90d - b.violations90d || a.driverId - b.driverId);

  return {
    month: { incidentCount, totalAmount, prevMonthCount, comparisonLabel },
    ytd: {
      count: ytdRows.reduce((acc, row) => acc + row.count, 0),
      total: ytdRows.reduce((acc, row) => acc + Number(row.amount ?? 0), 0),
    },
    safeDriverCount: rosterRows.filter((driver) => !penalizedInPeriod.has(driver.id)).length,
    driverTotal: rosterRows.length,
    scoreboard,
    longestStreak: scoreboard.reduce((max, row) => Math.max(max, row.streakDays), 0),
    streakLeader: scoreboard[0]?.name || '—',
    avgStreak: scoreboard.length > 0
      ? Math.round(scoreboard.reduce((acc, row) => acc + row.streakDays, 0) / scoreboard.length)
      : 0,
    driversOver90: scoreboard.filter((row) => row.streakDays >= 90).length,
    driversOver6m: scoreboard.filter((row) => row.streakDays >= 180).length,
  };
}
