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

async function loadReviewTripPodResult(
  tx: Tx,
  shipmentId: number,
  submissionId: number,
): Promise<ReviewTripPodResult> {
  const [row] = await tx.select({
    shipment: s.shipments,
    submissionId: s.tripPodSubmissions.id,
    submissionStatus: s.tripPodSubmissions.status,
    tripId: s.trips.id,
    tripStatus: s.trips.status,
  }).from(s.tripPodSubmissions)
    .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.tripPodSubmissions.fulfillmentId))
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .innerJoin(s.trips, eq(s.trips.id, s.tripPodSubmissions.tripId))
    .where(and(
      eq(s.tripPodSubmissions.id, submissionId),
      eq(s.shipments.id, shipmentId),
      isNull(s.shipments.deletedAt),
      isNull(s.trips.deletedAt),
    ))
    .limit(1);
  if (!row) {
    throw new ApiError(404, 'Không tìm thấy e-POD cần xử lý.');
  }
  return {
    shipment: row.shipment,
    submissionId: row.submissionId,
    submissionStatus: row.submissionStatus as TripPodStatus,
    tripId: row.tripId,
    tripStatus: row.tripStatus,
    shipmentVersion: row.shipment.version,
  };
}

export async function reviewTripPodSubmission(args: {
  shipmentId: number;
  submissionId: number;
  expectedVersion: number;
  resolution: 'ACCEPT' | 'REJECT';
  rejectionReason?: string | null;
  idempotencyKey: string;
  actor: AuthUser;
  // O2C C1: the PRD says the accountant ticks "Đã thu hồi chứng từ gốc (POD)"
  // on the same screen as e-POD acceptance. This flag sets podRecoveredAt
  // inside the transaction, immediately before the completion transition,
  // so the POD-recovery gate passes without a separate API call.
  podRecovered?: boolean;
}) {
  if (!isPodReviewWriter(args.actor)) {
    throw new ApiError(403, 'Chỉ CUS/CLERK mới được kiểm tra e-POD và hồ sơ chi phí.');
  }
  if (args.resolution === 'REJECT' && !args.rejectionReason?.trim()) {
    throw new ApiError(400, 'Cần nhập lý do từ chối e-POD.');
  }
  // O2C C1: if accepting and the trip doesn't yet have podRecoveredAt, the
  // caller MUST pass podRecovered=true to confirm paper POD is in hand. This
  // matches the PRD's "Kế toán/CUS đã tích chọn 'Đã thu hồi chứng từ gốc'".
  if (args.resolution === 'ACCEPT' && !args.podRecovered) {
    throw new ApiError(
      400,
      'Vui lòng xác nhận đã thu hồi chứng từ gốc (POD) trước khi duyệt e-POD.',
    );
  }

  const normalizedReason = args.rejectionReason?.trim() || null;
  let pushPayload: NotificationPayload | null = null;
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_REVIEW,
    idempotencyKey: args.idempotencyKey,
    payload: {
      shipmentId: args.shipmentId,
      submissionId: args.submissionId,
      expectedVersion: args.expectedVersion,
      resolution: args.resolution,
      rejectionReason: normalizedReason,
    },
    createdBy: args.actor.userId,
    entityType: 'trip_pod_submission',
    responseStatusCode: 200,
    serializeResult: () => null,
    load: async (entityId, tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      return loadReviewTripPodResult(tx, args.shipmentId, entityId);
    },
    create: async (tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      await assertShipmentAccountingUnlocked(tx, args.shipmentId);

      // Cancellation, POD review, and aggregate recomputation all serialize on
      // the shipment first. Keeping this shared lock order prevents a review
      // from holding trip/fulfillment rows while cancellation holds shipment.
      const [lockedShipment] = await tx.select({ id: s.shipments.id })
        .from(s.shipments)
        .where(and(
          eq(s.shipments.id, args.shipmentId),
          isNull(s.shipments.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!lockedShipment) {
        throw new ApiError(404, 'Không tìm thấy lô hàng.');
      }

      const [row] = await tx.select({
        submission: s.tripPodSubmissions,
        trip: s.trips,
        fulfillment: s.shipmentFulfillments,
      }).from(s.tripPodSubmissions)
        .innerJoin(s.trips, eq(s.trips.id, s.tripPodSubmissions.tripId))
        .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.tripPodSubmissions.fulfillmentId))
        .where(and(
          eq(s.tripPodSubmissions.id, args.submissionId),
          eq(s.shipmentFulfillments.shipmentId, args.shipmentId),
          isNull(s.trips.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!row) {
        throw new ApiError(404, 'Không tìm thấy e-POD cần xử lý.');
      }
      if (row.submission.version !== args.expectedVersion) {
        throw new ApiError(409, 'Phiên bản e-POD đã thay đổi. Vui lòng tải lại.');
      }
      if (row.submission.status !== TripPodStatus.SUBMITTED) {
        throw new ApiError(409, 'e-POD này đã được người khác xử lý.');
      }
      if (row.trip.status !== 'IN_TRANSIT') {
        throw new ApiError(409, 'Chỉ có thể duyệt e-POD của chuyến đang chạy.');
      }

      const files = await tx.select({
        fileType: s.tripPodFiles.fileType,
      }).from(s.tripPodFiles)
        .where(eq(s.tripPodFiles.submissionId, row.submission.id));
      const availableFileTypes = new Set(files.map((file) => file.fileType as typeof TRIP_POD_REQUIRED_FILE_TYPES[number]));
      const missingRequired = TRIP_POD_REQUIRED_FILE_TYPES.filter((fileType) => !availableFileTypes.has(fileType));
      if (missingRequired.length > 0) {
        throw new ApiError(409, 'e-POD chưa đủ hồ sơ bắt buộc để duyệt.');
      }

      const [updatedSubmission] = await tx.update(s.tripPodSubmissions).set({
        status: args.resolution === 'ACCEPT' ? TripPodStatus.ACCEPTED : TripPodStatus.REJECTED,
        reviewedBy: args.actor.userId,
        reviewedAt: new Date(),
        rejectionReason: args.resolution === 'REJECT' ? normalizedReason : null,
        version: sql`${s.tripPodSubmissions.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(s.tripPodSubmissions.id, row.submission.id),
        eq(s.tripPodSubmissions.status, TripPodStatus.SUBMITTED),
        eq(s.tripPodSubmissions.version, args.expectedVersion),
      )).returning({ id: s.tripPodSubmissions.id });
      if (!updatedSubmission) {
        throw new ApiError(409, 'e-POD này đã được người khác xử lý.');
      }

      if (args.resolution === 'ACCEPT') {
        // O2C C1: set podRecoveredAt inside the same tx so the POD-recovery
        // gate in transitionTripStatus passes. Only set if not already set
        // (idempotent — a prior /pod-recovered call may have done it).
        if (row.trip.podRecoveredAt == null) {
          await tx.update(s.trips).set({
            podRecoveredAt: new Date(),
            podRecoveredBy: args.actor.userId,
          }).where(eq(s.trips.id, row.trip.id));
        }
        // Accepting e-POD and confirming the original paper POD makes the
        // shipment ready for completion, but does not complete it. Financial
        // posting can then happen either through the routine Accountant/CUS
        // close path or the separate governed exception path.
        await recomputeShipmentCompletion(args.shipmentId, { changedBy: args.actor.userId }, tx);
        if (row.trip.driverId != null) {
          pushPayload = {
            type: NotificationType.TRIP_COMPLETED,
            title: 'e-POD đã được duyệt',
            message: `Chuyến ${row.trip.tripCode ?? 'chưa có mã'} đã đủ hồ sơ và đang chờ phê duyệt hoàn thành.`,
            relatedEntityType: 'shipment_fulfillments',
            relatedEntityId: row.fulfillment.id,
            targetDriverId: row.trip.driverId,
          };
          await persistNotificationInTx(tx, pushPayload);
        }
      } else {
        if (row.trip.driverId != null) {
          pushPayload = {
            type: NotificationType.SYSTEM_ANNOUNCEMENT,
            title: 'e-POD cần bổ sung',
            message: `e-POD của chuyến ${row.trip.tripCode ?? 'chưa có mã'} đã bị từ chối${normalizedReason ? `: ${normalizedReason}` : '.'} Vui lòng tạo phiên bản mới để gửi lại.`,
            relatedEntityType: 'shipment_fulfillments',
            relatedEntityId: row.fulfillment.id,
            targetDriverId: row.trip.driverId,
          };
          await persistNotificationInTx(tx, pushPayload);
        }
      }

      return loadReviewTripPodResult(tx, args.shipmentId, row.submission.id);
    },
    getEntityId: (result) => result.submissionId,
  });

  if (!outcome.replayed && pushPayload) {
    await sendNotificationPush(pushPayload).catch((error) => {
      console.error('POD review push delivery failed:', error);
    });
  }

  return {
    ...outcome.result,
    replayed: outcome.replayed,
  };
}

export interface ReviewTripPodResult {
  shipment: Awaited<ReturnType<typeof getShipment>>;
  submissionId: number;
  submissionStatus: TripPodStatus;
  tripId: number;
  tripStatus: typeof s.trips.$inferSelect.status;
  shipmentVersion: number;
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
        if (patch.operationalSiteId != null) {
          await assertShipmentFactorySiteValid(
            tx,
            patch.customerId ?? shipment.customerId,
            patch.operationalSiteId,
          );
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
