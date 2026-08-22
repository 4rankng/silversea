// Shipment lifecycle — core mutations extracted from shipment.service.ts
// (maintainability round 3): create/quick-create, update, status transitions,
// completion recompute, accountant direct close, fulfillment cancellation,
// and soft delete. Conventions carried over from the original module header:
// Vietnamese user-facing messages, optimistic-lock conflicts as 409 with a
// clear message, legal-edge-only status transitions (same-status idempotent),
// and transaction-scoped writes (callers may pass an outer tx).

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import {
  canonicalShipmentStatus,
  Role,
  TripStatus,
  TripPodStatus,
} from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import type { UpdateShipmentInput, ShipmentStatus } from './shipment-types';
import { normalizeShipmentRow } from './shipment-queries.service';
import {
  assertClerkCanAccessShipment,
  assertClerkCanCreateForCustomer,
  isClerkScopedUser,
  loadClerkShipmentScope,
  resolveClerkResponsibleUnitId,
} from './clerk-shipment-scope.service';
import {
  classifyClerkShipmentPatch,
  createShipmentChangeRequest,
} from './shipment-edit-boundary.service';
import { isFulfillmentRequired } from './shipment-fulfillment.service';
import { transitionTripStatus } from './trip-status-machine.service';
import {
  assertActorCanAccessShipment,
  createCustomerVisibleEvent,
} from './shipment-coordination.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import {
  assertDispatcherCanMutateShipmentIntake,
  ensureReadyShipmentHandoff,
  hasDispatchDate,
  isDirectlyEditableIntakeStatus,
} from './shipment-intake.service';
import { getShipment } from './shipment-detail-reads.service';
import {
  assertShipmentDirectCloseTripReadiness,
  hasCompletedExpenseScopes,
  loadTripExpenseScopeState,
  syncShipmentAuthorityToTrips,
  toNullableFixedDecimal,
  toNullableTimestamp,
} from './shipment-shared.service';
import type { ShipmentAuthorityTripRow } from './shipment-shared.service';

// ─── Status machine ─────────────────────────────────────────────────────────
//
// Mirrors the lifecycle implied by the `shipment_status` enum + phase-01
// "booking → documents → dispatch → delivery → debit-note":
//
//   PENDING_DATE ──► READY_FOR_DISPATCH ──► DISPATCHED ──► IN_TRANSIT
//                                                    ──► PENDING_EXPENSE_APPROVAL
//                                                    ──► COMPLETED
//                            ▲                    │
//                            └────────────────────┘
//                                               └──► CANCELED
//
// Operational regressions are allowed before COMPLETED when the underlying
// dispatch/evidence state changes (for example a rejected e-POD moves a
// shipment back out of pending approval). COMPLETED and CANCELED remain
// terminal.
const LEGAL_TRANSITIONS: Record<string, readonly string[]> = {
  NEW: ['READY_FOR_DISPATCH', 'CANCELED'],
  PENDING_DATE: ['READY_FOR_DISPATCH', 'CANCELED'],
  READY_FOR_DISPATCH: ['DISPATCHED', 'CANCELED'],
  DISPATCHED: ['IN_TRANSIT', 'CANCELED'],
  IN_TRANSIT: ['DISPATCHED', 'PENDING_EXPENSE_APPROVAL', 'CANCELED'],
  PENDING_EXPENSE_APPROVAL: ['DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
};

const CUSTOMER_VISIBLE_SHIPMENT_STATUS_COPY: Partial<Record<ShipmentStatus, {
  title: string;
  message: string;
}>> = {
  IN_TRANSIT: {
    title: 'Đang vận chuyển',
    message: 'Lô hàng đang được vận chuyển.',
  },
  COMPLETED: {
    title: 'Đã giao hàng',
    message: 'Lô hàng đã được giao.',
  },
};

function assertShipmentDocumentReferences(input: {
  blNumber?: string | null;
  bookingRef?: string | null;
  tradeDirection?: 'IMPORT' | 'EXPORT' | null;
}) {
  const hasBill = Boolean(input.blNumber?.trim());
  const hasBooking = Boolean(input.bookingRef?.trim());
  if (hasBill && hasBooking) {
    throw new ApiError(400, 'Một lô hàng chỉ có Số Bill (hàng Nhập) hoặc Số Booking (hàng Xuất).');
  }
  if (input.tradeDirection === 'IMPORT' && hasBooking) {
    throw new ApiError(400, 'Hàng Nhập dùng Số Bill, không dùng Số Booking.');
  }
  if (input.tradeDirection === 'EXPORT' && hasBill) {
    throw new ApiError(400, 'Hàng Xuất dùng Số Booking, không dùng Số Bill.');
  }
}

/**
 * Blank strings pass the trim-aware assertions above but violate the
 * direction CHECK on the shipments table (which is NULL-aware only), so an
 * untrimmed client payload would surface as a Postgres 23514 → 500 instead
 * of a clean store-as-null. Collapse whitespace-only refs to null at the
 * write boundary.
 */
function normalizeDocumentReference(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

export interface CreateShipmentInput {
  customerId: number;
  routeId?: number | null;
  cargoTypeId?: number | null;
  responsibleUnitId?: number | null;
  bookingRef?: string | null;
  blNumber?: string | null;
  tradeDirection?: typeof s.shipmentTradeDirectionEnum.enumValues[number] | null;
  cargoMode?: typeof s.shipmentCargoModeEnum.enumValues[number] | null;
  operationalSiteId?: number | null;
  pickupWarehouseSiteId?: number | null;
  factoryName?: string | null;
  isCombined?: boolean;
  shippingLineName?: string | null;
  expectedDeliveryDate?: string | null;
  customsCutoffAt?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  cargoWeightKg?: string | number | null;
  cargoVolumeCbm?: string | number | null;
  packageCount?: number | null;
  packageType?: string | null;
  operationalNotes?: string | null;
  customerNotes?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  createdBy?: number | null;
}

/** Dispatch master-plan: how much of the container demand has a planned carrier. */
export type ShipmentUpdateResult = typeof s.shipments.$inferSelect & {
  changeMode: 'DIRECT' | 'REQUESTED' | 'NOOP';
  changeRequestId: number | null;
  message?: string;
  notificationDelivered?: boolean;
};

type ShipmentFulfillmentRow = typeof s.shipmentFulfillments.$inferSelect;

type ShipmentCloseAuthorityContext = {
  fulfillmentRows: ShipmentFulfillmentRow[];
  requiredFulfillments: ShipmentFulfillmentRow[];
};

/**
 * Generate a stable, unique shipment code. Format: `SHP-<YYMM>-<NNNNN>` where
 * NNNNN is the shipment row id, zero-padded. PK-backed so it is unique by
 * construction and free of races (no separate counter table needed).
 *
 * Material assumption: the PRD-proposed format is
 * `{customerCode}-{YYMMDD}-{NNN}` (M3.1 §5, still open). Customers have no
 * `code` column yet, so the customer-code prefix is impossible without a
 * schema change outside this task's scope. `SHP-<YYMM>-<NNNNN>` is a stable
 * placeholder that is unique, sortable, and easy to re-format later (the
 * `shipments.shipmentCode` column is unique but not the source of truth for
 * business identity).
 */
export function formatShipmentCode(id: number, createdAt: Date = new Date()): string {
  const yy = String(createdAt.getFullYear()).slice(-2);
  const mm = String(createdAt.getMonth() + 1).padStart(2, '0');
  return `SHP-${yy}${mm}-${String(id).padStart(5, '0')}`;
}

async function loadShipmentCloseAuthorityContext(tx: Tx, shipmentId: number): Promise<ShipmentCloseAuthorityContext> {
  const fulfillmentRows = await tx.select().from(s.shipmentFulfillments)
    .where(eq(s.shipmentFulfillments.shipmentId, shipmentId))
    .orderBy(asc(s.shipmentFulfillments.id))
    .for('update');
  const fulfillmentById = new Map(fulfillmentRows.map((row) => [row.id, row]));
  const requiredFulfillments = fulfillmentRows.filter((row) => isFulfillmentRequired(
    row,
    row.replacementFulfillmentId != null
      ? fulfillmentById.get(row.replacementFulfillmentId) ?? null
      : null,
  ));
  return { fulfillmentRows, requiredFulfillments };
}

async function listRequiredShipmentAuthorityTrips(
  tx: Tx,
  requiredFulfillmentIds: number[],
): Promise<ShipmentAuthorityTripRow[]> {
  if (requiredFulfillmentIds.length === 0) {
    return [];
  }

  return tx.select({
    id: s.trips.id,
    fulfillmentId: s.trips.fulfillmentId,
    version: s.trips.version,
    shipmentId: s.trips.shipmentId,
    customerId: s.trips.customerId,
    routeId: s.trips.routeId,
    cargoTypeId: s.trips.cargoTypeId,
    departureDate: s.trips.departureDate,
    containerCount: s.trips.containerCount,
    vatRate: s.trips.vatRate,
    status: s.trips.status,
    pricingSource: s.trips.pricingSource,
    pricingFormula: s.trips.pricingFormula,
    pricingSnapshot: s.trips.pricingSnapshot,
    revenue: s.trips.revenue,
    revenueOriginal: s.trips.revenueOriginal,
    revenueEmptyReturn: s.trips.revenueEmptyReturn,
    podRecoveredAt: s.trips.podRecoveredAt,
  })
    .from(s.trips)
    .where(and(
      inArray(s.trips.fulfillmentId, requiredFulfillmentIds),
      sql`${s.trips.status} <> 'CANCELED'`,
      isNull(s.trips.deletedAt),
    ))
    .orderBy(asc(s.trips.id))
    .for('update');
}

function assertLegalTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (from === to) return; // Idempotent — transitionShipmentStatus handles same-status no-op before calling.
  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ApiError(
      409,
      `Không thể chuyển lô hàng từ "${from}" sang "${to}".`,
    );
  }
}

async function createShipmentStatusCustomerVisibleEvent(
  tx: Tx,
  shipmentId: number,
  statusHistoryId: number,
  targetStatus: ShipmentStatus,
  createdBy: number,
  occurredAt: Date,
): Promise<void> {
  const copy = CUSTOMER_VISIBLE_SHIPMENT_STATUS_COPY[targetStatus];
  if (!copy) return;

  await createCustomerVisibleEvent({
    shipmentId,
    eventKey: `shipment:${shipmentId}:status-history:${statusHistoryId}`,
    eventType: 'MILESTONE',
    title: copy.title,
    message: copy.message,
    occurredAt,
    createdBy,
  }, undefined, tx);
}

// ─── Create ─────────────────────────────────────────────────────────────────

async function createShipmentTx(tx: Tx, input: CreateShipmentInput, actor?: AuthUser) {
  assertShipmentDocumentReferences(input);
  if (input.operationalSiteId != null) {
    await assertShipmentFactorySiteValid(tx, input.customerId, input.operationalSiteId);
  }
  let responsibleUnitId = input.responsibleUnitId ?? null;
  if (actor && isClerkScopedUser(actor)) {
    const scope = await loadClerkShipmentScope(actor.userId, tx);
    assertClerkCanCreateForCustomer(scope, input.customerId);
    responsibleUnitId = resolveClerkResponsibleUnitId(scope, input.responsibleUnitId);
  }

  const closingAt = toNullableTimestamp(input.closingAt, 'Giờ closing');
  const plannedReturnAt = toNullableTimestamp(input.plannedReturnAt, 'Ngày trả rỗng kế hoạch');
  // Legacy API callers can still create a dated FCL root before its container
  // rows are supplied. As soon as a container write occurs, reconciliation
  // replaces this compatibility value with the earliest container appointment.
  const initialStatus: ShipmentStatus = input.expectedDeliveryDate != null || closingAt != null || plannedReturnAt != null
    ? 'READY_FOR_DISPATCH'
    : 'PENDING_DATE';

  // 1. Insert the shipment row with date-derived readiness.
  const [shipment] = await tx.insert(s.shipments).values({
    customerId: input.customerId,
    routeId: input.routeId ?? null,
    cargoTypeId: input.cargoTypeId ?? null,
    responsibleUnitId,
    bookingRef: normalizeDocumentReference(input.bookingRef),
    blNumber: normalizeDocumentReference(input.blNumber),
    tradeDirection: input.tradeDirection ?? null,
    cargoMode: input.cargoMode ?? null,
    operationalSiteId: input.operationalSiteId ?? null,
    pickupWarehouseSiteId: input.pickupWarehouseSiteId ?? null,
    factoryName: input.factoryName ?? null,
    isCombined: input.isCombined ?? false,
    shippingLineName: input.shippingLineName ?? null,
    expectedDeliveryDate: input.expectedDeliveryDate ?? null,
    customsCutoffAt: toNullableTimestamp(input.customsCutoffAt, 'Hạn hải quan'),
    closingAt,
    plannedReturnAt,
    cargoWeightKg: toNullableFixedDecimal(input.cargoWeightKg, 8, 2, 'Trọng lượng'),
    cargoVolumeCbm: toNullableFixedDecimal(input.cargoVolumeCbm, 7, 3, 'Thể tích'),
    packageCount: input.packageCount ?? null,
    packageType: input.packageType ?? null,
    operationalNotes: input.operationalNotes ?? null,
    customerNotes: input.customerNotes ?? null,
    pickupLocation: input.pickupLocation ?? null,
    deliveryLocation: input.deliveryLocation ?? null,
    contactName: input.contactName ?? null,
    contactPhone: input.contactPhone ?? null,
    createdBy: input.createdBy ?? null,
    updatedBy: input.createdBy ?? null,
    status: initialStatus,
    version: 1,
  }).returning();

  // 2. Backfill the unique shipmentCode from the row id. Same tx ⇒ atomic.
  const shipmentCode = formatShipmentCode(shipment.id, shipment.createdAt);
  const [finalized] = await tx.update(s.shipments)
    .set({ shipmentCode })
    .where(eq(s.shipments.id, shipment.id))
    .returning();

  // 3. Append the initial status-history row (fromStatus = null = creation).
  await tx.insert(s.shipmentStatusHistory).values({
    shipmentId: shipment.id,
    fromStatus: null,
    toStatus: initialStatus,
    reason: 'Tạo lô hàng',
    changedBy: input.createdBy ?? null,
  });

  const bookingEventCreatorId = input.createdBy ?? actor?.userId ?? null;
  if (bookingEventCreatorId != null) {
    await createCustomerVisibleEvent({
      shipmentId: shipment.id,
      eventKey: `shipment:${shipment.id}:booking-received`,
      eventType: 'MILESTONE',
      title: 'Đã tiếp nhận booking',
      message: 'Thông tin booking của lô hàng đã được tiếp nhận.',
      occurredAt: shipment.createdAt,
      createdBy: bookingEventCreatorId,
    }, undefined, tx);
  }

  if (initialStatus === 'READY_FOR_DISPATCH') {
    await ensureReadyShipmentHandoff(tx, finalized, input.createdBy ?? actor?.userId ?? null);
  }

  return finalized;
}

export async function createShipment(input: CreateShipmentInput, actor?: AuthUser, transaction?: Tx) {
  return transaction
    ? createShipmentTx(transaction, input, actor)
    : db.transaction((tx) => createShipmentTx(tx, input, actor));
}

// ─── Quick create (M10.1) ───────────────────────────────────────────────────
//
// Clerk-facing mobile entry point. Wraps `createShipment` with server-side
// idempotency so a flaky-network resubmit (same `Idempotency-Key`) returns
// the original shipment instead of creating a duplicate (PRD M10-01-03,
// Q23 proposal). The minimum data set is just `customerId` (the only
// NOT NULL column on `shipments`); every other field is optional and
// typically filled in later from the M10.2 doc-entry page.
export async function createShipmentIdempotent(
  input: CreateShipmentInput,
  idempotencyKey: string | undefined,
  actor?: AuthUser,
): Promise<{ shipment: Awaited<ReturnType<typeof createShipment>>; replayed: boolean }> {
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_QUICK_CREATE,
    idempotencyKey,
    payload: input,
    createdBy: input.createdBy ?? null,
    entityType: 'shipment',
    create: async (tx) => createShipmentTx(tx, input, actor),
    load: async (id, tx) => getShipment(id, tx),
  });
  return { shipment: result, replayed };
}

export async function assertShipmentFactorySiteValid(
  tx: Tx,
  customerId: number,
  operationalSiteId: number,
): Promise<void> {
  const [factory] = await tx.select({ id: s.operationalSites.id })
    .from(s.operationalSites)
    .where(and(
      eq(s.operationalSites.id, operationalSiteId),
      eq(s.operationalSites.customerId, customerId),
      eq(s.operationalSites.siteType, 'FACTORY'),
      eq(s.operationalSites.isActive, true),
      isNull(s.operationalSites.deletedAt),
    )).limit(1);
  if (!factory) throw new ApiError(409, 'Nhà máy không còn hiệu lực hoặc không thuộc khách hàng của lô hàng.');
}

export async function updateShipment(
  id: number,
  input: UpdateShipmentInput,
  actor?: AuthUser,
  transaction?: Tx,
): Promise<ShipmentUpdateResult> {
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, id), isNull(s.shipments.deletedAt)))
      .for('update') // pessimistic row lock so the version bump is race-free
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');
    assertDispatcherCanMutateShipmentIntake(actor, existing.status);
    await assertShipmentAccountingUnlocked(tx, id);
    // Shipment-level factory mirror (SILVER L1 P2): same customer-scope +
    // FACTORY-type validation the container choke point enforces. The
    // resolved customer respects an in-flight customerId change.
    if (input.operationalSiteId != null) {
      await assertShipmentFactorySiteValid(tx, input.customerId ?? existing.customerId, input.operationalSiteId);
    }

    let clerkScope = null;
    if (actor && isClerkScopedUser(actor)) {
      clerkScope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(clerkScope, existing);
      if (input.customerId !== undefined) {
        assertClerkCanCreateForCustomer(clerkScope, input.customerId);
      }
      if (input.responsibleUnitId != null) {
        resolveClerkResponsibleUnitId(clerkScope, input.responsibleUnitId);
      }
    }

    const expectedVersion = input.expectedVersion ?? input.version;
    if (expectedVersion == null || existing.version !== expectedVersion) {
      throw new ApiError(
        409,
        'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.',
      );
    }

    assertShipmentDocumentReferences({
      blNumber: input.blNumber !== undefined ? input.blNumber : existing.blNumber,
      bookingRef: input.bookingRef !== undefined ? input.bookingRef : existing.bookingRef,
      tradeDirection: input.tradeDirection !== undefined ? input.tradeDirection : existing.tradeDirection,
    });

    if (existing.cargoMode === CARGO_MODE.FCL && input.cargoMode === CARGO_MODE.LCL) {
      const fulfillmentRows = await tx.select({
        id: s.shipmentFulfillments.id,
      }).from(s.shipmentFulfillments)
        .where(eq(s.shipmentFulfillments.shipmentId, id))
        .for('update');
      if (fulfillmentRows.length > 0) {
        throw new ApiError(
          409,
          'Không thể chuyển lô hàng từ FCL sang LCL sau khi đã phát sinh tác vụ điều phối.',
        );
      }
      await tx.delete(s.shipmentContainers)
        .where(eq(s.shipmentContainers.shipmentId, id));
    }

    const planClassification = classifyClerkShipmentPatch(existing, {
      customerId: input.customerId,
      routeId: input.routeId,
      cargoTypeId: input.cargoTypeId,
      responsibleUnitId: input.responsibleUnitId,
      bookingRef: input.bookingRef,
      blNumber: input.blNumber,
      tradeDirection: input.tradeDirection,
      cargoMode: input.cargoMode,
      operationalSiteId: input.operationalSiteId,
      pickupWarehouseSiteId: input.pickupWarehouseSiteId,
      factoryName: input.factoryName,
      shippingLineName: input.shippingLineName,
      expectedDeliveryDate: input.expectedDeliveryDate,
      customsCutoffAt: input.customsCutoffAt,
      closingAt: input.closingAt,
      plannedReturnAt: input.plannedReturnAt,
      cargoWeightKg: input.cargoWeightKg,
      cargoVolumeCbm: input.cargoVolumeCbm,
      packageCount: input.packageCount,
      packageType: input.packageType,
      operationalNotes: input.operationalNotes,
      customerNotes: input.customerNotes,
      pickupLocation: input.pickupLocation,
      deliveryLocation: input.deliveryLocation,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
    });
    const shipmentAuthorityChanged = planClassification.changedFields.some(
      (field) => field === 'customerId' || field === 'cargoTypeId',
    );

    if (shipmentAuthorityChanged && !isDirectlyEditableIntakeStatus(existing.status)) {
      const requesterId = actor?.userId ?? input.updatedBy ?? existing.updatedBy ?? existing.createdBy;
      if (requesterId == null) {
        throw new ApiError(400, 'Thiếu người gửi yêu cầu thay đổi lô hàng.');
      }
      const changeRequestId = await createShipmentChangeRequest(tx, {
        shipment: existing,
        sourceVersion: existing.version,
        requestKind: 'PLAN_UPDATE',
        requestedBy: requesterId,
        beforeSnapshot: planClassification.beforeSnapshot,
        afterSnapshot: planClassification.afterSnapshot,
      });
      return {
        ...existing,
        changeMode: 'REQUESTED' as const,
        changeRequestId,
        notificationDelivered: false,
        message: 'Đã ghi nhận yêu cầu thay đổi kế hoạch.',
      };
    }

    if (actor && isClerkScopedUser(actor)) {
      if (planClassification.mode === 'NOOP') {
        return {
          ...existing,
          changeMode: 'NOOP' as const,
          changeRequestId: null,
          notificationDelivered: true,
        };
      }

      if (planClassification.mode === 'REQUESTED') {
        const changeRequestId = await createShipmentChangeRequest(tx, {
          shipment: existing,
          sourceVersion: existing.version,
          requestKind: 'PLAN_UPDATE',
          requestedBy: actor.userId,
          beforeSnapshot: planClassification.beforeSnapshot,
          afterSnapshot: planClassification.afterSnapshot,
        });
        return {
          ...existing,
          changeMode: 'REQUESTED' as const,
          changeRequestId,
          notificationDelivered: false,
          message: 'Đã ghi nhận yêu cầu thay đổi kế hoạch.',
        };
      }
    }

    const nextExpectedDeliveryDate = input.expectedDeliveryDate !== undefined
      ? input.expectedDeliveryDate
      : existing.expectedDeliveryDate;
    const nextClosingAt = input.closingAt !== undefined
      ? toNullableTimestamp(input.closingAt, 'Giờ closing')
      : existing.closingAt;
    const nextPlannedReturnAt = input.plannedReturnAt !== undefined
      ? toNullableTimestamp(input.plannedReturnAt, 'Ngày trả rỗng kế hoạch')
      : existing.plannedReturnAt;
    const currentCanonicalStatus = canonicalShipmentStatus(existing.status);
    if (currentCanonicalStatus === 'READY_FOR_DISPATCH' && !hasDispatchDate({
      expectedDeliveryDate: nextExpectedDeliveryDate,
      closingAt: nextClosingAt,
      plannedReturnAt: nextPlannedReturnAt,
    })) {
      throw new ApiError(409, 'Lô hàng đã sẵn sàng điều xe nên phải giữ ngày vận chuyển, giờ đóng hoặc thời gian trả hàng.');
    }
    const becomesReady = currentCanonicalStatus === 'PENDING_DATE'
      && hasDispatchDate({
        expectedDeliveryDate: nextExpectedDeliveryDate,
        closingAt: nextClosingAt,
        plannedReturnAt: nextPlannedReturnAt,
      });
    const nextVersion = existing.version + 1;
    const [updated] = await tx.update(s.shipments).set({
      version: nextVersion,
      ...(input.customerId != null ? { customerId: input.customerId } : {}),
      ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
      ...(input.cargoTypeId !== undefined ? { cargoTypeId: input.cargoTypeId } : {}),
      ...(input.responsibleUnitId !== undefined ? { responsibleUnitId: input.responsibleUnitId } : {}),
      ...(input.bookingRef !== undefined ? { bookingRef: normalizeDocumentReference(input.bookingRef) } : {}),
      ...(input.blNumber !== undefined ? { blNumber: normalizeDocumentReference(input.blNumber) } : {}),
      ...(input.tradeDirection !== undefined ? { tradeDirection: input.tradeDirection } : {}),
      ...(input.cargoMode !== undefined ? { cargoMode: input.cargoMode } : {}),
      ...(input.operationalSiteId !== undefined ? { operationalSiteId: input.operationalSiteId } : {}),
      ...(input.pickupWarehouseSiteId !== undefined ? { pickupWarehouseSiteId: input.pickupWarehouseSiteId } : {}),
      ...(input.factoryName !== undefined ? { factoryName: input.factoryName } : {}),
      ...(input.isCombined !== undefined ? { isCombined: input.isCombined } : {}),
      ...(input.shippingLineName !== undefined ? { shippingLineName: input.shippingLineName } : {}),
      ...(input.expectedDeliveryDate !== undefined
        ? { expectedDeliveryDate: input.expectedDeliveryDate }
        : {}),
      ...(input.customsCutoffAt !== undefined ? { customsCutoffAt: toNullableTimestamp(input.customsCutoffAt, 'Hạn hải quan') } : {}),
      ...(input.closingAt !== undefined ? { closingAt: nextClosingAt } : {}),
      ...(input.plannedReturnAt !== undefined ? { plannedReturnAt: nextPlannedReturnAt } : {}),
      ...(becomesReady ? { status: 'READY_FOR_DISPATCH' as const } : {}),
      ...(input.cargoWeightKg !== undefined ? { cargoWeightKg: toNullableFixedDecimal(input.cargoWeightKg, 8, 2, 'Trọng lượng') } : {}),
      ...(input.cargoVolumeCbm !== undefined ? { cargoVolumeCbm: toNullableFixedDecimal(input.cargoVolumeCbm, 7, 3, 'Thể tích') } : {}),
      ...(input.packageCount !== undefined ? { packageCount: input.packageCount } : {}),
      ...(input.packageType !== undefined ? { packageType: input.packageType } : {}),
      ...(input.operationalNotes !== undefined ? { operationalNotes: input.operationalNotes } : {}),
      ...(input.customerNotes !== undefined ? { customerNotes: input.customerNotes } : {}),
      ...(input.pickupLocation !== undefined
        ? { pickupLocation: input.pickupLocation }
        : {}),
      ...(input.deliveryLocation !== undefined
        ? { deliveryLocation: input.deliveryLocation }
        : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
      updatedBy: input.updatedBy ?? null,
      updatedAt: new Date(),
    }).where(eq(s.shipments.id, id)).returning();

    if (becomesReady) {
      await tx.insert(s.shipmentStatusHistory).values({
        shipmentId: id,
        fromStatus: existing.status ?? 'PENDING_DATE',
        toStatus: 'READY_FOR_DISPATCH',
        reason: 'Đã bổ sung ngày vận chuyển, giờ đóng hoặc thời gian trả hàng và sẵn sàng điều xe.',
        changedBy: input.updatedBy ?? actor?.userId ?? null,
      });
      await ensureReadyShipmentHandoff(tx, updated, input.updatedBy ?? actor?.userId ?? null);
    }
    if (shipmentAuthorityChanged && isDirectlyEditableIntakeStatus(updated.status)) {
      await syncShipmentAuthorityToTrips(tx, updated);
    }

    return {
      ...updated,
      changeMode: 'DIRECT' as const,
      changeRequestId: null,
      notificationDelivered: true,
    };
  };
  const result = await runInTx(transaction, execute);
  if (result.changeMode === 'REQUESTED') {
    return {
      ...result,
      notificationDelivered: true,
      message: 'Đã ghi nhận yêu cầu thay đổi kế hoạch và thông báo điều vận.',
    };
  }
  return result;
}

// ─── Status transitions ─────────────────────────────────────────────────────

export async function transitionShipmentStatus(
  shipmentId: number,
  targetStatus: ShipmentStatus,
  options: { reason?: string | null; changedBy?: number | null } = {},
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);

    const currentStatus = canonicalShipmentStatus(shipment.status);
    if (!currentStatus) {
      throw new ApiError(409, 'Trạng thái lô hàng không hợp lệ.');
    }

    // Idempotent: same target → no-op, return current row without writing a
    // duplicate history row (mirrors trip-status-machine's short-circuit).
    if (currentStatus === targetStatus) return shipment;

    if (targetStatus === 'READY_FOR_DISPATCH' && !hasDispatchDate(shipment)) {
      throw new ApiError(409, 'Cần nhập ngày vận chuyển, giờ đóng hoặc thời gian trả hàng trước khi sẵn sàng điều xe.');
    }

    assertLegalTransition(currentStatus, targetStatus);
    const transitionedAt = new Date();

    // Conditional update guards against concurrent transition races.
    const [updated] = await tx.update(s.shipments).set({
      status: targetStatus,
      version: sql`${s.shipments.version} + 1`,
      updatedAt: transitionedAt,
    })
      .where(and(eq(s.shipments.id, shipmentId), eq(s.shipments.status, shipment.status ?? currentStatus)))
      .returning();

    if (!updated) {
      throw new ApiError(
        409,
        'Trạng thái lô hàng đã bị thay đổi bởi người khác. Vui lòng tải lại.',
      );
    }

    const [historyRow] = await tx.insert(s.shipmentStatusHistory).values({
      shipmentId,
      fromStatus: shipment.status ?? currentStatus,
      toStatus: targetStatus,
      reason: options.reason ?? null,
      changedBy: options.changedBy ?? null,
      changedAt: transitionedAt,
    }).returning({ id: s.shipmentStatusHistory.id });
    const eventActorId = options.changedBy ?? null;
    if (eventActorId != null && historyRow) {
      await createShipmentStatusCustomerVisibleEvent(
        tx,
        shipmentId,
        historyRow.id,
        targetStatus,
        eventActorId,
        transitionedAt,
      );
    }
    if (targetStatus === 'READY_FOR_DISPATCH') {
      await ensureReadyShipmentHandoff(tx, updated, eventActorId);
    }

    return updated;
  };
  return runInTx(transaction, execute);
}

function isRoutineShipmentCloseWriter(actor: AuthUser): boolean {
  return actor.role === Role.ACCOUNTANT;
}

const ROUTINE_SHIPMENT_CLOSE_VAT_RATES = new Set<number>([0, 0.05, 0.08, 0.10]);

function normalizeRoutineShipmentCloseVatRate(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  if (!ROUTINE_SHIPMENT_CLOSE_VAT_RATES.has(rounded)) {
    throw new ApiError(400, 'Thuế suất VAT chỉ được chọn 0%, 5%, 8% hoặc 10%.');
  }
  return rounded;
}

type ShipmentDirectCloseTripVersionInput = {
  tripId: number;
  expectedVersion: number;
};

type ShipmentDirectCloseResult = {
  shipment: Pick<typeof s.shipments.$inferSelect, 'id' | 'shipmentCode' | 'status' | 'version'>;
  completedTripIds: number[];
  vatRate: number;
};

async function assertRoutineShipmentCloseCheckerSeparation(
  tx: Tx,
  tripIds: number[],
  completerUserId: number,
): Promise<void> {
  const acceptedRows = await tx.select({
    tripId: s.tripPodSubmissions.tripId,
    reviewedBy: s.tripPodSubmissions.reviewedBy,
  }).from(s.tripPodSubmissions)
    .where(and(
      inArray(s.tripPodSubmissions.tripId, tripIds),
      eq(s.tripPodSubmissions.status, TripPodStatus.ACCEPTED),
    ))
    .orderBy(desc(s.tripPodSubmissions.tripId), desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id))
    .for('update');

  const reviewerIds = [...new Set(acceptedRows.flatMap((row) => row.reviewedBy == null ? [] : [row.reviewedBy]))];
  const reviewerRoles = reviewerIds.length === 0
    ? new Map<number, string>()
    : new Map((await tx.select({ id: s.users.id, role: s.users.role })
      .from(s.users)
      .where(inArray(s.users.id, reviewerIds)))
      .map((row) => [row.id, row.role]));

  const latestAcceptedByTrip = new Map<number, { reviewedBy: number | null; reviewerRole: string | null }>();
  for (const row of acceptedRows) {
    if (!latestAcceptedByTrip.has(row.tripId)) {
      latestAcceptedByTrip.set(row.tripId, {
        reviewedBy: row.reviewedBy,
        reviewerRole: row.reviewedBy == null ? null : reviewerRoles.get(row.reviewedBy) ?? null,
      });
    }
  }

  for (const tripId of tripIds) {
    const checker = latestAcceptedByTrip.get(tripId);
    if (checker?.reviewedBy == null) {
      throw new ApiError(409, 'Chuyến chưa có người CUS/CLERK kiểm tra POD và hồ sơ chi phí.');
    }
    if (checker.reviewerRole !== Role.CUS) {
      throw new ApiError(409, 'Người kiểm tra POD và hồ sơ chi phí phải là CUS/CLERK.');
    }
    if (checker.reviewedBy === completerUserId) {
      throw new ApiError(409, 'Tài khoản Kế toán hoàn thành phải khác tài khoản CUS/CLERK đã kiểm tra hồ sơ.');
    }
  }
}

async function loadShipmentDirectCloseResult(
  tx: Tx,
  shipmentId: number,
  tripIds?: number[],
): Promise<ShipmentDirectCloseResult> {
  const [shipment] = await tx.select({
    id: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    status: s.shipments.status,
    version: s.shipments.version,
  }).from(s.shipments)
    .where(and(
      eq(s.shipments.id, shipmentId),
      isNull(s.shipments.deletedAt),
    ))
    .limit(1);
  if (!shipment) {
    throw new ApiError(404, 'Không tìm thấy lô hàng.');
  }

  const trips = await tx.select({
    id: s.trips.id,
    vatRate: s.trips.vatRate,
  }).from(s.trips)
    .where(and(
      eq(s.trips.shipmentId, shipmentId),
      isNull(s.trips.deletedAt),
      eq(s.trips.status, TripStatus.COMPLETED),
      ...(tripIds && tripIds.length > 0 ? [inArray(s.trips.id, tripIds)] : []),
    ))
    .orderBy(asc(s.trips.id));

  return {
    shipment: normalizeShipmentRow(shipment),
    completedTripIds: trips.map((trip) => trip.id),
    vatRate: trips.length > 0 ? Number(trips[0]?.vatRate ?? 0) : 0,
  };
}

export async function recomputeShipmentCompletion(
  shipmentId: number,
  options: { changedBy?: number | null } = {},
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) {
      throw new ApiError(404, 'Không tìm thấy lô hàng.');
    }
    const currentShipmentStatus = canonicalShipmentStatus(shipment.status);
    if (currentShipmentStatus === 'CANCELED' || currentShipmentStatus === 'COMPLETED') {
      return shipment;
    }

    const { fulfillmentRows, requiredFulfillments } = await loadShipmentCloseAuthorityContext(tx, shipmentId);
    if (fulfillmentRows.length === 0) {
      return shipment;
    }
    if (requiredFulfillments.length === 0) {
      if (
        currentShipmentStatus === 'PENDING_DATE'
        || currentShipmentStatus === 'READY_FOR_DISPATCH'
        || currentShipmentStatus === 'DISPATCHED'
      ) {
        return shipment;
      }
      return transitionShipmentStatus(
        shipmentId,
        'DISPATCHED',
        {
          reason: 'Tự động giữ trạng thái Đã điều xe vì lô hàng chưa còn tác vụ bắt buộc.',
          changedBy: options.changedBy ?? null,
        },
        tx,
      );
    }

    const requiredFulfillmentIds = requiredFulfillments.map((row) => row.id);
    const trips = await listRequiredShipmentAuthorityTrips(tx, requiredFulfillmentIds);
    const tripsByFulfillment = new Map<number, typeof trips>();
    for (const trip of trips) {
      const fulfillmentId = trip.fulfillmentId;
      if (fulfillmentId == null) continue;
      const existing = tripsByFulfillment.get(fulfillmentId) ?? [];
      existing.push(trip);
      tripsByFulfillment.set(fulfillmentId, existing);
    }

    const latestSubmissionRows = trips.length === 0
      ? []
      : await tx.select({
        tripId: s.tripPodSubmissions.tripId,
        status: s.tripPodSubmissions.status,
      }).from(s.tripPodSubmissions)
        .where(inArray(s.tripPodSubmissions.tripId, trips.map((trip) => trip.id)))
        .orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id))
        .for('update');
    const latestSubmissionByTripId = new Map<number, TripPodStatus>();
    for (const row of latestSubmissionRows) {
      if (!latestSubmissionByTripId.has(row.tripId)) {
        latestSubmissionByTripId.set(row.tripId, row.status as TripPodStatus);
      }
    }

    const acceptedSubmissions = trips.length === 0
      ? []
      : await tx.select({
        tripId: s.tripPodSubmissions.tripId,
      }).from(s.tripPodSubmissions)
        .where(and(
          inArray(s.tripPodSubmissions.tripId, trips.map((trip) => trip.id)),
          eq(s.tripPodSubmissions.status, TripPodStatus.ACCEPTED),
        ))
        .for('update');
    const acceptedTripIds = new Set(acceptedSubmissions.map((row) => row.tripId));

    const tripIds = trips.map((trip) => trip.id);
    const {
      completedExpenseScopeKeys,
      containersByTrip,
    } = await loadTripExpenseScopeState(tx, tripIds);

    const allRequiredTripsPresent = requiredFulfillments.every((row) => {
      const linkedTrips = tripsByFulfillment.get(row.id) ?? [];
      return linkedTrips.length === 1;
    });
    if (!allRequiredTripsPresent) {
      if (
        currentShipmentStatus === 'PENDING_DATE'
        || currentShipmentStatus === 'READY_FOR_DISPATCH'
        || currentShipmentStatus === 'DISPATCHED'
      ) {
        return shipment;
      }
      return transitionShipmentStatus(
          shipmentId,
          'DISPATCHED',
          {
            reason: 'Tự động quay về Đã điều xe vì tác vụ bắt buộc chưa xuất phát hoặc cần điều phối lại.',
            changedBy: options.changedBy ?? null,
          },
          tx,
        );
    }

    const allCompleted = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      return trip != null && trip.status === 'COMPLETED';
    });
    const allExpenseScopesComplete = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      return trip != null && hasCompletedExpenseScopes(
        trip.id,
        containersByTrip.get(trip.id) ?? [],
        completedExpenseScopeKeys,
      );
    });
    const anyInTransit = trips.some((trip) => trip.status === TripStatus.IN_TRANSIT);
    const allAwaitingApproval = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      const latestSubmissionStatus = trip == null ? null : latestSubmissionByTripId.get(trip.id) ?? null;
      return trip != null
        && latestSubmissionStatus != null
        && hasCompletedExpenseScopes(
          trip.id,
          containersByTrip.get(trip.id) ?? [],
          completedExpenseScopeKeys,
        )
        && (latestSubmissionStatus === TripPodStatus.SUBMITTED || latestSubmissionStatus === TripPodStatus.ACCEPTED);
    });
    const allCompletedAndAccepted = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      return trip != null && trip.status === 'COMPLETED'
        && hasCompletedExpenseScopes(
          trip.id,
          containersByTrip.get(trip.id) ?? [],
          completedExpenseScopeKeys,
        )
        && acceptedTripIds.has(trip.id)
        && trip.podRecoveredAt != null;
    });

    let targetStatus: ShipmentStatus = 'DISPATCHED';
    let reason = 'Tự động cập nhật theo tình trạng điều xe hiện tại.';
    if (allCompletedAndAccepted) {
      targetStatus = 'COMPLETED';
      reason = 'Tự động hoàn thành khi mọi tác vụ đã duyệt e-POD, thu hồi POD gốc và chốt xong.';
    } else if (allAwaitingApproval || (allCompleted && allExpenseScopesComplete)) {
      targetStatus = 'PENDING_EXPENSE_APPROVAL';
      reason = 'Tự động chuyển sang Chờ duyệt phí khi mọi tác vụ đã nộp đủ hồ sơ chờ kế toán/CUS duyệt.';
    } else if (anyInTransit) {
      targetStatus = 'IN_TRANSIT';
      reason = 'Tự động chuyển sang Đang chạy khi đã có chuyến xuất phát.';
    }

    if (currentShipmentStatus === targetStatus) return shipment;

    // Never skip a PRD lifecycle state, including when legacy data or a
    // replayed event arrives after downstream evidence has already been
    // submitted. Each intermediate transition is auditable in status history.
    let current: ShipmentStatus = currentShipmentStatus as ShipmentStatus;
    let currentRow = shipment;
    if (current === 'READY_FOR_DISPATCH') {
      currentRow = await transitionShipmentStatus(shipmentId, 'DISPATCHED', {
        reason: 'Khôi phục trạng thái Đã điều xe trước khi ghi nhận kết quả vận hành.',
        changedBy: options.changedBy ?? null,
      }, tx);
      current = 'DISPATCHED';
    }
    if (
      current === 'DISPATCHED'
      && (targetStatus === 'PENDING_EXPENSE_APPROVAL' || targetStatus === 'COMPLETED')
    ) {
      currentRow = await transitionShipmentStatus(shipmentId, 'IN_TRANSIT', {
        reason: 'Khôi phục trạng thái Đang chạy trước khi ghi nhận hồ sơ vận hành.',
        changedBy: options.changedBy ?? null,
      }, tx);
      current = 'IN_TRANSIT';
    }
    if (current === 'IN_TRANSIT' && targetStatus === 'COMPLETED') {
      currentRow = await transitionShipmentStatus(shipmentId, 'PENDING_EXPENSE_APPROVAL', {
        reason: 'Ghi nhận bước Chờ duyệt phí trước khi hoàn thành.',
        changedBy: options.changedBy ?? null,
      }, tx);
      current = 'PENDING_EXPENSE_APPROVAL';
    }
    if (current === targetStatus) return currentRow;
    return transitionShipmentStatus(shipmentId, targetStatus, {
      reason,
      changedBy: options.changedBy ?? null,
    }, tx);
  };

  return runInTx(transaction, execute);
}

export async function completeShipmentDirect(args: {
  shipmentId: number;
  expectedVersion: number;
  vatRate: number;
  trips: ShipmentDirectCloseTripVersionInput[];
  confirmZeroRevenue?: boolean;
  confirmNoPhoto?: boolean;
  idempotencyKey: string;
  actor: AuthUser;
}): Promise<ShipmentDirectCloseResult & { replayed: boolean }> {
  if (!isRoutineShipmentCloseWriter(args.actor)) {
    throw new ApiError(403, 'Chỉ Kế toán mới được hoàn thành trực tiếp lô hàng.');
  }
  const vatRate = normalizeRoutineShipmentCloseVatRate(args.vatRate);
  const normalizedTripVersions = [...args.trips]
    .map((item) => ({
      tripId: item.tripId,
      expectedVersion: item.expectedVersion,
    }))
    .sort((left, right) => left.tripId - right.tripId);
  if (normalizedTripVersions.length === 0) {
    throw new ApiError(400, 'Danh sách phiên bản chuyến đi là bắt buộc.');
  }
  const maxTripVersions = 100;
  if (normalizedTripVersions.length > maxTripVersions) {
    throw new ApiError(400, `Danh sách phiên bản chuyến đi không được vượt quá ${maxTripVersions}.`);
  }
  const duplicateTripIds = normalizedTripVersions
    .filter((item, index, all) => index > 0 && item.tripId === all[index - 1]?.tripId)
    .map((item) => item.tripId);
  if (duplicateTripIds.length > 0) {
    throw new ApiError(400, 'Danh sách phiên bản chuyến đi bị trùng.');
  }

  const outcome = await runIdempotent<ShipmentDirectCloseResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_COMPLETE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      shipmentId: args.shipmentId,
      expectedVersion: args.expectedVersion,
      vatRate,
      confirmZeroRevenue: args.confirmZeroRevenue === true,
      trips: normalizedTripVersions,
    },
    createdBy: args.actor.userId,
    entityType: 'shipment',
    responseStatusCode: 200,
    getEntityKey: (result) => result.shipment.shipmentCode,
    load: async (entityId, tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      return loadShipmentDirectCloseResult(tx, entityId);
    },
    create: async (tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      await assertShipmentAccountingUnlocked(tx, args.shipmentId);

      const [shipment] = await tx.select({
        id: s.shipments.id,
        version: s.shipments.version,
        status: s.shipments.status,
      }).from(s.shipments)
        .where(and(
          eq(s.shipments.id, args.shipmentId),
          isNull(s.shipments.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!shipment) {
        throw new ApiError(404, 'Không tìm thấy lô hàng.');
      }
      if (shipment.version !== args.expectedVersion) {
        throw new ApiError(409, 'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.');
      }
      if (canonicalShipmentStatus(shipment.status) !== 'PENDING_EXPENSE_APPROVAL') {
        throw new ApiError(409, 'Chỉ có thể chốt trực tiếp lô hàng đang chờ duyệt phí.');
      }

      const { requiredFulfillments } = await loadShipmentCloseAuthorityContext(tx, shipment.id);
      if (requiredFulfillments.length === 0) {
        throw new ApiError(409, 'Lô hàng chưa có tác vụ bắt buộc để chốt.');
      }

      const expectedTripVersionById = new Map(
        normalizedTripVersions.map((item) => [item.tripId, item.expectedVersion]),
      );
      const requiredTrips = await listRequiredShipmentAuthorityTrips(
        tx,
        requiredFulfillments.map((row) => row.id),
      );
      const tripsByFulfillment = new Map<number, ShipmentAuthorityTripRow[]>();
      for (const trip of requiredTrips) {
        if (trip.fulfillmentId == null) {
          continue;
        }
        const existing = tripsByFulfillment.get(trip.fulfillmentId) ?? [];
        existing.push(trip);
        tripsByFulfillment.set(trip.fulfillmentId, existing);
      }
      const missingRequiredTripIds = requiredFulfillments
        .map((row) => row.id)
        .filter((fulfillmentId) => (tripsByFulfillment.get(fulfillmentId) ?? []).length === 0);
      if (missingRequiredTripIds.length > 0) {
        throw new ApiError(409, 'Lô hàng chưa có đủ chuyến hiệu lực để chốt.');
      }
      const duplicateRequiredTripIds = requiredFulfillments
        .map((row) => row.id)
        .filter((fulfillmentId) => (tripsByFulfillment.get(fulfillmentId) ?? []).length > 1);
      if (duplicateRequiredTripIds.length > 0) {
        throw new ApiError(409, 'Lô hàng có nhiều chuyến hiệu lực cho cùng một tác vụ bắt buộc.');
      }

      if (
        requiredTrips.length !== normalizedTripVersions.length
        || requiredTrips.some((trip) => !expectedTripVersionById.has(trip.id))
      ) {
        throw new ApiError(409, 'Danh sách chuyến đi của lô hàng đã thay đổi. Vui lòng tải lại.');
      }

      const scopeState = await loadTripExpenseScopeState(
        tx,
        requiredTrips.map((trip) => trip.id),
      );
      await assertRoutineShipmentCloseCheckerSeparation(
        tx,
        requiredTrips.map((trip) => trip.id),
        args.actor.userId,
      );

      for (const trip of [...requiredTrips].sort((left, right) => left.id - right.id)) {
        const expectedTripVersion = expectedTripVersionById.get(trip.id);
        if (expectedTripVersion == null || trip.version !== expectedTripVersion) {
          throw new ApiError(409, 'Chuyến đi đã được thay đổi. Vui lòng tải lại.');
        }
        await assertShipmentDirectCloseTripReadiness(tx, trip.id, scopeState);
        await transitionTripStatus(
          trip.id,
          TripStatus.COMPLETED,
          args.actor.userId,
          args.actor.role,
          args.confirmZeroRevenue === true,
          args.confirmNoPhoto === true,
          {
            expectedVersion: trip.version,
            transaction: tx,
            routineShipmentClose: true,
            vatRateOverride: vatRate,
            strictApSnapshot: true,
          },
        );
      }

      return loadShipmentDirectCloseResult(
        tx,
        shipment.id,
        requiredTrips.map((trip) => trip.id),
      );
    },
    getEntityId: (result) => result.shipment.id,
  });

  return {
    ...outcome.result,
    replayed: outcome.replayed,
  };
}

export async function cancelShipmentFulfillment(args: {
  shipmentId: number;
  fulfillmentId: number;
  expectedVersion: number;
  disposition: 'REPLACED' | 'NOT_REQUIRED';
  reason: string;
  actor: AuthUser;
  idempotencyKey: string;
}): Promise<CancelShipmentFulfillmentResult & { replayed: boolean }> {
  if (args.actor.role !== Role.ADMIN && args.actor.role !== Role.MANAGER) {
    throw new ApiError(403, 'Chỉ quản lý hoặc quản trị viên được hủy tác vụ điều phối.');
  }
  const normalizedReason = args.reason.trim();
  if (!normalizedReason) {
    throw new ApiError(400, 'Lý do hủy tác vụ là bắt buộc.');
  }

  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_CANCEL,
    idempotencyKey: args.idempotencyKey,
    payload: {
      shipmentId: args.shipmentId,
      fulfillmentId: args.fulfillmentId,
      expectedVersion: args.expectedVersion,
      disposition: args.disposition,
      reason: normalizedReason,
    },
    createdBy: args.actor.userId,
    entityType: 'shipment_fulfillment',
    responseStatusCode: 200,
    create: async (tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      await assertShipmentAccountingUnlocked(tx, args.shipmentId);
      const [shipment] = await tx.select().from(s.shipments)
        .where(and(
          eq(s.shipments.id, args.shipmentId),
          isNull(s.shipments.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!shipment) {
        throw new ApiError(404, 'Không tìm thấy lô hàng.');
      }
      const shipmentStatus = canonicalShipmentStatus(shipment.status);
      if (shipmentStatus === 'COMPLETED' || shipmentStatus === 'CANCELED') {
        throw new ApiError(409, 'Không thể hủy tác vụ của lô hàng đã kết thúc.');
      }

      const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
        .where(and(
          eq(s.shipmentFulfillments.id, args.fulfillmentId),
          eq(s.shipmentFulfillments.shipmentId, shipment.id),
        ))
        .for('update')
        .limit(1);
      if (!fulfillment) {
        throw new ApiError(404, 'Không tìm thấy tác vụ thực hiện.');
      }
      if (fulfillment.version !== args.expectedVersion) {
        throw new ApiError(409, 'Tác vụ đã thay đổi. Vui lòng tải lại.');
      }
      if (fulfillment.cancellationDisposition != null) {
        throw new ApiError(409, 'Tác vụ đã được xử lý hủy trước đó.');
      }

      const activeTrips = await tx.select().from(s.trips)
        .where(and(
          eq(s.trips.fulfillmentId, fulfillment.id),
          isNull(s.trips.deletedAt),
        ))
        .for('update');
      const liveTrips = activeTrips.filter((trip) => trip.status !== TripStatus.CANCELED);
      if (liveTrips.length > 1) {
        throw new ApiError(409, 'Tác vụ đang gắn nhiều chuyến hiệu lực. Vui lòng kiểm tra lại điều phối.');
      }

      const linkedTrip = liveTrips[0] ?? null;
      if (linkedTrip?.status === TripStatus.COMPLETED) {
        throw new ApiError(409, 'Chuyến đã hoàn thành. Vui lòng xử lý luồng hủy chuyến trước khi hủy tác vụ.');
      }
      if (linkedTrip != null) {
        const [acceptedPod] = await tx.select({ id: s.tripPodSubmissions.id })
          .from(s.tripPodSubmissions)
          .where(and(
            eq(s.tripPodSubmissions.tripId, linkedTrip.id),
            eq(s.tripPodSubmissions.status, TripPodStatus.ACCEPTED),
          ))
          .limit(1);
        if (acceptedPod) {
          throw new ApiError(409, 'e-POD đã được duyệt. Vui lòng xử lý yêu cầu điều chỉnh trước khi hủy tác vụ.');
        }
      }
      if (linkedTrip != null) {
        await transitionTripStatus(
          linkedTrip.id,
          TripStatus.CANCELED,
          args.actor.userId,
          args.actor.role,
          undefined,
          undefined,
          {
            expectedVersion: linkedTrip.version,
            transaction: tx,
          },
        );
      }

      const now = new Date();
      if (fulfillment.canceledAt == null) {
        await tx.update(s.shipmentFulfillments).set({
          canceledAt: now,
          canceledBy: args.actor.userId,
          cancellationReason: normalizedReason,
          updatedAt: now,
        }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
      }

      let replacementFulfillmentId: number | null = null;
      if (args.disposition === 'REPLACED') {
        const [replacement] = await tx.insert(s.shipmentFulfillments).values({
          shipmentId: fulfillment.shipmentId,
          fulfillmentType: fulfillment.fulfillmentType,
          cargoMode: fulfillment.cargoMode,
          shipmentContainerId: fulfillment.shipmentContainerId,
          sourceShipmentVersion: shipment.version,
          siteSnapshot: fulfillment.siteSnapshot,
          dispatchClassification: fulfillment.cargoMode === CARGO_MODE.LCL ? 'LCL' : 'SINGLE',
          createdBy: args.actor.userId,
        }).returning();
        if (!replacement) {
          throw new ApiError(409, 'Không thể tạo tác vụ thay thế. Vui lòng thử lại.');
        }
        replacementFulfillmentId = replacement.id;
      }

      await tx.update(s.shipmentFulfillments).set({
        canceledAt: fulfillment.canceledAt ?? now,
        canceledBy: fulfillment.canceledBy ?? args.actor.userId,
        cancellationReason: fulfillment.cancellationReason ?? normalizedReason,
        cancellationDisposition: args.disposition,
        replacementFulfillmentId,
        notRequiredApprovedBy: args.disposition === 'NOT_REQUIRED' ? args.actor.userId : null,
        notRequiredApprovedAt: args.disposition === 'NOT_REQUIRED' ? now : null,
        notRequiredReason: args.disposition === 'NOT_REQUIRED' ? normalizedReason : null,
        version: sql`${s.shipmentFulfillments.version} + 1`,
        updatedAt: now,
      }).where(eq(s.shipmentFulfillments.id, fulfillment.id));

      const shipmentAfterRecompute = await recomputeShipmentCompletion(
        shipment.id,
        { changedBy: args.actor.userId },
        tx,
      );
      return {
        shipment: shipmentAfterRecompute,
        fulfillmentId: fulfillment.id,
        replacementFulfillmentId,
        shipmentVersion: shipmentAfterRecompute.version,
      };
    },
  });

  return {
    ...outcome.result,
    replayed: outcome.replayed,
  };
}

// ─── Soft delete ────────────────────────────────────────────────────────────
//
// Only date-pending or CANCELED shipments may be tombstoned — once work has started
// (DISPATCHED / IN_TRANSIT / PENDING_EXPENSE_APPROVAL / COMPLETED), the audit trail and linked trips must be
// preserved. Callers should prefer CANCELED for an in-flight cancellation;
// soft-delete is the "remove a mistakenly-created draft" path.

export async function softDeleteShipment(
  shipmentId: number,
  options: { deletedBy?: number | null; version: number },
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);

    if (existing.version !== options.version) {
      throw new ApiError(
        409,
        'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.',
      );
    }

    const currentStatus = canonicalShipmentStatus(existing.status);
    if (currentStatus !== 'PENDING_DATE' && currentStatus !== 'CANCELED') {
      throw new ApiError(
        409,
        'Chỉ có thể xóa lô hàng ở trạng thái Mới tạo hoặc Đã hủy.',
      );
    }

    const [updated] = await tx.update(s.shipments).set({
      deletedAt: new Date(),
      version: sql`${s.shipments.version} + 1`,
      updatedBy: options.deletedBy ?? null,
      updatedAt: new Date(),
    }).where(eq(s.shipments.id, shipmentId)).returning();

    return updated;
  };
  return runInTx(transaction, execute);
}

export interface CancelShipmentFulfillmentResult {
  shipment: Awaited<ReturnType<typeof getShipment>>;
  fulfillmentId: number;
  replacementFulfillmentId: number | null;
  shipmentVersion: number;
}
