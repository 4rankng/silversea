// Shipment plan updates: direct edits vs clerk plan-change requests, dispatch
// readiness guards, and authority sync to trips. Extracted from
// shipment-lifecycle.service.ts verbatim (pure code movement).
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../errors';
import { canonicalShipmentStatus, Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import type { UpdateShipmentInput } from './shipment-types';

import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { lockShipmentFreightRate } from './freight-rate-snapshot-lifecycle.service';
import {
  assertDispatcherCanMutateShipmentIntake,
  ensureReadyShipmentHandoff,
  hasDispatchDate,
  isDirectlyEditableIntakeStatus,
} from './shipment-intake.service';
import { ensureShipmentFulfillmentsInTx } from './shipment-fulfillment.service';
import {
  syncShipmentAuthorityToTrips,
  toNullableFixedDecimal,
  toNullableTimestamp,
} from './shipment-shared.service';
import {
  type ShipmentUpdateResult,
  assertShipmentDocumentReferences,
  normalizeDocumentReference,
  assertShipmentFactorySiteValid,
  assertShipmentMasterRefsExist,
  findShipmentReferenceConflict,
  throwShipmentReferenceConflict,
} from './shipment-lifecycle-shared.service';

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
    // Product ruling 2026-09-20 ("both notes can be edit"): a notes-only
    // update by CUS/ADMIN/DISPATCHER skips the accounting lock — the two note
    // fields stay writable on locked lots. Every other field combination
    // keeps the lock. The pessimistic row lock from the select above keeps
    // the version bump race-free either way.
    //
    // The dispatcher stage gate is role-scope, not payload-scope: a
    // dispatcher only mutates intake-stage lots even when the payload is
    // notes-only. The gate no-ops for other roles.
    assertDispatcherCanMutateShipmentIntake(actor, existing.status);
    const notesOnly = isNotesOnlyShipmentUpdate(input)
      && (actor?.role === Role.CUS || actor?.role === Role.ADMIN || actor?.role === Role.DISPATCHER);
    if (!notesOnly) {
      await assertShipmentAccountingUnlocked(tx, id);
    }
    // Master refs carry no DB FKs — validate only the refs this input
    // actually CHANGES, so pre-existing orphan rows (2026-09-15 sweep:
    // 94 shipments referencing deleted masters) stay editable, including
    // through editors that resend the stored (phantom) ref unchanged.
    await assertShipmentMasterRefsExist(tx, {
      customerId: input.customerId !== undefined && input.customerId !== existing.customerId ? input.customerId : undefined,
      routeId: input.routeId !== undefined && input.routeId !== existing.routeId ? input.routeId : undefined,
      cargoTypeId: input.cargoTypeId !== undefined && input.cargoTypeId !== existing.cargoTypeId ? input.cargoTypeId : undefined,
    });
    // Shipment-level factory mirror (SILVER L1 P2): same customer-scope +
    // FACTORY-type validation the container choke point enforces. The
    // resolved customer respects an in-flight customerId change. Ad-hoc
    // orders carry no catalog customer, so there is no scope to validate.
    if (input.operationalSiteId != null) {
      const resolvedCustomerId = input.customerId ?? existing.customerId;
      if (resolvedCustomerId != null) {
        await assertShipmentFactorySiteValid(tx, resolvedCustomerId, input.operationalSiteId);
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

    // Customer feedback 2026-09-07: when an update rewrites Bill/Booking,
    // block the change if another active shipment already owns that
    // reference. Excluding `existing.id` keeps the row from blocking itself
    // when the client resubmits its own current value (no-op).
    const nextBlNumber = normalizeDocumentReference(input.blNumber !== undefined ? input.blNumber : existing.blNumber);
    const nextBookingRef = normalizeDocumentReference(input.bookingRef !== undefined ? input.bookingRef : existing.bookingRef);
    const blChanged = input.blNumber !== undefined && nextBlNumber?.toLowerCase() !== normalizeDocumentReference(existing.blNumber)?.toLowerCase();
    const bookingChanged = input.bookingRef !== undefined && nextBookingRef?.toLowerCase() !== normalizeDocumentReference(existing.bookingRef)?.toLowerCase();
    if (blChanged || bookingChanged) {
      const conflict = await findShipmentReferenceConflict(
        tx,
        { blNumber: blChanged ? nextBlNumber : null, bookingRef: bookingChanged ? nextBookingRef : null },
        id,
      );
      if (conflict) {
        throwShipmentReferenceConflict(
          conflict,
          conflict.field === 'blNumber' ? 'bill' : 'booking',
        );
      }
    }

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




    // 2026-09-10 user directive: all phê duyệt (approval) flows are removed —
    // authority and clerk plan updates apply directly, with no
    // change-request routing to reintroduce later.
    const shipmentAuthorityChanged = (
      input.customerId !== undefined && input.customerId !== existing.customerId
    ) || (
      input.cargoTypeId !== undefined && input.cargoTypeId !== existing.cargoTypeId
    );
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
    const existingContainers = existing.cargoMode === 'FCL'
      ? await tx.select({ customerAppointmentAt: s.shipmentContainers.customerAppointmentAt })
          .from(s.shipmentContainers)
          .where(eq(s.shipmentContainers.shipmentId, existing.id))
      : [];
    const hasUndatedFclContainers = existingContainers.length > 0
      && existingContainers.some((c) => c.customerAppointmentAt == null);
    const becomesReady = currentCanonicalStatus === 'PENDING_DATE'
      && !hasUndatedFclContainers
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
      ...(input.bookingRef !== undefined ? { bookingRef: bookingChanged ? nextBookingRef : existing.bookingRef } : {}),
      ...(input.blNumber !== undefined ? { blNumber: blChanged ? nextBlNumber : existing.blNumber } : {}),
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

    if (input.isCombined !== undefined && existing.isCombined !== input.isCombined) {
      await tx.update(s.shipmentFulfillments).set({
        dispatchClassification: input.isCombined ? 'COMBINED' : 'SINGLE',
        updatedAt: new Date(),
      }).where(and(
        eq(s.shipmentFulfillments.shipmentId, id),
        isNull(s.shipmentFulfillments.canceledAt),
        eq(s.shipmentFulfillments.cargoMode, 'FCL'),
      ));
    }

    if (becomesReady) {
      await tx.insert(s.shipmentStatusHistory).values({
        shipmentId: id,
        fromStatus: existing.status ?? 'PENDING_DATE',
        toStatus: 'READY_FOR_DISPATCH',
        reason: 'Đã bổ sung ngày vận chuyển, giờ đóng hoặc thời gian trả hàng và sẵn sàng điều xe.',
        changedBy: input.updatedBy ?? actor?.userId ?? null,
      });
      // BUG 5 (2026-09-12): this date-driven PENDING_DATE → READY_FOR_DISPATCH
      // flip is an intake path of its own — without decomposing fulfillments
      // here the shipment turns ready but stays invisible to the dispatch
      // detail plan (its rows query inner-joins live fulfillments). The
      // submit-for-dispatch flow already ensures; mirror it.
      const readyActorId = input.updatedBy ?? actor?.userId ?? null;
      // Legacy rows can predate the explicit cargo-mode column (same repair
      // as updateCusShipmentContainerLine): a lot with containers is FCL, a
      // container-less one is LCL.
      const [anyContainer] = await tx.select({ id: s.shipmentContainers.id })
        .from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, id)).limit(1);
      const hasContainers = anyContainer != null;
      if (updated.cargoMode == null) {
        const repairedMode = hasContainers ? 'FCL' : 'LCL';
        await tx.update(s.shipments).set({ cargoMode: repairedMode, updatedAt: new Date() })
          .where(eq(s.shipments.id, id));
        updated.cargoMode = repairedMode;
      }
      // Decompose only when there is something dispatchable: LCL always
      // (one shipment-level fulfillment), FCL only with containers — an FCL
      // lot with zero containers cannot appear on the plan either way (rows
      // join containers), so its date update keeps the pre-fix behavior
      // instead of failing the whole save.
      // Route callers always supply an actor; a null-actor service-level flip
      // (legacy programmatic path) cannot decompose — the union branch keeps
      // the lot visible until a dispatched write decomposes it.
      if (readyActorId != null && (updated.cargoMode === 'LCL' || hasContainers)) {
        await ensureShipmentFulfillmentsInTx(tx, {
          shipmentId: id,
          actorId: readyActorId,
          allowClerkIntake: true,
        });
      }
      await ensureReadyShipmentHandoff(tx, updated, readyActorId);
    }
    if (shipmentAuthorityChanged && isDirectlyEditableIntakeStatus(updated.status)) {
      await syncShipmentAuthorityToTrips(tx, updated);
    }

    // Auto freight pricing: a transport-date change re-locks the rate. The
    // engine never mutates the frozen row — supersede = a new INSERT (chốt
    // 2026-09-09 Câu 2 = A). Skips silently when no rate key is derivable
    // (LCL without containers locks at dispatch instead) or on MANUAL.
    if (
      input.expectedDeliveryDate !== undefined
      && input.expectedDeliveryDate != null
      && input.expectedDeliveryDate !== existing.expectedDeliveryDate
    ) {
      await lockShipmentFreightRate(tx, { shipmentId: id });
    }

    return {
      ...updated,
      changeMode: 'DIRECT' as const,
      changeRequestId: null,
      notificationDelivered: true,
    };
  };
  const result = await runInTx(transaction, execute);
  return result;
}

/** A notes-only update carries nothing beyond the two note fields plus
 * bookkeeping keys, so the accounting-lock exception ("both notes can be
 * edit", product ruling 2026-09-20) can safely skip the aggregate guard.
 * driverNotes reaches this service already resolved to operationalNotes. */
function isNotesOnlyShipmentUpdate(input: UpdateShipmentInput): boolean {
  const definedKeys = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  const exemptKeys = new Set(['customerNotes', 'operationalNotes', 'expectedVersion', 'version', 'updatedBy']);
  return definedKeys.length > 0 && definedKeys.every((key) => exemptKeys.has(key));
}
