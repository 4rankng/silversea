// Shipment lifecycle core — accountant direct close, fulfillment cancellation,
// and soft delete stay in this file (the material-write registry pins their
// idempotency endpoints to this path); create / update / status-transitions
// live in leaf modules with shared helpers in shipment-lifecycle-shared. This
// file re-exports the leaves' public surface so importers resolve unchanged.
// Conventions carried over from the original module header: Vietnamese
// user-facing messages, optimistic-lock conflicts as 409 with a clear message,
// legal-edge-only status transitions (same-status idempotent), and
// transaction-scoped writes (callers may pass an outer tx).

import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { canonicalShipmentStatus, Role, TripStatus, TripPodStatus } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { normalizeShipmentRow } from './shipment-queries.service';
import {
  assertActorCanAccessShipment,
} from './shipment-coordination.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { transitionTripStatus } from './trip-status-machine.service';
import {
  assertShipmentDirectCloseTripReadiness,
  loadTripExpenseScopeState,
} from './shipment-shared.service';
import type { ShipmentAuthorityTripRow } from './shipment-shared.service';
import { getShipment } from './shipment-detail-reads.service';
import {
  loadShipmentCloseAuthorityContext,
  listRequiredShipmentAuthorityTrips,
} from './shipment-lifecycle-shared.service';
import { recomputeShipmentCompletion } from './shipment-status-transitions.service';

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

  const trips = await tx.select({ id: s.tripsComposite.id, vatRate: s.tripsComposite.vatRate })
    .from(s.tripsComposite)
    .where(and(
      eq(s.tripsComposite.shipmentId, shipmentId),
      isNull(s.tripsComposite.deletedAt),
      eq(s.tripsComposite.status, TripStatus.COMPLETED),
      ...(tripIds && tripIds.length > 0 ? [inArray(s.tripsComposite.id, tripIds)] : []),
    ))
    .orderBy(asc(s.tripsComposite.id));

  return {
    shipment: normalizeShipmentRow(shipment),
    completedTripIds: trips.map((trip) => trip.id),
    vatRate: trips.length > 0 ? Number(trips[0]?.vatRate ?? 0) : 0,
  };
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
      if (canonicalShipmentStatus(shipment.status) !== 'IN_TRANSIT') {
        throw new ApiError(409, 'Chỉ có thể chốt trực tiếp lô hàng đang chạy.');
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
          throw new ApiError(409, 'e-POD đã được xác nhận. Vui lòng ghi nhận điều chỉnh trước khi hủy tác vụ.');
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
          dispatchClassification: fulfillment.cargoMode === CARGO_MODE.LCL ? 'LCL' : (shipment.isCombined ? 'COMBINED' : 'SINGLE'),
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
// Deletion boundary (CTO rule 2026-09-04): a shipment may be tombstoned while
// NONE of its containers has been dispatched — no live (non-deleted,
// non-CANCELED) trip row is linked to the shipment, directly or through a
// fulfillment. Carrier allocations (PLANNED, no trip yet) and canceled legs do
// not block deletion; once any container is dispatched the shipment must go
// through the cancel flow instead, so the audit trail and linked trips are
// preserved.

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

    const [liveTrip] = await tx.select({ id: s.trips.id })
      .from(s.trips)
      .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
      .where(and(
        isNull(s.trips.deletedAt),
        ne(s.trips.status, 'CANCELED'),
        or(
          eq(s.trips.shipmentId, shipmentId),
          eq(s.shipmentFulfillments.shipmentId, shipmentId),
        ),
      ))
      .limit(1);
    if (liveTrip) {
      throw new ApiError(
        409,
        'Không thể xóa lô hàng đã có container được điều xe. Chỉ xóa được khi mọi container chưa phát lệnh.',
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

// ── Compatibility re-exports (leaf surface, named only) ─────────────────────
export type {
  CreateShipmentInput,
  ShipmentUpdateResult,
  ShipmentFulfillmentRow,
  ShipmentCloseAuthorityContext,
} from './shipment-lifecycle-shared.service';
export {
  assertShipmentFactorySiteValid,
} from './shipment-lifecycle-shared.service';
export {
  formatShipmentCode,
  createShipment,
  createShipmentIdempotent,
} from './shipment-create.service';
export { updateShipment } from './shipment-update.service';
export {
  transitionShipmentStatus,
  recomputeShipmentCompletion,
} from './shipment-status-transitions.service';
