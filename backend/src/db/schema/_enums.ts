// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import { applicationEnum } from './_shared';
// Enums
export const tripStatusEnum = applicationEnum(['CREATED', 'IN_TRANSIT', 'COMPLETED', 'CANCELED']);

export const fuelModeEnum = applicationEnum(['AUTO', 'FLAT_RATE']);

export const loadingTypeEnum = applicationEnum(['HANG', 'VO']);

export const roleEnum = applicationEnum(['ADMIN', 'MANAGER', 'ACCOUNTANT', 'DRIVER', 'OPS', 'CUSTOMER', 'CUS', 'DISPATCHER']);

export const customerAccountTypeEnum = applicationEnum(['SINGLE_ENTITY', 'CORPORATE_GROUP', 'AGENCY']);

export const txnTypeEnum = applicationEnum(['TRIP_REVENUE', 'PAYMENT_RECEIVED', 'PENALTY', 'MANAGEMENT_FEE', 'ADJUSTMENT', 'DRIVER_SALARY', 'VENDOR_EXPENSE', 'VENDOR_PAYMENT', 'OPS_ADVANCE', 'OPS_SETTLEMENT', 'EXTERNAL_CARRIER_COST', 'FUEL_EXPENSE', 'UNLOCK_REVERSAL', 'COMMISSION', 'DRIVER_PAYOUT', 'SERVICE_FEE']);

export const trailerTypeEnum = applicationEnum(['20FT', '40FT']);

// Dispatch classification of a fulfillment — an operational label only. It
// never infers trip pairing or `Đóng kết hợp`; historical rows stay null
// until an operator classifies them in a detailed-plan save.
export const dispatchClassificationEnum = applicationEnum(['SINGLE', 'DOUBLE', 'COMBINED', 'LCL']);

export const truckStatusEnum = applicationEnum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']);

export const driverStatusEnum = applicationEnum(['ACTIVE', 'INACTIVE']);

export const customerStatusEnum = applicationEnum(['ACTIVE', 'LOCKED']);

// 40f3ae15: DELIVERY_NOTE = biên bản giao hàng photo the driver attaches in
// the SỐ CONT & SEAL section (applicationEnum is a text column — additive
// value, no migration).
export const tripPhotoTypeEnum = applicationEnum(['CONTAINER', 'SEAL', 'OTHER', 'DELIVERY_NOTE']);

export const penaltyStatusEnum = applicationEnum(['ACTIVE', 'CANCELED']);

export const vehicleComponentEnum = applicationEnum(['TRUCK', 'TRAILER']);

export const trailerStatusEnum = applicationEnum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']);

// NOTE: forwarder_expense_type pgEnum removed — replaced by forwarder_expense_types config table.
// trip_expenses.expense_type is now varchar(50) referencing config codes.
export const advanceRequestStatusEnum = applicationEnum(['PENDING', 'APPROVED', 'REJECTED']);

export const advanceSettlementStatusEnum = applicationEnum(['PENDING', 'CHECKED_BY_ACCOUNTANT', 'APPROVED', 'REJECTED', 'REVERSED']);

export const creditOverrideStatusEnum = applicationEnum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELED']);

export const creditOverrideScopeEnum = applicationEnum(['SHIPMENT', 'EXPIRY']);

export const creditOverrideTierEnum = applicationEnum(['FINANCE_TIER_1', 'DIRECTOR']);

export const notificationTypeEnum = applicationEnum([
  'TRIP_CREATED', 'TRIP_DISPATCHED', 'TRIP_IN_TRANSIT', 'TRIP_COMPLETED',
  'TRIP_CANCELED', 'PAYMENT_RECEIVED', 'PENALTY_CREATED',
  'PENALTY_CANCELED', 'OVERDUE_PAYMENT', 'SALARY_PERIOD_CLOSING', 'SYSTEM_ANNOUNCEMENT',
  'ADVANCE_SETTLEMENT_APPROVED', 'SHIPMENT_HANDOFF',
]);

export const workDayStatusEnum = applicationEnum(['TRIP_DAY', 'STANDBY', 'PERSONAL_LEAVE', 'WEEKLY_OFF']);


// ─── Wave 1: Pricing & Fuel enums ───────────────────────────────────────────
// Direction of a lift (nâng/hạ) container movement at a port/yard.
export const liftDirectionEnum = applicationEnum(['LIFT_UP', 'LIFT_DOWN']);

// O2C B3: cargo state for the lift-pricing matrix. The customer's port-fee
// schedule (THÔNG TIN CẢNG BÃI) prices lifts differently for empty vs loaded
// containers (Container Rỗng vs Container Hàng).
export const loadStateEnum = applicationEnum(['LOADED', 'EMPTY']);

// Type of ancillary (non-transport) revenue. PRD M2.5 §1 proposes this set;
// additional types are application changes and require no database enum migration.
export const ancillaryRevenueTypeEnum = applicationEnum([
  'LCL', 'CONSOLIDATION', 'SERVICE_DIFF', 'OTHER',
]);

// How a trip's freight revenue was computed: TIER = weight-tier pricing,
// TABLE = fixed customer-route pricing, MANUAL = operator override.
export const pricingSourceEnum = applicationEnum(['TIER', 'TABLE', 'MANUAL']);


// ─── Wave 2: CUS enums ─────────────────────────────────────────────────────
// Debit-note lifecycle (M3.6). Extends the implicit 'DRAFT' default the
// existing billing_documents table already uses (no status column yet).
export const debitNoteStatusEnum = applicationEnum([
  'DRAFT', 'SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID',
  'PAID', 'REJECTED', 'CANCELED',
]);

// Milestone type for shipment tracking (M3.3). Derived from trip status +
// manual CUS notifications.
export const milestoneTypeEnum = applicationEnum([
  'BOOKING_RECEIVED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED',
  'CUSTOMS_CLEARED', 'PICKED_UP', 'MANUAL',
]);

// Email log status for the customer_email_logs table (M3.3).
export const emailStatusEnum = applicationEnum([
  'PENDING', 'SENT', 'FAILED', 'OPENED',
]);

export const fuelEvidenceOcrOutcomeEnum = applicationEnum([
  'ACCEPTED', 'UNREADABLE', 'MULTI_SCREEN', 'NON_PUMP', 'ANOMALY',
]);

export const fuelEvidenceReviewStatusEnum = applicationEnum([
  'PENDING', 'CONFIRMED', 'REJECTED',
]);


export const salaryConfirmationStatusEnum = applicationEnum(['DRAFT', 'CONFIRMED']);

// ─── Scheduler (Wave 0) ─────────────────────────────────────────────────────
// Run-log for the cron scheduler introduced in Wave 0. Every job tick acquires
// a Postgres advisory lock (so two backend instances can't double-run the same
// job at the same instant), writes a row at RUNNING, and updates it to SUCCESS
// or FAILED when the handler returns/throws. Wave 2 (email retries) and Wave 3
// (receivable reminders, salary-period close) register jobs against this table.
export const schedulerRunStatusEnum = applicationEnum(['RUNNING', 'SUCCESS', 'FAILED']);

// ─── Shipments (Wave 0) ─────────────────────────────────────────────────────
// First-class `shipments` (lô hàng) entity. A shipment owns booking docs,
// containers, and declarations, and *precedes and outlives* any single trip:
// booking → documents → dispatch → delivery → debit-note. A trip becomes a
// fulfillment of (part of) a shipment via `trips.shipmentId` (added above).
// This is the keystone for M3 (CUS), M4 (debit-note from approved expenses),
// M5.6 (payment allocation), M9/M10 (forwarder/clerk mobile).
//
// Scope of this Wave 0 schema slice: tables + FK + migration only. The
// service, router, RBAC, and frontend are subsequent Wave 0 checkboxes.
// NOTE: the DB text column may still HOLD the retired 'PENDING_EXPENSE_APPROVAL'
// value in historical rows (Postgres cannot DROP VALUE from an enum-style text
// column without a table rewrite). The app never writes it (retired 2026-09-05,
// removed from the vocabulary 2026-09-06; prod had 0 rows) — treat it as a ghost.
export const shipmentStatusEnum = applicationEnum([
  'NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT',
  'COMPLETED', 'CANCELED',
]);

export const shipmentDocumentTypeEnum = applicationEnum([
  'BOOKING', 'BL', 'DO', 'DECLARATION', 'OTHER',
]);


// Customs declaration scope: SINGLE = one declaration per container; SHARED =
// one declaration covers multiple containers (issued on approval). M3.1 §3.
export const shipmentDeclarationScopeEnum = applicationEnum([
  'SINGLE', 'SHARED',
]);

export const shipmentTradeDirectionEnum = applicationEnum([
  'IMPORT', 'EXPORT',
]);

export const shipmentCargoModeEnum = applicationEnum([
  'FCL', 'LCL',
]);
/** Typed cargo-mode literal — prefer over raw 'FCL'/'LCL' strings (single source). */

export type CargoMode = (typeof shipmentCargoModeEnum.enumValues)[number];

export const CARGO_MODE = { FCL: 'FCL', LCL: 'LCL' } as const satisfies Record<string, CargoMode>;

export const shipmentChangeRequestKindEnum = applicationEnum([
  'PLAN_UPDATE',
  'CONTAINER_RECONCILE',
]);

export const operationalSiteTypeEnum = applicationEnum([
  'FACTORY', 'WAREHOUSE',
]);

export const masterImportStatusEnum = applicationEnum([
  'ANALYZED', 'APPLIED', 'REJECTED',
]);

export const masterImportRowClassificationEnum = applicationEnum([
  'ACCEPTED', 'BLOCKED', 'TEMPLATE', 'EXAMPLE',
]);

export const shipmentFulfillmentTypeEnum = applicationEnum([
  'FCL_CONTAINER', 'LCL_SHIPMENT',
]);

export const fulfillmentCancellationDispositionEnum = applicationEnum([
  'REPLACED', 'NOT_REQUIRED',
]);

export const tripPodStatusEnum = applicationEnum([
  'DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED',
]);

export const tripPodFileTypeEnum = applicationEnum([
  'YARD_OR_DROP_RECEIPT', 'SIGNED_DELIVERY_NOTE', 'TOLL_TICKET',
]);


export const deliveryAttemptResultEnum = applicationEnum(['DELIVERED', 'PARTIAL', 'FAILED']);

export const customerDeliveryDecisionEnum = applicationEnum(['CONFIRMED', 'DISPUTED']);


// Wave 4: dispatch handoffs. When a clerk creates/qualifies a shipment,
// they hand it off to a dispatcher (điều vận). This table tracks the
// handoff lifecycle: UNSEEN → SEEN → ACCEPTED (or REJECTED), with the
// handler, priority, vehicle-needed-by time, operational note, and the
// shipment version at handoff time (for conflict detection — M10-03-03:
// "Nếu dữ liệu bị sửa trong lúc điều vận đang xem, phải cảnh báo có
// phiên bản mới").
export const handoffStatusEnum = applicationEnum([
  'UNSEEN',   // dispatched to dispatcher, not yet opened
  'SEEN',     // dispatcher opened the handoff
  'ACCEPTED', // dispatcher took ownership
  'REJECTED', // dispatcher declined (with reason)
]);

// M8.4 — driver progress events. Append-only log of driver-reported
// milestones (DEPARTED, ARRIVED, FUELED, INCIDENT, NOTE) against a trip.
// This is the foundation for the M8.4 driver mobile progress update: a
// driver records what actually happened on the road, with a client-supplied
// event time (`occurredAt` — may be backdated) and an optional note. The
// create endpoint is server-side idempotent (reuses `idempotency_keys` from
// M10.1) so the offline-queue replay (slice 2) doesn't duplicate events
// (PRD M08-04-03).
//
// These events are audit-style records only — they do NOT mutate trip
// status. Lifecycle transitions stay with `transitionTripStatus`.
export const driverProgressEventTypeEnum = applicationEnum([
  'ORDER_RECEIVED', 'DEPARTED', 'ARRIVED', 'FUELED', 'INCIDENT', 'NOTE',
  'PICKED_UP', 'LOADING_OR_RETURNING', 'DELIVERED',
]);

// M8.4 slice 3 — driver incidental costs. Driver-reported out-of-pocket
// expenses (per-diem, lift fee, parking, toll, fuel, other) against a trip.
// Distinct from `tripExpenses` (forwarder-scoped, buy/sell, supplier,
// approval workflow) — this is a lightweight driver-only record that feeds
// salary/settlement reconciliation. Idempotent create (reuses
// `idempotency_keys`) so the offline-queue replay doesn't duplicate.
//
// COMPLETED trips reject new incidental costs — unlike progress events (which
// are append-only audit logs), costs affect financials, so completion = immutable.
export const driverIncidentalCostTypeEnum = applicationEnum([
  // 27.8 spec additions:
  'PER_DIEM', 'LIFT_FEE', 'DROP_FEE', 'WAREHOUSE_FEE',
  'LIFT_DROP_LACH_HUYEN', 'ROAD_ALLOWANCE',
  'PARKING', 'TOLL', 'FUEL',
  'CONTAINER_WASH', 'CONTAINER_WELD', 'TIRE_WEIGH',
  'OTHER',
]);

