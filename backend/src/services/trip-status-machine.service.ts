// Trip Status Machine — Status transition logic and validation
// transitionTripStatus with all role checks, guard conditions, and ledger integration

import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { TripStatus, Role } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { applyTripPairLifecycleEffects } from './trip-pairs.service';
import { requirePersistedTripGovernanceAuthorization } from './trip-governance-authorization.service';
import { assertActiveApprovalApplication } from './governance-transition.service';
import { deriveMilestoneFromTripStatus } from './milestone.service';
import {
  createFinancialPosting,
  getActiveFinancialPosting,
} from './financial-posting.service';
import { captureProfitabilityAttributionSnapshot } from './profitability.service';
import { ArSnapshotService } from './ar-snapshot.service';
import { SnapshotServices } from './snapshot-services';
import { lockTripCloseAggregate } from './trip-close-readiness.service';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';

export async function transitionTripStatus(
  tripId: number,
  targetStatus: TripStatus,
  userId: number,
  userRole: string,
  confirmZeroRevenue?: boolean,
  confirmNoPhoto?: boolean,
  options?: {
    expectedVersion?: number;
    transaction?: Tx;
    governanceActionId?: number;
    routineShipmentClose?: boolean;
    vatRateOverride?: number;
    strictApSnapshot?: boolean;
    driverOwnedFulfillmentStart?: {
      driverId: number;
      fulfillmentId: number;
    };
  },
  ) {
  // Audit rows for status transitions are produced by the auditLogMiddleware
  // on the corresponding endpoint (POST /dispatch, /lock, /cancel) with full
  // Subject + Verb + Natural Key sentences.
  const execute = async (tx: Tx) => {
    let governanceAuthorized = false;
    if (targetStatus === TripStatus.COMPLETED) {
      await lockTripCloseAggregate(tx, tripId);
    }
    // Accounting-lock activation and operational writes share the canonical
    // shipment -> trip lock order. This prevents a transition racing the
    // accountant from deadlocking while still guaranteeing one winner.
    await assertTripShipmentAccountingUnlocked(tx, tripId);
    const [trip] = await tx.select().from(s.trips).where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (options?.expectedVersion !== undefined && trip.version !== options.expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }

    const currentStatus = trip.status as TripStatus;
    // O2C/Q15: governing completion stays separate from the routine
    // Accountant/CUS close path. Accepting e-POD is necessary evidence, but
    // is never an alternate completion path.
    if (currentStatus === targetStatus) {
      if (targetStatus === TripStatus.CANCELED) {
        throw new ApiError(409, 'Chuyến đi đã bị hủy');
      }
      return trip; // Idempotent short-circuit
    }
    if (
      (targetStatus === TripStatus.COMPLETED && options?.routineShipmentClose !== true)
      || (targetStatus === TripStatus.CANCELED && options?.governanceActionId != null)
    ) {
      assertActiveApprovalApplication(tx, options?.governanceActionId);
      await requirePersistedTripGovernanceAuthorization({
        tx,
        actionId: options?.governanceActionId,
        tripId,
        tripVersion: options?.expectedVersion ?? 0,
        actorId: userId,
        actorRole: userRole,
        operation: targetStatus === TripStatus.COMPLETED ? 'CLOSE' : 'CANCEL_COMPLETED',
      });
      governanceAuthorized = true;
    }

    // Verify role permissions and transition matrix
    if (targetStatus === TripStatus.IN_TRANSIT) {
      // Per docs/flows/01-TRIP_LIFECYCLE.md §2.3, ADMIN/MANAGER/DISPATCHER can dispatch.
      // A DRIVER may start only through the already ownership-checked,
      // fulfillment-scoped acknowledgement path. ACCOUNTANT's trip-write
      // permission is for financial fields only.
      const driverStart = options?.driverOwnedFulfillmentStart;
      const canStartOwnedFulfillment = userRole === Role.DRIVER
        && currentStatus === TripStatus.CREATED
        && driverStart != null
        && trip.driverId === driverStart.driverId
        && trip.fulfillmentId === driverStart.fulfillmentId;
      if (
        userRole !== Role.ADMIN
        && userRole !== Role.MANAGER
        && userRole !== Role.DISPATCHER
        && !canStartOwnedFulfillment
      ) {
        throw new ApiError(
          403,
          'Chỉ Quản lý, Điều phối hoặc Quản trị viên mới có quyền xuất phát chuyến đi',
        );
      }
      if (currentStatus !== TripStatus.CREATED && currentStatus !== TripStatus.COMPLETED) {
        throw new ApiError(409, 'Chỉ có thể xuất phát chuyến đi ở trạng thái Mới tạo hoặc Hoàn thành');
      }
      // Block dispatching a second trip on a truck that is already running
      // another trip — physically a truck can only be on one IN_TRANSIT trip
      // at a time. Without this guard the dispatch page's "Đang chạy" stat
      // stays at 3 even after dispatching more, because it counts unique
      // trucks (not trips) — so the user gets no visible feedback.
      //
      // Advisory lock serializes concurrent dispatches for the same truck —
      // without it, two READ COMMITTED transactions could both see 0 IN_TRANSIT
      // rows and both proceed (phantom-read race).
      if (trip.truckId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${trip.truckId})`);
      }
      const [busyTruck] = trip.truckId ? await tx.select({ id: s.trips.id, tripCode: s.trips.tripCode })
        .from(s.trips)
        .where(and(
          eq(s.trips.truckId, trip.truckId!),
          eq(s.trips.status, TripStatus.IN_TRANSIT),
          isNull(s.trips.deletedAt),
        ))
        .limit(1) : [];
      if (busyTruck && busyTruck.id !== tripId) {
        // Never leak the numeric id — show the trip code or fall back to a
        // generic phrase rather than "#17" which reads like a debug log.
        const busyLabel = busyTruck.tripCode || 'một chuyến khác';
        throw new ApiError(
          409,
          `Xe đang chạy chuyến ${busyLabel}. Vui lòng hoàn thành chuyến đó trước.`,
        );
      }
    } else if (targetStatus === TripStatus.COMPLETED) {
      const routineShipmentClose = options?.routineShipmentClose === true;
      // O2C completion is terminal. Routine shipment close uses approved
      // evidence plus the Kế toán/CUS authority; exception paths keep the
      // existing governed approval requirement.
      // Q18: a completed trip is terminal; it cannot be re-completed directly.
      if (currentStatus === TripStatus.COMPLETED) {
        throw new ApiError(
          409,
          'Chuyến đã chốt chỉ được mở lại bằng yêu cầu có kiểm tra và phê duyệt',
        );
      }
      if (currentStatus !== TripStatus.IN_TRANSIT) {
        throw new ApiError(409, 'Chỉ có thể hoàn thành chuyến đi đang chạy');
      }
      const canComplete = routineShipmentClose
        ? userRole === Role.ACCOUNTANT || userRole === Role.CLERK
        : userRole === Role.ADMIN || userRole === Role.MANAGER;
      if (!canComplete) {
        throw new ApiError(
          403,
          routineShipmentClose
            ? 'Chỉ Kế toán hoặc CUS mới có quyền chốt trực tiếp lô hàng.'
            : 'Chỉ Quản lý hoặc Quản trị viên mới có quyền hoàn thành chuyến đi',
        );
      }
      if (!routineShipmentClose && !governanceAuthorized) {
        throw new ApiError(409, 'Thiếu yêu cầu quản trị đã được phê duyệt');
      }

      // POD-recovery gate (O2C): physical paper return ("Đã thu hồi chứng từ
      // gốc / POD mộc đỏ") must be recorded before completion. Distinct from
      // digital e-POD acceptance. A governed close also requires it — the
      // accountant must have the paper in hand before posting revenue.
      if (trip.podRecoveredAt == null) {
        throw new ApiError(
          409,
          'Chưa thu hồi POD gốc (chứng từ mộc đỏ). Vui lòng đánh dấu đã thu hồi trước khi hoàn thành.',
        );
      }

      // Soft guard on zero-revenue (confirmZeroRevenue override still allowed).
      const revenue = Number(trip.revenue || 0);
      if (revenue === 0 && !confirmZeroRevenue) {
        throw new ApiError(422, 'Doanh thu bằng 0. Vui lòng xác nhận.');
      }

      // Photo evidence gate: require at least 1 photo baseline, and when the
      // trip's cargo type opts into requires_photos, additionally require
      // ≥1 CONTAINER and ≥1 SEAL photo. confirmNoPhoto lets the user override
      // (e.g. legacy trips with no photo evidence).
      if (!confirmNoPhoto) {
        const photos = await tx.select({ type: s.tripPhotos.type })
          .from(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
        const anyCount = photos.length;
        const containerCount = photos.filter(p => p.type === 'CONTAINER').length;
        const sealCount = photos.filter(p => p.type === 'SEAL').length;

        const cargo = trip.cargoTypeId == null
          ? null
          : (await tx.select({ requiresPhotos: s.cargoTypes.requiresPhotos })
            .from(s.cargoTypes)
            .where(eq(s.cargoTypes.id, trip.cargoTypeId))
            .limit(1))[0] ?? null;
        const requiresPhotos = cargo?.requiresPhotos === true; // null/false → baseline only

        if (anyCount < 1) {
          throw new ApiError(422, 'Chưa có ảnh bằng chứng. Vui lòng tải lên ít nhất 1 ảnh hoặc xác nhận hoàn thành không ảnh.');
        }
        if (requiresPhotos && (containerCount < 1 || sealCount < 1)) {
          throw new ApiError(422, 'Loại hàng yêu cầu ảnh: phải có ít nhất 1 ảnh CONTAINER và 1 ảnh SEAL (hoặc xác nhận hoàn thành không ảnh).');
        }
      }
      // Falls through to the generic status update below; the financial posting
      // + postTripCompletion + captureSnapshot fire in the post-update block.
    } else if (targetStatus === TripStatus.CANCELED) {
      if (userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
        throw new ApiError(
          403,
          'Chỉ Quản lý hoặc Quản trị viên mới có quyền hủy chuyến đi',
        );
      }
      if (currentStatus === TripStatus.COMPLETED) {
        if (!governanceAuthorized) {
          throw new ApiError(409, 'Thiếu yêu cầu quản trị đã được phê duyệt');
        }
      }

      const ancillaryFees = currentStatus === TripStatus.COMPLETED
        ? await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, trip.id))
        : [];

      // Canceled: zero all financials. The status predicate is the final
      // winner check after the controlling row lock above.
      const [updated] = await tx.update(s.trips).set({
        status: TripStatus.CANCELED,
        version: sql`${s.trips.version} + 1`,
        fuelLitersOverride: '0',
        fuelSupplementLiters: '0',
        tollsDiscount: '0',
        tollsAddition: '0',
        tollsStations: 0,
        hasReturnCargo: false,
        fuelPriceApplied: '0',
        fuelActualUnitPrice: '0',
        roadAllowanceBaseApplied: '0',
        fuelLoadedNormApplied: '0',
        fuelEmptyNormApplied: '0',
        fuelFixedAllowanceApplied: '0',
        fuelSupplementNormApplied: '0',
        tollPerStationApplied: '0',
        returnCargoBonusApplied: '0',
        fuelLiters: '0',
        totalFuelCost: '0',
        totalRoadAllowance: '0',
        tollCost: '0',
        tollDeduction: '0',
        roadAllowanceOverride: '0',
        totalCost: '0',
        revenue: '0',
        revenueEmptyReturn: '0',
        revenueCombine: '0',
        twoPointDeliveryBonus: '0',
        vehicleShiftAllowance: '0',
        grossProfit: '0',
        revenueOriginal: '0',
        customerCommission: '0',
        tripWageDays: 0,
        vatRate: '0',
        externalFreightCost: '0',
        driverSalary: '0',
        updatedAt: new Date(),
      }).where(and(eq(s.trips.id, tripId), eq(s.trips.status, currentStatus))).returning();

      if (!updated) {
        throw new ApiError(409, 'Chuyến đi đã bị thay đổi bởi người khác. Vui lòng tải lại.');
      }

      if (currentStatus === TripStatus.COMPLETED) {
        const activePosting = await getActiveFinancialPosting(tx, trip.id);
        if (!activePosting) {
          throw new ApiError(409, 'Chuyến chưa có phiên bản hạch toán đang hiệu lực');
        }
        await LedgerService.postTripCompletionReverse(tx, {
          id: trip.id,
          tripCode: trip.tripCode,
          customerId: trip.customerId,
          driverId: trip.driverId ?? null,
          revenue: trip.revenue,
          driverSalary: trip.driverSalary,
          carrierType: trip.carrierType ?? 'OWN',
          externalEntityId: trip.externalEntityId ?? null,
          externalEntityType: trip.externalEntityType ?? null,
          externalFreightCost: trip.externalFreightCost ?? null,
          fuelSupplierId: trip.fuelSupplierId ?? null,
          totalFuelCost: trip.totalFuelCost,
          fuelSurchargeAmount: trip.fuelSurchargeAmount,
          ancillaryFees: ancillaryFees.map(fee => ({
            id: fee.id,
            buyAmount: fee.buyAmount,
            sellAmount: fee.sellAmount,
            settlementMethod: fee.settlementMethod,
            supplierId: fee.supplierId ?? null,
            forwarderId: fee.forwarderId ?? null,
            approvalStatus: fee.approvalStatus,
          })),
        }, { strict: false, financialPostingId: activePosting?.id });
        await createFinancialPosting(tx, {
          tripId: updated.id,
          tripVersion: updated.version,
          reason: 'CANCELLATION',
          governanceActionId: options?.governanceActionId,
          effectiveAt: new Date(),
        });
      }

      await applyTripPairLifecycleEffects(tx, {
        tripId: trip.id,
        activeTripPairId: trip.activeTripPairId ?? null,
        activeTripPairOrder: trip.activeTripPairOrder ?? null,
        targetStatus: TripStatus.CANCELED,
        actorId: userId,
      });

      // Cancel audit row is written by the middleware for POST /cancel
      // ("Quản lý <actor> hủy chuyến <tripCode>") — skip duplicate write.
      return updated;
    }

    const [updated] = await tx.update(s.trips).set({
      status: targetStatus,
      version: sql`${s.trips.version} + 1`,
      ...(targetStatus === TripStatus.COMPLETED
        ? {
            completedAt: new Date(),
            ...(options?.vatRateOverride !== undefined
              ? { vatRate: String(options.vatRateOverride) }
              : {}),
          }
        : {}),
      updatedAt: new Date(),
    }).where(and(eq(s.trips.id, tripId), eq(s.trips.status, currentStatus))).returning();

    if (!updated) {
      throw new ApiError(409, 'Trạng thái chuyến đi đã bị thay đổi bởi người khác. Vui lòng tải lại.');
    }

    if (trip.shipmentId != null) {
      await deriveMilestoneFromTripStatus(
        trip.shipmentId,
        trip.id,
        currentStatus,
        targetStatus,
        userId,
        tx,
      );
    }

    if (targetStatus === TripStatus.COMPLETED && currentStatus === TripStatus.IN_TRANSIT) {
      const ancillaryFees = await tx.select().from(s.tripExpenses)
        .where(eq(s.tripExpenses.tripId, trip.id));

      const posting = await createFinancialPosting(tx, {
        tripId: updated.id,
        tripVersion: updated.version,
        reason: 'COMPLETION',
        governanceActionId: options?.governanceActionId,
        effectiveAt: updated.completedAt ?? new Date(),
      });

      await LedgerService.postTripCompletion(tx, {
        id: updated.id,
        tripCode: updated.tripCode,
        customerId: updated.customerId,
        driverId: updated.driverId ?? null,
        revenue: updated.revenue,
        driverSalary: updated.driverSalary,
        carrierType: updated.carrierType ?? 'OWN',
        externalEntityId: updated.externalEntityId ?? null,
        externalEntityType: updated.externalEntityType ?? null,
        externalFreightCost: updated.externalFreightCost ?? null,
        fuelSupplierId: updated.fuelSupplierId ?? null,
        totalFuelCost: updated.totalFuelCost,
        fuelSurchargeAmount: updated.fuelSurchargeAmount,
        ancillaryFees: ancillaryFees.map(fee => ({
          id: fee.id,
          buyAmount: fee.buyAmount,
          sellAmount: fee.sellAmount,
          settlementMethod: fee.settlementMethod,
          supplierId: fee.supplierId ?? null,
          forwarderId: fee.forwarderId ?? null,
          approvalStatus: fee.approvalStatus,
        })),
      }, { financialPostingId: posting?.id });

      // O2C AR snapshot: capture the canonical cost hash so post-completion cost
      // edits flip ar_snapshot_dirty for the accountant reconciliation view.
      await ArSnapshotService.captureSnapshot(updated.id, tx);
      const apCaptured = await SnapshotServices.captureApWithDegradation(updated.id, tx);
      if (!apCaptured && options?.strictApSnapshot === true) {
        throw new ApiError(500, 'Không thể ghi nhận AP cho chuyến đi. Vui lòng thử lại.');
      }

      if (posting) {
        await captureProfitabilityAttributionSnapshot(tx, updated.id, posting.id);
      }

      await applyTripPairLifecycleEffects(tx, {
        tripId: updated.id,
        activeTripPairId: trip.activeTripPairId ?? null,
        activeTripPairOrder: trip.activeTripPairOrder ?? null,
        targetStatus: TripStatus.COMPLETED,
        actorId: userId,
        completedAt: updated.completedAt ?? null,
      });

      if (updated.fulfillmentId != null) {
        const [fulfillment] = await tx.select({ shipmentId: s.shipmentFulfillments.shipmentId })
          .from(s.shipmentFulfillments)
          .where(eq(s.shipmentFulfillments.id, updated.fulfillmentId))
          .limit(1);
        if (fulfillment) {
          const { recomputeShipmentCompletion } = await import('./shipment.service.js');
          await recomputeShipmentCompletion(fulfillment.shipmentId, { changedBy: userId }, tx);
        }
      }
    }

    // Other transitions (e.g. IN_TRANSIT → COMPLETED triggered from /actuals)
    // are described by their own middleware-generated audit row using natural
    // Vietnamese verbs. We deliberately do NOT write a generic "chuyển trạng
    // thái từ <enum> sang <enum>" row — that previously leaked DB enum values
    // like CREATED / IN_TRANSIT into the audit log and read like a debug log
    // rather than a user-facing activity record.

    return updated;
  };
  return options?.transaction ? execute(options.transaction) : db.transaction(execute);
}
