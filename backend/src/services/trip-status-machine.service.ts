// Trip Status Machine — Status transition logic and validation
// transitionTripStatus with all role checks, guard conditions, and ledger integration


import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { acquireAdvisoryLock, lockKeys } from './advisory-lock.service';
import { eq, and, isNull, ne, or, sql } from 'drizzle-orm';
import { TripStatus, Role, localDateInBusinessZone } from '@tingting/shared';
import { isTripRunningOnDepartureDay, isActiveKepPairPartner, isDeclaredKepClampPartner, isSameRigLclSharePartner } from './trip-busy-gate';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { applyTripPairLifecycleEffects } from './trip-pairs.service';
import { materializeCompletedTripEconomics } from './trip-completion-economics.service';
import {
  getTripCompositeInTx, splitTripPatch, tripCompositeSelect,
  upsertTripCarrierInfo, upsertTripFinancialState,
} from './trip-composite.service';
import { assertActiveDirectApplication } from './governance-action-core.service';
import { deriveMilestoneFromTripStatus } from './milestone.service';
import {
  createFinancialPosting,
  getActiveFinancialPosting,
} from './financial-posting.service';
import { captureProfitabilityAttributionSnapshot } from './profitability.service';
import { ArSnapshotService } from './trip-snapshots.service';
import { SnapshotServices } from './snapshot-services';
import { lockTripCloseAggregate } from './trip-close-readiness.service';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { rewindShipmentAfterLastLiveTripCancel } from './shipment-status-transitions.service';
import { getDriverCompletionEvidenceStatus } from './trip-pod.service';
import { syncTimesheetSymbolForTrip } from './timesheet-auto-symbol.service';

/** Card 061026221826: Ngày hoàn thành never precedes Ngày khởi hành. The VN
 *  wall-clock date of the completion instant is compared against the planned
 *  departure date (same-day completion is normal); a missing departure date
 *  (legacy rows) skips the check. Shared by the completion transition and the
 *  manual actuals edit. */
export function assertCompletionNotBeforeDeparture(
  completedAt: Date,
  departureDate: string | Date | null | undefined,
): void {
  if (!departureDate) return;
  const dep = typeof departureDate === 'string' ? departureDate.slice(0, 10) : departureDate.toISOString().slice(0, 10);
  const vnDate = new Date(completedAt.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  if (vnDate < dep) throw new ApiError(400, 'Ngày hoàn thành không thể trước ngày khởi hành.');
}

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
    /**
     * Driver "Hoàn thành chuyến" full-close path: the driver has submitted
     * the e-POD for their own trip, and the system flips the trip straight to
     * COMPLETED (skipping the "Chờ duyệt phí" hand-off). The shipment
     * recompute is then responsible for advancing the shipment state.
     *
     * Q15 maker-checker is bypassed here on the user's explicit instruction
     * ("skip kế toán for now, we build later"). When the accountant review
     * flow is reintroduced, this option will be removed and the standard
     * routineShipmentClose + governance path will own the COMPLETED
     * transition again.
     */
    driverOwnedFulfillmentClose?: {
      driverId: number;
      fulfillmentId: number;
    };
    /**
     * Dispatch/CUS close for external-carrier trips: the external driver
     * never uses the app, so nobody can supply the e-POD that gates the
     * driver close — dispatch/CUS complete the trip on the driver's behalf
     * (feedback 2026-09-08). Same bypass semantics as the driver close:
     * no governed action, no photo/zero-revenue confirmations.
     */
    externalCarrierStaffClose?: {
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
    // Trips-split: composed row (ops + financial + carrier sidecars); the row
    // lock stays on trips only (`of`), matching the pre-split lock footprint.
    const [trip] = await tx.select(tripCompositeSelect())
      .from(s.trips)
      .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
      .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
      .where(eq(s.trips.id, tripId))
      .limit(1)
      .for('update', { of: [s.trips] });
    // Card 061026221826: completing before the planned departure date stamps
    // the exact nonsense /trips/135 showed — refuse before any write.
    if (targetStatus === TripStatus.COMPLETED) {
      assertCompletionNotBeforeDeparture(new Date(), trip.departureDate);
    }
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
    // Driver full-close path skips the governance action — the driver's
    // e-POD submission IS the evidence handoff. The standard exception
    // (routineShipmentClose → Accountant/CUS direct close) keeps the
    // existing check; the CANCELED branch only fires for governance-gated
    // cancellations, so it is unchanged.
    if (
      (options?.driverOwnedFulfillmentClose || options?.externalCarrierStaffClose)
      && targetStatus === TripStatus.COMPLETED
    ) {
      governanceAuthorized = true;
    } else if (
      (targetStatus === TripStatus.COMPLETED && options?.routineShipmentClose !== true)
      || (targetStatus === TripStatus.CANCELED && options?.governanceActionId != null)
    ) {
      // 2026-09-11 maker-checker removal: the cross-person persisted
      // authorization is gone with governance_actions; the in-memory
      // approval-application guard carries the apply-time authorization.
      assertActiveDirectApplication(tx, options?.governanceActionId);
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
      if (currentStatus === TripStatus.COMPLETED) {
        throw new ApiError(
          409,
          'Chuyến đã chốt chỉ được mở lại bằng thao tác mở lại tài chính có quyền và lý do hợp lệ',
        );
      }
      if (currentStatus !== TripStatus.CREATED) {
        throw new ApiError(409, 'Chỉ có thể xuất phát chuyến đi ở trạng thái Mới tạo');
      }
      // Unrelated trips cannot share a running truck. A persisted ACTIVE
      // KEP pair is the exception: its two 20ft containers run together.
      // A DOUBLE display classification alone never establishes that pair.
      //
      // Advisory lock serializes concurrent dispatches for the same truck —
      // without it, two READ COMMITTED transactions could both see 0 IN_TRANSIT
      // rows and both proceed (phantom-read race).
      if (trip.truckId) {
        await acquireAdvisoryLock(tx, lockKeys.tripTruckTransition(trip.truckId));
      }
      const busyTrips = trip.truckId ? await tx.select({
        id: s.trips.id, tripCode: s.trips.tripCode,
        driverId: s.trips.driverId,
        departureDate: s.trips.departureDate,
        // SIL-798 — the blocking reference the 409 must name: the trip's
        // business identifier (Số Bill / Số Booking, the §8 display law) so
        // the driver banner can link the actual blocking work without a
        // client-side board roundtrip or regex parsing.
        blockingLabel: sql<string | null>`nullif(coalesce(nullif(${s.shipments.blNumber}, ''), nullif(${s.shipments.bookingRef}, '')), '')`,
        // SIL-634: the busy row's fulfillment classification — the declared
        // clamp proof needs both legs' "Phân loại" to be Kẹp (DOUBLE).
        fulfillmentClassification: s.shipmentFulfillments.dispatchClassification,
      })
        .from(s.trips)
        .leftJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
        .leftJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
        .where(and(
          eq(s.trips.truckId, trip.truckId!),
          eq(s.trips.status, TripStatus.IN_TRANSIT),
          isNull(s.trips.deletedAt),
          ne(s.trips.id, tripId),
        )) : [];
      // Driver completion (Q15) hands off evidence but deliberately leaves the
      // trip IN_TRANSIT until the independently approved financial close — the
      // journey board already buckets such trips into HISTORY. Operationally
      // the truck is free once the driver delivered the full milestone set
      // (card 261022213755a: e-POD photos are optional evidence, so
      // evidence-ready no longer waits on a submitted e-POD); only
      // still-running trips block a new departure on the same truck.
      // SIL-474: a row whose planned departure day has not arrived is not a
      // running truck — an early "Xuất phát"/"Nhận lệnh" parks future trips
      // in IN_TRANSIT (the enum has no ASSIGNED state), and such a row used
      // to freeze the truck for every other order until the date passed.
      // Today's Asia/Ho_Chi_Minh date is computed once per transition; the
      // running decision lives in trip-busy-gate so tests share the real
      // predicate.
      const todayInBusinessZone = localDateInBusinessZone(new Date());
      // SIL-602/SIL-631: resolve the trip's OWN ACTIVE KEP pair ROW — the
      // pair row's membership is the pair identity (see isActiveKepPairPartner).
      // Fast path: the self stamp. SIL-631 fallback: when the stamp yields
      // nothing (lost or drifted pointer bookkeeping), resolve by membership
      // so a valid pair still exempts its own second leg. KET_HOP stays
      // excluded — its sequencing gate is the sole owner of that pair kind.
      let kepPair: { firstTripId: number; secondTripId: number } | null = null;
      if (trip.activeTripPairId != null) {
        const [pair] = await tx.select({ firstTripId: s.tripPairs.firstTripId, secondTripId: s.tripPairs.secondTripId })
          .from(s.tripPairs).where(and(
            eq(s.tripPairs.id, trip.activeTripPairId),
            eq(s.tripPairs.status, 'ACTIVE'),
            eq(s.tripPairs.pairKind, 'KEP'),
          )).limit(1);
        if (pair && (pair.firstTripId === tripId || pair.secondTripId === tripId)) kepPair = pair;
      }
      if (kepPair == null) {
        const [pair] = await tx.select({ firstTripId: s.tripPairs.firstTripId, secondTripId: s.tripPairs.secondTripId })
          .from(s.tripPairs).where(and(
            eq(s.tripPairs.status, 'ACTIVE'),
            eq(s.tripPairs.pairKind, 'KEP'),
            or(eq(s.tripPairs.firstTripId, tripId), eq(s.tripPairs.secondTripId, tripId)),
          )).limit(1);
        if (pair) kepPair = pair;
      }
      // SIL-634: the declared clamp proof — the second exemption shape. The
      // issue-time gate releases both legs for issue on the DOUBLE declaration
      // alone (same rig, same driver, same day, both 20', `activePairId ==
      // null` passes), so a kẹp pair can legitimately exist with NO pair row.
      // The accepting leg must recognize that unpaired declared partner too,
      // or the driver stays 409-blocked on a pair the dispatcher already
      // released (staging 31/10: K4K4…/K4K5…). Bounded like the issue-time
      // clamp: exactly ONE shape-matching busy row ("its one compatible
      // partner, never a third load" — the issue-time partner pick requires
      // `conflicts.length === 1`), both sides DOUBLE, shared driver, shared
      // departure day. SIL-704: no container-row re-probe here — the
      // "bổ sung sau" issue path legitimately leaves the trip container rows
      // untyped, and re-verifying issue-time facts at accept time is the
      // SIL-602/SIL-631 defect class. A SINGLE busy row (SIL-638 TC1) or any
      // shape mismatch keeps blocking.
      const declaredClampCandidates = busyTrips.filter((candidate) =>
        candidate.fulfillmentClassification === 'DOUBLE'
        && candidate.driverId != null && candidate.driverId === trip.driverId
        && candidate.departureDate != null && candidate.departureDate !== ''
        && candidate.departureDate === trip.departureDate);
      // SIL-705: the declared LCL share — same-rig same-day LCL legs the
      // dispatcher stacked on this rig (plan tier allows with warn-once).
      // Not bounded to one: consolidation stacks several lots; capacity is
      // an issue-time gate. Requires the accepting leg's own 'LCL'.
      const sameRigLclCandidates = busyTrips.filter((candidate) =>
        candidate.fulfillmentClassification === 'LCL'
        && candidate.driverId != null && candidate.driverId === trip.driverId
        && candidate.departureDate != null && candidate.departureDate !== ''
        && candidate.departureDate === trip.departureDate);
      const declaredClampExempt = new Set<number>();
      const declaredLclExempt = new Set<number>();
      if (trip.fulfillmentId != null
        && (declaredClampCandidates.length === 1 || sameRigLclCandidates.length > 0)) {
        const [ownFulfillment] = await tx.select({ classification: s.shipmentFulfillments.dispatchClassification })
          .from(s.shipmentFulfillments)
          .where(eq(s.shipmentFulfillments.id, trip.fulfillmentId))
          .limit(1);
        if (ownFulfillment?.classification === 'DOUBLE'
          && declaredClampCandidates.length === 1
          && isDeclaredKepClampPartner(
            {
              id: declaredClampCandidates[0].id,
              driverId: declaredClampCandidates[0].driverId,
              departureDate: declaredClampCandidates[0].departureDate,
              classification: declaredClampCandidates[0].fulfillmentClassification,
            },
            {
              tripId,
              tripDriverId: trip.driverId,
              tripDepartureDate: trip.departureDate,
              tripClassification: ownFulfillment.classification,
            },
          )) {
          declaredClampExempt.add(declaredClampCandidates[0].id);
        }
        if (ownFulfillment?.classification === 'LCL') {
          for (const candidate of sameRigLclCandidates) {
            if (isSameRigLclSharePartner(
              {
                id: candidate.id,
                driverId: candidate.driverId,
                departureDate: candidate.departureDate,
                classification: candidate.fulfillmentClassification,
              },
              {
                tripId,
                tripDriverId: trip.driverId,
                tripDepartureDate: trip.departureDate,
                tripClassification: ownFulfillment.classification,
              },
            )) {
              declaredLclExempt.add(candidate.id);
            }
          }
        }
      }
      const blockingTrips: Array<{ id: number; tripCode: string | null; driverId: number | null; blockingLabel: string | null }> = [];
      for (const candidate of busyTrips) {
        // SIL-602/SIL-631: the exemption is the ACTIVE KEP pair membership +
        // shared driver — the whole pair contract (see isActiveKepPairPartner).
        // Superseded pointer/trailer clauses blocked valid pairs in prod.
        if (isActiveKepPairPartner(candidate, {
          tripId,
          tripDriverId: trip.driverId,
          pair: kepPair,
        })) continue;
        // SIL-634: the unpaired declared kẹp partner — both legs DOUBLE, same
        // driver/day, both 20' (see isDeclaredKepClampPartner).
        if (declaredClampExempt.has(candidate.id)) continue;
        // SIL-705: the declared LCL share — same-rig same-day LCL legs (see
        // isSameRigLclSharePartner).
        if (declaredLclExempt.has(candidate.id)) continue;
        if (!isTripRunningOnDepartureDay(candidate.departureDate, todayInBusinessZone)) continue;
        const evidence = await getDriverCompletionEvidenceStatus(candidate.id, tx);
        if (!evidence.ready) blockingTrips.push(candidate);
      }
      const busyTruck = blockingTrips[0];
      if (busyTruck) {
        // Never leak the numeric id in the MESSAGE — the trip code (or a
        // generic phrase) stays the human text; the numeric trip id rides
        // the STRUCTURED payload, and only when the blocking trip belongs
        // to the same driver (ownership-guarded deep link — SIL-798: the
        // banner must NAME the blocking trip and LINK it, not just say
        // "retry later").
        const busyLabel = busyTruck.tripCode || 'một chuyến khác';
        const busyDisplayLabel = busyTruck.blockingLabel;
        const busyDriverOwned = busyTruck.driverId != null && busyTruck.driverId === trip.driverId;
        throw new ApiError(
          409,
          `Xe đang chạy chuyến ${busyLabel}. Vui lòng hoàn thành chuyến đó trước.`,
          undefined,
          {
            code: 'DRIVER_TRIP_BLOCKED',
            blockingTripId: busyDriverOwned ? busyTruck.id : null,
            // §8 display law: Số Bill/Booking names the trip; the internal
            // TRP code stays out of the banner copy.
            blockingTripLabel: busyDisplayLabel,
            driverOwned: busyDriverOwned,
          },
        );
      }
    } else if (targetStatus === TripStatus.COMPLETED) {
      const routineShipmentClose = options?.routineShipmentClose === true;
      const driverClose = options?.driverOwnedFulfillmentClose ?? null;
      const externalClose = options?.externalCarrierStaffClose ?? null;
      // O2C completion is terminal. Routine shipment close uses approved
      // evidence plus the Kế toán/CUS authority; exception paths keep the
      // existing governed approval requirement.
      // Q18: a completed trip is terminal; it cannot be re-completed directly.
      if (currentStatus === TripStatus.COMPLETED) {
        throw new ApiError(
          409,
          'Chuyến đã chốt chỉ được mở lại bằng thao tác mở lại tài chính có quyền và lý do hợp lệ',
        );
      }
      // An external-carrier trip never enters IN_TRANSIT — no app driver
      // exists to acknowledge/start it. Staff close admits CREATED directly.
      if (currentStatus !== TripStatus.IN_TRANSIT
        && !(externalClose != null && currentStatus === TripStatus.CREATED)) {
        throw new ApiError(409, 'Chỉ có thể hoàn thành chuyến đi đang chạy');
      }
      // Driver "Hoàn thành chuyến" full-close path: the driver owns the trip
      // (asserted by caller) and has submitted the e-POD (asserted by the
      // evidence check inside completeOwnedFulfillmentTrip). We skip the
      // accountant/governance gates here so the trip flips to COMPLETED in
      // the same flow the driver triggered. The e-POD submission itself is
      // the evidence handoff; cost reconciliation runs as post-completion
      // dirty edits (AR snapshot + dirty flag) per O2C dev-rev1 §Bước 4.
      if (driverClose) {
        if (userRole !== Role.DRIVER) {
          throw new ApiError(403, 'Chỉ lái xe mới có thể hoàn thành chuyến qua đường này.');
        }
        if (trip.driverId !== driverClose.driverId || trip.fulfillmentId !== driverClose.fulfillmentId) {
          throw new ApiError(403, 'Bạn không sở hữu chuyến này.');
        }
        // The driver's evidence handoff is sufficient — bypass governance
        // authorization so the standard close path's posting logic fires.
        governanceAuthorized = true;
        // confirmZeroRevenue / confirmNoPhoto are bypassed below; the e-POD
        // submission carries the evidence the driver can supply, and
        // confirmZeroRevenue override is implicit here.
        confirmZeroRevenue = true;
        confirmNoPhoto = true;
      } else if (externalClose) {
        // Dispatch/CUS closing an external-carrier trip on the driver's
        // behalf: no app driver exists, so the e-POD/milestone evidence the
        // driver close requires can never be produced. Role + linkage checks
        // here are the whole authorization surface (route already gates the
        // same roles); posting bypasses photo/zero-revenue like the driver
        // close because the trip carries no app-captured evidence either.
        if (userRole !== Role.ADMIN && userRole !== Role.MANAGER
          && userRole !== Role.DISPATCHER && userRole !== Role.CUS) {
          throw new ApiError(403, 'Chỉ Điều vận hoặc CUS mới có thể hoàn thành chuyến xe ngoài.');
        }
        if (trip.fulfillmentId !== externalClose.fulfillmentId) {
          throw new ApiError(403, 'Chuyến không thuộc tác vụ điều xe đã chỉ định.');
        }
        if (trip.driverId != null || (trip.carrierType ?? 'OWN') !== 'EXTERNAL') {
          throw new ApiError(409, 'Chỉ hoàn thành bằng đường này với chuyến xe ngoài.');
        }
        governanceAuthorized = true;
        confirmZeroRevenue = true;
        confirmNoPhoto = true;
      } else {
        // SIL-694 (id 806): an ACCOUNTANT completes through the governed
        // financial close only — governanceAuthorized is true exclusively
        // after assertActiveDirectApplication passed (governance-policy
        // applyRoles), so the accountant cannot slip through a raw
        // IN_TRANSIT → COMPLETED write: without a governed action the next
        // line answers 409 naming the required channel.
        const canComplete = routineShipmentClose
          ? userRole === Role.ACCOUNTANT || userRole === Role.CUS
          : userRole === Role.ADMIN || userRole === Role.MANAGER
            || (userRole === Role.ACCOUNTANT && governanceAuthorized);
        if (!canComplete) {
          throw new ApiError(
            403,
            routineShipmentClose
              ? 'Chỉ Kế toán hoặc CUS mới có quyền chốt trực tiếp lô hàng.'
              : 'Chỉ Quản lý hoặc Quản trị viên mới có quyền hoàn thành chuyến đi',
          );
        }
        if (!routineShipmentClose && !governanceAuthorized) {
          throw new ApiError(409, 'Thao tác phải được thực hiện qua lệnh tài chính có kiểm tra quyền và dữ liệu');
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
      }
      // Falls through to the generic status update below; the financial posting
      // + postTripCompletion + captureSnapshot fire in the post-update block.
    } else if (targetStatus === TripStatus.CANCELED) {
      // SIL-708: For uncompleted trips (dispatch cancellation), DISPATCHER is
      // authorized to cancel the trip so the lot returns to unallocated state.
      const allowedRoles: string[] = [Role.ADMIN, Role.MANAGER];
      if (currentStatus !== TripStatus.COMPLETED) {
        allowedRoles.push(Role.DISPATCHER);
      }
      if (!allowedRoles.includes(userRole)) {
        throw new ApiError(
          403,
          'Chỉ Điều vận, Quản lý hoặc Quản trị viên mới có quyền hủy chuyến đi',
        );
      }
      if (currentStatus === TripStatus.COMPLETED) {
        if (!governanceAuthorized) {
          throw new ApiError(409, 'Thao tác phải được thực hiện qua lệnh tài chính có kiểm tra quyền và dữ liệu');
        }
      }

      const ancillaryFees = currentStatus === TripStatus.COMPLETED
        ? await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, trip.id))
        : [];

      // Canceled: zero all financials. The status predicate is the final
      // winner check after the controlling row lock above.
      // Trips-split: the ops zeroing stays on trips; the financial zeroing
      // routes to trip_financial_state and externalFreightCost to
      // trip_carrier_info. The status predicate stays as the winner check on
      // the trips row.
      const { ops: cancelOps, financial: cancelFinancial, carrier: cancelCarrier } = splitTripPatch({
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
      });
      const [updatedOpsRow] = await tx.update(s.trips)
        .set(cancelOps as typeof s.trips.$inferInsert)
        .where(and(eq(s.trips.id, tripId), eq(s.trips.status, currentStatus)))
        .returning({ id: s.trips.id, version: s.trips.version });
      if (!updatedOpsRow) {
        throw new ApiError(409, 'Chuyến đi đã bị thay đổi bởi người khác. Vui lòng tải lại.');
      }
      await upsertTripFinancialState(tx, tripId, cancelFinancial);
      await upsertTripCarrierInfo(tx, tripId, cancelCarrier);
      const updated = await getTripCompositeInTx(tx, tripId);
      if (!updated) throw new Error(`trip ${tripId} composed row missing after cancel`);

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

      // SIL-737 — chuyến bị huỷ thì ngày hoàn thành của nó có thể mất hết
      // chuyến: ô chấm công do hệ thống ghi cho ngày đó phải được làm mới
      // (xoá hẳn nếu không còn chuyến nào). Ô Điều vận gõ tay không bị đè.
      await syncTimesheetSymbolForTrip(tripId, userId, tx);

      // SIL-753 r4 (product decision 09/11) — Hủy phân xe must return the lot
      // to TRUE 'Chưa phân xe': the canceled trip releases its fulfillment's
      // planned carrier assignment HERE, in the cancel's own transaction.
      // Until r4 only the FE's follow-up plan save cleared the assignment,
      // and once the SIL-751 rewind below started bumping the lot version
      // inside this same cancel, that stale-version save 409'd and the
      // carrier ('4GS / Chờ bổ sung biển', placeholder plate included) stayed
      // stuck on the row forever (QA 09/11, lô QA1109-753B). Clearing here
      // removes the second write entirely — every cancel surface (grid cell,
      // ⋯ menu, trip workspace) lands the same unassigned shape the plan-read
      // law renders as 'Chưa phân xe' (OWN, plate-less, external ids null).
      if (trip.fulfillmentId != null) {
        const [planLot] = await tx.select({
          shipmentId: s.shipments.id,
          costGroupId: s.shipments.costGroupId,
          actualTruckNo: s.shipments.actualTruckNo,
          version: s.shipments.version,
        })
          .from(s.shipmentFulfillments)
          .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
          .where(eq(s.shipmentFulfillments.id, trip.fulfillmentId))
          .limit(1);
        await tx.update(s.shipmentFulfillments).set({
          plannedCarrierType: 'OWN',
          plannedExternalCarrierId: null,
          plannedExternalCarrierVehicleId: null,
          plannedVehiclePlateNumber: null,
          version: sql`${s.shipmentFulfillments.version} + 1`,
          updatedAt: new Date(),
        }).where(eq(s.shipmentFulfillments.id, trip.fulfillmentId));
        // SIL-494 parity — a save that leaves the row PLATE-LESS drops the
        // lot's stale COST-group identity; the cancel now owns the same law
        // (same condition as the plan save's lotIdentityReset). The version
        // predicate mirrors the plan save's conditional write: a concurrent
        // guarded editor 409s on this bump instead of racing a best-effort
        // identity reset (both outcomes converge on actualTruckNo = null).
        if (planLot && planLot.costGroupId == null && planLot.actualTruckNo != null) {
          await tx.update(s.shipments).set({
            actualTruckNo: null,
            version: sql`${s.shipments.version} + 1`,
            updatedAt: new Date(),
          }).where(and(
            eq(s.shipments.id, planLot.shipmentId),
            eq(s.shipments.version, planLot.version),
          ));
        }
      }

      // SIL-751 — Hủy phân xe leaves the plan grid on "Chưa phân xe" while
      // the stored lot status stayed DISPATCHED (the dispatch-order issuance
      // flipped it and only the COMPLETED branch recomputed the shipment).
      // When this cancel was the lot's last live trip, rewind it inside the
      // same transaction so the API, the grid and the dispatch queue agree.
      const rewindShipmentId = trip.shipmentId
        ?? (trip.fulfillmentId != null
          ? (await tx.select({ shipmentId: s.shipmentFulfillments.shipmentId })
            .from(s.shipmentFulfillments)
            .where(eq(s.shipmentFulfillments.id, trip.fulfillmentId))
            .limit(1))[0]?.shipmentId ?? null
          : null);
      if (rewindShipmentId != null) {
        await rewindShipmentAfterLastLiveTripCancel(
          rewindShipmentId,
          { changedBy: userId },
          tx,
        );
      }

      // Cancel audit row is written by the middleware for POST /cancel
      // ("Quản lý <actor> hủy chuyến <tripCode>") — skip duplicate write.
      return updated;
    }

    const completedAt = targetStatus === TripStatus.COMPLETED ? new Date() : null;
    const { ops: transitionOps, financial: transitionFinancial } = splitTripPatch({
      status: targetStatus,
      version: sql`${s.trips.version} + 1`,
      ...(targetStatus === TripStatus.COMPLETED
        ? {
            completedAt,
            ...(options?.vatRateOverride !== undefined
              ? { vatRate: String(options.vatRateOverride) }
              : {}),
          }
        : {}),
      updatedAt: new Date(),
    });
    const [updatedOpsRow] = await tx.update(s.trips)
      .set(transitionOps as typeof s.trips.$inferInsert)
      .where(and(eq(s.trips.id, tripId), eq(s.trips.status, currentStatus)))
      .returning({ id: s.trips.id, version: s.trips.version, completedAt: s.trips.completedAt });
    if (!updatedOpsRow) {
      throw new ApiError(409, 'Trạng thái chuyến đi đã bị thay đổi bởi người khác. Vui lòng tải lại.');
    }
    await upsertTripFinancialState(tx, tripId, transitionFinancial);
    // Wave 7 (SIL-676 / SIL-638 TC3-T3): a leg closing through ANY completion
    // path carries its economics — driver salary (base cuốc / pair phụ phí)
    // and the once-per-pair VETC net toll — materialized HERE, before the
    // completion posting, so the ledger and every economics surface read
    // complete numbers even when no dispatcher figures-save touched the trip.
    // Runs inside the completion commit moment; afterwards a COMPLETED trip's
    // figures still change only through governed corrections.
    if (completedAt != null) {
      await materializeCompletedTripEconomics(tx, tripId, completedAt);
    }
    // SIL-737 — chuyến nội bộ hoàn thành tự ghi ký hiệu (Đ/K/Q) vào lưới
    // chấm công lái xe theo NGÀY HOÀN THÀNH. Ghi ở đây (đúng một cửa chuyển
    // trạng thái) nên mọi đường hoàn thành — Điều vận, app lái xe, đóng hộ
    // cho nhà xe ngoài — đều nhận cùng một luật. Chạy trong cùng tx: lưới
    // chấm công và trạng thái chuyến đi luôn nhất quán.
    if (completedAt != null) {
      await syncTimesheetSymbolForTrip(tripId, userId, tx);
    }
    const updated = await getTripCompositeInTx(tx, tripId);
    if (!updated) throw new Error(`trip ${tripId} composed row missing after status transition`);

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

    if (
      targetStatus === TripStatus.COMPLETED
      && (currentStatus === TripStatus.IN_TRANSIT || (options?.externalCarrierStaffClose != null && currentStatus === TripStatus.CREATED))
    ) {
      const ancillaryFees = await tx.select().from(s.tripExpenses)
        .where(eq(s.tripExpenses.tripId, trip.id));

      const posting = await createFinancialPosting(tx, {
        tripId: updated.id,
        tripVersion: updated.version,
        reason: 'COMPLETION',
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
  return runInTx(options?.transaction, execute);
}
