// Shipment create + clerk quick-create (idempotent). Extracted from
// shipment-lifecycle.service.ts verbatim (pure code movement); shared
// validators and input types live in shipment-lifecycle-shared.
import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import type { ShipmentStatus } from './shipment-types';
import { createCustomerVisibleEvent } from './shipment-coordination.service';
import { ensureReadyShipmentHandoff } from './shipment-intake.service';
import {
  toNullableFixedDecimal,
  toNullableTimestamp,
} from './shipment-shared.service';
import { getShipment } from './shipment-detail-reads.service';
import {
  type CreateShipmentInput,
  assertShipmentDocumentReferences,
  normalizeDocumentReference,
  assertShipmentFactorySiteValid,
  findShipmentReferenceConflict,
  throwShipmentReferenceConflict,
} from './shipment-lifecycle-shared.service';

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
// ─── Create ─────────────────────────────────────────────────────────────────

async function createShipmentTx(tx: Tx, input: CreateShipmentInput, actor?: AuthUser) {
  assertShipmentDocumentReferences(input);
  // Customer feedback 2026-09-07 (BL `JJCTCHPDY260305` accidentally created
  // twice): pre-check duplicate Bill/Booking against active rows so the
  // second attempt is blocked at the source with "đã nhập bởi <user>" instead
  // of silently producing a sibling shipment that strands downstream ops.
  const duplicate = await findShipmentReferenceConflict(
    tx,
    {
      blNumber: normalizeDocumentReference(input.blNumber),
      bookingRef: normalizeDocumentReference(input.bookingRef),
    },
  );
  if (duplicate) {
    throwShipmentReferenceConflict(
      duplicate,
      duplicate.field === 'blNumber' ? 'bill' : 'booking',
    );
  }
  if (input.operationalSiteId != null) {
    await assertShipmentFactorySiteValid(tx, input.customerId, input.operationalSiteId);
  }
  const responsibleUnitId = input.responsibleUnitId ?? null;

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
