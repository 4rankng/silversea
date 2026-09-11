/**
 * Trip status lifecycle writes: dispatch, complete, cancel. Handler bodies
 * moved verbatim from routes/trips.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { TripStatus, NotificationType, Role } from '@tingting/shared';
import { ApiError } from '../../errors';
import { requireRoles } from '../../middleware/casbin';
import { completeExternalCarrierTrip } from '../../services/trip-external-close.service';
import { dispatchTripWriteCommand, transitionTripWriteCommand } from '../../services/trip-command.service';
import { autoApplyGovernanceAction, requestCompletedTripCancellation, requestTripFinancialClose } from '../../services/adjustment-governance.service';

import { AuditEvent } from '../../services/audit-types';
import { asyncHandler } from '../../middleware/asyncHandler';

import { getUser } from '../../middleware/auth';
import * as tripService from '../../services/trip.service';
import { getTripStatusOr404 } from '../../services/trip-mutations.service';
import { emitNotification } from '../../services/notification.service';
import { findIdempotencyRecord, IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import {
  getExpectedVersion, getRequiredGovernanceReason,
} from './trips-shared';
import { invalidateReportCaches } from '../../lib/report-cache';

const router = Router();

router.post('/:id/dispatch', asyncHandler(async (req: Request, res: Response) => {
  const idempotencyKey = getRequestIdempotencyKey(req);
  const outcome = await dispatchTripWriteCommand(
    parseInt(req.params.id as string),
    getUser(req),
    { idempotencyKey, expectedVersion: getExpectedVersion(req.body) },
  );
  res.json(idempotencyKey
    ? { ...outcome.trip, replayed: outcome.replayed }
    : outcome.trip);
}));

// Complete trip (IN_TRANSIT → COMPLETED). Permissive — photos optional (B2):
// a trip may be marked "Hoàn thành" without photos; evidence can be added or
// edited afterwards. This is the explicit replacement for the old auto-complete
// that previously fired inside updateTripFigures whenever any photo existed.
router.post('/:id/complete', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const expectedVersion = getExpectedVersion(req.body);
  if (expectedVersion === undefined) {
    throw new ApiError(400, 'Phiên bản chuyến đi là bắt buộc');
  }
  const reason = getRequiredGovernanceReason(req.body);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: action, replayed, statusCode } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_FINANCIAL_CLOSE,
    idempotencyKey,
    payload: {
      actorId: user.userId,
      actorRole: user.role,
      tripId: id,
      expectedVersion,
      reason,
    },
    createdBy: user.userId,
    entityType: 'governance_action',
    // 2026-09-11 maker-checker removal: the governed close applies directly
    // in-request — no staged request, no second approver.
    create: (tx) => autoApplyGovernanceAction({
      make: (inner) => requestTripFinancialClose({
        tripId: id,
        reason,
        makerId: user.userId,
        makerRole: user.role,
        expectedTripVersion: expectedVersion,
        transaction: inner,
      }),
      actorId: user.userId,
      actorRole: user.role,
      transaction: tx,
    }),
    getEntityId: (result) => result.id,
    responseStatusCode: 200,
  });
  res.locals.auditEvent = AuditEvent.TRIP_COMPLETED;
  res.locals.auditEntityId = id;
  res.locals.auditEntityKey = action.subjectKey;
  res.status(statusCode)
    .json(idempotencyKey ? { ...action, replayed } : action);
}));

// Staff completion for external-carrier trips (feedback 2026-09-08):
// external drivers don't use the app, so the driver flow can never close
// their trips — dispatch/CUS complete on the driver's behalf. Distinct from
// the governed POST /:id/complete above: no photos/milestones exist for
// external carriers, so that flow can never apply to them.
router.post('/:id/complete-external', requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.CUS), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'ID chuyến đi không hợp lệ');
  }
  const user = getUser(req);
  const { trip, replayed } = await completeExternalCarrierTrip({
    tripId: id,
    actorUserId: user.userId,
    actorRole: user.role,
    expectedVersion: getExpectedVersion(req.body),
    idempotencyKey: getRequestIdempotencyKey(req),
  });
  res.locals.auditEvent = AuditEvent.TRIP_COMPLETED;
  res.locals.auditEntityId = id;
  res.locals.auditEntityKey = trip.tripCode ?? null;
  res.json({ ...trip, replayed });
}));

// Cancel trip
router.post('/:id/cancel', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const expectedVersion = getExpectedVersion(req.body);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const currentStatus = await getTripStatusOr404(id);

  // 2026-09-11 maker-checker removal: a completed-trip cancellation now
  // APPLIES in-request, so a retried (same-key) request observes the trip
  // already CANCELED and must replay the stored outcome instead of falling
  // through to the plain-cancel branch (which 409s on CANCELED).
  if (idempotencyKey && currentStatus !== TripStatus.COMPLETED) {
    const stored = await findIdempotencyRecord(
      IDEMPOTENCY_ENDPOINTS.TRIP_COMPLETED_CANCEL,
      idempotencyKey,
    );
    if (stored?.responseSnapshot != null) {
      res.status(stored.responseStatusCode ?? 200)
        .json({ ...(stored.responseSnapshot as Record<string, unknown>), replayed: true });
      return;
    }
  }

  if (currentStatus === TripStatus.COMPLETED) {
    if (expectedVersion === undefined) {
      throw new ApiError(400, 'Phiên bản chuyến đi là bắt buộc');
    }
    const reason = getRequiredGovernanceReason(req.body);
    const user = getUser(req);
    const { result: action, replayed, statusCode } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_COMPLETED_CANCEL,
      idempotencyKey,
      payload: {
        actorId: user.userId,
        actorRole: user.role,
        tripId: id,
        expectedVersion,
        reason,
      },
      createdBy: user.userId,
      entityType: 'governance_action',
      // 2026-09-11 maker-checker removal: governed completed-trip
      // cancellation applies directly in-request.
      create: (tx) => autoApplyGovernanceAction({
        make: (inner) => requestCompletedTripCancellation({
          tripId: id,
          reason,
          makerId: user.userId,
          makerRole: user.role,
          expectedTripVersion: expectedVersion,
          transaction: inner,
        }),
        actorId: user.userId,
        actorRole: user.role,
        transaction: tx,
      }),
      getEntityId: (result) => result.id,
      responseStatusCode: 200,
    });
    res.locals.auditEvent = AuditEvent.TRIP_CANCELED;
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = action.subjectKey;
    res.status(statusCode)
      .json(idempotencyKey ? { ...action, replayed } : action);
    return;
  }

  const outcome = await transitionTripWriteCommand({
    tripId: id,
    targetStatus: TripStatus.CANCELED,
    actor: getUser(req),
    idempotencyKey,
    expectedVersion,
  });
  if (!outcome.replayed) {
    await invalidateReportCaches();
    // Remove TRIP_DAY records for the canceled trip
    await tripService.syncAttendanceAfterStatusChange(
      outcome.trip.id, TripStatus.CANCELED, outcome.trip.driverId ?? null,
      outcome.trip.departureDate ?? null, null, getUser(req).userId,
    );
    emitNotification({
      type: NotificationType.TRIP_CANCELED,
      title: 'Chuyến đã hủy',
      message: `Chuyến ${outcome.trip.tripCode} đã bị hủy`,
      relatedEntityType: 'trips',
      relatedEntityId: id,
      targetDriverId: outcome.trip.driverId ?? undefined,
    });
  }
  res.json(idempotencyKey
    ? { ...outcome.trip, replayed: outcome.replayed }
    : outcome.trip);
}));

// ─── O2C POD-recovery gate (260801-2200 phase-03) ────────────────────────────
// Records physical paper return ("Đã thu hồi chứng từ gốc / POD mộc đỏ").
// Distinct from digital e-POD acceptance. The IN_TRANSIT → COMPLETED transition
// throws if this is null; only ACCOUNTANT or CLERK may set it.

export default router;
