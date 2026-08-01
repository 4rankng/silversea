import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role, createPenaltySchema } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import * as financialService from '../../services/financial.service';
import { IDEMPOTENCY_ENDPOINTS, resolveIdempotencyKey, runIdempotent } from '../../services/idempotency.service';

const router = Router();

function getRequestIdempotencyKey(req: Request): string | undefined {
  const requestBody = req.body as Record<string, unknown> | undefined;
  return resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
}

// ─── Penalties ───────────────────────────────────────────────────────────────

router.get('/penalties', asyncHandler(async (req: Request, res: Response) => {
  const driverId = req.query.driverId ? parseInt(req.query.driverId as string, 10) : undefined;
  res.json(await financialService.getPenalties(driverId));
}));

router.post('/penalties', asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const data = createPenaltySchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.PENALTIES_CREATE,
    idempotencyKey,
    payload: {
      driverId: data.driverId,
      tripId: data.tripId ?? null,
      reasonId: data.reasonId ?? null,
      customReason: data.customReason ?? '',
      amount: data.amount,
      date: data.date,
      makerId: actor.userId,
      makerRole: actor.role,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => financialService.requestPenaltyCreateGovernance({
      penalty: {
        driverId: data.driverId,
        tripId: data.tripId,
        reasonId: data.reasonId,
        customReason: data.customReason,
        amount: data.amount,
        date: data.date,
      },
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? "Quyết định chưa có tên";
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/penalties/:id/cancel', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const penaltyId = parseInt(req.params.id as string, 10);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.PENALTIES_CANCEL,
    idempotencyKey,
    payload: {
      penaltyId,
      reason: reason ?? '',
      makerId: actor.userId,
      makerRole: actor.role,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => financialService.requestPenaltyCancelGovernance({
      penaltyId,
      reason,
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? "Quyết định chưa có tên";
  res.status(200).json(idempotencyKey ? { ...result, replayed } : result);
}));

export default router;
