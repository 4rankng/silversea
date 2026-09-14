import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { TripPodStatus } from '@tingting/shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { tripCompositeSelect } from './trip-composite.service';
import type { Tx } from './trip-shared';

export interface TripCloseEvidenceSnapshot {
  acceptedPodSubmissionId: number;
  acceptedPodSubmissionVersion: number;
  acceptedPodSourceTripVersion: number;
}

/**
 * Locks the shipment aggregate in one global order used by both Ops scope
 * completion and governed close: shipment -> fulfillments -> trips. Evidence
 * rows and scope advisory locks are acquired only after this helper returns.
 */
export async function lockTripCloseAggregate(tx: Tx, tripId: number) {
  const [reference] = await tx.select({ shipmentId: s.trips.shipmentId })
    .from(s.trips)
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1);
  if (!reference) throw new ApiError(404, 'Không tìm thấy chuyến đi');

  if (reference.shipmentId != null) {
    await tx.select({ id: s.shipments.id }).from(s.shipments)
      .where(eq(s.shipments.id, reference.shipmentId))
      .limit(1)
      .for('update');
    await tx.select({ id: s.shipmentFulfillments.id }).from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, reference.shipmentId))
      .orderBy(asc(s.shipmentFulfillments.id))
      .for('update');
    await tx.select({ id: s.trips.id }).from(s.trips)
      .where(and(eq(s.trips.shipmentId, reference.shipmentId), isNull(s.trips.deletedAt)))
      .orderBy(asc(s.trips.id))
      .for('update');
  }

  const [trip] = await tx.select(tripCompositeSelect())
    .from(s.trips)
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1)
    .for('update', { of: [s.trips] });
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  return trip;
}

/**
 * Proves the two independent O2C handoffs required before financial close:
 * the current e-POD version is accepted and Ops has completed the general
 * expense scope plus every container expense scope.
 */
export async function requireTripCloseReadiness(
  tx: Tx,
  tripId: number,
): Promise<TripCloseEvidenceSnapshot> {
  const submissions = await tx.select({
    id: s.tripPodSubmissions.id,
    status: s.tripPodSubmissions.status,
    submissionVersion: s.tripPodSubmissions.submissionVersion,
    sourceTripVersion: s.tripPodSubmissions.sourceTripVersion,
  }).from(s.tripPodSubmissions)
    .where(eq(s.tripPodSubmissions.tripId, tripId))
    .orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id))
    .limit(1)
    .for('update');
  const currentPod = submissions[0];
  // Internal e-POD approval removed: a saved submission (not a draft, not
  // customer-rejected) satisfies the close precondition.
  if (
    !currentPod
    || currentPod.status === TripPodStatus.DRAFT
    || currentPod.status === TripPodStatus.REJECTED
  ) {
    throw new ApiError(409, 'Chưa có e-POD hợp lệ. Không thể chốt tài chính chuyến đi.');
  }

  const [containers, scopes] = await Promise.all([
    tx.select({ id: s.tripContainers.id })
      .from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, tripId))
      .for('update'),
    tx.select({
      tripContainerId: s.tripExpenseCompletionScopes.tripContainerId,
      status: s.tripExpenseCompletionScopes.status,
    }).from(s.tripExpenseCompletionScopes)
      .where(eq(s.tripExpenseCompletionScopes.tripId, tripId))
      .for('update'),
  ]);
  const completedKeys = new Set(
    scopes
      .filter((scope) => scope.status === 'COMPLETED')
      .map((scope) => scope.tripContainerId == null ? 'general' : String(scope.tripContainerId)),
  );
  const missingGeneral = !completedKeys.has('general');
  const missingContainerIds = containers
    .map((container) => container.id)
    .filter((containerId) => !completedKeys.has(String(containerId)));
  if (missingGeneral || missingContainerIds.length > 0) {
    throw new ApiError(
      409,
      'Ops chưa xác nhận hoàn tất kê khai chi phí chung và toàn bộ container.',
    );
  }

  return {
    acceptedPodSubmissionId: currentPod.id,
    acceptedPodSubmissionVersion: currentPod.submissionVersion,
    acceptedPodSourceTripVersion: currentPod.sourceTripVersion,
  };
}

export function assertTripCloseEvidenceBinding(
  persisted: Record<string, unknown> | null | undefined,
  current: TripCloseEvidenceSnapshot,
): void {
  if (
    persisted?.acceptedPodSubmissionId !== current.acceptedPodSubmissionId
    || persisted?.acceptedPodSubmissionVersion !== current.acceptedPodSubmissionVersion
    || persisted?.acceptedPodSourceTripVersion !== current.acceptedPodSourceTripVersion
  ) {
    throw new ApiError(
      409,
      'e-POD đã thay đổi sau khi tạo yêu cầu. Vui lòng tạo yêu cầu chốt mới.',
    );
  }
}
