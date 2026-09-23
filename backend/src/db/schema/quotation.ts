// Quotation (Mẫu báo giá 1) — card 20260922_66.
// Live-view frame over the running pricing parameters (operator ruling
// 2026-09-22 Q1): the quotation never copies prices/norms/fuel terms — it
// stores template identity, effective date, and per-cell Hệ số only. Per-trip
// money stays frozen in freight_rate_snapshots at Ngày vận chuyển.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp,
  uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { fuelPricePeriods } from './pricing';

export const quotations = pgTable('quotations', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  templateName: varchar('template_name', { length: 120 }).notNull(),
  effectiveDate: date('effective_date').notNull(),
  // Card 20260922_60: the per-customer fuel-surcharge rounding rule from the
  // quotation's fuel-parameter header ("Phụ phí làm tròn = Round(....;-...)").
  // 'NONE' = unconfigured (deterministic: no rounding).
  surchargeRoundingMode: varchar('surcharge_rounding_mode', { length: 20 })
    .notNull()
    .default('NONE'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});
// Deliberately NO unique constraint on (customer, template, date): card _57
// re-uploads create NEW versions (ruling 6) — multiple active rows per
// customer must stay possible until _62's version release workflow lands.

// The grid's per-cell mutable datum: the Hệ số (ruling _59 — multiplies the
// fuel surcharge ONLY, default 1, snapshotted at version release later).
// Giá cos, liters, and fuel parameters are NEVER stored here; they resolve
// live from pricing_tables / freight_rate_terms / fuel_consumption_norms.
// Cells key on vehicle class CODES including _58's weight-split catalog
// (CONT20.LIGHT/.HEAVY, CONT40.LIGHT/.HEAVY); heavy cells carry no price of
// their own in Mẫu 1 today (missing data, ruling 2) — the light twin's
// engine result supplies fuel params for the surcharge-only line.
export const quotationCells = pgTable('quotation_cells', {
  id: serial('id').primaryKey(),
  quotationId: integer('quotation_id').notNull(),
  routeId: integer('route_id').notNull(),
  vehicleSizeClassId: integer('vehicle_size_class_id').notNull(),
  heSo: numeric('he_so', { precision: 8, scale: 4 }).notNull().default('1'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('quotation_cells_uniq')
    .on(table.quotationId, table.routeId, table.vehicleSizeClassId),
]);

// Card _62: version-release snapshots — LIVE VIEW NO MORE. Every change
// (manual edit / AGREED fuel update / new import) releases a version here:
// the payload freezes the whole rendered quotation (frame + grid figures +
// fee catalog + fuel params) so an old version renders its own numbers.
// trigger_kind names the event that released it.
export const quotationVersionSnapshots = pgTable('quotation_version_snapshots', {
  id: serial('id').primaryKey(),
  quotationId: integer('quotation_id').notNull(),
  version: integer('version').notNull(),
  payload: jsonb('payload').notNull(),
  triggerKind: varchar('trigger_kind', { length: 30 }),
  releasedBy: integer('released_by'),
  releasedAt: timestamp('released_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('quotation_version_snapshots_quotation_version_uniq')
    .on(table.quotationId, table.version),
]);


// Card 20260922_61: the "ĐỒNG Ý CẬP NHẬT BÁO GIÁ" workflow. When kế toán
// enters a fuel price period, every customer with an active quotation gets a
// PENDING row; the pricing engine caps that customer's fuel period at the
// newest AGREED row's period (watermark), so a new price applies only after
// Đồng ý (ruling 8). UNIQUE (period, customer) keeps generation idempotent.
export const quotationFuelApprovals = pgTable('quotation_fuel_approvals', {
  id: serial('id').primaryKey(),
  fuelPricePeriodId: integer('fuel_price_period_id')
    .notNull()
    .references(() => fuelPricePeriods.id),
  customerId: integer('customer_id').notNull(),
  quotationId: integer('quotation_id').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  decidedBy: integer('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('quotation_fuel_approvals_period_customer_uniq')
    .on(table.fuelPricePeriodId, table.customerId),
]);

// Card 20260922_64: the per-customer "Chi phí khác" catalog riding the
// quotation frame. Amounts are TẠM defaults (ruling 9a — editable data,
// never hardcoded); null defaultAmount = pending-empty (Kiểm hóa) or manual
// per lot (ruling 9b/9c). Routing carries the customer's column semantics:
// DEDICATED_CUSTOMS / DEDICATED_LACH_HUYEN go to their own columns; OTHER_
// COSTS rides the chi-phí-khác column with the fee name noted into bảng kê.
export const quotationFees = pgTable('quotation_fees', {
  id: serial('id').primaryKey(),
  quotationId: integer('quotation_id').notNull(),
  feeName: varchar('fee_name', { length: 120 }).notNull(),
  subType: varchar('sub_type', { length: 80 }),
  defaultAmount: numeric('default_amount', { precision: 15, scale: 0 }),
  routing: varchar('routing', { length: 30 }).notNull().default('OTHER_COSTS'),
  note: text('note'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('quotation_fees_quotation_idx').on(table.quotationId),
]);
