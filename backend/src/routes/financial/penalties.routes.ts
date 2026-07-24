import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role, NotificationType, createPenaltySchema } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { emitNotification } from '../../services/notification.service';
import { cacheInvalidatePattern } from '../../lib/redis';
import * as financialService from '../../services/financial.service';

const router = Router();

// ─── Penalties ───────────────────────────────────────────────────────────────

router.get('/penalties', asyncHandler(async (req: Request, res: Response) => {
  const driverId = req.query.driverId ? parseInt(req.query.driverId as string) : undefined;
  res.json(await financialService.getPenalties(driverId));
}));

router.post('/penalties', asyncHandler(async (req: Request, res: Response) => {
  const data = createPenaltySchema.parse(req.body);
  const penalty = await financialService.createPenalty({
    driverId: data.driverId,
    tripId: data.tripId,
    reasonId: data.reasonId,
    customReason: data.customReason,
    amount: data.amount,
    date: data.date,
  });
  await cacheInvalidatePattern('reports:pnl:*');
  emitNotification({
    type: NotificationType.PENALTY_CREATED,
    title: 'Phạt mới',
    message: `Phạt cho lái xe ID ${data.driverId} đã được tạo`,
    relatedEntityType: 'penalties',
    relatedEntityId: penalty.id,
    targetDriverId: data.driverId,
  });
  res.status(201).json(penalty);
}));

router.post('/penalties/:id/cancel', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { reason } = req.body || {};
  const penalty = await financialService.cancelPenalty(id, reason);
  await cacheInvalidatePattern('reports:pnl:*');
  emitNotification({
    type: NotificationType.PENALTY_CANCELED,
    title: 'Hủy phạt',
    message: `Phạt ID ${id} đã được hủy`,
    relatedEntityType: 'penalties',
    relatedEntityId: id,
    targetDriverId: penalty.driverId,
  });
  res.json(penalty);
}));

export default router;
