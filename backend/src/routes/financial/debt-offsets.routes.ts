import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role, debtOffsetSchema, governanceActionDecisionSchema } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import {
  getDualEntities,
  createDebtOffset,
  listDebtOffsets,
  requestDebtOffsetApprovalGovernance,
  requestDebtOffsetCancelGovernance,
} from '../../services/debtOffset.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';

const router = Router();

// ─── Debt Offsets ─────────────────────────────────────────────────────────────

router.get('/finance/dual-entities', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getDualEntities());
}));

router.get('/finance/debt-offsets', asyncHandler(async (req: Request, res: Response) => {
  const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
  if (customerId !== undefined && Number.isNaN(customerId)) {
    return res.status(400).json({ error: 'customerId không hợp lệ' });
  }
  const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
  if (supplierId !== undefined && Number.isNaN(supplierId)) {
    return res.status(400).json({ error: 'supplierId không hợp lệ' });
  }
  const approvalStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await listDebtOffsets({ customerId, supplierId, approvalStatus }));
}));

router.post('/finance/debt-offsets', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const data = debtOffsetSchema.parse(req.body);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DEBT_OFFSET_CREATE,
    idempotencyKey,
    payload: { actorId: user.userId, ...data },
    createdBy: user.userId,
    entityType: 'debt_offset',
    create: (tx) => createDebtOffset({
      ...data,
      createdBy: user.userId,
      transaction: tx,
    }),
  });
  res.locals.auditEntityId = result.id;
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/finance/debt-offsets/:id/approve',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const user = getUser(req);
    const data = governanceActionDecisionSchema.parse(req.body);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.DEBT_OFFSET_APPROVE,
      idempotencyKey,
      payload: { actorId: user.userId, actorRole: user.role, id, ...data },
      createdBy: user.userId,
      entityType: 'governance_action',
      create: (tx) => requestDebtOffsetApprovalGovernance({
        debtOffsetId: id,
        expectedVersion: data.expectedVersion,
        reason: data.reason,
        makerId: user.userId,
        makerRole: user.role,
        transaction: tx,
      }),
    });
    res.locals.auditEntityId = result.id;
    res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

// M6.4 — cancel an APPROVED debt offset via reversing entries. Mirrors
// approveDebtOffset's authz (ADMIN/MANAGER). Invalidates the same caches.
router.post('/finance/debt-offsets/:id/cancel',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const user = getUser(req);
    const data = governanceActionDecisionSchema.parse(req.body);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.DEBT_OFFSET_CANCEL,
      idempotencyKey,
      payload: { actorId: user.userId, actorRole: user.role, id, ...data },
      createdBy: user.userId,
      entityType: 'governance_action',
      create: (tx) => requestDebtOffsetCancelGovernance({
        debtOffsetId: id,
        expectedVersion: data.expectedVersion,
        reason: data.reason,
        makerId: user.userId,
        makerRole: user.role,
        transaction: tx,
      }),
    });
    res.locals.auditEntityId = result.id;
    res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

export default router;
