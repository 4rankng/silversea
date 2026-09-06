// ─── Ops field-operations module (docs/prd/OpsVanHanh.md) ───────────────────
// Personal shipment pins, per-truck ops oversight, cash expenses with receipt
// photos, and settlement batches. Money is numeric(15,0) VND, no decimals.
// Cross-table FKs are application-level per project convention (no
// .references()); only uniqueness within a table is enforced in the DB.
import { boolean, date, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { opsExpenseStatusEnum, opsSettlementStatusEnum } from './_enums';

// Personal bookmark: an Ops pins a shipment (lô) to the top of their own
// /ops/orders list. One row per (user, shipment); unpin deletes the row.
export const userShipmentPins = pgTable('user_shipment_pins', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  shipmentId: integer('shipment_id').notNull(),
  pinnedAt: timestamp('pinned_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_shipment_pins_pair_uniq').on(table.userId, table.shipmentId),
  index('user_shipment_pins_shipment_idx').on(table.shipmentId),
]);

// Admin assigns each truck at most one ACTIVE ops owner; one ops user may own
// many trucks. Reassignment deactivates the previous row for that truck.
export const truckOpsAssignments = pgTable('truck_ops_assignments', {
  id: serial('id').primaryKey(),
  truckId: integer('truck_id').notNull(),
  opsUserId: integer('ops_user_id').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('truck_ops_assignments_active_truck_uniq')
    .on(table.truckId)
    .where(sql`${table.isActive} is true`),
  index('truck_ops_assignments_ops_idx').on(table.opsUserId, table.isActive),
]);

// One cash expense declared by an Ops against a shipment (lô), optionally
// scoped to one container of that lô (null = phí chung lô). APPROVED rows are
// locked forever; PENDING/REJECTED stay editable by their author only.
export const opsExpenseEntries = pgTable('ops_expense_entries', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  shipmentContainerId: integer('shipment_container_id'),
  // App-level FK → forwarder_expense_types.code.
  expenseTypeCode: varchar('expense_type_code', { length: 50 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  paidById: integer('paid_by_id').notNull(),
  paidAt: date('paid_at').notNull(),
  note: text('note'),
  approvalStatus: opsExpenseStatusEnum('approval_status').default('PENDING').notNull(),
  approvedById: integer('approved_by_id'),
  approvedAt: timestamp('approved_at'),
  rejectionReason: text('rejection_reason'),
  // Set when the entry is frozen into a settlement batch (đề nghị thanh
  // toán); immutable afterwards — entries added later fall into the next one.
  opsSettlementId: integer('ops_settlement_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('ops_expense_entries_payer_status_idx').on(table.paidById, table.approvalStatus),
  index('ops_expense_entries_shipment_idx').on(table.shipmentId),
  index('ops_expense_entries_settlement_idx').on(table.opsSettlementId),
]);

// Receipt photos for an ops expense. storage_key comes from the shared upload
// pipeline and is served through /api/photos.
export const opsExpensePhotos = pgTable('ops_expense_photos', {
  id: serial('id').primaryKey(),
  opsExpenseId: integer('ops_expense_id').notNull(),
  storageKey: text('storage_key').notNull(),
  uploadedById: integer('uploaded_by_id').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('ops_expense_photos_pair_uniq').on(table.opsExpenseId, table.storageKey),
]);

// Settlement batch: freezes the creating Ops' open PENDING+APPROVED entries at
// creation time. total_amount = sum of the frozen entries; accounting approves
// the batch once every frozen entry is approved.
export const opsSettlements = pgTable('ops_settlements', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 20 }).notNull(),
  opsUserId: integer('ops_user_id').notNull(),
  status: opsSettlementStatusEnum('status').default('PENDING').notNull(),
  totalAmount: numeric('total_amount', { precision: 15, scale: 0 }).notNull(),
  note: text('note'),
  approvedById: integer('approved_by_id'),
  approvedAt: timestamp('approved_at'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('ops_settlements_code_uniq').on(table.code),
  index('ops_settlements_user_idx').on(table.opsUserId, table.status),
]);
