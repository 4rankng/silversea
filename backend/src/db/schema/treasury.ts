// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  date, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const debtOffsets = pgTable('debt_offsets', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  supplierId: integer('supplier_id').notNull(),
  // Q08: legacy offsets may predate canonical partner linkage. Keep nullable
  // at-rest for upgrade safety; new writes must still provide the canonical
  // partner through the service-layer validator.
  partnerId: integer('partner_id'),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  offsetDate: date('offset_date').notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('VND'),
  minutesReference: varchar('minutes_reference', { length: 120 }),
  minutesDocumentHash: varchar('minutes_document_hash', { length: 120 }),
  note: text('note'),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('PENDING'),
  createdBy: integer('created_by'),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('debt_offsets_customer_idx').on(table.customerId),
  index('debt_offsets_supplier_idx').on(table.supplierId),
  index('debt_offsets_partner_idx').on(table.partnerId, table.offsetDate),
]);

// ─── Wave 3: Financial Close tables ─────────────────────────────────────────
export const treasuryAccounts = pgTable('treasury_accounts', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('VND'),
  bankName: varchar('bank_name', { length: 160 }),
  bankAccountNumber: varchar('bank_account_number', { length: 80 }),
  openingBalance: numeric('opening_balance', { precision: 15, scale: 0 }).notNull().default('0'),
  openingBalanceDate: date('opening_balance_date'),
  cutoverAt: timestamp('cutover_at', { withTimezone: true }),
  openingGovernanceActionId: integer('opening_governance_action_id'),
  status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  createdBy: integer('created_by').notNull(),
  updatedBy: integer('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('treasury_accounts_code_uniq').on(table.code),
  index('treasury_accounts_type_status_idx').on(table.type, table.status),
]);

export const paymentReceipts = pgTable('payment_receipts', {
  id: serial('id').primaryKey(),
  receiptId: varchar('receipt_id', { length: 100 }).notNull(),
  customerId: integer('customer_id').notNull(),
  receivedAmount: numeric('received_amount', { precision: 15, scale: 0 }).notNull(),
  allocatedTotal: numeric('allocated_total', { precision: 15, scale: 0 }).notNull(),
  unappliedAmount: numeric('unapplied_amount', { precision: 15, scale: 0 }).notNull(),
  refundedAmount: numeric('refunded_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  allocationMethod: varchar('allocation_method', { length: 20 }).notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  treasuryAccountId: integer('treasury_account_id'),
  valueDate: date('value_date'),
  physicalReference: varchar('physical_reference', { length: 160 }),
  paymentContractVersion: integer('payment_contract_version').notNull().default(1),
  createdBy: integer('created_by'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('payment_receipts_receipt_id_uniq').on(table.receiptId),
  index('payment_receipts_customer_created_idx').on(table.customerId, table.createdAt),
]);


// Append-only book movements linked to one physical collection/payment source.
// AR/AP balances continue to live in their existing authorities.
export const treasuryMovements = pgTable('treasury_movements', {
  id: serial('id').primaryKey(),
  treasuryAccountId: integer('treasury_account_id').notNull(),
  direction: varchar('direction', { length: 10 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  valueDate: date('value_date').notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).defaultNow().notNull(),
  status: varchar('status', { length: 20 }).notNull().default('POSTED'),
  paymentReceiptId: integer('payment_receipt_id'),
  ledgerEntryId: integer('ledger_entry_id'),
  sourceVersion: integer('source_version').notNull(),
  paymentContractVersion: integer('payment_contract_version').notNull(),
  physicalReference: varchar('physical_reference', { length: 160 }).notNull(),
  externalReference: varchar('external_reference', { length: 160 }),
  governanceActionId: integer('governance_action_id'),
  reversalOfId: integer('reversal_of_id'),
  createdBy: integer('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('treasury_movements_physical_posted_uniq')
    .on(table.treasuryAccountId, table.direction, table.physicalReference)
    .where(sql`${table.status} = 'POSTED'`),
  uniqueIndex('treasury_movements_receipt_posted_uniq')
    .on(table.paymentReceiptId)
    .where(sql`${table.paymentReceiptId} is not null and ${table.status} = 'POSTED' and ${table.reversalOfId} is null`),
  uniqueIndex('treasury_movements_ledger_posted_uniq')
    .on(table.ledgerEntryId)
    .where(sql`${table.ledgerEntryId} is not null and ${table.status} = 'POSTED' and ${table.reversalOfId} is null`),
  uniqueIndex('treasury_movements_reversal_uniq')
    .on(table.reversalOfId, table.sourceVersion)
    .where(sql`${table.reversalOfId} is not null`),
  index('treasury_movements_account_date_idx').on(table.treasuryAccountId, table.valueDate),
]);


// M5.6: payment allocations. A single receipt (payment) can be split across
// multiple trips/shipments. Each allocation links a payment to one document
// (trip or billing_document) with the amount applied.
export const paymentAllocations = pgTable('payment_allocations', {
  id: serial('id').primaryKey(),
  // The receipt/payment that this allocation belongs to.
  receiptId: varchar('receipt_id', { length: 100 }),
  paymentReceiptId: integer('payment_receipt_id'),
  allocationOrder: integer('allocation_order'),
  originalDueDateSnapshot: date('original_due_date_snapshot'),
  processingDueDateSnapshot: date('processing_due_date_snapshot'),
  issueTimestampSnapshot: timestamp('issue_timestamp_snapshot'),
  // The customer receiving the allocation.
  customerId: integer('customer_id').notNull(),
  billingDocumentId: integer('billing_document_id'),
  sourceTripId: integer('source_trip_id'),
  // What this allocation is applied to: a trip or a billing document.
  targetType: varchar('target_type', { length: 20 }).notNull(), // TRIP | BILLING_DOCUMENT
  targetId: integer('target_id').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  // Allocation strategy: OLDEST_FIRST (default), PROPORTIONAL, MANUAL.
  allocationMethod: varchar('allocation_method', { length: 20 }).notNull().default('OLDEST_FIRST'),
  allocatedBy: integer('allocated_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('payment_allocations_customer_idx').on(table.customerId),
  index('payment_allocations_target_idx').on(table.targetType, table.targetId),
  index('payment_allocations_document_idx').on(table.billingDocumentId, table.createdAt),
  index('payment_allocations_source_trip_idx').on(table.sourceTripId, table.createdAt),
  index('payment_allocations_receipt_idx').on(table.receiptId),
  uniqueIndex('payment_allocations_receipt_order_uniq')
    .on(table.paymentReceiptId, table.allocationOrder)
    .where(sql`${table.paymentReceiptId} is not null`),
  uniqueIndex('payment_allocations_receipt_target_uniq')
    .on(
      table.paymentReceiptId,
      table.targetType,
      table.targetId,
      sql`coalesce(${table.sourceTripId}, 0)`,
    )
    .where(sql`${table.paymentReceiptId} is not null`),
]);

export const paymentRefunds = pgTable('payment_refunds', {
  id: serial('id').primaryKey(),
  paymentReceiptId: integer('payment_receipt_id')

    .notNull(),
  governanceActionId: integer('governance_action_id')

    .notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  reason: text('reason').notNull(),
  createdBy: integer('created_by').notNull(),
  approvedBy: integer('approved_by').notNull(),
  ledgerEntryId: integer('ledger_entry_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('payment_refunds_governance_action_uniq').on(table.governanceActionId),
  index('payment_refunds_receipt_created_idx').on(table.paymentReceiptId, table.createdAt),
]);
