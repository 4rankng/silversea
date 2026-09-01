import { Router } from 'express';
import type { Request, Response } from 'express';
import * as s from '../../db/schema';
import { and, eq, isNull, like, ne } from 'drizzle-orm';
import { ApiError } from '../../errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import { Role } from '@tingting/shared';
import { createCrudRouter } from '../utils/crud-factory';
import { runIdempotent, resolveIdempotencyKey } from '../../services/idempotency.service';
import { cacheInvalidate, cacheInvalidatePattern } from '../../lib/redis';
import * as H from './config-helpers';
import { installTireInTx, removeTireInTx, disposeTireInTx, transferTireInTx, isHttpError } from '../../services/tire.service';
import { installTireSchema, disposeTireSchema, transferTireSchema } from '@tingting/shared';
// Tire lifecycle routes (T3c split) — install/remove/dispose/transfer with
// role-gated writes, moved verbatim from routes/config.ts.

// Lifecycle endpoints — MANAGER/ACCOUNTANT/ADMIN only (writes). The mount-level
// config Casbin gate already restricts broadly; requireRoles tightens write actions.
export const tireLifecycleRouter = Router();
tireLifecycleRouter.post('/:id/install', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = installTireSchema.parse(req.body);
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi lắp lốp.');
  const expectedUpdatedAt = H.requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản lốp mới nhất trước khi lắp.',
  );
  try {
    const { result, replayed } = await runIdempotent({
      endpoint: H.CONFIG_COMMANDS.TIRE_INSTALL,
      idempotencyKey,
      payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: req.user?.userId ?? null,
      entityType: 'tires',
      create: async (tx) => installTireInTx(tx, id, {
        truckId: data.truckId ?? null,
        trailerId: data.trailerId ?? null,
        position: data.position ?? null,
      }, expectedUpdatedAt),
    });
    if (!replayed) {
      await cacheInvalidatePattern('catalogs:*');
    }
    res.json({ ...result, replayed });
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

tireLifecycleRouter.post('/:id/remove', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi tháo lốp.');
  const expectedUpdatedAt = H.requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản lốp mới nhất trước khi tháo.',
  );
  try {
    const { result, replayed } = await runIdempotent({
      endpoint: H.CONFIG_COMMANDS.TIRE_REMOVE,
      idempotencyKey,
      payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: req.user?.userId ?? null,
      entityType: 'tires',
      create: async (tx) => removeTireInTx(tx, id, expectedUpdatedAt),
    });
    if (!replayed) {
      await cacheInvalidatePattern('catalogs:*');
    }
    res.json({ ...result, replayed });
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

tireLifecycleRouter.post('/:id/dispose', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = disposeTireSchema.parse(req.body);
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi thanh lý lốp.');
  const expectedUpdatedAt = H.requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản lốp mới nhất trước khi thanh lý.',
  );
  try {
    const { result, replayed } = await runIdempotent({
      endpoint: H.CONFIG_COMMANDS.TIRE_DISPOSE,
      idempotencyKey,
      payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: req.user?.userId ?? null,
      entityType: 'tires',
      create: async (tx) => disposeTireInTx(tx, id, { reason: data.reason }, expectedUpdatedAt),
    });
    if (!replayed) {
      await cacheInvalidatePattern('catalogs:*');
    }
    res.json({ ...result, replayed });
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

tireLifecycleRouter.post('/:id/transfer', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = transferTireSchema.parse(req.body);
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi chuyển lốp.');
  const expectedUpdatedAt = H.requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản lốp mới nhất trước khi điều chuyển.',
  );
  try {
    const { result, replayed } = await runIdempotent({
      endpoint: H.CONFIG_COMMANDS.TIRE_TRANSFER,
      idempotencyKey,
      payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: req.user?.userId ?? null,
      entityType: 'tires',
      create: async (tx) => transferTireInTx(tx, id, {
        truckId: data.truckId ?? null,
        trailerId: data.trailerId ?? null,
        position: data.position ?? null,
      }, expectedUpdatedAt),
    });
    if (!replayed) {
      await cacheInvalidatePattern('catalogs:*');
    }
    res.json({ ...result, replayed });
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));
// Road config — singleton GET/PUT
