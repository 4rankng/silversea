import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';

import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { resolveIdempotencyKey } from '../../services/idempotency.service';
import { bindDriverUser } from '../../services/driver-user-binding.service';
import { declareMaterialWrite } from '../../middleware/material-write';

const router = Router()

router.use(requireRoles(Role.ADMIN));

router.post('/:driverId', declareMaterialWrite('config.driver-user-bindings.bind', { method: 'POST', path: '/api/config/driver-user-bindings/:driverId' }),  asyncHandler(async (req: Request, res: Response) => {
  const outcome = await bindDriverUser({
    driverId: Number(req.params.driverId),
    userId: Number(req.body?.userId),
    expectedVersion: Number(req.body?.expectedVersion),
    idempotencyKey: resolveIdempotencyKey({
      headerValue: req.header('Idempotency-Key'),
      requestId: req.body?._requestId,
    }),
    actor: getUser(req),
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

export default router;
