// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  boolean, check, date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { customerDeliveryDecisionEnum, deliveryAttemptResultEnum, dispatchClassificationEnum, emailStatusEnum, fulfillmentCancellationDispositionEnum, handoffStatusEnum, milestoneTypeEnum, shipmentCargoModeEnum, shipmentChangeRequestKindEnum, shipmentDeclarationScopeEnum, shipmentDocumentTypeEnum, shipmentFulfillmentTypeEnum, shipmentStatusEnum, shipmentTradeDirectionEnum, tripPodFileTypeEnum, tripPodStatusEnum, customsChannelEnum } from './_enums';
export const shipments = pgTable('shipments', {
  id: serial('id').primaryKey(),
  // Auto-generated unique code. Format pending PRD M3.1 §5 (proposed
  // `{customerCode}-{YYMMDD}-{NNN}`); the gen logic ships with the service in
  // a later Wave 0 checkbox. Nullable here so draft rows can exist before code
  // assignment.
  shipmentCode: varchar('shipment_code', { length: 50 }).unique(),
  // Optimistic locking, mirroring trips.
  version: integer('version').default(1).notNull(),
  // Nullable since ad-hoc orders (Lệnh chạy ngoài): a walk-in cuốc stores the
  // free-text customer in raw_customer_name and no catalog link. Catalog
  // orders keep the FK as before.
  customerId: integer('customer_id'),
  // ── Lệnh chạy ngoài (MasterDataNhaMay §4.1/§2.1 Case 2) ────────────────
  // Free-text intake for one-off cuốc: raw_* carries what the user typed when
  // no catalog id was selected. XOR with the id columns by convention; the
  // pair (id set → raw null) is normalized in the intake services and NEVER
  // written back into the master tables.
  isAdHoc: boolean('is_ad_hoc').notNull().default(false),
  rawCustomerName: varchar('raw_customer_name', { length: 255 }),
  rawRouteName: varchar('raw_route_name', { length: 255 }),
  routeId: integer('route_id'),
  cargoTypeId: integer('cargo_type_id'),
  responsibleUnitId: integer('responsible_unit_id')
    ,
  status: shipmentStatusEnum('status').default('PENDING_DATE'),
  bookingRef: varchar('booking_ref', { length: 100 }),
  blNumber: varchar('bl_number', { length: 100 }),
  tradeDirection: shipmentTradeDirectionEnum('trade_direction'),
  cargoMode: shipmentCargoModeEnum('cargo_mode'),
  operationalSiteId: integer('operational_site_id'),
  pickupWarehouseSiteId: integer('pickup_warehouse_site_id'),
  factoryName: varchar('factory_name', { length: 255 }),
  // Operational classification only. It lets CUS/Điều vận mark a shipment as
  // consolidated without reusing a posted trip-revenue field as a proxy.
  isCombined: boolean('is_combined').notNull().default(false),
  shippingLineName: varchar('shipping_line_name', { length: 255 }),
  expectedDeliveryDate: date('expected_delivery_date'),
  customsCutoffAt: timestamp('customs_cutoff_at', { withTimezone: true }),
  closingAt: timestamp('closing_at', { withTimezone: true }),
  plannedReturnAt: timestamp('planned_return_at', { withTimezone: true }),
  orderExchangeStartedAt: timestamp('order_exchange_started_at', { withTimezone: true }),
  orderExchangeStartedBy: integer('order_exchange_started_by'),
  orderExchangeCompletedAt: timestamp('order_exchange_completed_at', { withTimezone: true }),
  orderExchangeCompletedBy: integer('order_exchange_completed_by'),
  cargoWeightKg: numeric('cargo_weight_kg', { precision: 10, scale: 2 }),
  // Matched to per-container cargo_volume_cbm precision so a container sum
  // promoted to the shipment level never overflows the narrower column.
  cargoVolumeCbm: numeric('cargo_volume_cbm', { precision: 12, scale: 3 }),
  packageCount: integer('package_count'),
  packageType: varchar('package_type', { length: 100 }),
  operationalNotes: text('operational_notes'),
  // Customer-facing note (shown on the CUS dashboard Col6). operationalNotes
  // above is the internal note. Split keeps the two audiences separate.
  customerNotes: text('customer_notes'),
  pickupLocation: varchar('pickup_location', { length: 255 }),
  deliveryLocation: varchar('delivery_location', { length: 255 }),
  contactName: varchar('contact_name', { length: 100 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  createdBy: integer('created_by'),
  updatedBy: integer('updated_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  check('shipments_document_reference_direction_check', sql`
    not (${table.blNumber} is not null and ${table.bookingRef} is not null)
    and (${table.tradeDirection} is distinct from 'IMPORT' or ${table.bookingRef} is null)
    and (${table.tradeDirection} is distinct from 'EXPORT' or ${table.blNumber} is null)
  `),
  uniqueIndex('shipments_id_cargo_mode_uniq_idx').on(table.id, table.cargoMode),
  index('shipments_customer_status_idx').on(table.customerId, table.status),
  index('shipments_route_idx').on(table.routeId),
  index('shipments_responsible_unit_idx').on(table.responsibleUnitId, table.status),
  index('shipments_status_idx').on(table.status),
  index('shipments_operational_site_idx').on(table.operationalSiteId),
  index('shipments_pickup_warehouse_idx').on(table.pickupWarehouseSiteId),
]);


// Booking confirmation, bill of lading, delivery order, customs declaration
// PDFs, etc. storageKey points at the same object-storage / uploads path
// convention used by other uploads (e.g. trip photos).
export const shipmentDocuments = pgTable('shipment_documents', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  type: shipmentDocumentTypeEnum('type'),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by'),
  // Wave 2 M3.2: document expiry date. When set and past, an expired DO
  // blocks dispatch. NULL = no expiry (permanent document).
  expiresAt: date('expires_at'),
  // Wave 2 M3.2: when this document replaces a previous version, the old
  // document's id is stored here so the replacement history is traceable.
  // The old document is NOT deleted — it stays for audit.
  replacedBy: integer('replaced_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('shipment_documents_shipment_id_idx').on(table.shipmentId),
]);


// Customs declarations. Per M3.1 §3, one declaration may cover N containers
// (SHARED) or be per-container (SINGLE). The link from a declaration to the
// containers it covers is many-to-many in full; this Wave 0 slice captures
// the declaration row itself. Container-level linkage ships with the
// container-snapshot service in a later Wave 0 checkbox.
export const shipmentDeclarations = pgTable('shipment_declarations', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  declarationNumber: varchar('declaration_number', { length: 50 }),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  scope: shipmentDeclarationScopeEnum('scope').default('SINGLE'),
  note: text('note'),
  // Card 20260919_5: the customs authority assigns the channel to the whole
  // declaration — declaration-level by ruling, never per-container.
  channel: customsChannelEnum('channel'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('shipment_declarations_shipment_id_idx').on(table.shipmentId),
]);


// Append-only status transitions. Every status change writes a row with the
// reason (free text) and the acting user. fromStatus is nullable for the
// initial DRAFT creation row.
export const shipmentStatusHistory = pgTable('shipment_status_history', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  fromStatus: shipmentStatusEnum('from_status'),
  toStatus: shipmentStatusEnum('to_status').notNull(),
  reason: text('reason'),
  changedBy: integer('changed_by'),
  // timestamptz: an audit-style timestamp, kept unambiguous across deploy
  // regions (matches the file's recent direction for similar audit columns).
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('shipment_status_history_shipment_id_idx').on(table.shipmentId),
]);


// Shipment-side container record. Per phase-01 architecture, reusing
// trip_containers is wrong because a shipment can exist before any trip. This
// table mirrors trip_containers' shape; on dispatch, the relevant containers
// are snapshotted into trip_containers (which is tightly coupled to trip
// expense photos, geotags, multi-seal). Multi-seal on the shipment side will
// mirror trip_container_seals when the dispatch service lands.
export const shipmentContainers = pgTable('shipment_containers', {
  id: serial('id').primaryKey(),
  // CASCADE: a hard shipment delete takes its container rows along — the app
  // normally tombstones (deletedAt), and the FK exists so test/QA hard
  // deletes can no longer strand orphan children (migration 0073).
  shipmentId: integer('shipment_id')
    .notNull()
    .references(() => shipments.id, { onDelete: 'cascade' }),
  containerTypeId: integer('container_type_id'),
  containerNumber: varchar('container_number', { length: 50 }),
  sealNumber: varchar('seal_number', { length: 50 }),
  // Freight-side "PS thực tế" (Bảng 2.1, debit wave REWORK): the actual
  // surcharge/extra recorded per container, persisted at lock-time bookkeeping
  // and rolled into the lot totals on the debit screen. Nullable — null =
  // Chưa xác định.
  psActualAmount: numeric('ps_actual_amount', { precision: 15, scale: 0 }),
  psActualNote: text('ps_actual_note'),
  cargoWeightKg: numeric('cargo_weight_kg', { precision: 10, scale: 2 }),
  // Per-container CBM. CUS dashboard Col4 cargo totals aggregate this across
  // containers (sum), falling back to the shipment-level figure when unset.
  cargoVolumeCbm: numeric('cargo_volume_cbm', { precision: 12, scale: 3 }),
  shippingLineName: varchar('shipping_line_name', { length: 255 }),
  // FCL authority is per container. The shipment route remains nullable only
  // as a legacy/LCL projection; dispatch must resolve this value first.
  routeId: integer('route_id'),
  customerAppointmentAt: timestamp('customer_appointment_at', { withTimezone: true }),
  pickupPortId: integer('pickup_port_id'),
  dropoffPortId: integer('dropoff_port_id'),
  // Ad-hoc orders (Lệnh chạy ngoài): free-text cảng nâng/hạ when no catalog
  // port was picked. XOR with the port ids above by intake convention.
  rawPickupPortName: varchar('raw_pickup_port_name', { length: 255 }),
  rawDropoffPortName: varchar('raw_dropoff_port_name', { length: 255 }),
  // Ad-hoc row-tier factory/route (§4.2): free text when this container has
  // no catalog factory/route picked. XOR with operationalSiteId/routeId by
  // the same intake convention; normalized in the reconcile service.
  rawFactoryName: varchar('raw_factory_name', { length: 255 }),
  rawRouteName: varchar('raw_route_name', { length: 255 }),
  // Per-container factory authority (SILVER L1): nullable, indexed, no DB FK
  // by repo convention — customer scope + FACTORY type are enforced at the
  // persistence choke point (reconcileShipmentContainersInTx).
  operationalSiteId: integer('operational_site_id'),
  notes: text('notes'),
  // Manual charge proposals (accounting close), merged from the 1:1
  // shipment_container_charge_facts table (lean-down 2026-09-06). Amounts in
  // VND; chargeProposalVersion guards the optimistic confirm flow. Property
  // names intentionally match the former fact columns so the proposal
  // field-map, checksum shape, and API payloads stay unchanged.
  chargeProposalVersion: integer('charge_proposal_version').notNull().default(1),
  outboundTransportAmount: numeric('charge_outbound_transport_amount', { precision: 15, scale: 0 }),
  outboundHandlingAmount: numeric('charge_outbound_handling_amount', { precision: 15, scale: 0 }),
  outboundIncidentalAmount: numeric('charge_outbound_incidental_amount', { precision: 15, scale: 0 }),
  inboundTransportAmount: numeric('charge_inbound_transport_amount', { precision: 15, scale: 0 }),
  inboundHandlingAmount: numeric('charge_inbound_handling_amount', { precision: 15, scale: 0 }),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('shipment_containers_shipment_id_idx').on(table.shipmentId),
  index('shipment_containers_pickup_port_idx').on(table.pickupPortId),
  index('shipment_containers_dropoff_port_idx').on(table.dropoffPortId),
  index('shipment_containers_route_idx').on(table.routeId),
  index('shipment_containers_operational_site_idx').on(table.operationalSiteId),
  uniqueIndex('shipment_containers_shipment_id_id_uniq_idx').on(table.shipmentId, table.id),
]);


// Independently dispatchable unit derived from one shipment. Execution state
// remains authoritative on trips; this row owns only identity, requiredness,
// assignment snapshots, and governed cancellation/replacement provenance.
export const shipmentFulfillments = pgTable('shipment_fulfillments', {
  id: serial('id').primaryKey(),
  // CASCADE: same rationale as shipmentContainers (migration 0073); live
  // trips stay protected by the trips.fulfillment_id RESTRICT FK.
  shipmentId: integer('shipment_id')
    .notNull()
    .references(() => shipments.id, { onDelete: 'cascade' }),
  fulfillmentType: shipmentFulfillmentTypeEnum('fulfillment_type').notNull(),
  cargoMode: shipmentCargoModeEnum('cargo_mode').notNull(),
  shipmentContainerId: integer('shipment_container_id')
    ,
  sourceShipmentVersion: integer('source_shipment_version').notNull(),
  siteSnapshot: jsonb('site_snapshot').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  plannedCarrierType: varchar('planned_carrier_type', { length: 20 }),
  plannedExternalCarrierId: integer('planned_external_carrier_id'),
  plannedExternalCarrierVehicleId: integer('planned_external_carrier_vehicle_id'),
  plannedVehiclePlateNumber: varchar('planned_vehicle_plate_number', { length: 20 }),
  // Pre-dispatch operational estimates. These never feed AR/AP/P&L; the
  // canonical financial values remain on the dispatched trip and Accounting
  // closes them through the existing governed workflows.
  plannedRevenue: numeric('planned_revenue', { precision: 15, scale: 0 }),
  plannedCarrierCost: numeric('planned_carrier_cost', { precision: 15, scale: 0 }),
  dispatchClassification: dispatchClassificationEnum('dispatch_classification').notNull().default('SINGLE'),
  version: integer('version').notNull().default(1),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  canceledBy: integer('canceled_by'),
  cancellationReason: text('cancellation_reason'),
  cancellationDisposition: fulfillmentCancellationDispositionEnum('cancellation_disposition'),
  replacementFulfillmentId: integer('replacement_fulfillment_id'),
  notRequiredApprovedBy: integer('not_required_approved_by'),
  notRequiredApprovedAt: timestamp('not_required_approved_at', { withTimezone: true }),
  notRequiredReason: text('not_required_reason'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('shipment_fulfillments_shipment_id_id_uniq_idx').on(table.shipmentId, table.id),
  index('shipment_fulfillments_shipment_idx').on(table.shipmentId),
  index('shipment_fulfillments_planned_external_carrier_idx').on(table.plannedExternalCarrierId),
  index('shipment_fulfillments_planned_external_carrier_vehicle_idx').on(table.plannedExternalCarrierVehicleId),
  uniqueIndex('shipment_fulfillments_active_container_uniq_idx')
    .on(table.shipmentContainerId)
    .where(sql`${table.shipmentContainerId} is not null and ${table.canceledAt} is null`),
  uniqueIndex('shipment_fulfillments_active_lcl_uniq_idx')
    .on(table.shipmentId)
    .where(sql`${table.fulfillmentType} = 'LCL_SHIPMENT' and ${table.canceledAt} is null`),
  uniqueIndex('shipment_fulfillments_replacement_uniq_idx')
    .on(table.replacementFulfillmentId)
    .where(sql`${table.replacementFulfillmentId} is not null`),
]);



export const shipmentRecoveryFacts = pgTable('shipment_recovery_facts', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  shipmentContainerId: integer('shipment_container_id'),
  version: integer('version').notNull().default(1),
  kind: varchar('kind', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('OPEN'),
  expectedAmount: numeric('expected_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  recoveredAmount: numeric('recovered_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  outstandingAmount: numeric('outstanding_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  sourceExpenseId: integer('source_expense_id'),
  sourceVersion: varchar('source_version', { length: 120 }),
  waiverReason: text('waiver_reason'),
  createdBy: integer('created_by'),
  updatedBy: integer('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('shipment_recovery_facts_shipment_idx')
    .on(table.shipmentId, table.kind, table.status),
  index('shipment_recovery_facts_container_idx')
    .on(table.shipmentContainerId),
  uniqueIndex('shipment_recovery_facts_source_expense_uniq_idx')
    .on(table.sourceExpenseId)
    .where(sql`${table.sourceExpenseId} is not null`),
]);


// Accounting lock is orthogonal to ShipmentStatus. It freezes the shipment's
// operational source graph after an issued Debit Note closes the debt cycle.
// Corrections use financial adjustment/reversal authorities, never a seventh
// O2C status.
export const shipmentAccountingLocks = pgTable('shipment_accounting_locks', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  billingDocumentId: integer('billing_document_id').notNull(),
  confirmationActionId: integer('confirmation_action_id'),
  billingDocumentVersion: integer('billing_document_version').notNull(),
  billingPeriodSnapshot: jsonb('billing_period_snapshot').$type<{
    rangeFrom: string;
    rangeTo: string;
    issuedAt: string;
  }>().notNull(),
  shipmentVersionAtLock: integer('shipment_version_at_lock').notNull(),
  reason: text('reason').notNull(),
  activatedBy: integer('activated_by').notNull(),
  activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
  releasedBy: integer('released_by'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releaseReason: text('release_reason'),
}, (table) => [
  uniqueIndex('shipment_accounting_locks_active_shipment_uniq_idx')
    .on(table.shipmentId)
    .where(sql`${table.releasedAt} is null`),
  index('shipment_accounting_locks_document_idx').on(table.billingDocumentId),
  index('shipment_accounting_locks_confirmation_idx').on(table.confirmationActionId),
]);

export const shipmentDocumentCustodyFacts = pgTable('shipment_document_custody_facts', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  shipmentVersion: integer('shipment_version').notNull(),
  status: varchar('status', { length: 40 }).notNull(),
  note: text('note'),
  changedBy: integer('changed_by').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('shipment_document_custody_facts_shipment_idx')
    .on(table.shipmentId, table.changedAt),
]);

// Persistent record of accountant finance confirmations and charge-proposal
// billing-link decisions for a shipment. These rows were governance_actions
// entries before the maker-checker removal; they are real domain records
// (confirmation ids are referenced by accounting locks and custody), so they
// live in their own table instead of the dropped governance queue.
export const shipmentFinanceActions = pgTable('shipment_finance_actions', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  actionKind: varchar('action_kind', { length: 60 }).notNull(),
  shipmentVersion: integer('shipment_version').notNull(),
  status: varchar('status', { length: 40 }).notNull().default('APPROVED'),
  reason: text('reason'),
  beforeSnapshot: jsonb('before_snapshot').$type<Record<string, unknown> | null>(),
  afterSnapshot: jsonb('after_snapshot').$type<Record<string, unknown> | null>(),
  deltaSnapshot: jsonb('delta_snapshot').$type<Record<string, unknown> | null>(),
  makerId: integer('maker_id').notNull(),
  makerRole: varchar('maker_role', { length: 20 }).notNull(),
  checkerId: integer('checker_id'),
  checkerRole: varchar('checker_role', { length: 20 }),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  approverId: integer('approver_id'),
  approverRole: varchar('approver_role', { length: 20 }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  applicationResult: jsonb('application_result').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('shipment_finance_actions_shipment_kind_idx')
    .on(table.shipmentId, table.actionKind, table.status),
]);


// Immutable, versioned proof-of-delivery submissions. Generic trip photos do
// not satisfy these typed slots. Phase 4 owns driver submission; Phase 5 owns
// first-winner review and shipment aggregate closure.
export const tripPodSubmissions = pgTable('trip_pod_submissions', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  fulfillmentId: integer('fulfillment_id')
    .notNull(),
  submissionVersion: integer('submission_version').notNull(),
  sourceTripVersion: integer('source_trip_version').notNull(),
  status: tripPodStatusEnum('status').notNull().default('DRAFT'),
  supersedesSubmissionId: integer('supersedes_submission_id')
    ,
  submittedBy: integer('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_pod_submissions_trip_id_id_uniq_idx').on(table.tripId, table.id),
  uniqueIndex('trip_pod_submissions_trip_version_uniq_idx')
    .on(table.tripId, table.submissionVersion),
  uniqueIndex('trip_pod_submissions_supersedes_uniq_idx')
    .on(table.supersedesSubmissionId)
    .where(sql`${table.supersedesSubmissionId} is not null`),
  uniqueIndex('trip_pod_submissions_open_uniq_idx')
    .on(table.tripId)
    .where(sql`${table.status} in ('DRAFT', 'SUBMITTED')`),
  uniqueIndex('trip_pod_submissions_accepted_uniq_idx')
    .on(table.tripId)
    .where(sql`${table.status} = 'ACCEPTED'`),
  index('trip_pod_submissions_fulfillment_status_idx').on(table.fulfillmentId, table.status),
]);

export const tripPodFiles = pgTable('trip_pod_files', {
  id: serial('id').primaryKey(),
  submissionId: integer('submission_id')
    .notNull(),
  fileType: tripPodFileTypeEnum('file_type').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  originalFileName: varchar('original_file_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 120 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  uploadedBy: integer('uploaded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_pod_files_storage_key_uniq_idx').on(table.storageKey),
  uniqueIndex('trip_pod_files_required_slot_uniq_idx')
    .on(table.submissionId, table.fileType)
    .where(sql`${table.fileType} <> 'TOLL_TICKET'`),
  index('trip_pod_files_submission_idx').on(table.submissionId),
]);

export const userShipmentLinks = pgTable('user_shipment_links', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  shipmentId: integer('shipment_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_shipment_links_user_shipment_uniq_idx').on(table.userId, table.shipmentId),
  index('user_shipment_links_user_idx').on(table.userId),
  index('user_shipment_links_shipment_idx').on(table.shipmentId),
]);


// Versioned salesperson authority. A shipment-specific active assignment wins
// over the customer's active default; missing history remains unattributed.
export const salespersonAssignments = pgTable('salesperson_assignments', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  shipmentId: integer('shipment_id'),
  salespersonUserId: integer('salesperson_user_id').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  version: integer('version').notNull(),
  supersedesAssignmentId: integer('supersedes_assignment_id')
    ,
  changeReason: text('change_reason').notNull(),
  changedBy: integer('changed_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('salesperson_assignments_customer_default_active_uniq')
    .on(table.customerId)
    .where(sql`${table.shipmentId} is null and ${table.effectiveTo} is null`),
  uniqueIndex('salesperson_assignments_shipment_active_uniq')
    .on(table.shipmentId)
    .where(sql`${table.shipmentId} is not null and ${table.effectiveTo} is null`),
  uniqueIndex('salesperson_assignments_supersedes_uniq')
    .on(table.supersedesAssignmentId)
    .where(sql`${table.supersedesAssignmentId} is not null`),
  index('salesperson_assignments_lookup_idx').on(table.customerId, table.shipmentId, table.effectiveFrom),
]);

export const shipmentChangeRequests = pgTable('shipment_change_requests', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  sourceVersion: integer('source_version').notNull(),
  requestKind: shipmentChangeRequestKindEnum('request_kind').notNull(),
  requestedBy: integer('requested_by').notNull(),
  beforeSnapshot: jsonb('before_snapshot').notNull(),
  afterSnapshot: jsonb('after_snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('shipment_change_requests_shipment_version_uniq_idx')
    .on(table.shipmentId, table.sourceVersion),
  index('shipment_change_requests_shipment_created_idx').on(table.shipmentId, table.createdAt),
]);

// ─── Wave 2: CUS Core tables ────────────────────────────────────────────────
//
// Schema-only slice for Wave 2. The service/route/UI items are subsequent
// roadmap checkboxes. See phase-03 plan for full design.


// M3.3: shipment milestones. Each milestone tracks a point in the shipment
// lifecycle (booking, dispatch, transit, delivery, customs, pickup) derived
// from trip status changes or entered manually by CUS staff. Append-only.
export const shipmentMilestones = pgTable('shipment_milestones', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  type: milestoneTypeEnum('type').notNull(),
  note: text('note'),
  // Optional link to the trip that triggered this milestone (e.g. IN_TRANSIT
  // when the dispatched trip enters transit). NULL for manual milestones.
  tripId: integer('trip_id'),
  changedBy: integer('changed_by'),
  // Timestamp when the milestone occurred (not when it was recorded — the
  // operator may backdate to the actual event time).
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('shipment_milestones_shipment_idx').on(table.shipmentId, table.occurredAt),
  uniqueIndex('shipment_milestones_trip_type_uniq')
    .on(table.shipmentId, table.tripId, table.type)
    .where(sql`${table.tripId} is not null`),
]);


// Immutable, portal-safe customer communication content. Operational notes
// remain in shipment_milestones and are never serialized through this table.
export const customerVisibleEvents = pgTable('customer_visible_events', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  customerId: integer('customer_id').notNull(),
  milestoneId: integer('milestone_id'),
  eventKey: varchar('event_key', { length: 120 }).notNull(),
  contentVersion: integer('content_version').notNull(),
  eventType: varchar('event_type', { length: 40 }).notNull(),
  classification: varchar('classification', { length: 30 }).notNull().default('CUSTOMER_VISIBLE'),
  contentSnapshot: jsonb('content_snapshot').$type<{
    title: string;
    message: string;
    occurredAt: string;
    shipmentCode?: string;
  }>().notNull(),
  supersedesEventId: integer('supersedes_event_id')
    ,
  createdBy: integer('created_by').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('customer_visible_events_key_version_uniq').on(table.eventKey, table.contentVersion),
  uniqueIndex('customer_visible_events_supersedes_uniq')
    .on(table.supersedesEventId)
    .where(sql`${table.supersedesEventId} is not null`),
  index('customer_visible_events_shipment_idx').on(table.shipmentId, table.occurredAt),
  index('customer_visible_events_customer_idx').on(table.customerId, table.occurredAt),
]);

// Immutable driver-reported delivery record. This deliberately separates the
// driver claim from customer acceptance and accounting/POD readiness.
export const deliveryAttempts = pgTable('delivery_attempts', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  fulfillmentId: integer('fulfillment_id').notNull(),
  tripId: integer('trip_id').notNull(),
  shipmentContainerId: integer('shipment_container_id'),
  driverProgressEventId: integer('driver_progress_event_id').notNull(),
  customerVisibleEventId: integer('customer_visible_event_id'),
  result: deliveryAttemptResultEnum('result').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  recordedBy: integer('recorded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('delivery_attempts_driver_progress_event_uniq').on(table.driverProgressEventId),
  uniqueIndex('delivery_attempts_customer_visible_event_uniq').on(table.customerVisibleEventId).where(sql`${table.customerVisibleEventId} is not null`),
  index('delivery_attempts_shipment_idx').on(table.shipmentId, table.occurredAt),
  index('delivery_attempts_fulfillment_idx').on(table.fulfillmentId, table.occurredAt),
  index('delivery_attempts_trip_idx').on(table.tripId, table.occurredAt),
  index('delivery_attempts_container_idx').on(table.shipmentContainerId),
]);

export const customerDeliveryResponses = pgTable('customer_delivery_responses', {
  id: serial('id').primaryKey(),
  deliveryAttemptId: integer('delivery_attempt_id').notNull(),
  customerVisibleEventId: integer('customer_visible_event_id').notNull(),
  eventVersion: integer('event_version').notNull(),
  customerId: integer('customer_id').notNull(),
  decision: customerDeliveryDecisionEnum('decision').notNull(),
  reason: text('reason'),
  evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  respondedBy: integer('responded_by').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
  respondedAt: timestamp('responded_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('customer_delivery_responses_event_version_customer_uniq').on(table.customerVisibleEventId, table.eventVersion, table.customerId),
  uniqueIndex('customer_delivery_responses_idempotency_uniq').on(table.idempotencyKey),
  index('customer_delivery_responses_attempt_idx').on(table.deliveryAttemptId),
  index('customer_delivery_responses_customer_idx').on(table.customerId, table.respondedAt),
  index('customer_delivery_responses_responded_by_idx').on(table.respondedBy),
  check('customer_delivery_responses_dispute_reason_check', sql`${table.decision} <> 'DISPUTED' or (length(trim(${table.reason})) between 1 and 1000)`),
]);

export const customerEventAcknowledgements = pgTable('customer_event_acknowledgements', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id')
    .notNull(),
  eventVersion: integer('event_version').notNull(),
  customerId: integer('customer_id').notNull(),
  acknowledgedBy: integer('acknowledged_by').notNull(),
  kind: varchar('kind', { length: 20 }).notNull().default('ACKNOWLEDGED'),
  idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('customer_event_ack_actor_kind_uniq').on(table.eventId, table.acknowledgedBy, table.kind),
  uniqueIndex('customer_event_ack_idempotency_uniq').on(table.idempotencyKey),
  index('customer_event_ack_customer_idx').on(table.customerId, table.acknowledgedAt),
]);


// M3.3: customer email logs. Tracks every email sent to a customer (debit
// note sent, delivery confirmation, milestone notification). Used for retry
// via the Wave-0 scheduler and for audit of customer communication.
export const customerEmailLogs = pgTable('customer_email_logs', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  shipmentId: integer('shipment_id'),
  billingDocumentId: integer('billing_document_id'),
  customerVisibleEventId: integer('customer_visible_event_id'),
  // The email template / event type (e.g. 'DEBIT_NOTE_SENT', 'DELIVERY_CONFIRM').
  subject: varchar('subject', { length: 255 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 255 }),
  status: emailStatusEnum('status').default('PENDING'),
  // Error message from the email provider when status=FAILED.
  errorMessage: text('error_message'),
  // Provider message ID for tracking opens/clicks.
  providerMessageId: varchar('provider_message_id', { length: 255 }),
  // Retry count for the scheduler (0 = first attempt).
  retryCount: integer('retry_count').default(0).notNull(),
  sentBy: integer('sent_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('customer_email_logs_customer_idx').on(table.customerId, table.status),
  index('customer_email_logs_status_idx').on(table.status),
  index('customer_email_logs_visible_event_idx').on(table.customerVisibleEventId),
]);


export const dispatchHandoffs = pgTable('dispatch_handoffs', {
  id: serial('id').primaryKey(),
  version: integer('version').notNull().default(1),
  // The shipment being handed off.
  shipmentId: integer('shipment_id')
    .notNull(),
  // The dispatcher (user) assigned to handle this handoff.
  handlerId: integer('handler_id'),
  // M10-03 §1: priority level (e.g. 'NORMAL', 'URGENT'). Free-text for now;
  // can be enum-ified when the PRD confirms the levels.
  priority: varchar('priority', { length: 20 }).notNull().default('NORMAL'),
  // M10-03 §1: when the vehicle is needed (thời gian cần xe).
  vehicleNeededBy: timestamp('vehicle_needed_by'),
  // M10-03 §1: operational note (ghi chú vận hành).
  operationalNote: text('operational_note'),
  // Handoff status lifecycle.
  status: handoffStatusEnum('status').default('UNSEEN').notNull(),
  // Snapshot of shipment.version at handoff time — used by M10-03-03 to
  // detect if the shipment was edited after handoff (version conflict).
  handoffVersion: integer('handoff_version').notNull(),
  // Who created the handoff (the clerk).
  createdBy: integer('created_by'),
  // Timestamps for each lifecycle transition (for audit/tracking).
  dispatchedAt: timestamp('dispatched_at').defaultNow().notNull(),
  seenAt: timestamp('seen_at'),
  resolvedAt: timestamp('resolved_at'),
  acceptedBy: integer('accepted_by'),
  supersedesHandoffId: integer('supersedes_handoff_id')
    ,
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  // Free-text reason for REJECTED status.
  rejectReason: text('reject_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('dispatch_handoffs_shipment_idx').on(table.shipmentId),
  index('dispatch_handoffs_handler_idx').on(table.handlerId),
  index('dispatch_handoffs_status_idx').on(table.status),
  // One active handoff per shipment at a time (UNSEEN or SEEN). ACCEPTED/
  // REJECTED rows are historical; a new handoff can be created after one
  // is resolved.
  uniqueIndex('dispatch_handoffs_shipment_active_uniq')
    .on(table.shipmentId)
    .where(sql`${table.status} IN ('UNSEEN', 'SEEN')`),
  uniqueIndex('dispatch_handoffs_supersedes_uniq')
    .on(table.supersedesHandoffId)
    .where(sql`${table.supersedesHandoffId} is not null`),
]);
