// Shipment review — e-POD review, change-request review, and POD file
// download extracted from shipment.service.ts (maintainability round 3).
// All user-facing messages in Vietnamese (PRD Mxx-HT-01).

import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import {
  NotificationType,
  Role,
  TripPodStatus,
  TRIP_POD_REQUIRED_FILE_TYPES,
} from '@tingting/shared';
import {
  persistNotificationInTx,
  sendNotificationPush,
  type NotificationPayload,
} from './notification.service';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { getShipmentPodFileForDownload } from './trip-pod.service';
import { persistChangeRequestDecisionNotification } from './shipment-edit-boundary.service';
import { isDirectlyEditableIntakeStatus } from './shipment-intake.service';
import {
  assertContainerSetValid,
  parseContainerChangeSnapshot,
  parsePlanUpdateSnapshot,
  reconcileShipmentContainersWithFulfillmentGuard,
} from './shipment-containers.service';
import { getShipment, getShipmentDetail } from './shipment-detail-reads.service';
import {
  assertShipmentFactorySiteValid,
  recomputeShipmentCompletion,
} from './shipment-lifecycle.service';
import {
  syncShipmentAuthorityToTrips,
  toNullableFixedDecimal,
  toNullableTimestamp,
} from './shipment-shared.service';

export interface ShipmentChangeRequestReviewResult {
  shipment: Awaited<ReturnType<typeof getShipment>>;
  resolution: 'APPLIED' | 'REJECTED';
  changeRequestId: number;
  shipmentVersion: number;
  notificationDelivered: boolean;
  message: string;
}

function isPodReviewWriter(actor: AuthUser): boolean {
  return actor.role === Role.CUS;
}

export async function downloadShipmentPodFile(
  shipmentId: number,
  fileId: number,
  actor?: AuthUser,
) {
  try {
    await getShipmentDetail(shipmentId, actor);
  } catch (error) {
    if (actor?.role === Role.CUS && error instanceof ApiError && error.statusCode === 403) {
      throw new ApiError(404, 'Không tìm thấy tệp e-POD.');
    }
    throw error;
  }
  return getShipmentPodFileForDownload({ shipmentId, fileId });
}

export async function reviewShipmentChangeRequest(
  shipmentId: number,
  changeRequestId: number,
  resolution: 'APPLIED' | 'REJECTED',
  actor: AuthUser,
  transaction?: Tx,
): Promise<ShipmentChangeRequestReviewResult> {
  const execute = async (tx: Tx) => {
    const [request] = await tx.select()
      .from(s.shipmentChangeRequests)
      .where(and(
        eq(s.shipmentChangeRequests.id, changeRequestId),
        eq(s.shipmentChangeRequests.shipmentId, shipmentId),
      ))
      .for('update')
      .limit(1);
    if (!request) {
      throw new ApiError(404, 'Không tìm thấy yêu cầu thay đổi cần xử lý');
    }

    const [shipment] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    let reviewedShipment = shipment;
    if (resolution === 'APPLIED') {
      if (shipment.version !== request.sourceVersion) {
        throw new ApiError(409, 'Lô hàng đã đổi phiên bản. Vui lòng tải lại trước khi áp dụng yêu cầu này.');
      }
      if (request.requestKind === 'PLAN_UPDATE') {
        const patch = parsePlanUpdateSnapshot(request.afterSnapshot);
        // Revalidate at apply time: the factory may have been deactivated or
        // re-scoped between request submission and review (TOCTOU guard).
        // Ad-hoc orders carry no catalog customer to scope against.
        if (patch.operationalSiteId != null) {
          const resolvedCustomerId = patch.customerId ?? shipment.customerId;
          if (resolvedCustomerId != null) {
            await assertShipmentFactorySiteValid(tx, resolvedCustomerId, patch.operationalSiteId);
          }
        }
        const [updated] = await tx.update(s.shipments).set({
          ...(patch.customerId !== undefined ? { customerId: patch.customerId } : {}),
          ...(patch.cargoTypeId !== undefined ? { cargoTypeId: patch.cargoTypeId } : {}),
          ...(patch.responsibleUnitId !== undefined ? { responsibleUnitId: patch.responsibleUnitId } : {}),
          ...(patch.bookingRef !== undefined ? { bookingRef: patch.bookingRef } : {}),
          ...(patch.blNumber !== undefined ? { blNumber: patch.blNumber } : {}),
          ...(patch.tradeDirection !== undefined ? { tradeDirection: patch.tradeDirection } : {}),
          ...(patch.cargoMode !== undefined ? { cargoMode: patch.cargoMode } : {}),
          ...(patch.operationalSiteId !== undefined ? { operationalSiteId: patch.operationalSiteId } : {}),
          ...(patch.pickupWarehouseSiteId !== undefined ? { pickupWarehouseSiteId: patch.pickupWarehouseSiteId } : {}),
          ...(patch.factoryName !== undefined ? { factoryName: patch.factoryName } : {}),
          ...(patch.shippingLineName !== undefined ? { shippingLineName: patch.shippingLineName } : {}),
          ...(patch.expectedDeliveryDate !== undefined ? { expectedDeliveryDate: patch.expectedDeliveryDate } : {}),
          ...(patch.customsCutoffAt !== undefined ? { customsCutoffAt: toNullableTimestamp(patch.customsCutoffAt, 'Hạn hải quan') } : {}),
          ...(patch.closingAt !== undefined ? { closingAt: toNullableTimestamp(patch.closingAt, 'Giờ closing') } : {}),
          ...(patch.plannedReturnAt !== undefined ? { plannedReturnAt: toNullableTimestamp(patch.plannedReturnAt, 'Ngày trả rỗng kế hoạch') } : {}),
          ...(patch.cargoWeightKg !== undefined ? { cargoWeightKg: toNullableFixedDecimal(patch.cargoWeightKg, 8, 2, 'Trọng lượng') } : {}),
          ...(patch.cargoVolumeCbm !== undefined ? { cargoVolumeCbm: toNullableFixedDecimal(patch.cargoVolumeCbm, 7, 3, 'Thể tích') } : {}),
          ...(patch.packageCount !== undefined ? { packageCount: patch.packageCount } : {}),
          ...(patch.packageType !== undefined ? { packageType: patch.packageType } : {}),
          ...(patch.operationalNotes !== undefined ? { operationalNotes: patch.operationalNotes } : {}),
          ...(patch.customerNotes !== undefined ? { customerNotes: patch.customerNotes } : {}),
          ...(patch.pickupLocation !== undefined ? { pickupLocation: patch.pickupLocation } : {}),
          ...(patch.deliveryLocation !== undefined ? { deliveryLocation: patch.deliveryLocation } : {}),
          ...(patch.contactName !== undefined ? { contactName: patch.contactName } : {}),
          ...(patch.contactPhone !== undefined ? { contactPhone: patch.contactPhone } : {}),
          version: shipment.version + 1,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
          .where(eq(s.shipments.id, shipmentId))
          .returning();
        reviewedShipment = updated;
        if (isDirectlyEditableIntakeStatus(reviewedShipment.status)) {
          await syncShipmentAuthorityToTrips(tx, reviewedShipment);
        }
      } else {
        const containers = parseContainerChangeSnapshot(request.afterSnapshot);
        assertContainerSetValid(containers);
        await reconcileShipmentContainersWithFulfillmentGuard(
          tx,
          shipmentId,
          actor.userId,
          containers,
        );
        const [updated] = await tx.update(s.shipments).set({
          version: shipment.version + 1,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
          .where(eq(s.shipments.id, shipmentId))
          .returning();
        reviewedShipment = updated;
      }
    }

    await tx.delete(s.shipmentChangeRequests)
      .where(eq(s.shipmentChangeRequests.id, changeRequestId));

    await persistChangeRequestDecisionNotification(tx, {
      shipmentId: reviewedShipment.id,
      shipmentCode: reviewedShipment.shipmentCode ?? null,
      requesterId: request.requestedBy,
      resolution,
    });

    return {
      shipment: reviewedShipment,
      requesterId: request.requestedBy,
      shipmentVersion: reviewedShipment.version,
      resolution,
    };
  };
  const result = await runInTx(transaction, execute);

  return {
    shipment: result.shipment,
    resolution: result.resolution,
    changeRequestId,
    shipmentVersion: result.shipmentVersion,
    notificationDelivered: true,
    message: result.resolution === 'APPLIED'
      ? 'Đã áp dụng yêu cầu thay đổi và cập nhật phiên bản lô hàng.'
      : 'Đã từ chối yêu cầu thay đổi.',
  };
}
