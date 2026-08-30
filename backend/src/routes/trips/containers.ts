/**
 * Trip containers batch upsert and trip instructions. Handler bodies moved
 * verbatim from routes/trips.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role, tripContainerBatchSchema, upsertTripInstructionsSchema } from '@tingting/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { listTripContainers, batchUpsertTripContainers } from '../../services/forwarder.service';
import * as tripService from '../../services/trip.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { throwValidation } from '../../lib/validation';
import { getExpectedVersion, invalidateReportCaches } from './trips-shared';

const router = Router();

router.put('/:id/containers', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const parsed = tripContainerBatchSchema.parse(req.body);
  const userId = req.user?.userId ?? null;
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_CONTAINERS,
    idempotencyKey,
    payload: { actorId: userId, tripId, data: parsed },
    createdBy: userId,
    entityType: 'trip_containers',
    create: async (tx) => ({
      items: await batchUpsertTripContainers(
        tripId,
        userId,
        parsed.containers,
        parsed.expectedVersion,
        tx,
      ),
    }),
    getEntityId: () => tripId,
  });
  if (!replayed) await invalidateReportCaches();
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

// ─── Trip instructions (N2 / B1.3) ──────────────────────────────────────────
// Manager-authored contact + free-text guidance. One row per trip; upsert on
// conflict. No new casbin line — MANAGER/ACCOUNTANT already have `trips write`
// and ADMIN has the wildcard policy.

// GET /api/trips/:id/instructions — returns null when no row exists yet.
router.get('/:id/instructions', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  res.json(await tripService.getTripInstructions(tripId));
}));

// PUT /api/trips/:id/instructions — upsert contact + guidance for a trip.
router.put('/:id/instructions', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(tripId) || tripId <= 0) {
    return res.status(400).json({ error: 'ID chuyến đi không hợp lệ' });
  }
  const parsed = upsertTripInstructionsSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: row, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_INSTRUCTIONS,
    idempotencyKey,
    payload: { actorId: user.userId, tripId, data: parsed.data },
    createdBy: user.userId,
    entityType: 'trip_instructions',
    create: (tx) => tripService.upsertTripInstructions(
      tripId,
      parsed.data,
      user.userId,
      tx,
    ),
    getEntityId: (result) => result.id,
  });
  res.json(idempotencyKey ? { ...row, replayed } : row);
}));

// ─── Trip Expenses (ancillary fees) ──────────────────────────────────────────

// GET /api/trips/:id/expenses — list all expenses for a trip

export default router;
