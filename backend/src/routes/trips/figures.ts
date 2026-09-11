/**
 * Trips figure updates: pre-departure plan and post-trip actuals. Handler
 * bodies moved verbatim from routes/trips.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { TripStatus, updateTripFiguresSchema } from '@tingting/shared';
import { AuditEvent } from '../../services/audit-types';

import { autoApplyGovernanceAction, requestTripFinancialChange } from '../../services/adjustment-governance.service';
import { loadTripStatusVersion } from '../../services/trip-queries.service';
import { asyncHandler } from '../../middleware/asyncHandler';

import { getUser } from '../../middleware/auth';
import * as tripService from '../../services/trip.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';

import { invalidateReportCaches } from '../../lib/report-cache';

const router = Router();

router.put('/:id/pre-departure', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = updateTripFiguresSchema.parse(req.body);
  const user = getUser(req);
  const governanceReason = typeof req.body?.governanceReason === 'string'
    ? req.body.governanceReason.trim()
    : '';
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_PRE_DEPARTURE,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, tripId: id, data, governanceReason },
    createdBy: user.userId,
    entityType: 'trip_or_governance_action',
    create: async (tx) => {
      const current = await loadTripStatusVersion(tx, id);
      if (current?.status === TripStatus.COMPLETED) {
        // 2026-09-11 maker-checker removal: completed-trip figure changes
        // apply directly in-request.
        return autoApplyGovernanceAction({
          make: (inner) => requestTripFinancialChange({
            tripId: id,
            reason: governanceReason,
            figures: {
              ...data,
              expectedVersion: data.version,
              userId: user.userId,
              userRole: user.role,
            },
            makerId: user.userId,
            makerRole: user.role,
            expectedTripVersion: data.version!,
            transaction: inner,
          }),
          actorId: user.userId,
          actorRole: user.role,
          transaction: tx,
        });
      }
      return tripService.updateTripFigures(id, {
        ...data,
        expectedVersion: data.version,
        userId: user.userId,
        userRole: user.role,
      }, tx);
    },
    getEntityId: (value) => value.id,
  });
  if ('actionKind' in result && result.actionKind === 'TRIP_FINANCIAL_CHANGE') {
    res.locals.auditEvent = AuditEvent.TRIP_UPDATED_ACTUALS;
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = result.subjectKey;
  }
  if (!replayed) await invalidateReportCaches();
  res.status(200)
    .json(idempotencyKey ? { ...result, replayed } : result);
}));

// Update actuals
router.put('/:id/actuals', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = updateTripFiguresSchema.parse(req.body);
  const user = getUser(req);
  const governanceReason = typeof req.body?.governanceReason === 'string'
    ? req.body.governanceReason.trim()
    : '';
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_ACTUALS,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, tripId: id, data, governanceReason },
    createdBy: user.userId,
    entityType: 'trip_or_governance_action',
    create: async (tx) => {
      const current = await loadTripStatusVersion(tx, id);
      if (current?.status === TripStatus.COMPLETED) {
        // 2026-09-11 maker-checker removal: completed-trip figure changes
        // apply directly in-request.
        return autoApplyGovernanceAction({
          make: (inner) => requestTripFinancialChange({
            tripId: id,
            reason: governanceReason,
            figures: {
              ...data,
              expectedVersion: data.version,
              userId: user.userId,
              userRole: user.role,
            },
            makerId: user.userId,
            makerRole: user.role,
            expectedTripVersion: data.version!,
            transaction: inner,
          }),
          actorId: user.userId,
          actorRole: user.role,
          transaction: tx,
        });
      }
      return tripService.updateTripFigures(id, {
        ...data,
        expectedVersion: data.version,
        userId: user.userId,
        userRole: user.role,
      }, tx);
    },
    getEntityId: (value) => value.id,
  });
  if ('actionKind' in result && result.actionKind === 'TRIP_FINANCIAL_CHANGE') {
    res.locals.auditEvent = AuditEvent.TRIP_UPDATED_ACTUALS;
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = result.subjectKey;
  }
  if (!replayed) await invalidateReportCaches();
  res.status(200)
    .json(idempotencyKey ? { ...result, replayed } : result);
}));



export default router;
