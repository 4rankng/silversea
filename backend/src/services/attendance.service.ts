import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, gte, lte, sql, isNull, ne } from 'drizzle-orm';
import { resolveSalaryPeriodDateRange } from './salary-period.service';
import { ApiError } from '../errors';

function parseIsoDate(date: string): Date {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ApiError(400, `Ngày không hợp lệ: ${date}`);
  }
  return parsed;
}

/** How many Sundays are in a given month/year */
function countSundays(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) count++;
  }
  return count;
}

/** Standard work days in a month = total days - sundays */
export function computeStandardWorkDays(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  return daysInMonth - countSundays(year, month);
}

/**
 * Get work days for a driver in a given date range.
 */
export async function getWorkDays(driverId: number, startDate: string, endDate: string) {
  return db.select().from(s.driverWorkDays)
    .where(and(
      eq(s.driverWorkDays.driverId, driverId),
      gte(s.driverWorkDays.date, startDate),
      lte(s.driverWorkDays.date, endDate),
    ))
    .orderBy(s.driverWorkDays.date);
}

/**
 * Upsert a single work day status for a driver.
 * Uses onConflictDoUpdate for atomicity — avoids the race condition
 * of the previous select-then-insert-or-update pattern.
 */
export async function upsertWorkDay(
  driverId: number,
  date: string,
  status: 'TRIP_DAY' | 'STANDBY' | 'PERSONAL_LEAVE' | 'WEEKLY_OFF',
  note: string | null,
  createdBy: number,
) {
  // Preserve existing tripId atomically in the SET clause (avoids TOCTOU race).
  // Drizzle's onConflictDoUpdate SET references the existing row's column value,
  // so just referencing the column preserves whatever is already stored.
  // For TRIP_DAY: keep existing tripId. For other statuses: clear it.
  const [result] = await db.insert(s.driverWorkDays)
    .values({ driverId, date, status, note, createdBy, tripId: null })
    .onConflictDoUpdate({
      target: [s.driverWorkDays.driverId, s.driverWorkDays.date],
      set: {
        status,
        note,
        tripId: status === 'TRIP_DAY'
          ? sql`${s.driverWorkDays.tripId}`
          : null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

/**
 * Delete a work day (set to nothing - clear a STANDBY/PERSONAL_LEAVE)
 */
export async function deleteWorkDay(driverId: number, date: string) {
  const deleted = await db.delete(s.driverWorkDays)
    .where(and(eq(s.driverWorkDays.driverId, driverId), eq(s.driverWorkDays.date, date)))
    .returning();
  return deleted.length > 0 ? { deleted: true } : null;
}

/**
 * Batch upsert work days. Used by the calendar UI to save multiple day changes at once.
 * Each item: { date, status: 'TRIP_DAY' | 'STANDBY' | 'PERSONAL_LEAVE' | 'WEEKLY_OFF' | null } - null means clear.
 */
export async function batchUpsertWorkDays(
  driverId: number,
  items: Array<{ date: string; status: 'TRIP_DAY' | 'STANDBY' | 'PERSONAL_LEAVE' | 'WEEKLY_OFF' | null; note?: string | null }>,
  createdBy: number,
) {
  return db.transaction(async (tx) => {
    const results = [];
    for (const item of items) {
      if (item.status === null) {
        // Delete/clear the work day
        const existing = await tx.select().from(s.driverWorkDays)
          .where(and(eq(s.driverWorkDays.driverId, driverId), eq(s.driverWorkDays.date, item.date)))
          .limit(1);
        if (existing[0]) {
          // Reject deletion of trip-linked TRIP_DAY records
          if (existing[0].tripId) {
            results.push({ date: item.date, action: 'rejected', reason: 'TRIP_DAY locked (trip-linked)' });
            continue;
          }
          await tx.delete(s.driverWorkDays).where(eq(s.driverWorkDays.id, existing[0].id));
        }
        results.push({ date: item.date, action: 'deleted' });
      } else {
        // Upsert the work day
        const [existing] = await tx.select({ tripId: s.driverWorkDays.tripId, id: s.driverWorkDays.id })
          .from(s.driverWorkDays)
          .where(and(eq(s.driverWorkDays.driverId, driverId), eq(s.driverWorkDays.date, item.date)))
          .limit(1);
        if (item.status === 'PERSONAL_LEAVE' && !(item.note ?? '').trim()) {
          results.push({ date: item.date, action: 'rejected', reason: 'PERSONAL_LEAVE requires note' });
          continue;
        }
        if (item.status === 'TRIP_DAY') {
          results.push({
            date: item.date,
            action: 'rejected',
            reason: existing?.tripId
              ? 'TRIP_DAY derived from trip completion cannot be edited manually'
              : 'Manual TRIP_DAY is not allowed',
          });
          continue;
        }
        // Reject status changes on trip-linked records (TRIP_DAY from sync)
        if (existing?.tripId) {
          results.push({ date: item.date, action: 'rejected', reason: 'TRIP_DAY locked (trip-linked)' });
          continue;
        }
        const [result] = await tx.insert(s.driverWorkDays)
          .values({ driverId, date: item.date, status: item.status, note: item.note ?? null, createdBy, tripId: null })
          .onConflictDoUpdate({
            target: [s.driverWorkDays.driverId, s.driverWorkDays.date],
            set: { status: item.status, note: item.note ?? null, tripId: null, updatedAt: new Date() },
          })
          .returning();
        results.push({ date: item.date, action: 'upserted', result });
      }
    }
    return results;
  });
}

/**
 * Sync TRIP_DAY records when a trip transitions to IN_TRANSIT or COMPLETED.
 * Called from trip service after status change.
 */
export async function syncTripWorkDays(
  driverId: number,
  tripId: number,
  departureDate: string,
  arrivalDate: string | null,
  createdBy?: number | null,
) {
  const endDate = arrivalDate || departureDate;

  const start = parseIsoDate(departureDate);
  const end = parseIsoDate(endDate);

  // Collect all dates in range
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Upsert each date as TRIP_DAY (overrides WEEKLY_OFF if trip is running)
  // Single INSERT with onConflictDoUpdate handles both new and existing rows
  for (const date of dates) {
    await db.insert(s.driverWorkDays)
      .values({ driverId, date, status: 'TRIP_DAY', tripId, note: null, createdBy: createdBy ?? null })
      .onConflictDoUpdate({
        target: [s.driverWorkDays.driverId, s.driverWorkDays.date],
        set: { status: 'TRIP_DAY', tripId, updatedAt: new Date() },
      });
  }
}

/**
 * Remove TRIP_DAY records for a canceled trip.
 */
export async function removeTripWorkDays(driverId: number, tripId: number) {
  await db.delete(s.driverWorkDays)
    .where(and(
      eq(s.driverWorkDays.driverId, driverId),
      eq(s.driverWorkDays.tripId, tripId),
      eq(s.driverWorkDays.status, 'TRIP_DAY'),
    ));
}

/**
 * Compute attendance summary for a driver in a month/year.
 */
export async function computeAttendanceSummary(
  driverId: number,
  year: number,
  month: number,
) {
  // Resolve the salary period date range
  const period = await resolveSalaryPeriodDateRange(month, year);
  const { start, end } = period;

  const workDays = await getWorkDays(driverId, start, end);
  const workDayMap = new Map(workDays.map(w => [w.date, w.status]));

  const startParts = start.split('-').map(Number);
  const endParts = end.split('-').map(Number);
  const cur = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
  const stop = new Date(Date.UTC(endParts[0], endParts[1] - 1, endParts[2]));

  const dates: string[] = [];
  while (cur <= stop) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  let tripDays = 0;
  let standbyDays = 0;
  let personalLeaveDays = 0;
  let weeklyOffDays = 0;

  for (const dateStr of dates) {
    const status = workDayMap.get(dateStr);
    if (status) {
      if (status === 'TRIP_DAY') tripDays++;
      else if (status === 'STANDBY') standbyDays++;
      else if (status === 'PERSONAL_LEAVE') personalLeaveDays++;
      else if (status === 'WEEKLY_OFF') weeklyOffDays++;
    } else {
      // Default: Sunday is WEEKLY_OFF, non-Sunday is STANDBY
      const [y, m, d] = dateStr.split('-').map(Number);
      const isSunday = new Date(y, m - 1, d).getDay() === 0;
      if (isSunday) {
        weeklyOffDays++;
      } else {
        standbyDays++;
      }
    }
  }

  // Standard work days: calendar days - sundays in the calendar month
  const standardWorkDays = computeStandardWorkDays(year, month);

  return {
    driverId,
    year,
    month,
    periodStart: start,
    periodEnd: end,
    standardWorkDays,
    tripDays,
    standbyDays,
    personalLeaveDays,
    weeklyOffDays,
    paidDays: tripDays + standbyDays,
    workDays, // raw day records
  };
}

type ConfirmationMap = Map<number, { status: string | null; confirmedBy: number | null; confirmedAt: Date | null }>;

/**
 * Compute the full salary breakdown for a driver in a month.
 * @param confirmationMap Optional pre-fetched confirmation map (avoids N+1 in batch calls).
 */
export async function computeSalary(
  driverId: number,
  year: number,
  month: number,
  confirmationMap?: ConfirmationMap,
) {
  const attendance = await computeAttendanceSummary(driverId, year, month);
  const { periodStart: start, periodEnd: end, standardWorkDays, tripDays, standbyDays, paidDays } = attendance;

  // Get driver base salary
  const [driver] = await db.select({
    baseSalary: s.drivers.baseSalary,
    socialInsurance: s.drivers.socialInsurance,
  }).from(s.drivers)
    .where(eq(s.drivers.id, driverId)).limit(1);

  if (!driver) {
    throw new ApiError(404, 'Không tìm thấy lái xe');
  }
  const baseSalary = parseFloat(driver.baseSalary || '0');
  // Social insurance from drivers.social_insurance column (was hardcoded to 0)
  const socialInsurance = parseFloat(driver.socialInsurance || '0');

  // Per customer (Pete): dailyRate = baseSalary / standardWorkDays
  // This is a cost-allocation rate to distribute monthly salary across trips, NOT actual pay.
  const dailyRate = Math.round(baseSalary / standardWorkDays);

  // Cost allocation: trip salary = trip days × daily rate
  const totalTripSalary = tripDays * dailyRate;

  // Standby cost: standby days × daily rate (idle days → allocated cost)
  const supplementPay = standbyDays * dailyRate;

  // Leave deduction: Removed because adjustment handles it natively.
  const leaveDeduction = 0;

  // Adjustment: (paidDays - standardWorkDays) * dailyRate
  const adjustment = (paidDays - standardWorkDays) * dailyRate;

  // Penalties in period
  const [penaltyRow] = await db.select({
    total: sql<string>`coalesce(sum(${s.penalties.amount}::numeric), 0)`,
  }).from(s.penalties)
    .where(and(
      eq(s.penalties.driverId, driverId),
      isNull(s.penalties.deletedAt),
      ne(s.penalties.status, 'CANCELED'),
      gte(s.penalties.date, start),
      lte(s.penalties.date, end),
    ));

  const totalPenalties = parseFloat(penaltyRow?.total || '0');

  // Net salary is just base salary + adjustment - penalties
  const netSalary = baseSalary + adjustment - totalPenalties;

  // Get salary confirmation status — use pre-fetched map if available
  let confirmationRow: { status: string | null; confirmedBy: number | null; confirmedAt: Date | null } | undefined;
  if (confirmationMap) {
    confirmationRow = confirmationMap.get(driverId);
  } else {
    [confirmationRow] = await db.select({
      status: s.salaryConfirmations.status,
      confirmedBy: s.salaryConfirmations.confirmedBy,
      confirmedAt: s.salaryConfirmations.confirmedAt,
    }).from(s.salaryConfirmations)
      .where(and(
        eq(s.salaryConfirmations.driverId, driverId),
        eq(s.salaryConfirmations.year, year),
        eq(s.salaryConfirmations.month, month),
      )).limit(1);
  }

  return {
    ...attendance,
    baseSalary,
    socialInsurance,
    dailyRate,
    totalTripSalary,
    adjustment,
    supplementPay,
    leaveDeduction,
    totalPenalties,
    netSalary,
    confirmationStatus: confirmationRow?.status ?? 'DRAFT',
    confirmedBy: confirmationRow?.confirmedBy ?? null,
    confirmedAt: confirmationRow?.confirmedAt ?? null,
  };
}

/**
 * Compute salary summaries for ALL active drivers in a given month/year.
 */
export async function computeAllDriverSalaries(year: number, month: number) {
  const drivers = await db.select({
    id: s.drivers.id,
    name: s.drivers.name,
    baseSalary: s.drivers.baseSalary,
    status: s.drivers.status,
  }).from(s.drivers)
    .where(isNull(s.drivers.deletedAt))
    .orderBy(s.drivers.name);

  // Batch-fetch all confirmations for this month (eliminates N+1)
  const confirmations = await db.select({
    driverId: s.salaryConfirmations.driverId,
    status: s.salaryConfirmations.status,
    confirmedBy: s.salaryConfirmations.confirmedBy,
    confirmedAt: s.salaryConfirmations.confirmedAt,
  }).from(s.salaryConfirmations)
    .where(and(
      eq(s.salaryConfirmations.year, year),
      eq(s.salaryConfirmations.month, month),
    ));

  const confirmationMap = new Map(
    confirmations.map(c => [c.driverId, c]),
  );

  const summaries = await Promise.all(
    drivers.map(async (driver) => {
      try {
        const salary = await computeSalary(driver.id, year, month, confirmationMap);
        return { ...driver, salary };
      } catch (err) {
        console.error(`[salary] computeSalary failed for driver ${driver.id}:`, err);
        return { ...driver, salary: null };
      }
    })
  );

  return { year, month, items: summaries };
}

/**
 * Confirm a salary period for a driver (DRAFT → CONFIRMED).
 * Upserts a salary_confirmations row.
 */
export async function confirmSalary(
  driverId: number,
  year: number,
  month: number,
  userId: number,
) {
  // Validate driver exists
  const [driver] = await db.select({ id: s.drivers.id })
    .from(s.drivers)
    .where(and(eq(s.drivers.id, driverId), isNull(s.drivers.deletedAt)))
    .limit(1);
  if (!driver) throw new ApiError(404, 'Không tìm thấy lái xe');

  const now = new Date();
  const [confirmation] = await db.insert(s.salaryConfirmations)
    .values({
      driverId,
      year,
      month,
      status: 'CONFIRMED',
      confirmedBy: userId,
      confirmedAt: now,
    })
    .onConflictDoUpdate({
      target: [s.salaryConfirmations.driverId, s.salaryConfirmations.year, s.salaryConfirmations.month],
      set: {
        status: 'CONFIRMED',
        confirmedBy: userId,
        confirmedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  const salary = await computeSalary(driverId, year, month);
  return { confirmation, salary };
}

/**
 * Reopen a confirmed salary period for editing (CONFIRMED → DRAFT).
 * Removes the salary_confirmations row so work days become editable again.
 * No-op if the period was never confirmed (computeSalary returns DRAFT).
 */
export async function unconfirmSalary(
  driverId: number,
  year: number,
  month: number,
) {
  // Validate driver exists
  const [driver] = await db.select({ id: s.drivers.id })
    .from(s.drivers)
    .where(and(eq(s.drivers.id, driverId), isNull(s.drivers.deletedAt)))
    .limit(1);
  if (!driver) throw new ApiError(404, 'Không tìm thấy lái xe');

  await db.delete(s.salaryConfirmations)
    .where(and(
      eq(s.salaryConfirmations.driverId, driverId),
      eq(s.salaryConfirmations.year, year),
      eq(s.salaryConfirmations.month, month),
    ));

  const salary = await computeSalary(driverId, year, month);
  return { ok: true as const, salary };
}
