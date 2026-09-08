// Shipment plan updates: direct edits vs clerk plan-change requests, dispatch
// readiness guards, and authority sync to trips. Extracted from
// shipment-lifecycle.service.ts verbatim (pure code movement).
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../errors';
import { canonicalShipmentStatus } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import type { UpdateShipmentInput } from './shipment-types';
import {
  classifyClerkShipmentPatch,
  createShipmentChangeRequest,
  isClerkScopedUser,
} from './shipment-edit-boundary.service';

import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import {
  assertDispatcherCanMutateShipmentIntake,
  ensureReadyShipmentHandoff,
  hasDispatchDate,
  isDirectlyEditableIntakeStatus,
} from './shipment-intake.service';
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
    assertDispatcherCanMutateShipmentIntake(actor, existing.status);
    await assertShipmentAccountingUnlocked(tx, id);
    // Shipment-level factory mirror (SILVER L1 P2): same customer-scope +
    // FACTORY-type validation the container choke point enforces. The
    // resolved customer respects an in-flight customerId change.
    if (input.operationalSiteId != null) {
      await assertShipmentFactorySiteValid(tx, input.customerId ?? existing.customerId, input.operationalSiteId);
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
    const blChanged = input.blNumber !== undefined && nextBlNumber !== existing.blNumber;
    const bookingChanged = input.bookingRef !== undefined && nextBookingRef !== existing.bookingRef;
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

    const planClassification = classifyClerkShipmentPatch(existing, {
      customerId: input.customerId,
      routeId: input.routeId,
      cargoTypeId: input.cargoTypeId,
      responsibleUnitId: input.responsibleUnitId,
      isCombined: input.isCombined,
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
