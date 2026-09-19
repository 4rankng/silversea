// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  boolean, date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { BillingDocumentOfficialIdentitySnapshot, DebitNoteTemplateSnapshot } from '@tingting/shared';
import { advanceRequestStatusEnum, advanceSettlementStatusEnum, creditOverrideScopeEnum, creditOverrideStatusEnum, creditOverrideTierEnum, debitNoteStatusEnum, salaryConfirmationStatusEnum, txnTypeEnum } from './_enums';
// Canonical financial posting version for one trip. Operational trip.version
// is deliberately not used as financial provenance because unrelated dossier
// edits also advance it.
export const tripFinancialPostings = pgTable('trip_financial_postings', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  version: integer('version').notNull(),
  tripVersion: integer('trip_version').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  reason: varchar('reason', { length: 30 }).notNull(),
  supersedesId: integer('supersedes_id'),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_financial_postings_trip_version_uniq').on(table.tripId, table.version),
  uniqueIndex('trip_financial_postings_trip_active_uniq')
    .on(table.tripId)
    .where(sql`${table.status} = 'ACTIVE'`),
  uniqueIndex('trip_financial_postings_supersedes_uniq')
    .on(table.supersedesId)
    .where(sql`${table.supersedesId} is not null`),
  index('trip_financial_postings_trip_status_idx').on(table.tripId, table.status),
]);


// ─── Financials ──────────────────────────────────────────────────────────────
export const ledger = pgTable('ledger', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  txnType: txnTypeEnum('txn_type').notNull(),
  txnId: integer('txn_id'),
  receiptId: varchar('receipt_id', { length: 100 }),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: integer('entity_id').notNull(),
  credit: numeric('credit', { precision: 15, scale: 0 }).default('0'),
  debit: numeric('debit', { precision: 15, scale: 0 }).default('0'),
  balance: numeric('balance', { precision: 15, scale: 0 }).notNull(),
  note: text('note'),
  // Q19 immutable payment-date authority. These values are frozen when an AR
  // obligation is posted so later customer/calendar edits cannot rewrite
  // historical overdue dates. Non-AR and unbackfillable legacy rows stay NULL.
  originalDueDate: date('original_due_date'),
  processingDueDate: date('processing_due_date'),
  paymentTermDaysApplied: integer('payment_term_days_applied'),
  paymentDatePolicyApplied: varchar('payment_date_policy_applied', { length: 30 }),
  financialPostingId: integer('financial_posting_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // Hottest query path: every getBalance/postEntry does WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1
  index('ledger_entity_entity_idx').on(table.entityType, table.entityId),
  index('ledger_entity_entity_id_idx').on(table.entityType, table.entityId, table.id),
  index('ledger_entity_txn_timestamp_idx').on(table.entityType, table.txnType, table.timestamp),
  index('ledger_financial_posting_idx').on(table.financialPostingId),
  uniqueIndex('ledger_forwarder_settlement_once_idx')
    .on(table.txnType, table.txnId, table.entityType, table.entityId)
    .where(sql`${table.txnType} = 'OPS_SETTLEMENT'`),
]);

// ─── Billing Documents (debit notes + payment statements) ─────────────────────
// Saved documents composed by kế toán / quản lý. PAYMENT_STATEMENT is a pure
// presentation snapshot. DEBIT_NOTE edits reconcile amount overrides, ad-hoc
// rows, and exclusions through append-only customer-ledger adjustments.
// entityType CUSTOMER = AR debit-note customer OR AP external carrier (carriers
// live in customers per decision D-E/F); entityType VENDOR = AP supplier.


// ─── Debit-note (Giấy báo nợ) templates ──────────────────────────────────────
// Form-driven, Excel-only layout presets. Single default enforced in code by the
// transactional route handler (NOT a partial unique index — see migration 0076 +
// the salary_periods.isDefault precedent). document_type is reserved for
// forward-compat; the resolver guards to DEBIT_NOTE today.
export const debitNoteTemplates = pgTable('debit_note_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  documentType: varchar('document_type', { length: 20 }).notNull().default('DEBIT_NOTE'),
  titleText: varchar('title_text', { length: 100 }).notNull().default('GIẤY BÁO NỢ'),
  issuerName: varchar('issuer_name', { length: 200 }),
  issuerAddress: varchar('issuer_address', { length: 300 }),
  issuerTaxCode: varchar('issuer_tax_code', { length: 50 }),
  issuerRepresentative: varchar('issuer_representative', { length: 100 }),
  accentColor: varchar('accent_color', { length: 20 }).notNull().default('#1F4E79'),
  showContainerColumn: boolean('show_container_column').notNull().default(true),
  showUnitColumn: boolean('show_unit_column').notNull().default(true),
  groupingMode: varchar('grouping_mode', { length: 20 }).notNull().default('ROUTE'),
  columns: jsonb('columns').$type<Array<{
    id: string;
    label: string;
    variable: string;
    width: number;
    align: 'left' | 'center' | 'right';
    format: 'text' | 'date' | 'number' | 'currency';
    total?: boolean;
  }>>().notNull().default(sql`'[]'::jsonb`),
  // Phase 2: rendered read-only in UI; reserved for a future vndToWords() helper.
  amountInWords: boolean('amount_in_words').notNull().default(false),
  orientation: varchar('orientation', { length: 10 }).notNull().default('landscape'),
  termsText: text('terms_text'),
  signatureLeftLabel: varchar('signature_left_label', { length: 100 }).default('Khách hàng'),
  signatureLeftName: varchar('signature_left_name', { length: 100 }),
  signatureRightLabel: varchar('signature_right_label', { length: 100 }).default('Kế toán trưởng'),
  signatureRightName: varchar('signature_right_name', { length: 100 }),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const billingDocuments = pgTable('billing_documents', {
  id: serial('id').primaryKey(),
  version: integer('version').notNull().default(1),
  type: varchar('type', { length: 20 }).notNull(),               // DEBIT_NOTE | PAYMENT_STATEMENT
  entityType: varchar('entity_type', { length: 20 }).notNull(),  // CUSTOMER | VENDOR
  entityId: integer('entity_id').notNull(),
  entityName: varchar('entity_name', { length: 255 }),
  rangeFrom: date('range_from').notNull(),
  rangeTo: date('range_to').notNull(),
  note: text('note'),
  debitNoteTemplateId: integer('debit_note_template_id'),
  // Frozen render-only copy so historical debit notes re-export identically
  // after the template (or its logo) is edited/deleted.
  debitNoteTemplateSnapshot: jsonb('debit_note_template_snapshot').$type<DebitNoteTemplateSnapshot>(),
  // Immutable legal/bank/signature identity used by issued-document renders.
  // Separate from the template so legacy documents without a template can be
  // backfilled without inventing a partial template object.
  officialIdentitySnapshot: jsonb('official_identity_snapshot').$type<BillingDocumentOfficialIdentitySnapshot>(),
  // Reference-only legal invoice handoff state. This metadata never posts AR
  // and never replaces the Debit Note as the debt instrument authority.
  legalInvoiceRef: jsonb('legal_invoice_ref').$type<{
    provider?: string;
    status: 'PENDING' | 'UNKNOWN' | 'ISSUED' | 'DEAD' | 'CANCELED';
    providerReference?: string;
    requestVersion: number;
    payloadHash?: string;
    checksum?: string;
    issuedAt?: string;
    updatedAt: string;
  }>(),
  totalInclVat: numeric('total_incl_vat', { precision: 15, scale: 0 }).notNull().default('0'),
  totalNet: numeric('total_net', { precision: 15, scale: 0 }).notNull().default('0'),
  totalTax: numeric('total_tax', { precision: 15, scale: 0 }).notNull().default('0'),
  totalGross: numeric('total_gross', { precision: 15, scale: 0 }).notNull().default('0'),
  vatTreatmentVersion: varchar('vat_treatment_version', { length: 30 }).notNull().default('VAT-V1'),
  // Wave 2 M3.6: debit-note lifecycle status. Defaults to DRAFT (existing
  // documents are treated as DRAFT until explicitly transitioned). Nullable
  // for backward compat (old documents get NULL = implicitly DRAFT).
  debitNoteStatus: debitNoteStatusEnum('debit_note_status').default('DRAFT'),
  // Wave 2 M3.6: when the customer confirmed/rejected the note. NULL = no
  // customer action yet.
  customerConfirmedAt: timestamp('customer_confirmed_at', { withTimezone: true }),
  customerConfirmedBy: varchar('customer_confirmed_by', { length: 255 }),
  // Net AR delta contributed by this debit note beyond the trip/fee amounts
  // that were already posted when the trip completed. Kept separately so an
  // edit can post only the difference and repeated saves stay idempotent.
  ledgerAdjustmentAmount: numeric('ledger_adjustment_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  // Frozen contractual due-date snapshot for customer debit notes.
  originalDueDate: date('original_due_date'),
  processingDueDate: date('processing_due_date'),
  paymentTermDaysApplied: integer('payment_term_days_applied'),
  paymentDatePolicyApplied: varchar('payment_date_policy_applied', { length: 30 }),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  authorityState: varchar('authority_state', { length: 30 }).notNull().default('CURRENT'),
  authorityWarningReason: text('authority_warning_reason'),
  authorityWarningAt: timestamp('authority_warning_at', { withTimezone: true }),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('billing_documents_entity_idx').on(table.entityType, table.entityId),
]);


// Q21: reusable period-lock authority for salary, fuel, and debit-note cycles.
// Scope is GLOBAL for company-wide domains and CUSTOMER for debit-note locks.
export const periodLocks = pgTable('period_locks', {
  id: serial('id').primaryKey(),
  domain: varchar('domain', { length: 30 }).notNull(),
  scopeType: varchar('scope_type', { length: 20 }).notNull().default('GLOBAL'),
  scopeId: integer('scope_id').notNull().default(0),
  cycle: varchar('cycle', { length: 20 }).notNull(),
  periodKey: varchar('period_key', { length: 40 }).notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('CLOSED'),
  closedBy: integer('closed_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }).defaultNow().notNull(),
  reopenedBy: integer('reopened_by'),
  reopenedAt: timestamp('reopened_at', { withTimezone: true }),
  note: text('note'),
  reopenNote: text('reopen_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('period_locks_domain_scope_period_uniq')
    .on(table.domain, table.scopeType, table.scopeId, table.periodKey),
  index('period_locks_lookup_idx').on(
    table.domain,
    table.scopeType,
    table.scopeId,
    table.status,
    table.periodStart,
    table.periodEnd,
  ),
]);



export const financialReportingPolicyVersions = pgTable('financial_reporting_policy_versions', {
  id: serial('id').primaryKey(),
  effectiveFrom: date('effective_from').notNull(),
  depreciationMethod: varchar('depreciation_method', { length: 30 }).notNull(),
  allocationBasis: varchar('allocation_basis', { length: 50 }).notNull(),
  lowMarginThresholdRatio: numeric('low_margin_threshold_ratio', { precision: 5, scale: 4 }),
  createdBy: integer('created_by')

    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('financial_reporting_policy_versions_effective_from_uniq')
    .on(table.effectiveFrom),
  index('financial_reporting_policy_versions_effective_lookup_idx')
    .on(table.effectiveFrom, table.createdAt),
]);

export const truckFinancialProfileVersions = pgTable('truck_financial_profile_versions', {
  id: serial('id').primaryKey(),
  truckId: integer('truck_id')

    .notNull(),
  effectiveFrom: date('effective_from').notNull(),
  acquisitionCost: numeric('acquisition_cost', { precision: 15, scale: 0 }).notNull(),
  residualValue: numeric('residual_value', { precision: 15, scale: 0 }).notNull(),
  inServiceDate: date('in_service_date').notNull(),
  usefulLifeMonths: integer('useful_life_months').notNull(),
  monthlyFixedCost: numeric('monthly_fixed_cost', { precision: 15, scale: 0 }).notNull(),
  createdBy: integer('created_by')

    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('truck_financial_profile_versions_truck_month_uniq')
    .on(table.truckId, table.effectiveFrom),
  index('truck_financial_profile_versions_lookup_idx')
    .on(table.truckId, table.effectiveFrom, table.createdAt),
]);


// Q21: late debit-note adjustments keep an internal link to the original
// locked periods they are correcting. A single adjustment document may point
// back to multiple locked periods when approved source lines come in late.
export const billingDocumentSourcePeriodLocks = pgTable('billing_document_source_period_locks', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')

    .notNull(),
  periodLockId: integer('period_lock_id')

    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('billing_document_source_period_locks_doc_period_uniq')
    .on(table.documentId, table.periodLockId),
  index('billing_document_source_period_locks_period_idx').on(table.periodLockId),
]);


// Active trip claims prevent overlapping non-voided Debit Notes from billing
// the same trip twice while still allowing separate non-overlapping periods
// (for example late recoverable fees in July and freight completion in August).
// Release happens through the billing-document lifecycle: soft-delete or
// CANCELED transitions mark the claim released instead of erasing history.
export const billingDocumentTripClaims = pgTable('billing_document_trip_claims', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')

    .notNull(),
  tripId: integer('trip_id')

    .notNull(),
  financialPostingId: integer('financial_posting_id')

    .notNull(),
  financialPostingVersion: integer('financial_posting_version').notNull(),
  postingChecksum: varchar('posting_checksum', { length: 64 }).notNull(),
  rangeFrom: date('range_from').notNull(),
  rangeTo: date('range_to').notNull(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releasedBy: integer('released_by'),
  releaseReason: varchar('release_reason', { length: 32 }),
}, (table) => [
  uniqueIndex('billing_document_trip_claims_document_trip_active_uniq')
    .on(table.documentId, table.tripId)
    .where(sql`${table.releasedAt} is null`),
  index('billing_document_trip_claims_document_idx').on(table.documentId),
  index('billing_document_trip_claims_trip_idx').on(table.tripId),
]);

// Active lot claims enforce the 2026-09-19 lot-level uniqueness ruling: a
// locked lot may appear in at most ONE issued Debit Note (uniqueness lives at
// the lot, not at customer+period — the old billing_documents key blocked
// disjoint multi-period exports). Release happens through the billing-document
// lifecycle: the CANCELED transition releases the claim instead of erasing
// history.
export const debitNoteLots = pgTable('debit_note_lots', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull(),
  shipmentId: integer('shipment_id').notNull(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releasedBy: integer('released_by'),
  releaseReason: varchar('release_reason', { length: 32 }),
}, (table) => [
  uniqueIndex('debit_note_lots_shipment_active_uniq').on(table.shipmentId)
    .where(sql`${table.releasedAt} is null`),
  index('debit_note_lots_document_idx').on(table.documentId),
]);

export const billingDocumentLines = pgTable('billing_document_lines', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull(),
  sourceType: varchar('source_type', { length: 20 }).notNull(),  // TRIP | EXPENSE | ADHOC
  sourceId: integer('source_id'),                                // tripId | tripExpenseId | null(ADHOC)
  sourceVersion: varchar('source_version', { length: 120 }),
  sourceChangedAt: timestamp('source_changed_at', { withTimezone: true }),
  financialPostingId: integer('financial_posting_id'),
  financialPostingVersion: integer('financial_posting_version'),
  postingChecksum: varchar('posting_checksum', { length: 64 }),
  lineType: varchar('line_type', { length: 20 }).notNull(),      // FREIGHT | SERVICE_FEE | ADHOC
  typeLabel: varchar('type_label', { length: 100 }).notNull().default('Khác'),
  unit: varchar('unit', { length: 50 }).notNull().default('lần'),
  description: text('description').notNull(),
  routeName: varchar('route_name', { length: 255 }),
  containerNumbers: text('container_numbers'),                   // comma-joined (no PG arrays in this schema)
  renderData: jsonb('render_data').$type<Record<string, unknown>>(),
  baseAmount: numeric('base_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  amountOverride: numeric('amount_override', { precision: 15, scale: 0 }),
  excluded: boolean('excluded').default(false).notNull(),
  vatTreatment: varchar('vat_treatment', { length: 20 }).notNull().default('EXEMPT'),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  vatTreatmentVersion: varchar('vat_treatment_version', { length: 30 }).notNull().default('VAT-V1'),
  netAmount: numeric('net_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  taxAmount: numeric('tax_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  grossAmount: numeric('gross_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  sortOrder: integer('sort_order').default(0).notNull(),
}, (table) => [
  index('billing_document_lines_doc_idx').on(table.documentId),
]);


// One recoverable expense may be claimed by only one Debit Note. Approval and
// eligibility remain authoritative on trip_expenses; this table only freezes
// the source/version link and prevents double billing.
export const billingDocumentRecoverableClaims = pgTable('billing_document_recoverable_claims', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')
    .notNull(),
  // Plain integer avoids the schema initializer cycle: trip_expenses is
  // declared later in this file. The generated migration adds the FK.
  expenseId: integer('expense_id').notNull(),
  expenseVersion: integer('expense_version').notNull(),
  sourceVersion: varchar('source_version', { length: 120 }).notNull(),
  evidenceSnapshot: jsonb('evidence_snapshot').$type<Record<string, unknown>>().notNull(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releasedBy: integer('released_by'),
  releaseReason: varchar('release_reason', { length: 32 }),
}, (table) => [
  uniqueIndex('billing_document_recoverable_claims_expense_active_uniq')
    .on(table.expenseId)
    .where(sql`${table.releasedAt} is null`),
  index('billing_document_recoverable_claims_document_idx').on(table.documentId),
]);

export const billingDocumentDisputes = pgTable('billing_document_disputes', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull(),
  documentVersion: integer('document_version').notNull(),
  customerId: integer('customer_id').notNull(),
  disputedBy: integer('disputed_by').notNull(),
  reason: text('reason').notNull(),
  evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
  disputedAt: timestamp('disputed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('billing_document_disputes_idempotency_uniq').on(table.idempotencyKey),
  index('billing_document_disputes_document_idx').on(table.documentId, table.disputedAt),
]);

export const capTableHistory = pgTable('cap_table_history', {
  id: serial('id').primaryKey(),
  partnerName: varchar('partner_name', { length: 255 }).notNull(),
  // Optional — application drives cap-table ownership via percentage; this
  // column is reserved for future amount-based book-keeping.
  contributionAmount: numeric('contribution_amount', { precision: 15, scale: 0 }).default('0').notNull(),
  // Snapshot ownership percentage (0–100). Distribution math reads this
  // directly; contributionAmount is a separate book-keeping field.
  percentage: numeric('percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  effectiveDate: date('effective_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});


// ─── Per-vehicle ownership (F3) ─────────────────────────────────────────────
// History-based mirrors of `cap_table_history`, but scoped per truck. Each row
// is a snapshot of one partner's stake at an `effectiveDate` for a truck; the
// latest effectiveDate ≤ cutoff (deduped by partner) resolves the active
// owners whose % share that truck's profit. `percentage` is explicit (0–100);
// contribution amount is not tracked per-vehicle.
export const truckCapTable = pgTable('truck_cap_table', {
  id: serial('id').primaryKey(),
  truckId: integer('truck_id').notNull(),
  partnerName: varchar('partner_name', { length: 255 }).notNull(),
  percentage: numeric('percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  // B2 (feedback202606 GAP 7) — role of the partner: INVESTOR (capital partner,
  // default) or DRIVER (driver-contributor modeled as a per-truck profit
  // participant by %). Application validation owns the allowed values.
  role: text('role').notNull().default('INVESTOR'),
  effectiveDate: date('effective_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('truck_cap_table_truck_effective_idx').on(table.truckId, table.effectiveDate),
]);

export const distributions = pgTable('distributions', {
  id: serial('id').primaryKey(),
  quarter: integer('quarter').notNull(),
  year: integer('year').notNull(),
  partnerName: varchar('partner_name', { length: 255 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  // F3 — per-vehicle attribution. NULL on legacy entity-wide rows; set to the
  // owning truck's id on new per-vehicle distribution rows.
  truckId: integer('truck_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const managementFees = pgTable('management_fees', {
  id: serial('id').primaryKey(),
  month: integer('month').notNull(),
  year: integer('year').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const salaryConfirmations = pgTable('salary_confirmations', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  status: salaryConfirmationStatusEnum('status').default('DRAFT').notNull(),
  confirmedBy: integer('confirmed_by'),
  confirmedAt: timestamp('confirmed_at'),
  salarySnapshot: jsonb('salary_snapshot').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('salary_confirmations_driver_period_idx').on(table.driverId, table.year, table.month),
]);

export const salaryPeriods = pgTable('salary_periods', {
  id: serial('id').primaryKey(),
  // null for the global default row; 1-12 for per-month overrides
  month: integer('month'),
  year: integer('year'),
  // Explicit dates for per-month overrides; null for global default (derived)
  startDate: date('start_date'),
  endDate: date('end_date'),
  label: varchar('label', { length: 100 }),
  // Only set on the global default row (isDefault = true)
  defaultStartDay: integer('default_start_day'),
  defaultEndDay: integer('default_end_day'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});


export const advanceRequests = pgTable('advance_requests', {
  id: serial('id').primaryKey(),
  version: integer('version').default(1).notNull(),
  requesterId: integer('requester_id').notNull(),
  // Durable display snapshot of the requester's full name at creation. The
  // live users join disappears once the account is removed, but a completed
  // financial approval must keep showing who requested it.
  requesterNameSnapshot: text('requester_name_snapshot'),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  reason: text('reason').notNull(),
  status: advanceRequestStatusEnum('status').default('RECORDED').notNull(),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const advanceSettlements = pgTable('advance_settlements', {
  id: serial('id').primaryKey(),
  version: integer('version').default(1).notNull(),
  code: varchar('code', { length: 20 }).notNull(),
  forwarderId: integer('forwarder_id').notNull(),
  totalExpenseAmount: numeric('total_expense_amount', { precision: 15, scale: 0 }).notNull(),
  refundAmount: numeric('refund_amount', { precision: 15, scale: 0 }).default('0').notNull(),
  status: advanceSettlementStatusEnum('status').default('RECORDED').notNull(),
  checkedBy: integer('checked_by'),
  checkedAt: timestamp('checked_at'),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at'),
  // Immutable idempotency authority for the automatic O2C expense-offset hook.
  // Manual settlements leave this null; one approved expense can create at
  // most one automatic settlement even under concurrent approval replays.
  autoOffsetExpenseId: integer('auto_offset_expense_id'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('advance_settlements_code_unique_idx').on(table.code),
  uniqueIndex('advance_settlements_auto_offset_expense_uniq')
    .on(table.autoOffsetExpenseId)
    .where(sql`${table.autoOffsetExpenseId} IS NOT NULL`),
]);

export const advanceSettlementRequests = pgTable('advance_settlement_requests', {
  id: serial('id').primaryKey(),
  settlementId: integer('settlement_id').notNull(),
  advanceRequestId: integer('advance_request_id').notNull(),
  // The consumed slice of this advance. A request can fund multiple automatic
  // settlements while its unallocated residual remains outstanding.
  allocatedAmount: numeric('allocated_amount', { precision: 15, scale: 0 }).default('0').notNull(),
}, (table) => [
  uniqueIndex('adv_settlement_req_unique_idx').on(table.settlementId, table.advanceRequestId),
  index('adv_settlement_req_request_idx').on(table.advanceRequestId),
]);

export const settlementExpenses = pgTable('settlement_expenses', {
  id: serial('id').primaryKey(),
  settlementId: integer('settlement_id').notNull(),
  tripExpenseId: integer('trip_expense_id').notNull(),
  originalBuyAmount: numeric('original_buy_amount', { precision: 15, scale: 0 }).notNull(),
  adjustedBuyAmount: numeric('adjusted_buy_amount', { precision: 15, scale: 0 }).notNull(),
  submittedSellAmount: numeric('submitted_sell_amount', { precision: 15, scale: 0 }),
  originalSnapshot: jsonb('original_snapshot').$type<Record<string, unknown>>().notNull(),
  adjustedSnapshot: jsonb('adjusted_snapshot').$type<Record<string, unknown>>().notNull(),
  adjustmentReason: text('adjustment_reason'),
  adjustedBy: integer('adjusted_by'),
  adjustedAt: timestamp('adjusted_at'),
}, (table) => [
  uniqueIndex('settlement_expense_unique_idx').on(table.settlementId, table.tripExpenseId),
  index('settlement_expense_trip_expense_idx').on(table.tripExpenseId),
]);


// Q18: immutable audit history for every accountant correction applied to a
// settlement expense. The current effective snapshot remains on
// settlement_expenses for approval/reporting, while these child rows preserve
// every before/after transition and its eventual approval authority.
export const settlementExpenseAdjustments = pgTable('settlement_expense_adjustments', {
  id: serial('id').primaryKey(),
  settlementId: integer('settlement_id')

    .notNull(),
  settlementExpenseId: integer('settlement_expense_id')

    .notNull(),
  tripExpenseId: integer('trip_expense_id')

    .notNull(),
  sequence: integer('sequence').notNull(),
  sourceVersion: integer('source_version').notNull(),
  beforeSnapshot: jsonb('before_snapshot').$type<Record<string, unknown>>().notNull(),
  afterSnapshot: jsonb('after_snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  adjustedBy: integer('adjusted_by').notNull(),
  adjustedAt: timestamp('adjusted_at', { withTimezone: true }).defaultNow().notNull(),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('settlement_expense_adjustments_link_sequence_uniq')
    .on(table.settlementExpenseId, table.sequence),
  index('settlement_expense_adjustments_settlement_idx')
    .on(table.settlementId, table.adjustedAt),
  index('settlement_expense_adjustments_expense_idx')
    .on(table.tripExpenseId, table.adjustedAt),
]);


// Q01/Q02: durable over-limit approval workflow. Requests are bounded to one
// shipment or to an explicit expiry window and preserve the exposure snapshot
// that was actually approved.
export const creditOverrideRequests = pgTable('credit_override_requests', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  shipmentId: integer('shipment_id'),
  scopeType: creditOverrideScopeEnum('scope_type').notNull(),
  status: creditOverrideStatusEnum('status').notNull().default('PENDING'),
  requiredTier: creditOverrideTierEnum('required_tier').notNull(),
  reason: text('reason').notNull(),
  requestedBy: integer('requested_by').notNull(),
  requestedRole: varchar('requested_role', { length: 20 }).notNull(),
  proposedAmount: numeric('proposed_amount', { precision: 15, scale: 0 }).notNull(),
  outstandingAmount: numeric('outstanding_amount', { precision: 15, scale: 0 }).notNull(),
  approvedCommitmentAmount: numeric('approved_commitment_amount', { precision: 15, scale: 0 }).notNull(),
  totalExposure: numeric('total_exposure', { precision: 15, scale: 0 }).notNull(),
  creditLimit: numeric('credit_limit', { precision: 15, scale: 0 }).notNull(),
  warningThreshold: numeric('warning_threshold', { precision: 4, scale: 2 }).notNull(),
  overLimitAmount: numeric('over_limit_amount', { precision: 15, scale: 0 }).notNull(),
  overLimitRatio: numeric('over_limit_ratio', { precision: 8, scale: 4 }).notNull(),
  repeatException: boolean('repeat_exception').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  approvedBy: integer('approved_by'),
  approvedRole: varchar('approved_role', { length: 20 }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectedBy: integer('rejected_by'),
  rejectedRole: varchar('rejected_role', { length: 20 }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  consumedTripId: integer('consumed_trip_id'),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('credit_override_requests_customer_idx').on(table.customerId, table.status, table.createdAt),
  index('credit_override_requests_shipment_idx').on(table.shipmentId, table.status),
  uniqueIndex('credit_override_requests_active_shipment_uniq')
    .on(table.shipmentId)
    .where(sql`${table.shipmentId} is not null and ${table.status} in ('PENDING', 'APPROVED')`),
]);


// M7.3: salary period closes. An accountant closes a salary period; after
// close, no further changes to driver salary for that period. Each period has
// at most one close row (enforced by a unique index).
export const salaryPeriodCloses = pgTable('salary_period_closes', {
  id: serial('id').primaryKey(),
  // Period identifier: YYYY-MM format (e.g. '2026-07').
  period: varchar('period', { length: 7 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('CLOSED'), // CLOSED | REOPENED
  // The ledger entry posted when the period was closed (single entry per close).
  ledgerEntryId: integer('ledger_entry_id'),
  closedBy: integer('closed_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }).defaultNow().notNull(),
  note: text('note'),
  payslipIssuedBy: integer('payslip_issued_by'),
  payslipIssuedAt: timestamp('payslip_issued_at', { withTimezone: true }),
  payslipIssuedNote: text('payslip_issued_note'),
  officialPostedBy: integer('official_posted_by'),
  officialPostedAt: timestamp('official_posted_at', { withTimezone: true }),
  officialPostingNote: text('official_posting_note'),
  // Immutable payroll provenance captured in the same transaction as the close.
  // Historical close responses must never be reconstructed from today's global
  // payroll-unit setting or today's unit membership.
  payrollScope: varchar('payroll_scope', { length: 20 }),
  payrollBusinessUnitId: integer('payroll_business_unit_id'),
  payrollBusinessUnitName: text('payroll_business_unit_name'),
  includedDriverIds: jsonb('included_driver_ids').$type<number[]>(),
  excludedDriverIds: jsonb('excluded_driver_ids').$type<number[]>(),
  payrollProvenanceCapturedAt: timestamp('payroll_provenance_captured_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('salary_period_closes_period_uniq').on(table.period),
]);

export const salaryPeriodAdjustments = pgTable('salary_period_adjustments', {
  id: serial('id').primaryKey(),
  sourcePeriod: varchar('source_period', { length: 7 }).notNull(),
  targetPeriod: varchar('target_period', { length: 7 }).notNull(),
  driverId: integer('driver_id').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  reason: text('reason').notNull(),
  approvedBy: integer('approved_by').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('salary_period_adjustments_target_driver_idx').on(table.targetPeriod, table.driverId, table.createdAt),
  index('salary_period_adjustments_source_driver_idx').on(table.sourcePeriod, table.driverId, table.createdAt),
]);

export const fuelPeriodAdjustments = pgTable('fuel_period_adjustments', {
  id: serial('id').primaryKey(),
  fuelInvoiceId: integer('fuel_invoice_id')

    .notNull(),
  sourcePeriodLockId: integer('source_period_lock_id')

    .notNull(),
  sourcePeriod: varchar('source_period', { length: 7 }).notNull(),
  targetPeriod: varchar('target_period', { length: 7 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('fuel_period_adjustments_invoice_idx').on(table.fuelInvoiceId, table.createdAt),
  index('fuel_period_adjustments_source_idx').on(table.sourcePeriod, table.createdAt),
  index('fuel_period_adjustments_target_idx').on(table.targetPeriod, table.createdAt),
]);


// Legacy fuel-reconciliation explanations are retained as historical records.
// No active workflow requires or edits these rows; variance reporting does not
// block direct fuel expense recording. Keep existing data and uniqueness intact.
export const fuelReconExplanations = pgTable('fuel_recon_explanations', {
  id: serial('id').primaryKey(),
  supplierId: integer('supplier_id').notNull(),
  // Historical ISO date range (YYYY-MM-DD) captured with the explanation.
  periodFrom: date('period_from').notNull(),
  periodTo: date('period_to').notNull(),
  // Free-text accountant explanation (e.g. "price changed mid-month",
  // "pump calibration drift", "extra top-up not yet invoiced").
  explanationText: text('explanation_text').notNull(),
  // Captured-for-audit: the absolute variance at the moment the explanation
  // was recorded. Stored as a positive integer (VND).
  resolvedVariance: numeric('resolved_variance', { precision: 15, scale: 0 }).notNull(),
  createdBy: integer('created_by'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('fuel_recon_explanations_supplier_period_uniq')
    .on(table.supplierId, table.periodFrom, table.periodTo),
  index('fuel_recon_explanations_supplier_idx').on(table.supplierId),
]);


export const profitabilitySnapshots = pgTable('profitability_snapshots', {
  id: serial('id').primaryKey(),
  financialPostingId: integer('financial_posting_id')
    .notNull(),
  tripId: integer('trip_id').notNull(),
  shipmentId: integer('shipment_id'),
  completedBusinessDate: date('completed_business_date').notNull(),
  revenue: numeric('revenue', { precision: 15, scale: 0 }).notNull(),
  directCost: numeric('direct_cost', { precision: 15, scale: 0 }).notNull(),
  sharedOverhead: numeric('shared_overhead', { precision: 15, scale: 0 }).notNull().default('0'),
  profit: numeric('profit', { precision: 15, scale: 0 }).notNull(),
  attributionStatus: varchar('attribution_status', { length: 30 }).notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('profitability_snapshots_posting_uniq').on(table.financialPostingId),
  index('profitability_snapshots_business_date_idx').on(table.completedBusinessDate),
]);

export const profitabilitySnapshotDimensions = pgTable('profitability_snapshot_dimensions', {
  id: serial('id').primaryKey(),
  snapshotId: integer('snapshot_id')
    .notNull(),
  dimension: varchar('dimension', { length: 30 }).notNull(),
  dimensionKey: varchar('dimension_key', { length: 120 }).notNull(),
  dimensionLabel: varchar('dimension_label', { length: 255 }).notNull(),
  attributionStatus: varchar('attribution_status', { length: 30 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
}, (table) => [
  uniqueIndex('profitability_snapshot_dimensions_uniq').on(table.snapshotId, table.dimension),
  index('profitability_snapshot_dimensions_lookup_idx').on(table.dimension, table.dimensionKey),
]);

// ─── Card 20260918_19 — lot cost lock (Khóa lô) + adjust history ───────────
// A LOT lock, independent of the kỳ kế toán lock (shipment_accounting_locks):
// the accounting lock is billing-document-tied with a period snapshot; the
// cost lock has no period or document. They co-exist; guards chain.
export const shipmentCostLocks = pgTable('shipment_cost_locks', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  shipmentVersionAtLock: integer('shipment_version_at_lock').notNull(),
  // Frozen Lớp-1 totals + Lớp-2 lines assembled SERVER-side from engine
  // values (never client amounts). Stored numbers are never recomputed —
  // "mở kỳ mới không đổi số đã khóa".
  costSnapshot: jsonb('cost_snapshot').$type<Record<string, unknown>>().notNull(),
  lockedBy: integer('locked_by').notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
  lockNote: text('lock_note'),
  unlockedBy: integer('unlocked_by'),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }),
  unlockReason: text('unlock_reason'),
}, (table) => [
  // One ACTIVE lock per shipment — the backstop behind the Idempotency-Key.
  uniqueIndex('shipment_cost_locks_active_uniq').on(table.shipmentId).where(sql`unlocked_at is null`),
]);

export const shipmentCostAdjustments = pgTable('shipment_cost_adjustments', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  costLockId: integer('cost_lock_id').notNull(),
  beforeJson: jsonb('before_json').$type<Record<string, unknown>>().notNull(),
  afterJson: jsonb('after_json').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  adjustedBy: integer('adjusted_by').notNull(),
  adjustedAt: timestamp('adjusted_at', { withTimezone: true }).notNull().defaultNow(),
  idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull().unique(),
});
