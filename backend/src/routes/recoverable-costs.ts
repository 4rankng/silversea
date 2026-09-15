import { Router, type Request, type Response } from 'express';
import {
  Role,
  recoverableCostListQuerySchema,
} from '@tingting/shared';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRoles } from '../middleware/casbin';
import { getUser } from '../middleware/auth';
import {
  getRecoverableCost,
  listRecoverableCosts,
} from '../services/recoverable-cost.service';

const router = Router();
const ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.OPS] as const;

router.use(requireRoles(...ROLES));

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const filters = recoverableCostListQuerySchema.parse(req.query);
  res.json(await listRecoverableCosts(getUser(req), filters));
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  res.json(await getRecoverableCost(getUser(req), id));
}));

export default router;
