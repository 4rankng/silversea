import { expenseMetadataColumns } from './expense-metadata';
import type { ExpenseCostGroup } from '@tingting/shared';
// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  boolean, date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { driverIncidentalCostTypeEnum, driverProgressEventTypeEnum, fuelEvidenceOcrOutcomeEnum, fuelEvidenceReviewStatusEnum, penaltyStatusEnum, vehicleComponentEnum, workDayStatusEnum } from './_enums';
export const penalties = pgTable('penalties', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').notNull(),
  tripId: integer('trip_id'),
  reasonId: integer('reason_id'),
  customReason: text('custom_reason'),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  date: date('date').notNull(),
  status: penaltyStatusEnum('status').default('ACTIVE').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('penalties_date_idx').on(table.date),
  index('penalties_driver_id_idx').on(table.driverId),
]);

// ─── Vendor & Expense ────────────────────────────────────────────────────────────
// suppliers is declared above customers (before routes) to avoid circular forward-ref.
export const expenseCategories = pgTable('expense_categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  isRenewable: boolean('is_renewable').default(false),
  reminderLeadDays: integer('reminder_lead_days').default(30),
  // Wave 2 M3.7: per-type invoice-required rule. When true, expenses in this
  // category MUST have a supplier invoice (invoiceNumber + invoiceDate) before
  // direct recording. When false, substitute evidence is accepted. Defaults false
  // (back-compat — existing categories accept any evidence).
  requiresInvoice: boolean('requires_invoice').default(false),
  // Wave 3 M4.7: when requiresInvoice is false, this flag indicates whether
  // substitute evidence is explicitly allowed. Defaults true (back-compat —
  // non-invoice categories accept substitute evidence).
  substituteEvidenceAllowed: boolean('substitute_evidence_allowed').default(true),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  expenseDate: date('expense_date').notNull(),
  supplierId: integer('supplier_id').notNull(),
  categoryId: integer('category_id').notNull(),
  // `truck_id` is polymorphic — holds either `trucks.id` (when vehicle_component='TRUCK'),
  // `trailers.id` (when vehicle_component='TRAILER'), or null (company-wide expense).
  // Polymorphic relationship integrity is maintained by create/update services.
  truckId: integer('truck_id'),
  vehicleComponent: vehicleComponentEnum('vehicle_component').default('TRUCK'),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  paymentStatus: varchar('payment_status', { length: 20 }).notNull(),
  validFrom: timestamp('valid_from'),
  validTo: timestamp('valid_to'),
  receiptId: varchar('receipt_id', { length: 100 }),
  note: text('note'),
  // Valid authorized saves become RECORDED and post supplier debt directly.
  // Incomplete legacy rows remain DRAFT; VOIDED rows cannot post. Review
  // metadata below preserves historical facts and is not an active workflow.
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('RECORDED'),
  checkedBy: integer('checked_by'),
  checkedAt: timestamp('checked_at'),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at'),
  rejectionReason: text('rejection_reason'),
  // QA-089: which supplier payment settled this row — paid-status is
  // ledger-backed; reversals restore UNPAID only when this payment still
  // covers the row.
  settledByPaymentId: integer('settled_by_payment_id'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('expenses_approval_status_idx').on(table.approvalStatus),
  index('expenses_date_idx').on(table.expenseDate),
  index('expenses_supplier_idx').on(table.supplierId),
  index('expenses_category_idx').on(table.categoryId),
  index('expenses_vehicle_idx').on(table.truckId, table.vehicleComponent),
]);

// KP-075: explicit per-expense allocation records for supplier payments.
// Each row tracks how much of a payment was allocated to a specific expense,
// enabling partial payment support and proper reversal.
export const expensePaymentAllocations = pgTable('expense_payment_allocations', {
  id: serial('id').primaryKey(),
  expenseId: integer('expense_id').notNull(),
  paymentLedgerId: integer('payment_ledger_id').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('exp_pay_alloc_expense_idx').on(table.expenseId),
  index('exp_pay_alloc_payment_idx').on(table.paymentLedgerId),
  uniqueIndex('exp_pay_alloc_expense_payment_uniq').on(table.expenseId, table.paymentLedgerId),
]);

export const expensePhotos = pgTable('expense_photos', {
  id: serial('id').primaryKey(),
  expenseId: integer('expense_id').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by'),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (table) => [
  // Receipt-photo serving (/api/photos) resolves ownership by exact storage_key
  // lookup; this index makes that O(log n) instead of a seq scan. See ADR 0042.
  index('expense_photos_storage_key_idx').on(table.storageKey),
]);


export const tripExpenses = pgTable('trip_expenses', {
  costGroup: text('cost_group').$type<ExpenseCostGroup>(),
  feeName: text('fee_name'),
  recoveryNote: text('recovery_note'),
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  version: integer('version').notNull().default(1),
  forwarderId: integer('forwarder_id'),  // nullable — accountants also create
  // Q15: authoritative maker. Legacy forwarder-created rows are safely
  // backfilled from forwarder_id; unknown office-side legacy makers stay NULL.
  createdBy: integer('created_by'),
  expenseType: varchar('expense_type', { length: 50 }).notNull(),   // FK to forwarder_expense_types.code
  buyAmount: numeric('buy_amount', { precision: 15, scale: 0 }).notNull(),
  sellAmount: numeric('sell_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  // Explicit customer recovery decomposition. Legacy rows remain NULL and are
  // reported as missing accounting classification instead of being guessed
  // from buy amount/markup.
  recoverablePrincipalAmount: numeric('recoverable_principal_amount', { precision: 15, scale: 0 }),
  serviceFeeAmount: numeric('service_fee_amount', { precision: 15, scale: 0 }),
  settlementMethod: varchar('settlement_method', { length: 20 }).notNull().default('OPS_ADVANCE'),
  supplierId: integer('supplier_id'),
  expenseDate: date('expense_date'),
  payeeName: varchar('payee_name', { length: 200 }),
  invoiceNumber: varchar('invoice_number', { length: 50 }),
  invoiceDate: date('invoice_date'),
  declarationNumber: varchar('declaration_number', { length: 50 }),
  // Free-text container label (DEPRECATED for B5). Kept for back-compat with
  // rows written before the FK existed and as a denormalised mirror; new writes
  // should set `tripContainerId` so the label always matches a real container.
  containerNumber: varchar('container_number', { length: 20 }),
  // B5: authoritative link to the trip's container row. Application delete
  // handling downgrades the expense to trip-level by clearing this identifier.
  tripContainerId: integer('trip_container_id'),
  // Immutable pricing evidence for lift/lower expenses. The FK identifies the
  // catalog row; the JSON snapshot preserves the selectors and resolved price
  // even if that catalog row is later edited or retired.
  liftPricingId: integer('lift_pricing_id'),
  liftPricingSnapshot: jsonb('lift_pricing_snapshot').$type<{
    portId: number;
    containerTypeId: number;
    direction: 'LIFT_UP' | 'LIFT_DOWN';
    loadState: 'LOADED' | 'EMPTY';
    expenseDate: string;
    effectiveDate: string;
    unitPrice: number;
  }>(),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('RECORDED'),
  // Historical O2C approval metadata, retained to preserve the deletion
  // protection of rows genuinely approved under the retired workflow. New
  // direct RECORDED expenses do not fabricate an approver or approval time.
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: integer('approved_by'),
  note: text('note'),
  noInvoiceEvidenceTypes: jsonb('no_invoice_evidence_types').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  noInvoicePolicySnapshot: jsonb('no_invoice_policy_snapshot').$type<Record<string, unknown>>(),
  returnForEvidenceReason: text('return_for_evidence_reason'),
  returnedForEvidenceAt: timestamp('returned_for_evidence_at'),
  returnedForEvidenceBy: integer('returned_for_evidence_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('trip_expenses_trip_id_idx').on(table.tripId),
  index('trip_expenses_container_idx').on(table.containerNumber),
  index('trip_expenses_trip_container_id_idx').on(table.tripContainerId),
  index('trip_expenses_lift_pricing_id_idx').on(table.liftPricingId),
  index('trip_expenses_no_invoice_aggregate_idx').on(table.expenseType, table.expenseDate, table.payeeName),
]);

export const fuelInvoices = pgTable('fuel_invoices', {
  id: serial('id').primaryKey(),
  supplierId: integer('supplier_id').notNull(),
  invoiceNumber: varchar('invoice_number', { length: 80 }).notNull(),
  invoiceDate: date('invoice_date').notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('VND'),
  totalLiters: numeric('total_liters', { precision: 15, scale: 2 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull(),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('RECORDED'),
  note: text('note'),
  createdBy: integer('created_by'),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('fuel_invoices_supplier_idx').on(table.supplierId, table.invoiceDate),
  uniqueIndex('fuel_invoices_supplier_invoice_uniq_idx')
    .on(
      table.supplierId,
      sql`lower(btrim(${table.invoiceNumber}))`,
      table.invoiceDate,
    ),
]);

export const fuelInvoiceAllocations = pgTable('fuel_invoice_allocations', {
  id: serial('id').primaryKey(),
  fuelInvoiceId: integer('fuel_invoice_id')

    .notNull(),
  tripId: integer('trip_id').notNull(),
  truckId: integer('truck_id'),
  tripExpenseId: integer('trip_expense_id'),
  voucherReference: varchar('voucher_reference', { length: 120 }).notNull(),
  voucherDate: date('voucher_date').notNull(),
  liters: numeric('liters', { precision: 15, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('fuel_invoice_allocations_invoice_idx').on(table.fuelInvoiceId),
  index('fuel_invoice_allocations_truck_idx').on(table.truckId, table.voucherDate),
  uniqueIndex('fuel_invoice_allocations_trip_expense_uniq_idx')
    .on(table.tripExpenseId)
    .where(sql`${table.tripExpenseId} is not null`),
  uniqueIndex('fuel_invoice_allocations_invoice_voucher_uniq_idx')
    .on(table.fuelInvoiceId, table.tripId, table.voucherReference),
]);

export const tripExpensePhotos = pgTable('trip_expense_photos', {
  id: serial('id').primaryKey(),
  tripExpenseId: integer('trip_expense_id').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by'),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (table) => [
  // Receipt-photo serving (/api/photos) resolves ownership by exact storage_key
  // lookup; this index makes that O(log n) instead of a seq scan. See ADR 0042.
  index('trip_expense_photos_storage_key_idx').on(table.storageKey),
]);

export const fuelEvidenceReviews = pgTable('fuel_evidence_reviews', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  ownerDriverId: integer('owner_driver_id').notNull(),
  ownerUserId: integer('owner_user_id').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  storageHash: varchar('storage_hash', { length: 64 }).notNull(),
  originalFileName: varchar('original_file_name', { length: 255 }),
  mimeType: varchar('mime_type', { length: 120 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  gpsAccuracy: numeric('gps_accuracy', { precision: 8, scale: 2 }),
  gpsAltitude: numeric('gps_altitude', { precision: 8, scale: 2 }),
  gpsAt: timestamp('gps_at', { withTimezone: true }),
  geotagSource: varchar('geotag_source', { length: 20 }),
  geotagSampleCount: integer('geotag_sample_count'),
  geotagBestAccuracy: numeric('geotag_best_accuracy', { precision: 8, scale: 2 }),
  geotagElapsedMs: integer('geotag_elapsed_ms'),
  ocrOutcome: fuelEvidenceOcrOutcomeEnum('ocr_outcome').notNull(),
  reviewStatus: fuelEvidenceReviewStatusEnum('review_status').notNull().default('PENDING'),
  confidence: numeric('confidence', { precision: 5, scale: 4 }),
  reviewRequired: boolean('review_required').notNull().default(true),
  litres: numeric('litres', { precision: 12, scale: 3 }),
  unitPrice: numeric('unit_price', { precision: 15, scale: 0 }),
  totalAmount: numeric('total_amount', { precision: 15, scale: 0 }),
  computedTotal: numeric('computed_total', { precision: 15, scale: 0 }),
  mismatch: boolean('mismatch').notNull().default(false),
  anomalyCode: varchar('anomaly_code', { length: 40 }),
  anomalyReason: text('anomaly_reason'),
  ocrProvider: varchar('ocr_provider', { length: 40 }),
  ocrModel: varchar('ocr_model', { length: 100 }),
  ocrError: text('ocr_error'),
  reviewerId: integer('reviewer_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  createdBy: integer('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  version: integer('version').notNull().default(1),
}, (table) => [
  uniqueIndex('fuel_evidence_reviews_trip_owner_hash_uniq').on(table.tripId, table.ownerDriverId, table.storageHash),
  index('fuel_evidence_reviews_trip_idx').on(table.tripId, table.reviewStatus),
  index('fuel_evidence_reviews_owner_idx').on(table.ownerDriverId, table.createdAt),
  index('fuel_evidence_reviews_review_queue_idx').on(table.reviewStatus, table.createdAt),
  index('fuel_evidence_reviews_storage_key_idx').on(table.storageKey),
]);

export const tripExpenseCompletionScopes = pgTable('trip_expense_completion_scopes', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  // Null represents the trip-level "Chi phí chung" scope.
  tripContainerId: integer('trip_container_id'),
  status: varchar('status', { length: 20 }).notNull().default('IN_PROGRESS'),
  completedBy: integer('completed_by'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_expense_scope_container_unq').on(table.tripContainerId).where(sql`${table.tripContainerId} IS NOT NULL`),
  uniqueIndex('trip_expense_scope_general_unq').on(table.tripId).where(sql`${table.tripContainerId} IS NULL`),
  index('trip_expense_scope_trip_idx').on(table.tripId),
]);

// ─── Attendance ──────────────────────────────────────────────────────────────
export const driverWorkDays = pgTable('driver_work_days', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').notNull(),
  date: date('date').notNull(),
  status: workDayStatusEnum('status').notNull(),
  tripId: integer('trip_id'),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('driver_work_days_driver_date_idx').on(table.driverId, table.date),
  index('driver_work_days_driver_idx').on(table.driverId),
]);


export const driverProgressEvents = pgTable('driver_progress_events', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id')
    .notNull(),
  driverId: integer('driver_id')
    .notNull(),
  eventType: driverProgressEventTypeEnum('event_type').notNull(),
  // The time the event occurred (driver-reported; may be backdated to the
  // actual event). Distinct from `createdAt` (record-time audit).
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  note: text('note'),
  // The user who recorded the event (audit). Usually the driver; ADMIN may
  // record on a driver's behalf in edge cases.
  recordedBy: integer('recorded_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('driver_progress_events_trip_idx').on(table.tripId, table.occurredAt),
  index('driver_progress_events_driver_idx').on(table.driverId),
]);


export const driverIncidentalCosts = pgTable('driver_incidental_costs', {
  ...expenseMetadataColumns(),
  id: serial('id').primaryKey(),
  tripId: integer('trip_id')
    .notNull(),
  driverId: integer('driver_id')
    .notNull(),
  costType: driverIncidentalCostTypeEnum('cost_type').notNull(),
  // Card 20260921_6: the catalog row the driver picked (app-level FK →
  // forwarder_expense_types.code, same convention as ops_expense_entries).
  // null = legacy/enum-only entry keeps the pre-card heuristic.
  expenseTypeCode: varchar('expense_type_code', { length: 50 }),
  // VND amount — integer, no decimals (matches tripExpenses.buyAmount convention).
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  // The date the cost was incurred (driver-reported). Distinct from createdAt.
  occurredAt: date('occurred_at').notNull(),
  note: text('note'),
  // Driver-attached receipt photo for this cost line (upload.ts storage-key
  // convention). Nullable — the M8.4 slice-3 cost log predates the mobile
  // shipment-cost-entry form's receipt requirement, and existing rows have none.
  receiptStorageKey: varchar('receipt_storage_key', { length: 255 }),
  recordedBy: integer('recorded_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('driver_incidental_costs_trip_idx').on(table.tripId, table.occurredAt),
  index('driver_incidental_costs_driver_idx').on(table.driverId),
]);
