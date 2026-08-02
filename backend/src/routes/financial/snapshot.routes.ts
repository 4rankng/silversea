import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';

import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { ApiError } from '../../errors';
import { ApSnapshotService } from '../../services/ap-snapshot.service';
import { ArSnapshotService } from '../../services/ar-snapshot.service';
import { SnapshotServices } from '../../services/snapshot-services';
import {
  IDEMPOTENCY_ENDPOINTS,
  resolveIdempotencyKey,
  runIdempotent,
} from '../../services/idempotency.service';
import type { Tx } from '../../services/trip-shared';

const router = Router();
const ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

function parseTripId(req: Request): number {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId < 1) {
    throw new ApiError(400, 'tripId không hợp lệ');
  }
  return tripId;
}

async function runSnapshotRecaptureWriteCommand(input: {
  req: Request;
  tripId: number;
  endpoint: typeof IDEMPOTENCY_ENDPOINTS.SNAPSHOT_AR_RECAPTURE
    | typeof IDEMPOTENCY_ENDPOINTS.SNAPSHOT_AP_RECAPTURE
    | typeof IDEMPOTENCY_ENDPOINTS.SNAPSHOT_FUEL_SURCHARGE_RECAPTURE;
  recapture: (tripId: number, tx: Tx) => Promise<void>;
}) {
  const actor = getUser(input.req);
  const body = input.req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: input.req.header('Idempotency-Key'),
    requestId: body?._requestId,
  });
  return runIdempotent({
    endpoint: input.endpoint,
    idempotencyKey,
    payload: { tripId: input.tripId },
    createdBy: actor.userId,
    entityType: 'trip',
    create: async (tx) => {
      await input.recapture(input.tripId, tx);
      return { ok: true as const, tripId: input.tripId };
    },
    getEntityId: (result) => result.tripId,
  });
}

router.get('/finance/snapshots/ar/dirty', requireRoles(...ROLES), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await ArSnapshotService.listDirty());
}));

router.post('/finance/snapshots/ar/:id/recapture', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseTripId(req);
  const { result, replayed } = await runSnapshotRecaptureWriteCommand({
    req,
    tripId,
    endpoint: IDEMPOTENCY_ENDPOINTS.SNAPSHOT_AR_RECAPTURE,
    recapture: (id, tx) => ArSnapshotService.recapture(id, tx),
  });
  res.locals.auditEntityId = tripId;
  res.json({ ...result, replayed });
}));

router.get('/finance/snapshots/ap/dirty', requireRoles(...ROLES), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await ApSnapshotService.listDirty());
}));

router.post('/finance/snapshots/ap/:id/recapture', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseTripId(req);
  const { result, replayed } = await runSnapshotRecaptureWriteCommand({
    req,
    tripId,
    endpoint: IDEMPOTENCY_ENDPOINTS.SNAPSHOT_AP_RECAPTURE,
    recapture: (id, tx) => ApSnapshotService.recapture(id, tx),
  });
  res.locals.auditEntityId = tripId;
  res.json({ ...result, replayed });
}));

router.get('/finance/snapshots/fuel-surcharge/dirty', requireRoles(...ROLES), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await SnapshotServices.listFuelSurchargeDirty());
}));

router.post('/finance/snapshots/fuel-surcharge/:id/recapture', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseTripId(req);
  const { result, replayed } = await runSnapshotRecaptureWriteCommand({
    req,
    tripId,
    endpoint: IDEMPOTENCY_ENDPOINTS.SNAPSHOT_FUEL_SURCHARGE_RECAPTURE,
    recapture: (id, tx) => SnapshotServices.recaptureFuelSurcharge(id, tx),
  });
  res.locals.auditEntityId = tripId;
  res.json({ ...result, replayed });
}));

export default router;
