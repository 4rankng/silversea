// Quotation CRUD routes (card 20260922_66). Mounted by routes/config.ts so
// the /api casbin 'config' gate applies to reads; writes additionally
// requireRoles to the financial trio (operator ruling 2026-09-22 e:
// ADMIN / MANAGER / ACCOUNTANT precedent). Idempotency-Key honored on writes
// per house standard.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role, quotationCreateSchema, quotationUpdateSchema } from '@tingting/shared';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ApiError } from '../../errors';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { runIdempotent } from '../../services/idempotency.service';
import {
  createQuotation, deleteQuotation, getQuotation, listQuotations, updateQuotation,
} from '../../services/quotation.service';

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

const router = Router();

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listQuotations());
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID không hợp lệ');
  res.json(await getQuotation(id));
}));

router.post('/', requireRoles(...WRITE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const parsed = quotationCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.errors[0]?.message ?? 'Dữ liệu báo giá không hợp lệ');
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: 'quotations.create',
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { actorId: actor.userId, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'quotation',
    create: (tx) => createQuotation(parsed.data, tx),
    getEntityId: (value) => value.id,
  });
  res.status(replayed ? 200 : 201).json(result);
}));

router.put('/:id', requireRoles(...WRITE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID không hợp lệ');
  const parsed = quotationUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.errors[0]?.message ?? 'Dữ liệu báo giá không hợp lệ');
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: 'quotations.update',
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { actorId: actor.userId, quotationId: id, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'quotation',
    getEntityId: () => id,
    create: (tx) => updateQuotation(id, parsed.data, tx).then(() => ({ id })),
  });
  res.json(result);
}));

router.delete('/:id', requireRoles(...WRITE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID không hợp lệ');
  const actor = getUser(req);
  await runIdempotent({
    endpoint: 'quotations.delete',
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { actorId: actor.userId, quotationId: id },
    createdBy: actor.userId,
    entityType: 'quotation',
    getEntityId: () => id,
    create: async (tx) => {
      await deleteQuotation(id, tx);
      return { id };
    },
  });
  res.json({ ok: true });
}));

export default router;