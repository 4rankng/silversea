/**
 * Staff completion of external-carrier trips — dispatch/CUS close on the
 * driver's behalf (feedback 2026-09-08). External carriers don't use the
 * driver app: no acknowledgement, milestones, or e-POD can ever exist, so
 * the evidence gates of the driver close are unreachable. The staff close
 * reuses the machine's externalCarrierStaffClose bypass instead and lets
 * dispatch/CUS flip the trip to COMPLETED from the dispatch detail plan.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';
import { db, type Tx } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';
import { invalidateReportCaches } from '../lib/report-cache';
import { transitionTripStatus } from './trip-status-machine.service';
import { upsertTripCarrierInfo } from './trip-composite.service';

export interface ExternalTripCompletionResult {
  tripId: number;
  tripCode: string | null;
  fulfillmentId: number | null;
  status: TripStatus;
  version: number;
  completedAt: string | null;
}

export async function completeExternalCarrierTrip(args: {
  tripId: number;
  actorUserId: number;
  actorRole: string;
  /** Optimistic guard when the caller holds a version; optional otherwise. */
  expectedVersion?: number;
  idempotencyKey?: string;
}): Promise<{ trip: ExternalTripCompletionResult; replayed: boolean }> {
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DISPATCH_EXTERNAL_FULFILLMENT_COMPLETE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      tripId: args.tripId,
      actorUserId: args.actorUserId,
      expectedVersion: args.expectedVersion ?? null,
    },
    createdBy: args.actorUserId,
    entityType: 'trip',
    responseStatusCode: 200,
    create: async (tx) => {
      // Fast pre-read for 404/cancel messaging before the machine's
      // row-locked reload does the authoritative checks.
      // Card 20261004_359 — carrierType/externalPlateNumber live in the
      // trip_carrier_info split (Stage A); the tripsComposite view folds the
      // 1:1 splits back together for this read.
      const [trip] = await tx.select({
        id: s.tripsComposite.id,
        tripCode: s.tripsComposite.tripCode,
        fulfillmentId: s.tripsComposite.fulfillmentId,
        shipmentId: s.tripsComposite.shipmentId,
        version: s.tripsComposite.version,
        status: s.tripsComposite.status,
        carrierType: s.tripsComposite.carrierType,
        externalPlateNumber: s.tripsComposite.externalPlateNumber,
      }).from(s.tripsComposite)
        .where(and(eq(s.tripsComposite.id, args.tripId), isNull(s.tripsComposite.deletedAt)))
        .limit(1);
      if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi.');
      if (trip.status === TripStatus.CANCELED) {
        throw new ApiError(409, 'Chuyến đã bị hủy.');
      }
      // Card 20261004_359 — issuing an external dispatch may defer the plate
      // ("Bổ sung sau"), but a trip that actually ran must carry one: the
      // mandatory-plate point moves from issue to completion. The plate rides
      // in through the plate-only update endpoint (Cập nhật biển số).
      if (trip.carrierType === 'EXTERNAL' && trip.externalPlateNumber == null) {
        throw new ApiError(409, 'Chuyến chưa có biển số xe — bổ sung biển (Cập nhật biển số) trước khi hoàn thành.');
      }
      await transitionTripStatus(
        trip.id,
        TripStatus.COMPLETED,
        args.actorUserId,
        args.actorRole,
        true,
        true,
        {
          expectedVersion: args.expectedVersion ?? trip.version,
          transaction: tx,
          externalCarrierStaffClose: { fulfillmentId: trip.fulfillmentId ?? 0 },
        },
      );
      if (trip.shipmentId != null) {
        const { recomputeShipmentCompletion } = await import('./shipment.service.js');
        await recomputeShipmentCompletion(trip.shipmentId, { changedBy: args.actorUserId }, tx);
      }
      const [closed] = await tx.select({
        fulfillmentId: s.trips.fulfillmentId,
        version: s.trips.version,
        completedAt: s.trips.completedAt,
      }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
      return {
        tripId: trip.id,
        tripCode: trip.tripCode,
        fulfillmentId: closed.fulfillmentId,
        status: TripStatus.COMPLETED,
        version: closed.version,
        completedAt: closed.completedAt?.toISOString() ?? null,
      };
    },
    load: async (entityId, tx) => {
      const [closed] = await tx.select({
        tripCode: s.trips.tripCode,
        fulfillmentId: s.trips.fulfillmentId,
        version: s.trips.version,
        completedAt: s.trips.completedAt,
      }).from(s.trips).where(eq(s.trips.id, entityId)).limit(1);
      if (!closed) throw new ApiError(404, 'Không tìm thấy chuyến đi.');
      return {
        tripId: entityId,
        tripCode: closed.tripCode,
        fulfillmentId: closed.fulfillmentId,
        status: TripStatus.COMPLETED,
        version: closed.version,
        completedAt: closed.completedAt?.toISOString() ?? null,
      };
    },
    getEntityId: (value) => value.tripId,
  });

  // The close posts revenue/AP/AR like the driver completion, so every
  // trip-write report cache must bust on create AND replay.
  await invalidateReportCaches();
  return { trip: result, replayed };
}

/* ── SIL-714 (Spec I.4e) — external plate update while the trip awaits its
   biển số. Both Điều vận and CUS may fill/correct the actual plate of a live
   EXTERNAL trip through the small trip-scoped write mounted on /api/shipments
   (the same CUS-admitting shape as the staff close above). OWN-fleet vehicle
   changes stay governed by Hủy phân xe + phân xe mới (SIL-708). */

export interface ExternalTripPlateContext {
  tripId: number;
  tripCode: string | null;
  /** Wire string, not the enum: the composite view's select is a literal union. */
  status: string | null;
  carrierType: 'OWN' | 'EXTERNAL';
  version: number;
  externalPlateNumber: string | null;
}

/** Read one external trip's plate context for the update dialog. */
export async function getExternalTripPlateContext(tripId: number): Promise<ExternalTripPlateContext> {
  const [trip] = await db.select({
    id: s.tripsComposite.id,
    tripCode: s.tripsComposite.tripCode,
    status: s.tripsComposite.status,
    carrierType: s.tripsComposite.carrierType,
    version: s.tripsComposite.version,
    externalPlateNumber: s.tripsComposite.externalPlateNumber,
  }).from(s.tripsComposite)
    .where(and(eq(s.tripsComposite.id, tripId), isNull(s.tripsComposite.deletedAt)))
    .limit(1);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi.');
  return {
    tripId: trip.id,
    tripCode: trip.tripCode,
    status: trip.status,
    carrierType: trip.carrierType === 'EXTERNAL' ? 'EXTERNAL' : 'OWN',
    version: trip.version,
    externalPlateNumber: trip.externalPlateNumber,
  };
}

/** Guard shared by the in-tx write (the route's runShipmentWrite callback). */
function assertExternalPlateUpdateAllowed(trip: ExternalTripPlateContext, expectedVersion: number): void {
  if (trip.carrierType !== 'EXTERNAL') {
    throw new ApiError(409, 'Chỉ chuyến xe ngoài mới cập nhật biển số qua cổng này — xe nhà đổi xe qua Hủy phân xe.');
  }
  if (trip.status === TripStatus.CANCELED) {
    throw new ApiError(409, 'Chuyến đã bị hủy — không thể cập nhật biển số.');
  }
  if (trip.status === TripStatus.COMPLETED) {
    throw new ApiError(409, 'Chuyến đã hoàn thành — không thể cập nhật biển số.');
  }
  if (trip.version !== expectedVersion) {
    throw new ApiError(409, 'Chuyến đi đã bị thay đổi. Vui lòng tải lại.');
  }
}

/**
 * The durable write, executed inside the caller's idempotency transaction
 * (runShipmentWrite at the route): guards re-run in-tx, then the plate patch
 * lands on the carrier sidecar exactly when the trips row's optimistic
 * version increments — a lost race bumps zero rows and 409s.
 */
export async function updateExternalTripPlateInTx(tx: Tx, args: {
  tripId: number;
  externalPlateNumber: string;
  expectedVersion: number;
}): Promise<ExternalTripPlateContext> {
  const [trip] = await tx.select({
    id: s.tripsComposite.id,
    tripCode: s.tripsComposite.tripCode,
    status: s.tripsComposite.status,
    carrierType: s.tripsComposite.carrierType,
    version: s.tripsComposite.version,
    externalPlateNumber: s.tripsComposite.externalPlateNumber,
  }).from(s.tripsComposite)
    .where(and(eq(s.tripsComposite.id, args.tripId), isNull(s.tripsComposite.deletedAt)))
    .limit(1);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi.');
  const context: ExternalTripPlateContext = {
    tripId: trip.id,
    tripCode: trip.tripCode,
    status: trip.status,
    carrierType: trip.carrierType === 'EXTERNAL' ? 'EXTERNAL' : 'OWN',
    version: trip.version,
    externalPlateNumber: trip.externalPlateNumber,
  };
  assertExternalPlateUpdateAllowed(context, args.expectedVersion);

  const [bumped] = await tx.update(s.trips).set({
    version: args.expectedVersion + 1,
    updatedAt: new Date(),
  }).where(and(eq(s.trips.id, args.tripId), eq(s.trips.version, args.expectedVersion))).returning();
  if (!bumped) throw new ApiError(409, 'Chuyến đi đã bị thay đổi. Vui lòng tải lại.');
  await upsertTripCarrierInfo(tx, args.tripId, { externalPlateNumber: args.externalPlateNumber });
  return { ...context, externalPlateNumber: args.externalPlateNumber, version: args.expectedVersion + 1 };
}
