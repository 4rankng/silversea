import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role, NotificationType, createPenaltySchema } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { emitNotification } from '../../services/notification.service';
import { cacheInvalidatePattern } from '../../lib/redis';
import * as financialService from '../../services/financial.service';
import { resolveIdempotencyKey } from '../../services/idempotency.service';

const router = Router();

// ─── Penalties ───────────────────────────────────────────────────────────────

router.get('/penalties', asyncHandler(async (req: Request, res: Response) => {
  const driverId = req.query.driverId ? parseInt(req.query.driverId as string) : undefined;
  res.json(await financialService.getPenalties(driverId));
}));

router.post('/penalties', asyncHandler(async (req: Request, res: Response) => {
  const requestBody = req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
  const data = createPenaltySchema.parse(req.body);
  const { result: penalty, replayed } = await financialService.createPenaltyIdempotent({
    input: {
      driverId: data.driverId,
      tripId: data.tripId,
      reasonId: data.reasonId,
      customReason: data.customReason,
      amount: data.amount,
      date: data.date,
    },
    idempotencyKey,
    createdBy: getUser(req).userId,
  });
  res.locals.auditEntityId = penalty.id;
  res.locals.auditEntityKey = `#${penalty.id}`;
  if (!replayed) {
    await cacheInvalidatePattern('reports:pnl:*');
    emitNotification({
      type: NotificationType.PENALTY_CREATED,
      title: 'Phạt mới',
      message: `Phạt cho lái xe ID ${data.driverId} đã được tạo`,
      relatedEntityType: 'penalties',
      relatedEntityId: penalty.id,
      targetDriverId: data.driverId,
    });
  }
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...penalty, replayed } : penalty);
}));

router.post('/penalties/:id/cancel', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { reason } = req.body || {};
  const requestBody = req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
  const { result: penalty, replayed } = await financialService.cancelPenaltyIdempotent({
    penaltyId: id,
    reason,
    idempotencyKey,
    createdBy: getUser(req).userId,
  });
  res.locals.auditEntityId = penalty.id;
  res.locals.auditEntityKey = `#${penalty.id}`;
  if (!replayed) {
    await cacheInvalidatePattern('reports:pnl:*');
    emitNotification({
      type: NotificationType.PENALTY_CANCELED,
      title: 'Hủy phạt',
      message: `Phạt ID ${id} đã được hủy`,
      relatedEntityType: 'penalties',
      relatedEntityId: id,
      targetDriverId: penalty.driverId,
    });
  }
  res.json(idempotencyKey ? { ...penalty, replayed } : penalty);
}));

export default router;
