/**
 * Exceptional reopen (unlock) requests and departure-date changes. Handler
 * bodies moved verbatim from routes/trips.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role, tripReopenRequestSchema } from '@tingting/shared';
import { ApiError } from '../../errors';
import { requestTripReopen } from '../../services/adjustment-governance.service';
import { AuditEvent } from '../../services/audit-types';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import * as tripService from '../../services/trip.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import {
  getExpectedVersion, getRequiredGovernanceReason,
} from './trips-shared';
import { invalidateReportCaches } from '../../lib/report-cache';

const router = Router();

// Submit an exceptional reopen request. The trip remains COMPLETED until a
// distinct checker and approver complete the governance action.
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
    create: (tx) => requestTripReopen({
      tripId: id,
      reason: data.reason,
      makerId: user.userId,
      makerRole: user.role,
      expectedTripVersion: data.expectedVersion,
      transaction: tx,
    }),
    getEntityId: (result) => result.id,
  });
  res.status(202).json(idempotencyKey ? { ...action, replayed } : action);
}));

// Change departure date (any status except CANCELED)
router.patch('/:id/departure-date', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { departureDate } = req.body;
  if (!departureDate || typeof departureDate !== 'string') {
    return res.status(400).json({ error: 'Ngày khởi hành không hợp lệ' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) {
    return res.status(400).json({ error: 'Định dạng ngày không hợp lệ (YYYY-MM-DD)' });
  }
  const parsed = Date.parse(departureDate);
  if (isNaN(parsed)) {
    return res.status(400).json({ error: 'Giá trị ngày không hợp lệ' });
  }
  if (req.body.expectedVersion !== undefined
      && (!Number.isInteger(req.body.expectedVersion) || req.body.expectedVersion <= 0)) {
    return res.status(400).json({ error: 'Phiên bản chuyến đi không hợp lệ' });
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
