import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  governanceActionVersionSchema,
  governanceActionDecisionSchema,
  governanceActionListQuerySchema,
  Role,
} from '@tingting/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import {
  cancelGovernanceAction,
  checkGovernanceAction,
  getGovernanceAction,
  listGovernanceActions,
  rejectGovernanceAction,
  returnGovernanceActionForEvidence,
} from '../../services/governance-transition.service';
import { approveGovernanceAction } from '../../services/adjustment-governance.service';
import { parseActionId } from './governance-action-input';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';

const router = Router();
const FINANCIAL_VIEWERS = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

router.get(
  '/governance-actions',
  requireRoles(...FINANCIAL_VIEWERS),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getUser(req);
    const query = governanceActionListQuerySchema.parse(req.query);
    const actions = await listGovernanceActions({
      actorId: actor.userId,
      actorRole: actor.role,
      query,
    });
    res.json(actions);
  }),
);

router.get(
  '/governance-actions/:id',
  requireRoles(...FINANCIAL_VIEWERS),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getUser(req);
    res.json(await getGovernanceAction({
      actionId: parseActionId(req.params.id),
      actorId: actor.userId,
      actorRole: actor.role,
    }));
  }),
);

router.post(
  '/governance-actions/:id/check',
  requireRoles(...FINANCIAL_VIEWERS),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getUser(req);
    const input = governanceActionVersionSchema.parse(req.body);
    const actionId = parseActionId(req.params.id);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK,
      idempotencyKey,
      payload: { actionId, actorId: actor.userId, actorRole: actor.role, ...input },
      createdBy: actor.userId,
      entityType: 'governance_action',
      create: (tx) => checkGovernanceAction({
        actionId,
        checkerId: actor.userId,
        checkerRole: actor.role,
        expectedVersion: input.expectedVersion,
        transaction: tx,
      }),
    });
    res.locals.auditEntityId = result.id;
    res.json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

router.post(
  '/governance-actions/:id/approve',
  requireRoles(...FINANCIAL_VIEWERS),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getUser(req);
    const input = governanceActionVersionSchema.parse(req.body);
    const actionId = parseActionId(req.params.id);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE,
      idempotencyKey,
      payload: { actionId, actorId: actor.userId, actorRole: actor.role, ...input },
      createdBy: actor.userId,
      entityType: 'governance_action',
      create: (tx) => approveGovernanceAction({
        actionId,
        approverId: actor.userId,
        approverRole: actor.role,
        expectedVersion: input.expectedVersion,
        transaction: tx,
      }),
    });
    res.locals.auditEntityId = result.id;
    res.json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

router.post(
  '/governance-actions/:id/reject',
  requireRoles(...FINANCIAL_VIEWERS),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getUser(req);
    const input = governanceActionDecisionSchema.parse(req.body);
    const actionId = parseActionId(req.params.id);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_REJECT,
      idempotencyKey,
      payload: { actionId, actorId: actor.userId, actorRole: actor.role, ...input },
      createdBy: actor.userId,
      entityType: 'governance_action',
      create: (tx) => rejectGovernanceAction({
        actionId,
        actorId: actor.userId,
        actorRole: actor.role,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        transaction: tx,
      }),
    });
    res.locals.auditEntityId = result.id;
    res.json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

router.post(
  '/governance-actions/:id/return-for-evidence',
  requireRoles(...FINANCIAL_VIEWERS),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getUser(req);
    const input = governanceActionDecisionSchema.parse(req.body);
    const actionId = parseActionId(req.params.id);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_RETURN,
      idempotencyKey,
      payload: { actionId, actorId: actor.userId, actorRole: actor.role, ...input },
      createdBy: actor.userId,
      entityType: 'governance_action',
      create: (tx) => returnGovernanceActionForEvidence({
        actionId,
        actorId: actor.userId,
        actorRole: actor.role,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        transaction: tx,
      }),
    });
    res.locals.auditEntityId = result.id;
    res.json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

router.post(
  '/governance-actions/:id/cancel',
  requireRoles(...FINANCIAL_VIEWERS),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getUser(req);
    const input = governanceActionDecisionSchema.parse(req.body);
    const actionId = parseActionId(req.params.id);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CANCEL,
      idempotencyKey,
      payload: { actionId, actorId: actor.userId, actorRole: actor.role, ...input },
      createdBy: actor.userId,
      entityType: 'governance_action',
      create: (tx) => cancelGovernanceAction({
        actionId,
        actorId: actor.userId,
        actorRole: actor.role,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        transaction: tx,
      }),
    });
    res.locals.auditEntityId = result.id;
    res.json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

export default router;
