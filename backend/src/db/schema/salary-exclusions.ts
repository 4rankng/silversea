// Durable home for approved salary-period driver exclusions. Previously these
// lived as APPROVED rows in governance_actions (subjectKey `${period}:${driverId}`);
// with the maker-checker table dropped (migration 0068), exclusions get their
// own table so readiness gates and follow-up completion keep working.
import { pgTable, serial, varchar, integer, text, timestamp, index } from 'drizzle-orm/pg-core';

export const salaryPeriodExclusions = pgTable('salary_period_exclusions', {
  id: serial('id').primaryKey(),
  period: varchar('period', { length: 7 }).notNull(),
  driverId: integer('driver_id').notNull(),
  reason: text('reason').notNull(),
  handlingMode: varchar('handling_mode', { length: 30 }).notNull(),
  targetPeriod: varchar('target_period', { length: 7 }),
  note: text('note'),
  requestedBy: integer('requested_by').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  followupStatus: varchar('followup_status', { length: 20 }).notNull().default('PENDING'),
  followupCompletedAt: timestamp('followup_completed_at', { withTimezone: true }),
  followupCompletedBy: integer('followup_completed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('salary_period_exclusions_period_idx').on(table.period),
  index('salary_period_exclusions_driver_idx').on(table.driverId),
]);
