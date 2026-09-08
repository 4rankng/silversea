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
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';
import { invalidateReportCaches } from '../lib/report-cache';
import { transitionTripStatus } from './trip-status-machine.service';

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
      const [trip] = await tx.select({
        id: s.trips.id,
        tripCode: s.trips.tripCode,
        fulfillmentId: s.trips.fulfillmentId,
        shipmentId: s.trips.shipmentId,
        version: s.trips.version,
        status: s.trips.status,
      }).from(s.trips)
        .where(and(eq(s.trips.id, args.tripId), isNull(s.trips.deletedAt)))
        .limit(1);
      if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi.');
      if (trip.status === TripStatus.CANCELED) {
        throw new ApiError(409, 'Chuyến đã bị hủy.');
      }
      await transitionTripStatus(
        trip.id,
        TripStatus.COMPLETED,
        args.actorUserId,
        args.actorRole,
        true,
        true,
        {
          expectedVersion: trip.version,
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
