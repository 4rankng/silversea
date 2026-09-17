import { integer, numeric, pgTable, serial, text, timestamp, date, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ExpenseSourceKind } from '@tingting/shared';

// Explicit source bridge; old rows are not assigned fabricated evidence or cash history.
// Cross-table relationships are validated by the writing services per repository policy.
export const expenseAccountingSources = pgTable('expense_accounting_sources', {
  id: serial('id').primaryKey(), sourceKind: text('source_kind').$type<ExpenseSourceKind>().notNull(), sourceId: integer('source_id').notNull(),
  version: integer('version').default(1).notNull(), shipmentId: integer('shipment_id').notNull(),
  tripId: integer('trip_id'),
  recordedById: integer('recorded_by_id'), confirmedById: integer('confirmed_by_id'), confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  linkedTripExpenseId: integer('linked_trip_expense_id'), reconciliationId: integer('reconciliation_id'),
  allocatedAdvanceAmount: numeric('allocated_advance_amount', { precision: 15, scale: 0 }).default('0').notNull(),
  status: text('status').$type<'RECORDED' | 'VOIDED'>().default('RECORDED').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex('expense_accounting_source_uniq').on(t.sourceKind, t.sourceId),
  uniqueIndex('expense_accounting_trip_expense_uniq').on(t.linkedTripExpenseId).where(sql`${t.linkedTripExpenseId} is not null`),
  index('expense_accounting_shipment_idx').on(t.shipmentId)]);

export const expenseCashVouchers = pgTable('expense_cash_vouchers', {
  id: serial('id').primaryKey(), code: text('code').notNull(), version: integer('version').default(1).notNull(),
  counterpartyType: text('counterparty_type').notNull(), counterpartyId: integer('counterparty_id').notNull(),
  paymentReceiptId: integer('payment_receipt_id'), treasuryMovementId: integer('treasury_movement_id').notNull(),
  reconciliationId: integer('reconciliation_id'), status: text('status').$type<'RECORDED' | 'REVERSED'>().default('RECORDED').notNull(),
  note: text('note'), createdById: integer('created_by_id').notNull(), reversedById: integer('reversed_by_id'), reversalReason: text('reversal_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex('expense_cash_vouchers_code_uniq').on(t.code), index('expense_cash_vouchers_created_idx').on(t.createdAt)]);

export const expenseCashAllocations = pgTable('expense_cash_allocations', {
  id: serial('id').primaryKey(), voucherId: integer('voucher_id').notNull(), expenseAccountingSourceId: integer('expense_accounting_source_id').notNull(),
  paymentAllocationId: integer('payment_allocation_id'),
  sourceVersion: integer('source_version').notNull(), amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
}, t => [uniqueIndex('expense_cash_allocations_pair_uniq').on(t.voucherId, t.expenseAccountingSourceId), index('expense_cash_allocations_source_idx').on(t.expenseAccountingSourceId)]);

export const expenseReconciliations = pgTable('expense_reconciliations', {
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  id: serial('id').primaryKey(), code: text('code').notNull(), opsUserId: integer('ops_user_id').notNull(),
  from: date('from_date').notNull(), to: date('to_date').notNull(), amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  advanceAmount: numeric('advance_amount', { precision: 15, scale: 0 }).notNull(), note: text('note'),
  createdById: integer('created_by_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex('expense_reconciliations_code_uniq').on(t.code), index('expense_reconciliations_user_idx').on(t.opsUserId)]);

export const expenseReconciliationAdvances = pgTable('expense_reconciliation_advances', {
  id: serial('id').primaryKey(), reconciliationId: integer('reconciliation_id').notNull(), advanceRequestId: integer('advance_request_id').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
}, t => [uniqueIndex('expense_reconciliation_advances_pair_uniq').on(t.reconciliationId, t.advanceRequestId), index('expense_reconciliation_advances_advance_idx').on(t.advanceRequestId)]);

export const truckAccountantAssignments = pgTable('truck_accountant_assignments', {
  id: serial('id').primaryKey(), truckId: integer('truck_id').notNull(), accountantId: integer('accountant_id'), version: integer('version').notNull(),
  assignedById: integer('assigned_by_id').notNull(), assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, t => [uniqueIndex('truck_accountant_assignments_active_uniq').on(t.truckId).where(sql`${t.endedAt} is null`), index('truck_accountant_assignments_user_idx').on(t.accountantId)]);

/** Protected, exact-key evidence attachments; adding proof never rewrites money. */
export const expenseAccountingEvidence = pgTable('expense_accounting_evidence', {
  id: serial('id').primaryKey(), expenseAccountingSourceId: integer('expense_accounting_source_id').notNull(),
  storageKey: text('storage_key').notNull(), uploadedById: integer('uploaded_by_id').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex('expense_accounting_evidence_key_uniq').on(t.storageKey), index('expense_accounting_evidence_source_idx').on(t.expenseAccountingSourceId)]);
