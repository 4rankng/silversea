// Shipment status machine: legal-transition table, customer-visible status
// events, status transitions, and evidence-driven completion recompute.
// Extracted from shipment-lifecycle.service.ts verbatim (pure code movement).
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, TripStatus, TripPodStatus } from '@tingting/shared';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import type { ShipmentStatus } from './shipment-types';
import { createCustomerVisibleEvent } from './shipment-coordination.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import {
  ensureReadyShipmentHandoff,
  hasDispatchDate,
} from './shipment-intake.service';
import {
  hasCompletedExpenseScopes,
  loadTripExpenseScopeState,
} from './shipment-shared.service';
import {
  loadShipmentCloseAuthorityContext,
  listRequiredShipmentAuthorityTrips,
} from './shipment-lifecycle-shared.service';

// ─── Status machine ─────────────────────────────────────────────────────────
//
// Mirrors the lifecycle implied by the `shipment_status` enum + phase-01
// "booking → documents → dispatch → delivery → debit-note":
//
//   PENDING_DATE ──► READY_FOR_DISPATCH ──► DISPATCHED ──► IN_TRANSIT
//                                                    ──► PENDING_EXPENSE_APPROVAL
//                                                    ──► COMPLETED
//                            ▲                    │
//                            └────────────────────┘
//                                               └──► CANCELED
//
// Operational regressions are allowed before COMPLETED when the underlying
// dispatch/evidence state changes (for example a rejected e-POD moves a
// shipment back out of pending approval). COMPLETED and CANCELED remain
// terminal.
const LEGAL_TRANSITIONS: Record<string, readonly string[]> = {
  NEW: ['READY_FOR_DISPATCH', 'CANCELED'],
  PENDING_DATE: ['READY_FOR_DISPATCH', 'CANCELED'],
  READY_FOR_DISPATCH: ['DISPATCHED', 'CANCELED'],
  DISPATCHED: ['IN_TRANSIT', 'CANCELED'],
  IN_TRANSIT: ['DISPATCHED', 'PENDING_EXPENSE_APPROVAL', 'CANCELED'],
  PENDING_EXPENSE_APPROVAL: ['DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
};

const CUSTOMER_VISIBLE_SHIPMENT_STATUS_COPY: Partial<Record<ShipmentStatus, {
  title: string;
  message: string;
}>> = {
  IN_TRANSIT: {
    title: 'Đang vận chuyển',
    message: 'Lô hàng đang được vận chuyển.',
  },
  COMPLETED: {
    title: 'Đã giao hàng',
    message: 'Lô hàng đã được giao.',
  },
};
export function assertLegalTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (from === to) return; // Idempotent — transitionShipmentStatus handles same-status no-op before calling.
  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ApiError(
      409,
      `Không thể chuyển lô hàng từ "${from}" sang "${to}".`,
    );
  }
}

export async function createShipmentStatusCustomerVisibleEvent(
  tx: Tx,
  shipmentId: number,
  statusHistoryId: number,
  targetStatus: ShipmentStatus,
  createdBy: number,
  occurredAt: Date,
): Promise<void> {
  const copy = CUSTOMER_VISIBLE_SHIPMENT_STATUS_COPY[targetStatus];
  if (!copy) return;

  await createCustomerVisibleEvent({
    shipmentId,
    eventKey: `shipment:${shipmentId}:status-history:${statusHistoryId}`,
    eventType: 'MILESTONE',
    title: copy.title,
    message: copy.message,
    occurredAt,
    createdBy,
  }, undefined, tx);
}
// ─── Status transitions ─────────────────────────────────────────────────────

export async function transitionShipmentStatus(
  shipmentId: number,
  targetStatus: ShipmentStatus,
  options: { reason?: string | null; changedBy?: number | null } = {},
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);

    const currentStatus = canonicalShipmentStatus(shipment.status);
    if (!currentStatus) {
      throw new ApiError(409, 'Trạng thái lô hàng không hợp lệ.');
    }

    // Idempotent: same target → no-op, return current row without writing a
    // duplicate history row (mirrors trip-status-machine's short-circuit).
    if (currentStatus === targetStatus) return shipment;

    if (targetStatus === 'READY_FOR_DISPATCH' && !hasDispatchDate(shipment)) {
      throw new ApiError(409, 'Cần nhập ngày vận chuyển, giờ đóng hoặc thời gian trả hàng trước khi sẵn sàng điều xe.');
    }

    assertLegalTransition(currentStatus, targetStatus);
    const transitionedAt = new Date();

    // Conditional update guards against concurrent transition races.
    const [updated] = await tx.update(s.shipments).set({
      status: targetStatus,
      version: sql`${s.shipments.version} + 1`,
      updatedAt: transitionedAt,
    })
      .where(and(eq(s.shipments.id, shipmentId), eq(s.shipments.status, shipment.status ?? currentStatus)))
      .returning();

    if (!updated) {
      throw new ApiError(
        409,
        'Trạng thái lô hàng đã bị thay đổi bởi người khác. Vui lòng tải lại.',
      );
    }

    const [historyRow] = await tx.insert(s.shipmentStatusHistory).values({
      shipmentId,
      fromStatus: shipment.status ?? currentStatus,
      toStatus: targetStatus,
      reason: options.reason ?? null,
      changedBy: options.changedBy ?? null,
      changedAt: transitionedAt,
    }).returning({ id: s.shipmentStatusHistory.id });
    const eventActorId = options.changedBy ?? null;
    if (eventActorId != null && historyRow) {
      await createShipmentStatusCustomerVisibleEvent(
        tx,
        shipmentId,
        historyRow.id,
        targetStatus,
        eventActorId,
        transitionedAt,
      );
    }
    if (targetStatus === 'READY_FOR_DISPATCH') {
      await ensureReadyShipmentHandoff(tx, updated, eventActorId);
    }

    return updated;
  };
  return runInTx(transaction, execute);
}
export async function recomputeShipmentCompletion(
  shipmentId: number,
  options: { changedBy?: number | null } = {},
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) {
      throw new ApiError(404, 'Không tìm thấy lô hàng.');
    }
    const currentShipmentStatus = canonicalShipmentStatus(shipment.status);
    if (currentShipmentStatus === 'CANCELED' || currentShipmentStatus === 'COMPLETED') {
      return shipment;
    }

    const { fulfillmentRows, requiredFulfillments } = await loadShipmentCloseAuthorityContext(tx, shipmentId);
    if (fulfillmentRows.length === 0) {
      return shipment;
    }
    if (requiredFulfillments.length === 0) {
      if (
        currentShipmentStatus === 'PENDING_DATE'
        || currentShipmentStatus === 'READY_FOR_DISPATCH'
        || currentShipmentStatus === 'DISPATCHED'
      ) {
        return shipment;
      }
      return transitionShipmentStatus(
        shipmentId,
        'DISPATCHED',
        {
          reason: 'Tự động giữ trạng thái Đã phân xe vì lô hàng chưa còn tác vụ bắt buộc.',
          changedBy: options.changedBy ?? null,
        },
        tx,
      );
    }

    const requiredFulfillmentIds = requiredFulfillments.map((row) => row.id);
    const trips = await listRequiredShipmentAuthorityTrips(tx, requiredFulfillmentIds);
    const tripsByFulfillment = new Map<number, typeof trips>();
    for (const trip of trips) {
      const fulfillmentId = trip.fulfillmentId;
      if (fulfillmentId == null) continue;
      const existing = tripsByFulfillment.get(fulfillmentId) ?? [];
      existing.push(trip);
      tripsByFulfillment.set(fulfillmentId, existing);
    }

    const latestSubmissionRows = trips.length === 0
      ? []
      : await tx.select({
        tripId: s.tripPodSubmissions.tripId,
        status: s.tripPodSubmissions.status,
      }).from(s.tripPodSubmissions)
        .where(inArray(s.tripPodSubmissions.tripId, trips.map((trip) => trip.id)))
        .orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id))
        .for('update');
    const latestSubmissionByTripId = new Map<number, TripPodStatus>();
    for (const row of latestSubmissionRows) {
      if (!latestSubmissionByTripId.has(row.tripId)) {
        latestSubmissionByTripId.set(row.tripId, row.status as TripPodStatus);
      }
    }

    const acceptedSubmissions = trips.length === 0
      ? []
      : await tx.select({
        tripId: s.tripPodSubmissions.tripId,
      }).from(s.tripPodSubmissions)
        .where(and(
          inArray(s.tripPodSubmissions.tripId, trips.map((trip) => trip.id)),
          eq(s.tripPodSubmissions.status, TripPodStatus.ACCEPTED),
        ))
        .for('update');
    const acceptedTripIds = new Set(acceptedSubmissions.map((row) => row.tripId));

    const tripIds = trips.map((trip) => trip.id);
    const {
      completedExpenseScopeKeys,
      containersByTrip,
    } = await loadTripExpenseScopeState(tx, tripIds);

    const allRequiredTripsPresent = requiredFulfillments.every((row) => {
      const linkedTrips = tripsByFulfillment.get(row.id) ?? [];
      return linkedTrips.length === 1;
    });
    // Distinguish the "some planned carriers have not dispatched yet" case
    // (mixed shipment — at least one trip exists, some fulfillments still
    // pending) from the "no trips at all" case. The former should continue
    // through the recompute so a driver-completed trip can lift the
    // shipment off DISPATCHED → PENDING_EXPENSE_APPROVAL (see
    // `anyFulfillmentCompletedViaDriver` below). The latter (every
    // required fulfillment missing its trip) still falls back to the
    // DISPATCHED rewind so the workboard doesn't get stuck.
    const anyRequiredTripDispatched = requiredFulfillments.some((row) => {
      const linkedTrips = tripsByFulfillment.get(row.id) ?? [];
      return linkedTrips.length >= 1;
    });
    if (!allRequiredTripsPresent && !anyRequiredTripDispatched) {
      if (
        currentShipmentStatus === 'PENDING_DATE'
        || currentShipmentStatus === 'READY_FOR_DISPATCH'
        || currentShipmentStatus === 'DISPATCHED'
      ) {
        return shipment;
      }
      return transitionShipmentStatus(
          shipmentId,
          'DISPATCHED',
          {
            reason: 'Tự động quay về Đã phân xe vì tác vụ bắt buộc chưa xuất phát hoặc cần điều phối lại.',
            changedBy: options.changedBy ?? null,
          },
          tx,
        );
    }

    const allCompleted = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      return trip != null && trip.status === 'COMPLETED';
    });
    const allExpenseScopesComplete = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      return trip != null && hasCompletedExpenseScopes(
        trip.id,
        containersByTrip.get(trip.id) ?? [],
        completedExpenseScopeKeys,
      );
    });
    const anyInTransit = trips.some((trip) => trip.status === TripStatus.IN_TRANSIT);
    const allAwaitingApproval = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      const latestSubmissionStatus = trip == null ? null : latestSubmissionByTripId.get(trip.id) ?? null;
      return trip != null
        && latestSubmissionStatus != null
        && hasCompletedExpenseScopes(
          trip.id,
          containersByTrip.get(trip.id) ?? [],
          completedExpenseScopeKeys,
        )
        && (latestSubmissionStatus === TripPodStatus.SUBMITTED || latestSubmissionStatus === TripPodStatus.ACCEPTED);
    });
    const allCompletedAndAccepted = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      return trip != null && trip.status === 'COMPLETED'
        && hasCompletedExpenseScopes(
          trip.id,
          containersByTrip.get(trip.id) ?? [],
          completedExpenseScopeKeys,
        )
        && acceptedTripIds.has(trip.id)
        && trip.podRecoveredAt != null;
    });

    // Driver "Hoàn thành chuyến" full-close path: every required fulfillment's
    // trip is COMPLETED with a SUBMITTED/ACCEPTED e-POD, but the accountant
    // review gates (expense scopes + podRecoveredAt) are not yet satisfied
    // because the accountant flow was deliberately skipped ("skip kế toán
    // for now, we build later"). The trip is operationally done — advance
    // the shipment so CUS/Dispatcher see "Hoàn thành" instead of a stale
    // "Chờ duyệt phí". When the accountant review is reintroduced, this
    // condition narrows back to `allCompletedAndAccepted` and the strict
    // gates resume.
    const allCompletedViaDriverClose = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      const latestSubmissionStatus = trip == null ? null : latestSubmissionByTripId.get(trip.id) ?? null;
      return trip != null
        && trip.status === 'COMPLETED'
        && latestSubmissionStatus != null
        && (latestSubmissionStatus === TripPodStatus.SUBMITTED || latestSubmissionStatus === TripPodStatus.ACCEPTED);
    });

    // Multi-fulfillment partial close: at least one required fulfillment's
    // trip is COMPLETED with a SUBMITTED/ACCEPTED e-POD, but other required
    // fulfillments are still pending (planned carrier allocation with no
    // dispatched trip yet). The driver-closed trip should reflect on the
    // shipment — advance to PENDING_EXPENSE_APPROVAL so CUS/Dispatcher see
    // "Chờ duyệt phí" instead of the misleading "Đang chạy". The remaining
    // planned carriers are still tracked at the container level (dispatch
    // status = PLANNED) and will be re-evaluated when the next trip is
    // dispatched. When all required fulfillments eventually complete, the
    // `allCompletedViaDriverClose` branch above fires and the shipment
    // jumps to COMPLETED.
    const anyFulfillmentCompletedViaDriver = requiredFulfillments.some((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      const latestSubmissionStatus = trip == null ? null : latestSubmissionByTripId.get(trip.id) ?? null;
      return trip != null
        && trip.status === 'COMPLETED'
        && latestSubmissionStatus != null
        && (latestSubmissionStatus === TripPodStatus.SUBMITTED || latestSubmissionStatus === TripPodStatus.ACCEPTED);
    });

    // Driver evidence handoff (DISABLED 2026-08-29 — user instruction "skip
    // kế toán for now, we build later"). When the accountant review flow is
    // reintroduced, restore the PENDING_EXPENSE_APPROVAL advance so CUS/Dis-
    // patcher can see "Chờ duyệt phí" right after e-POD submission. For now
    // we keep the shipment in its current operational state (IN_TRANSIT) until
    // the driver full-closes the trip — only that path advances to COMPLETED.
    // const allDriverEvidenceSubmitted = requiredFulfillments.every((row) => {
    //   const trip = tripsByFulfillment.get(row.id)?.[0];
    //   const latestSubmissionStatus = trip == null ? null : latestSubmissionByTripId.get(trip.id) ?? null;
    //   return trip != null
    //     && trip.status === TripStatus.IN_TRANSIT
    //     && trip.podRecoveredAt == null
    //     && latestSubmissionStatus != null
    //     && (latestSubmissionStatus === TripPodStatus.SUBMITTED || latestSubmissionStatus === TripPodStatus.ACCEPTED);
    // });

    let targetStatus: ShipmentStatus = 'DISPATCHED';
    let reason = 'Tự động cập nhật theo tình trạng điều xe hiện tại.';
    if (allCompletedViaDriverClose) {
      targetStatus = 'COMPLETED';
      reason = 'Tài xế đã hoàn thành chuyến. Lô hàng chuyển sang Hoàn thành (kế toán review sẽ xử lý chi phí sau).';
    } else if (allCompletedAndAccepted) {
      targetStatus = 'COMPLETED';
      reason = 'Tự động hoàn thành khi mọi tác vụ đã duyệt e-POD, thu hồi POD gốc và chốt xong.';
    } else if (allAwaitingApproval || (allCompleted && allExpenseScopesComplete)) {
      targetStatus = 'PENDING_EXPENSE_APPROVAL';
      reason = 'Tự động chuyển sang Chờ duyệt phí khi mọi tác vụ đã nộp đủ hồ sơ chờ kế toán/CUS duyệt.';
    } else if (anyFulfillmentCompletedViaDriver) {
      // Multi-fulfillment partial close: at least one driver-closed trip is
      // complete, but other planned carriers are still pending. Advance the
      // shipment so the CUS workspace badge + Dispatcher trips list show
      // "Chờ duyệt phí" (the trip-level container badge already shows
      // "Hoàn thành" via dispatchStatus) instead of a stale "Đang chạy".
      // The remaining planned carriers are still tracked at the container
      // level (dispatchStatus = PLANNED) and will be re-evaluated when the
      // next trip is dispatched. When the last required fulfillment
      // eventually closes, `allCompletedViaDriverClose` fires and the
      // shipment jumps to COMPLETED.
      targetStatus = 'PENDING_EXPENSE_APPROVAL';
      reason = 'Tài xế đã hoàn thành một phần lô hàng. Chuyển sang Chờ duyệt phí cho phần đã đóng; những tác vụ còn lại sẽ được cập nhật khi phát lệnh tiếp.';
    } else if (anyInTransit && allRequiredTripsPresent) {
      // Only advance the shipment to IN_TRANSIT when every required
      // fulfillment has a dispatched trip. A shipment with mixed
      // dispatched + planned-carrier fulfillments stays at DISPATCHED
      // until either (a) all planned carriers get a trip too, or
      // (b) the driver-closed trip drives the partial close above.
      targetStatus = 'IN_TRANSIT';
      reason = 'Tự động chuyển sang Đang chạy khi đã có chuyến xuất phát.';
    }

    if (currentShipmentStatus === targetStatus) return shipment;

    // Never skip a PRD lifecycle state, including when legacy data or a
    // replayed event arrives after downstream evidence has already been
    // submitted. Each intermediate transition is auditable in status history.
    let current: ShipmentStatus = currentShipmentStatus as ShipmentStatus;
    let currentRow = shipment;
    if (current === 'READY_FOR_DISPATCH') {
      currentRow = await transitionShipmentStatus(shipmentId, 'DISPATCHED', {
        reason: 'Khôi phục trạng thái Đã phân xe trước khi ghi nhận kết quả vận hành.',
        changedBy: options.changedBy ?? null,
      }, tx);
      current = 'DISPATCHED';
    }
    if (
      current === 'DISPATCHED'
      && (targetStatus === 'PENDING_EXPENSE_APPROVAL' || targetStatus === 'COMPLETED')
    ) {
      currentRow = await transitionShipmentStatus(shipmentId, 'IN_TRANSIT', {
        reason: 'Khôi phục trạng thái Đang chạy trước khi ghi nhận hồ sơ vận hành.',
        changedBy: options.changedBy ?? null,
      }, tx);
      current = 'IN_TRANSIT';
    }
    if (current === 'IN_TRANSIT' && targetStatus === 'COMPLETED') {
      currentRow = await transitionShipmentStatus(shipmentId, 'PENDING_EXPENSE_APPROVAL', {
        reason: 'Ghi nhận bước Chờ duyệt phí trước khi hoàn thành.',
        changedBy: options.changedBy ?? null,
      }, tx);
      current = 'PENDING_EXPENSE_APPROVAL';
    }
    if (current === targetStatus) return currentRow;
    return transitionShipmentStatus(shipmentId, targetStatus, {
      reason,
      changedBy: options.changedBy ?? null,
    }, tx);
  };

  return runInTx(transaction, execute);
}
