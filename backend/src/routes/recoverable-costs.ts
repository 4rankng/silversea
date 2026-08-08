import { Router, type Request, type Response } from 'express';
import {
  Role,
  recoverableCostListQuerySchema,
  recoverableCostRequestSchema,
} from '@tingting/shared';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRoles } from '../middleware/casbin';
import { getUser } from '../middleware/auth';
import { runIdempotent } from '../services/idempotency.service';
import {
  getRecoverableCost,
  listRecoverableCosts,
  requestRecoverableCostDecision,
} from '../services/recoverable-cost.service';
import { getRequestIdempotencyKey } from './utils/idempotency';

const router = Router();
const ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS] as const;

router.use(requireRoles(...ROLES));

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const filters = recoverableCostListQuerySchema.parse(req.query);
  res.json(await listRecoverableCosts(getUser(req), filters));
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  res.json(await getRecoverableCost(getUser(req), id));
}));

router.post('/:id/request', asyncHandler(async (req: Request, res: Response) => {
  const expenseId = z.coerce.number().int().positive().parse(req.params.id);
  const body = recoverableCostRequestSchema.parse(req.body);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const endpoint = body.decision === 'APPROVED'
    ? 'recoverable-costs.approval-request'
    : 'recoverable-costs.rejection-request';
  const { result, replayed, statusCode } = await runIdempotent({
    endpoint,
    idempotencyKey,
    payload: { expenseId, actorId: actor.userId, ...body },
    createdBy: actor.userId,
    entityType: 'governance_action',
    responseStatusCode: 202,
    create: (tx) => requestRecoverableCostDecision({
      expenseId,
      decision: body.decision,
      reason: body.reason,
      evidence: body.evidence,
      expectedVersion: body.expectedVersion,
      actor,
      transaction: tx,
    }),
    getEntityId: (action) => action.id,
  });
  res.locals.auditEntityId = expenseId;
  res.status(statusCode).json({ ...result, replayed });
}));

export default router;
