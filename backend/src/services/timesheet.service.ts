/**
 * Driver timesheet (chấm công lái xe) — the symbol grid Điều vận fills, the
 * accountant's signed corrections, and the month rollup. All money and every
 * symbol→trip count comes from shared `computeTimesheetSalary`; nothing here
 * recomputes it, so the grid, the API and the payroll figure cannot disagree.
 *
 * Audit trail (the doc requires "ghi nhận ai nhập gì"): every grid write stamps
 * enteredBy/enteredAt on the cell, every correction stamps adjustedBy/adjustedAt,
 * and each governed write appends one audit_logs row.
 *
 * Deliberately separate from driver_work_days/attendance.service — that surface
 * counts one TRIP_DAY per day and owns its own salary-confirmation governance.
 */

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  TIMESHEET_SYMBOLS,
  TIMESHEET_SALARY_MODES,
  computeTimesheetSalary,
  countDayTrips,
  daysOfMonth,
  isSundayUtc,
  type TimesheetSalaryMode,
  type TimesheetSalaryResult,
  type TimesheetSymbol,
} from '@tingting/shared';
import { db, type Executor } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';

export interface TimesheetActor {
  userId: number;
  fullName: string | null;
  role: string;
}

/** Static membership over the six grid symbols — a lookup table, not a Set. */
const KNOWN_SYMBOLS: Record<string, true> = {
  K: true, Q: true, 'Đ': true, L: true, N: true, P: true,
};

export interface TimesheetDayCell {
  id: number | null;
  workDate: string;
  symbol: TimesheetSymbol | null;
  trips: number;
  isSunday: boolean;
  tripAdjustment: number;
  note: string | null;
  enteredBy: number | null;
  enteredAt: string | null;
  adjustedBy: number | null;
  adjustedAt: string | null;
}

export interface TimesheetMonthView {
  id: number;
  driverId: number;
  driverName: string;
  year: number;
  month: number;
  salaryMode: TimesheetSalaryMode;
  dailyBase: number | null;
  flatAmount: number | null;
  status: 'OPEN' | 'RECONCILED';
  reconciledBy: number | null;
  reconciledAt: string | null;
  reconcileNote: string | null;
  days: TimesheetDayCell[];
  salary: TimesheetSalaryResult;
  /** Set when the accountant still has to decide a mode's missing money input. */
  warnings: string[];
}

export interface TimesheetRollupRow {
  driverId: number;
  driverName: string;
  /** đơn / kẹp / ghép counts are the per-symbol cell counts. */
  donCount: number;
  kepCount: number;
  quayDauCount: number;
  luuCaCount: number;
  nghiCount: number;
  nghiPhepCount: number;
  trips: number;
  workdays: number;
  bonusTrips: number;
  salaryMode: TimesheetSalaryMode | null;
  salary: number;
  perTripPay: number;
  extraTripBonus: number;
  dailyBasePay: number;
  status: 'OPEN' | 'RECONCILED' | null;
  /** Trips recorded on Sundays — paid separately, never an attended day. */
  sundayTrips: number;
  /** From the driver's COMPLETED trips with a financial row, in the month. */
  revenue: number | null;
  cost: number | null;
  salaryRatio: number | null;
  /** Completed trips carrying a trip_financial_state row (the revenue basis). */
  tripsCompleted: number;
}

function assertPeriod(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new ApiError(400, 'Năm không hợp lệ.');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ApiError(400, 'Tháng không hợp lệ (1–12).');
  }
}

function assertSymbol(symbol: unknown): asserts symbol is TimesheetSymbol {
  if (typeof symbol !== 'string' || !KNOWN_SYMBOLS[symbol]) {
    throw new ApiError(400, `Ký hiệu không hợp lệ. Chỉ nhận: ${TIMESHEET_SYMBOLS.join(', ')}.`);
  }
}

/** Postgres 23505 on the `(driver_id, year, month)` unique index. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === '23505';
}

function numeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function assertMonthOwnsDate(year: number, month: number, workDate: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(workDate);
  if (!match) throw new ApiError(400, `Ngày không hợp lệ: ${workDate}.`);
  const [, y, m] = match;
  if (Number(y) !== year || Number(m) !== month) {
    throw new ApiError(400, `Ngày ${workDate} không thuộc tháng ${String(month).padStart(2, '0')}/${year}.`);
  }
  // The day-of-month matters too: "2026-02-30" passes the year/month match but
  // Postgres rejects it as an invalid date (500), so it is caught here as the
  // 400 it is.
  if (!daysOfMonth(year, month).includes(workDate)) {
    throw new ApiError(400, `Ngày ${workDate} không tồn tại trong tháng ${String(month).padStart(2, '0')}/${year}.`);
  }
}

/** Drivers available in the grid, each with its current mode for the period. */
export async function listTimesheetDrivers(year: number, month: number) {
  assertPeriod(year, month);
  const rows = await db.select({
    id: s.drivers.id,
    name: s.drivers.name,
    status: s.drivers.status,
    // FB-104 (card 141026230810) — báo cáo Tổng hợp xếp lệnh tháng in Loại xe +
    // Biển kiểm soát của xe đang gán cho lái xe.
    plateNumber: s.trucks.licensePlate,
    vehicleClass: s.trucks.vehicleClass,
  }).from(s.drivers)
    .leftJoin(s.trucks, and(eq(s.trucks.id, s.drivers.assignedTruckId), isNull(s.trucks.deletedAt)))
    .where(isNull(s.drivers.deletedAt))
    .orderBy(asc(s.drivers.name));

  const months = await db.select({
    driverId: s.driverTimesheetMonths.driverId,
    id: s.driverTimesheetMonths.id,
    salaryMode: s.driverTimesheetMonths.salaryMode,
    status: s.driverTimesheetMonths.status,
  }).from(s.driverTimesheetMonths)
    .where(and(eq(s.driverTimesheetMonths.year, year), eq(s.driverTimesheetMonths.month, month)));
  const byDriver = new Map(months.map(row => [row.driverId, row]));

  return rows.map(row => ({
    ...row,
    monthId: byDriver.get(row.id)?.id ?? null,
    salaryMode: byDriver.get(row.id)?.salaryMode ?? null,
    monthStatus: byDriver.get(row.id)?.status ?? null,
  }));
}

async function loadMonthRow(id: number, executor: Executor = db) {
  const [row] = await executor.select().from(s.driverTimesheetMonths)
    .where(eq(s.driverTimesheetMonths.id, id)).limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy phiên chấm công.');
  return row;
}

async function loadMonthDays(monthId: number, executor: Executor = db) {
  return executor.select().from(s.driverTimesheetDays)
    .where(eq(s.driverTimesheetDays.monthId, monthId))
    .orderBy(asc(s.driverTimesheetDays.workDate));
}

/** Build the grid view: every calendar day of the month, filled or empty. */
async function buildMonthView(monthRow: typeof s.driverTimesheetMonths.$inferSelect, executor: Executor = db): Promise<TimesheetMonthView> {
  const [driver] = await executor.select({ name: s.drivers.name })
    .from(s.drivers).where(eq(s.drivers.id, monthRow.driverId)).limit(1);
  const rows = await loadMonthDays(monthRow.id, executor);
  const byDate = new Map(rows.map(row => [row.workDate, row]));

  const days: TimesheetDayCell[] = daysOfMonth(monthRow.year, monthRow.month).map(workDate => {
    const row = byDate.get(workDate);
    const sunday = row ? row.isSunday : isSundayUtc(workDate);
    return {
      id: row?.id ?? null,
      workDate,
      symbol: (row?.symbol as TimesheetSymbol | undefined) ?? null,
      trips: 0,
      isSunday: sunday,
      tripAdjustment: row?.tripAdjustment ?? 0,
      note: row?.note ?? null,
      enteredBy: row?.enteredBy ?? null,
      enteredAt: isoOrNull(row?.enteredAt ?? null),
      adjustedBy: row?.adjustedBy ?? null,
      adjustedAt: isoOrNull(row?.adjustedAt ?? null),
    };
  });

  // Trips per cell are computed by the shared authority, never stored twice.
  for (const cell of days) {
    cell.trips = countDayTrips({ symbol: cell.symbol, workDate: cell.workDate, tripAdjustment: cell.tripAdjustment });
  }
  const salary = computeTimesheetSalary({
    mode: monthRow.salaryMode as TimesheetSalaryMode,
    dailyBase: numeric(monthRow.dailyBase),
    flatAmount: numeric(monthRow.flatAmount),
    days: days.map(day => ({ symbol: day.symbol, workDate: day.workDate, tripAdjustment: day.tripAdjustment })),
  });

  const warnings: string[] = [];
  if (monthRow.salaryMode === 'FLAT_MONTHLY' && numeric(monthRow.flatAmount) === null) {
    warnings.push('Chưa nhập mức lương tháng cố định — lương đang tính bằng 0.');
  }
  if (monthRow.salaryMode === 'PER_TRIP' && numeric(monthRow.dailyBase) === null) {
    warnings.push('Chưa nhập lương ngày — thưởng chuyến vẫn tính, lương ngày bằng 0.');
  }

  return {
    id: monthRow.id,
    driverId: monthRow.driverId,
    driverName: driver?.name ?? `Lái xe #${monthRow.driverId}`,
    year: monthRow.year,
    month: monthRow.month,
    salaryMode: monthRow.salaryMode as TimesheetSalaryMode,
    dailyBase: numeric(monthRow.dailyBase),
    flatAmount: numeric(monthRow.flatAmount),
    status: monthRow.status as 'OPEN' | 'RECONCILED',
    reconciledBy: monthRow.reconciledBy,
    reconciledAt: isoOrNull(monthRow.reconciledAt),
    reconcileNote: monthRow.reconcileNote,
    days,
    salary,
    warnings,
  };
}

export async function getTimesheetMonth(monthId: number): Promise<TimesheetMonthView> {
  return buildMonthView(await loadMonthRow(monthId));
}

/** Every timesheet month in a period, with its grid. Drivers without a month
 *  are omitted — the dispatcher creates the period from the driver list. */
export async function listTimesheetMonths(year: number, month: number): Promise<TimesheetMonthView[]> {
  assertPeriod(year, month);
  const rows = await db.select().from(s.driverTimesheetMonths)
    .where(and(eq(s.driverTimesheetMonths.year, year), eq(s.driverTimesheetMonths.month, month)))
    .orderBy(asc(s.driverTimesheetMonths.driverId));
  return Promise.all(rows.map(row => buildMonthView(row)));
}

export async function createTimesheetMonth(actor: TimesheetActor, input: {
  driverId: number; year: number; month: number; salaryMode?: TimesheetSalaryMode;
  dailyBase?: number | null; flatAmount?: number | null;
}) {
  assertPeriod(input.year, input.month);
  const salaryMode = input.salaryMode ?? 'PER_TRIP';
  if (!TIMESHEET_SALARY_MODES.includes(salaryMode)) {
    throw new ApiError(400, 'Chế độ lương không hợp lệ.');
  }
  const [driver] = await db.select({ id: s.drivers.id }).from(s.drivers)
    .where(and(eq(s.drivers.id, input.driverId), isNull(s.drivers.deletedAt))).limit(1);
  if (!driver) throw new ApiError(404, 'Không tìm thấy lái xe.');

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(s.driverTimesheetMonths)
      .where(and(
        eq(s.driverTimesheetMonths.driverId, input.driverId),
        eq(s.driverTimesheetMonths.year, input.year),
        eq(s.driverTimesheetMonths.month, input.month),
      )).limit(1);
    if (existing) throw new ApiError(409, 'Tháng chấm công của lái xe này đã tồn tại.');
    let row: typeof s.driverTimesheetMonths.$inferSelect | undefined;
    try {
      [row] = await tx.insert(s.driverTimesheetMonths).values({
        driverId: input.driverId,
        year: input.year,
        month: input.month,
        salaryMode,
        dailyBase: input.dailyBase === undefined || input.dailyBase === null ? null : String(Math.round(input.dailyBase)),
        flatAmount: input.flatAmount === undefined || input.flatAmount === null ? null : String(Math.round(input.flatAmount)),
        status: 'OPEN',
        createdBy: actor.userId,
        updatedBy: actor.userId,
      }).returning();
    } catch (error) {
      // The check above and the insert are not atomic; the unique index is the
      // real arbiter, so a concurrent winner arrives here as a raw 23505 and
      // must surface as the same 409 the check produces.
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'Tháng chấm công của lái xe này đã tồn tại.');
      }
      throw error;
    }
    await tx.insert(s.auditLogs).values({
      userId: actor.userId,
      actorName: actor.fullName,
      entityType: 'TIMESHEET_MONTH',
      entityId: row!.id,
      message: `Mở bảng chấm công tháng ${String(input.month).padStart(2, '0')}/${input.year}`,
      payload: { action: 'create', salaryMode, driverId: input.driverId, actorRole: actor.role },
    });
    return buildMonthView(row!, tx);
  });
}

/** Kế toán owns the mode and its money parameters. */
export async function updateTimesheetMode(actor: TimesheetActor, monthId: number, input: {
  salaryMode?: TimesheetSalaryMode; dailyBase?: number | null; flatAmount?: number | null;
}) {
  if (input.salaryMode !== undefined && !TIMESHEET_SALARY_MODES.includes(input.salaryMode)) {
    throw new ApiError(400, 'Chế độ lương không hợp lệ.');
  }
  return db.transaction(async (tx) => {
    const before = await loadMonthRow(monthId, tx);
    const changes: Partial<typeof s.driverTimesheetMonths.$inferInsert> = {
      ...(input.salaryMode !== undefined ? { salaryMode: input.salaryMode } : {}),
      ...(input.dailyBase !== undefined ? { dailyBase: input.dailyBase === null ? null : String(Math.round(input.dailyBase)) } : {}),
      ...(input.flatAmount !== undefined ? { flatAmount: input.flatAmount === null ? null : String(Math.round(input.flatAmount)) } : {}),
    };
    // Only a REAL money change invalidates the reconciliation. An empty body
    // (or a no-op resubmit) must not strip the seal and leave a stale
    // reconcileNote with no reconciler and no timestamp.
    const moneyChanged = Object.keys(changes).some(key =>
      String(before[key as keyof typeof before] ?? '') !== String(changes[key as keyof typeof changes] ?? ''));
    if (moneyChanged) {
      Object.assign(changes, { status: 'OPEN', reconciledBy: null, reconciledAt: null });
    }
    const [after] = await tx.update(s.driverTimesheetMonths).set({
      ...changes,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(s.driverTimesheetMonths.id, monthId)).returning();
    await tx.insert(s.auditLogs).values({
      userId: actor.userId,
      actorName: actor.fullName,
      entityType: 'TIMESHEET_MONTH',
      entityId: monthId,
      message: 'Đổi chế độ lương chấm công',
      payload: { action: 'mode', before, after, actorRole: actor.role },
    });
    return buildMonthView(after!, tx);
  });
}

/**
 * Điều vận writes the grid. The API accepts SYMBOLS only: the trips a symbol
 * implies are the server's to decide, so a driver-facing client cannot inflate
 * the count (or the payslip) by posting a number.
 */
export async function saveTimesheetDays(actor: TimesheetActor, monthId: number, items: Array<{
  workDate: string; symbol: TimesheetSymbol | null; note?: string | null;
}>) {
  if (items.length === 0) throw new ApiError(400, 'Chưa có ô nào được gửi.');
  return db.transaction(async (tx) => {
    const month = await loadMonthRow(monthId, tx);
    if (month.status === 'RECONCILED') {
      throw new ApiError(409, 'Tháng đã đối chiếu — mở lại trước khi sửa lưới.');
    }
    const written: string[] = [];
    // Corrections the re-entry discards, so the audit trail records WHO had
    // corrected those cells and by how much before Điều vận overwrote them.
    const discardedAdjustments: Array<{ workDate: string; tripAdjustment: number; adjustedBy: number | null }> = [];
    for (const item of items) {
      assertMonthOwnsDate(month.year, month.month, item.workDate);
      if (item.symbol !== null) assertSymbol(item.symbol);
      const isSunday = isSundayUtc(item.workDate);
      const [existing] = await tx.select().from(s.driverTimesheetDays)
        .where(and(
          eq(s.driverTimesheetDays.monthId, monthId),
          eq(s.driverTimesheetDays.workDate, item.workDate),
        )).limit(1);

      if (item.symbol === null) {
        if (existing) {
          if (existing.tripAdjustment !== 0 || existing.adjustedBy !== null) {
            discardedAdjustments.push({
              workDate: existing.workDate,
              tripAdjustment: existing.tripAdjustment,
              adjustedBy: existing.adjustedBy,
            });
          }
          await tx.delete(s.driverTimesheetDays).where(eq(s.driverTimesheetDays.id, existing.id));
        }
        written.push(item.workDate);
        continue;
      }
      if (existing) {
        // A new symbol supersedes the accountant's correction on that cell: the
        // cell is being re-entered, so the old correction no longer describes it.
        if (existing.tripAdjustment !== 0 || existing.adjustedBy !== null) {
          discardedAdjustments.push({
            workDate: existing.workDate,
            tripAdjustment: existing.tripAdjustment,
            adjustedBy: existing.adjustedBy,
          });
        }
        await tx.update(s.driverTimesheetDays).set({
          symbol: item.symbol,
          isSunday,
          tripAdjustment: 0,
          adjustedBy: null,
          adjustedAt: null,
          note: item.note ?? null,
          enteredBy: actor.userId,
          enteredAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(s.driverTimesheetDays.id, existing.id));
      } else {
        await tx.insert(s.driverTimesheetDays).values({
          monthId,
          driverId: month.driverId,
          workDate: item.workDate,
          symbol: item.symbol,
          isSunday,
          note: item.note ?? null,
          enteredBy: actor.userId,
          enteredAt: new Date(),
        });
      }
      written.push(item.workDate);
    }
    await tx.update(s.driverTimesheetMonths).set({ updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(s.driverTimesheetMonths.id, monthId));
    await tx.insert(s.auditLogs).values({
      userId: actor.userId,
      actorName: actor.fullName,
      entityType: 'TIMESHEET_MONTH',
      entityId: monthId,
      message: `Cập nhật lưới chấm công ${written.length} ô`,
      payload: {
        action: 'grid',
        dates: written,
        actorRole: actor.role,
        // Non-empty whenever a re-entry erased a signed correction: the
        // accountant's figure must stay recoverable after Điều vận overwrites.
        discardedAdjustments,
      },
    });
    return buildMonthView(await loadMonthRow(monthId, tx), tx);
  });
}

/** Kế toán's correction in TRIPS. Negative is allowed — a trip the paperwork
 *  does not support. The audit row records who changed what. */
export async function adjustTimesheetDay(actor: TimesheetActor, monthId: number, dayId: number, tripAdjustment: number) {
  if (!Number.isInteger(tripAdjustment)) throw new ApiError(400, 'Chỉnh lệch phải là số nguyên.');
  return db.transaction(async (tx) => {
    // The same seal the grid write obeys: a correction after Kế toán has
    // signed off would leave the month marked RECONCILED with a different
    // figure than the one that was reconciled.
    const month = await loadMonthRow(monthId, tx);
    if (month.status === 'RECONCILED') {
      throw new ApiError(409, 'Tháng đã đối chiếu — mở lại trước khi chỉnh lệch.');
    }
    const [before] = await tx.select().from(s.driverTimesheetDays)
      .where(and(eq(s.driverTimesheetDays.id, dayId), eq(s.driverTimesheetDays.monthId, monthId))).limit(1);
    if (!before) throw new ApiError(404, 'Không tìm thấy ô ngày trong tháng này.');
    await tx.update(s.driverTimesheetDays).set({
      tripAdjustment,
      adjustedBy: actor.userId,
      adjustedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(s.driverTimesheetDays.id, dayId));
    await tx.insert(s.auditLogs).values({
      userId: actor.userId,
      actorName: actor.fullName,
      entityType: 'TIMESHEET_DAY',
      entityId: dayId,
      message: `Chỉnh lệch chuyến ngày ${before.workDate}`,
      payload: { action: 'adjust', monthId, before: before.tripAdjustment, after: tripAdjustment, actorRole: actor.role },
    });
    // Re-read the parent INSIDE the tx: `month` was loaded before the update,
    // so its counters would still describe the pre-correction grid.
    return buildMonthView(await loadMonthRow(monthId, tx), tx);
  });
}

/** Kế toán closes the month. Reopening is the only way back to OPEN. */
export async function reconcileTimesheetMonth(actor: TimesheetActor, monthId: number, note?: string | null) {
  return db.transaction(async (tx) => {
    const before = await loadMonthRow(monthId, tx);
    const [after] = await tx.update(s.driverTimesheetMonths).set({
      status: 'RECONCILED',
      reconciledBy: actor.userId,
      reconciledAt: new Date(),
      reconcileNote: note ?? null,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(s.driverTimesheetMonths.id, monthId)).returning();
    await tx.insert(s.auditLogs).values({
      userId: actor.userId,
      actorName: actor.fullName,
      entityType: 'TIMESHEET_MONTH',
      entityId: monthId,
      message: 'Đối chiếu xong bảng chấm công',
      payload: { action: 'reconcile', before: before.status, note: note ?? null, actorRole: actor.role },
    });
    return buildMonthView(after!, tx);
  });
}

export async function reopenTimesheetMonth(actor: TimesheetActor, monthId: number) {
  return db.transaction(async (tx) => {
    const before = await loadMonthRow(monthId, tx);
    const [after] = await tx.update(s.driverTimesheetMonths).set({
      status: 'OPEN',
      reconciledBy: null,
      reconciledAt: null,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(s.driverTimesheetMonths.id, monthId)).returning();
    await tx.insert(s.auditLogs).values({
      userId: actor.userId,
      actorName: actor.fullName,
      entityType: 'TIMESHEET_MONTH',
      entityId: monthId,
      message: 'Mở lại bảng chấm công để đối chiếu',
      payload: { action: 'reopen', before: before.status, actorRole: actor.role },
    });
    return buildMonthView(after!, tx);
  });
}

/** Month rollup per driver for leadership: counts, trips, workdays, salary and
 *  the revenue/cost efficiency metrics from that driver's completed trips. */
export async function getTimesheetRollup(year: number, month: number): Promise<TimesheetRollupRow[]> {
  assertPeriod(year, month);
  const monthRows = await db.select().from(s.driverTimesheetMonths)
    .where(and(eq(s.driverTimesheetMonths.year, year), eq(s.driverTimesheetMonths.month, month)));
  if (monthRows.length === 0) return [];
  const ids = monthRows.map(row => row.id);

  const dayRows = await db.select().from(s.driverTimesheetDays)
    .where(inArray(s.driverTimesheetDays.monthId, ids));
  const daysByMonth = new Map<number, typeof dayRows>();
  for (const row of dayRows) {
    const bucket = daysByMonth.get(row.monthId) ?? [];
    bucket.push(row);
    daysByMonth.set(row.monthId, bucket);
  }

  const driverIds = [...new Set(monthRows.map(row => row.driverId))];
  const driverRows = await db.select({ id: s.drivers.id, name: s.drivers.name })
    .from(s.drivers).where(inArray(s.drivers.id, driverIds));
  const names = new Map(driverRows.map(row => [row.id, row.name]));

  // Efficiency inputs come from the driver's COMPLETED trips in the calendar
  // month. A canceled (or not-yet-run) trip carries no real revenue and would
  // otherwise inflate the ratio leadership reads.
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const periodEnd = daysOfMonth(year, month).at(-1)!;
  const tripRows = await db.select({
    driverId: s.trips.driverId,
    trips: sql<number>`count(*)::int`,
    revenue: sql<string>`coalesce(sum(${s.tripFinancialState.revenue}), 0)`,
    cost: sql<string>`coalesce(sum(${s.tripFinancialState.totalCost}), 0)`,
  }).from(s.trips)
    .innerJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .where(and(
      inArray(s.trips.driverId, driverIds),
      eq(s.trips.status, 'COMPLETED'),
      sql`${s.trips.departureDate} >= ${periodStart}`,
      sql`${s.trips.departureDate} <= ${periodEnd}`,
    ))
    .groupBy(s.trips.driverId);
  const tripsByDriver = new Map(tripRows.map(row => [row.driverId ?? 0, row]));

  return monthRows.map(monthRow => {
    const days = daysByMonth.get(monthRow.id) ?? [];
    const salary = computeTimesheetSalary({
      mode: monthRow.salaryMode as TimesheetSalaryMode,
      dailyBase: numeric(monthRow.dailyBase),
      flatAmount: numeric(monthRow.flatAmount),
      days: days.map(row => ({
        symbol: row.symbol as TimesheetSymbol,
        workDate: row.workDate,
        tripAdjustment: row.tripAdjustment,
      })),
    });
    const cells = salary.symbolDays;
    const sundayTrips = days
      .filter(row => row.isSunday)
      .reduce((sum, row) => sum + countDayTrips({
        symbol: row.symbol as TimesheetSymbol,
        workDate: row.workDate,
        tripAdjustment: row.tripAdjustment,
      }), 0);

    const tripStats = tripsByDriver.get(monthRow.driverId);
    const revenue = tripStats ? Number(tripStats.revenue) : null;
    const cost = tripStats ? Number(tripStats.cost) : null;

    return {
      driverId: monthRow.driverId,
      driverName: names.get(monthRow.driverId) ?? `Lái xe #${monthRow.driverId}`,
      donCount: cells['Đ'],
      kepCount: cells.K,
      quayDauCount: cells.Q,
      luuCaCount: cells.L,
      nghiCount: cells.N,
      nghiPhepCount: cells.P,
      trips: salary.trips,
      workdays: salary.workdays,
      bonusTrips: salary.bonusTrips,
      salaryMode: monthRow.salaryMode as TimesheetSalaryMode,
      salary: salary.salaryTotal,
      perTripPay: salary.perTripPay,
      extraTripBonus: salary.extraTripBonus,
      dailyBasePay: salary.dailyBasePay,
      status: monthRow.status as 'OPEN' | 'RECONCILED',
      sundayTrips,
      revenue,
      cost,
      salaryRatio: revenue && revenue > 0 ? Math.round((salary.salaryTotal / revenue) * 10000) / 10000 : null,
      tripsCompleted: tripStats?.trips ?? 0,
    };
  }).sort((a, b) => a.driverName.localeCompare(b.driverName, 'vi'));
}