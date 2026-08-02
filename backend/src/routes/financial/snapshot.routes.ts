import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';

import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ApiError } from '../../errors';
import { ApSnapshotService } from '../../services/ap-snapshot.service';
import { ArSnapshotService } from '../../services/ar-snapshot.service';
import { SnapshotServices } from '../../services/snapshot-services';

const router = Router();
const ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

function parseTripId(req: Request): number {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId < 1) {
    throw new ApiError(400, 'tripId không hợp lệ');
  }
  return tripId;
}

router.get('/finance/snapshots/ar/dirty', requireRoles(...ROLES), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await ArSnapshotService.listDirty());
}));

router.post('/finance/snapshots/ar/:id/recapture', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseTripId(req);
  await ArSnapshotService.recapture(tripId);
  res.locals.auditEntityId = tripId;
  res.json({ ok: true, tripId });
}));

router.get('/finance/snapshots/ap/dirty', requireRoles(...ROLES), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await ApSnapshotService.listDirty());
}));

router.post('/finance/snapshots/ap/:id/recapture', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseTripId(req);
  await ApSnapshotService.recapture(tripId);
  res.locals.auditEntityId = tripId;
  res.json({ ok: true, tripId });
}));

router.get('/finance/snapshots/fuel-surcharge/dirty', requireRoles(...ROLES), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await SnapshotServices.listFuelSurchargeDirty());
}));

router.post('/finance/snapshots/fuel-surcharge/:id/recapture', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseTripId(req);
  await SnapshotServices.recaptureFuelSurcharge(tripId);
  res.locals.auditEntityId = tripId;
  res.json({ ok: true, tripId });
}));

export default router;
