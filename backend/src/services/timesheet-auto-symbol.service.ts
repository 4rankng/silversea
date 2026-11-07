/**
 * SIL-737 — chuyến nội bộ "Đã hoàn thành" tự ghi ký hiệu vào lưới chấm
 * công lái xe (/timesheet) theo NGÀY HOÀN THÀNH.
 *
 * Trước SIL-737 lưới chỉ có một nguồn: Điều vận gõ tay ký hiệu cho từng ô
 * ngày. Nay một chuyến của xe nội bộ (SilverSea) hoàn thành thì hệ thống tự
 * suy ra ký hiệu của ô ngày đó — Đ (chạy đơn) · K (kẹp) · Q (quay đầu) — theo
 * đúng bộ ký hiệu mà shared `timesheetSymbolForDay` và
 * `TIMESHEET_SYMBOL_RULES` định nghĩa, nên lưới và bảng lương không thể lệch
 * nhau.
 *
 * Luật ghi (xem cả shared `timesheetSymbolForDay`):
 *   • Chỉ chuyến XE NỘI BỘ (xe không thuộc nhà xe ngoài) — chuyến nhà xe ngoài
 *     không có lái xe nội bộ nên không có ô chấm công nào để ghi.
 *   • Ngày ghi = NGÀY HOÀN THÀNH theo luật SIL-683 (UTC → Asia/Ho_Chi_Minh),
 *     không phải ngày xuất phát.
 *   • Ký hiệu suy ra từ CÁC chuyến hoàn thành trong ngày đó của lái xe đó
 *     (1 chuyến → K/Đ; 2 chuyến trở lên → Q), nên một ngày có chuyến thứ hai
 *     thì ô được làm mới chứ không giữ ký hiệu cũ.
 *   • Ô do Điều vận gõ tay (`source = 'MANUAL'`) KHÔNG bị đè: ô người đang
 *     làm việc thuộc về người đó. Ô hệ thống ghi (`source = 'AUTO'`) thì được
 *     làm mới và bị xoá khi ngày đó không còn chuyến nào (chuyến bị huỷ).
 *   • Tháng chấm công chưa mở thì mở luôn theo chế độ lương của chính lái xe
 *     (luật FB-103: bảng mới kế thừa `drivers.salary_mode`), `daily_base` để
 *     trống cho tới khi Kế toán nhập — đúng như khi Kế toán tự mở bảng.
 *   • Tháng đã ĐỐI CHIẾU (RECONCILED) thì không ghi: bảng đã được niêm phong,
 *     muốn sửa thì phải mở lại (đúng luật mà ghi lưới tay đang chấp hành).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isSundayUtc, monthOfDay, timesheetSymbolForDay, type TimesheetSymbol } from '@tingting/shared';
import { db, type Executor } from '../db';
import * as s from '../db/schema';
import { tripCompletionBusinessDateSql } from './completion-business-date-sql.service';
import { classifyTripRun } from './trip-run-shape';

/** Who wrote a grid cell: the dispatcher typed it, or the system derived it. */
export type TimesheetDaySource = 'MANUAL' | 'AUTO';

/** What the auto-write did, for the audit trail and the caller's log. */
export interface TimesheetAutoWriteResult {
  /** The day the symbol was written for (or removed from). */
  workDate: string | null;
  /** The symbol now standing for that day (null = the cell was removed). */
  symbol: TimesheetSymbol | null;
  /** False when nothing was written (out of scope, manual cell, sealed month). */
  wrote: boolean;
  /** Why nothing was written — for the audit trail, never a silent skip. */
  reason:
    | 'WRITTEN'
    | 'REMOVED'
    | 'NOT_INTERNAL_TRIP'
    | 'NO_DRIVER'
    | 'NO_COMPLETION_DATE'
    | 'MANUAL_CELL'
    | 'SEALED_MONTH'
    | 'NO_MONTH'
    | 'NO_TRIPS';
}

/**
 * The trips of one driver-day that count for the grid: COMPLETED, on an
 * internal-fleet truck, finished on the business date of that day.
 */
async function completedRunsForDay(
  executor: Executor,
  driverId: number,
  workDate: string,
): Promise<Array<'KEP' | 'KET_HOP' | 'LAY_LE' | 'DON'>> {
  const rows = await executor
    .select({
      pairKind: s.tripPairs.pairKind,
      dispatchClassification: s.shipmentFulfillments.dispatchClassification,
      fulfillmentType: s.shipmentFulfillments.fulfillmentType,
    })
    .from(s.trips)
    // Inner join: a trip without a live internal truck has no internal run.
    .innerJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.tripPairs, eq(s.tripPairs.id, s.trips.activeTripPairId))
    .leftJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
    .where(and(
      eq(s.trips.driverId, driverId),
      eq(s.trips.status, 'COMPLETED'),
      isNull(s.trips.deletedAt),
      // Xe nội bộ: xe SilverSea, không thuộc nhà xe ngoài.
      isNull(s.trucks.carrierId),
      isNull(s.trucks.deletedAt),
      // Luật ngày hoàn thành SIL-683 — cùng phép tính với ngày của chính chuyến.
      eq(tripCompletionBusinessDateSql(), workDate),
    ));
  return rows.map((row) => classifyTripRun({
    pairKind: row.pairKind,
    dispatchClassification: row.dispatchClassification,
    fulfillmentType: row.fulfillmentType,
  }));
}

/**
 * The driver's period session, opened on demand (the driver's own salary mode,
 * `daily_base` left for Kế toán — the same defaults the Kế toán path uses).
 */
async function ensureTimesheetMonth(
  executor: Executor,
  driverId: number,
  year: number,
  month: number,
): Promise<typeof s.driverTimesheetMonths.$inferSelect | null> {
  const existing = await executor.select().from(s.driverTimesheetMonths)
    .where(and(
      eq(s.driverTimesheetMonths.driverId, driverId),
      eq(s.driverTimesheetMonths.year, year),
      eq(s.driverTimesheetMonths.month, month),
    )).limit(1);
  if (existing[0]) return existing[0];

  const [driver] = await executor.select({ salaryMode: s.drivers.salaryMode })
    .from(s.drivers)
    .where(and(eq(s.drivers.id, driverId), isNull(s.drivers.deletedAt)))
    .limit(1);
  if (!driver) return null;

  // Two completions can land in the same second: the unique index is the
  // arbiter, so a losing insert is not an error.
  await executor.insert(s.driverTimesheetMonths).values({
    driverId,
    year,
    month,
    salaryMode: driver.salaryMode === 'FLAT_MONTHLY' ? 'FLAT_MONTHLY' : 'PER_TRIP',
    dailyBase: null,
    flatAmount: null,
    status: 'OPEN',
  }).onConflictDoNothing({
    target: [s.driverTimesheetMonths.driverId, s.driverTimesheetMonths.year, s.driverTimesheetMonths.month],
  });
  const [row] = await executor.select().from(s.driverTimesheetMonths)
    .where(and(
      eq(s.driverTimesheetMonths.driverId, driverId),
      eq(s.driverTimesheetMonths.year, year),
      eq(s.driverTimesheetMonths.month, month),
    )).limit(1);
  return row ?? null;
}

/**
 * Re-derive the symbol of the day this trip touches and write it into the
 * grid. Called from the ONE trip-completion engine, so every completion path
 * (dispatcher close, driver app close, external-carrier staff close) and the
 * cancel path land the same rule.
 */
export async function syncTimesheetSymbolForTrip(
  tripId: number,
  actorUserId: number | null,
  executor: Executor = db,
): Promise<TimesheetAutoWriteResult> {
  const [trip] = await executor.select({
    driverId: s.trips.driverId,
    status: s.trips.status,
    truckId: s.trips.truckId,
    carrierId: s.trucks.carrierId,
    workDate: sql<string | null>`${tripCompletionBusinessDateSql()}`,
  }).from(s.trips)
    .innerJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .where(eq(s.trips.id, tripId)).limit(1);
  if (!trip) return { workDate: null, symbol: null, wrote: false, reason: 'NOT_INTERNAL_TRIP' };
  if (trip.carrierId != null) return { workDate: null, symbol: null, wrote: false, reason: 'NOT_INTERNAL_TRIP' };
  if (trip.driverId == null) return { workDate: null, symbol: null, wrote: false, reason: 'NO_DRIVER' };
  if (!trip.workDate) return { workDate: null, symbol: null, wrote: false, reason: 'NO_COMPLETION_DATE' };

  const workDate = trip.workDate;
  const { year, month } = monthOfDay(workDate);
  const period = await ensureTimesheetMonth(executor, trip.driverId, year, month);
  if (!period) return { workDate, symbol: null, wrote: false, reason: 'NO_MONTH' };
  // A sealed period is the accountant's signed figure — the auto-write stops
  // here exactly like a manual grid write stops (409 → mở lại bảng).
  if (period.status === 'RECONCILED') return { workDate, symbol: null, wrote: false, reason: 'SEALED_MONTH' };

  const runs = await completedRunsForDay(executor, trip.driverId, workDate);
  const symbol = timesheetSymbolForDay(runs);

  const [existing] = await executor.select().from(s.driverTimesheetDays)
    .where(and(
      eq(s.driverTimesheetDays.monthId, period.id),
      eq(s.driverTimesheetDays.workDate, workDate),
    )).limit(1);

  // Ô của Điều vận không bị đè.
  if (existing && existing.source === 'MANUAL') {
    return { workDate, symbol: existing.symbol as TimesheetSymbol, wrote: false, reason: 'MANUAL_CELL' };
  }

  const now = new Date();
  if (symbol == null) {
    // Ngày đó không còn chuyến nào (chuyến bị huỷ) → xoá ô do hệ thống ghi.
    if (existing) {
      await executor.delete(s.driverTimesheetDays).where(eq(s.driverTimesheetDays.id, existing.id));
      await executor.update(s.driverTimesheetMonths)
        .set({ updatedAt: now })
        .where(eq(s.driverTimesheetMonths.id, period.id));
      await executor.insert(s.auditLogs).values({
        userId: actorUserId,
        message: `Xoá ký hiệu chấm công tự ghi ngày ${workDate}`,
        entityType: 'TIMESHEET_MONTH',
        entityId: period.id,
        payload: { action: 'auto-remove', workDate, driverId: trip.driverId, tripId },
      });
      return { workDate, symbol: null, wrote: true, reason: 'REMOVED' };
    }
    return { workDate, symbol: null, wrote: false, reason: 'NO_TRIPS' };
  }

  if (existing) {
    await executor.update(s.driverTimesheetDays).set({
      symbol,
      isSunday: isSundayUtc(workDate),
      enteredBy: actorUserId,
      enteredAt: now,
      updatedAt: now,
    }).where(eq(s.driverTimesheetDays.id, existing.id));
  } else {
    await executor.insert(s.driverTimesheetDays).values({
      monthId: period.id,
      driverId: trip.driverId,
      workDate,
      symbol,
      isSunday: isSundayUtc(workDate),
      source: 'AUTO',
      enteredBy: actorUserId,
      enteredAt: now,
    });
  }
  await executor.update(s.driverTimesheetMonths)
    .set({ updatedAt: now })
    .where(eq(s.driverTimesheetMonths.id, period.id));
  await executor.insert(s.auditLogs).values({
    userId: actorUserId,
    message: `Tự ghi ký hiệu chấm công ${symbol} ngày ${workDate}`,
    entityType: 'TIMESHEET_MONTH',
    entityId: period.id,
    payload: { action: 'auto', workDate, symbol, driverId: trip.driverId, tripId, runs: runs.length },
  });
  return { workDate, symbol, wrote: true, reason: 'WRITTEN' };
}
