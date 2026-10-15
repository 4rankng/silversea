import { boolean, check, date, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Driver timesheet (chấm công lái xe) — the grid Điều vận fills with symbols
 * (K kẹp 2 cont, Q quay đầu, Đ chạy đơn, L lưu ca, N nghỉ, P nghỉ phép) and
 * Kế toán reconciles last. Deliberately SEPARATE from `driver_work_days`
 * (attendance/salary already shipped): this surface counts 0–2 trips per day
 * and excludes Sundays from attended days, and neither table writes the other.
 *
 * Symbol → trips/workday lives in shared `computeTimesheetSalary`; the day rows
 * store the symbol and the accountant's signed trip correction, and the money is
 * always derived — never stored.
 */

/** One driver's timesheet period (one calendar month). */
export const driverTimesheetMonths = pgTable('driver_timesheet_months', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').notNull(),
  year: integer('year').notNull(),
  /** 1–12, asserted by the shared contract and the service. */
  month: integer('month').notNull(),
  /** PER_TRIP (300.000đ/trip + daily base, +100.000đ from trip 21) or
   *  FLAT_MONTHLY (one figure per month). */
  salaryMode: varchar('salary_mode', { length: 20 }).notNull().default('PER_TRIP'),
  /** Daily base pay — PER_TRIP only. NULL until Kế toán configures it. */
  dailyBase: numeric('daily_base', { precision: 15, scale: 0 }),
  /** Monthly flat figure — FLAT_MONTHLY only. */
  flatAmount: numeric('flat_amount', { precision: 15, scale: 0 }),
  status: varchar('status', { length: 20 }).notNull().default('OPEN'),
  reconciledBy: integer('reconciled_by'),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  reconcileNote: text('reconcile_note'),
  createdBy: integer('created_by'),
  updatedBy: integer('updated_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('driver_timesheet_months_driver_period_unq').on(table.driverId, table.year, table.month),
  index('driver_timesheet_months_period_idx').on(table.year, table.month),
  index('driver_timesheet_months_status_idx').on(table.status),
  // Declared here as well as in the migration: the Drizzle schema is the
  // source of truth, and a schema missing a constraint the database already
  // has would make the next `generate` emit a DROP CONSTRAINT for it.
  check('driver_timesheet_months_salary_mode_check', sql`${table.salaryMode} in ('PER_TRIP', 'FLAT_MONTHLY')`),
  check('driver_timesheet_months_status_check', sql`${table.status} in ('OPEN', 'RECONCILED')`),
  check('driver_timesheet_months_period_check', sql`${table.month} between 1 and 12`),
]);

/** One grid cell: driver × calendar day inside a period. */
export const driverTimesheetDays = pgTable('driver_timesheet_days', {
  id: serial('id').primaryKey(),
  // Cascade: a day row has no meaning without its period, and dropping the
  // period must not strand orphaned grid rows behind a stale unique key.
  monthId: integer('month_id').notNull().references(() => driverTimesheetMonths.id, { onDelete: 'cascade' }),
  // Denormalized so a driver/month rollup never needs the parent join.
  driverId: integer('driver_id').notNull(),
  workDate: date('work_date').notNull(),
  /** K | Q | Đ | L | N | P — the server owns the trips this symbol implies. */
  symbol: varchar('symbol', { length: 1 }).notNull(),
  /** Snapshot of the weekday: a Sunday is recorded but is never an attended
   *  day, and history must not shift when the calendar is edited. */
  isSunday: boolean('is_sunday').notNull().default(false),
  /** Kế toán's signed correction in TRIPS. Negative is allowed (a trip without
   *  paperwork). The API never accepts a client-supplied trip count. */
  tripAdjustment: integer('trip_adjustment').notNull().default(0),
  adjustedBy: integer('adjusted_by'),
  adjustedAt: timestamp('adjusted_at', { withTimezone: true }),
  note: text('note'),
  /** Điều vận's last writer — the audit trail the doc requires. */
  enteredBy: integer('entered_by'),
  enteredAt: timestamp('entered_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('driver_timesheet_days_month_date_unq').on(table.monthId, table.workDate),
  index('driver_timesheet_days_driver_date_idx').on(table.driverId, table.workDate),
  check('driver_timesheet_days_symbol_check', sql`${table.symbol} in ('K', 'Q', 'Đ', 'L', 'N', 'P')`),
]);