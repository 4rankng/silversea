/**
 * Exceptional reopen (unlock) requests and departure-date changes. Handler
 * bodies moved verbatim from routes/trips.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { tripReopenRequestSchema } from '@tingting/shared';

import { autoApplyGovernanceAction, requestTripReopen } from '../../services/adjustment-governance.service';

import { asyncHandler } from '../../middleware/asyncHandler';
import { ApiError } from '../../errors';

import { getUser } from '../../middleware/auth';
import * as tripService from '../../services/trip.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';

import { invalidateReportCaches } from '../../lib/report-cache';

const router = Router();

// Exceptional reopen: applies directly in-request (maker-checker removed
// 2026-09-11) — the completed trip reopens immediately on a valid request.
router.post('/:id/unlock', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = tripReopenRequestSchema.parse(req.body);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: action, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_UNLOCK,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, tripId: id, data },
    createdBy: user.userId,
    entityType: 'governance_action',
    create: (tx) => autoApplyGovernanceAction({
      make: (inner) => requestTripReopen({
        tripId: id,
        reason: data.reason,
        makerId: user.userId,
        makerRole: user.role,
        expectedTripVersion: data.expectedVersion,
        transaction: inner,
      }),
      actorId: user.userId,
      actorRole: user.role,
      transaction: tx,
    }),
    getEntityId: (result) => result.id,
  });
  if (!replayed) await invalidateReportCaches();
  res.status(200).json(idempotencyKey ? { ...action, replayed } : action);
}));

// Change departure date (any status except CANCELED)
router.patch('/:id/departure-date', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { departureDate } = req.body;
  if (!departureDate || typeof departureDate !== 'string') {
    throw new ApiError(400, 'Ngày khởi hành không hợp lệ');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) {
    throw new ApiError(400, 'Định dạng ngày không hợp lệ (YYYY-MM-DD)');
  }
  const parsed = Date.parse(departureDate);
  if (isNaN(parsed)) {
    throw new ApiError(400, 'Giá trị ngày không hợp lệ');
  }
  if (req.body.expectedVersion !== undefined
      && (!Number.isInteger(req.body.expectedVersion) || req.body.expectedVersion <= 0)) {
    throw new ApiError(400, 'Phiên bản chuyến đi không hợp lệ');
  }
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: trip, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_DEPARTURE_DATE,
    idempotencyKey,
    payload: {
      actorId: user.userId,
      actorRole: user.role,
      tripId: id,
      departureDate,
      expectedVersion: req.body.expectedVersion,
    },
    createdBy: user.userId,
    entityType: 'trip',
    create: (tx) => tripService.updateDepartureDate(
      id,
      departureDate,
      user.userId,
      user.role,
      req.body.expectedVersion,
      tx,
    ),
    getEntityId: (result) => result.id,
  });
  if (!replayed) await invalidateReportCaches();
  res.json(idempotencyKey ? { ...trip, replayed } : trip);
}));

// Get adjustments for a specific trip

export default router;
