import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { Role } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ApiError } from '../../errors';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { runIdempotent } from '../../services/idempotency.service';
import {
  approveCreditOverrideRequest,
  checkCreditOverrideRequest,
  createCreditOverrideRequest,
  getCreditOverrideRequest,
  listCreditOverrideRequests,
  CREDIT_OVERRIDE_SORT_KEYS,
} from '../../services/credit-limit.service';

const createCreditOverrideSchema = z.object({
  customerId: z.coerce.number().int().positive('Khách hàng là bắt buộc'),
  proposedAmount: z.coerce.number().int().positive('Giá trị đề nghị phải là số nguyên dương'),
  reason: z.string().trim().min(1, 'Lý do vượt hạn mức là bắt buộc').max(1000),
  shipmentId: z.coerce.number().int().positive().optional().nullable(),
  expiresAt: z.string().trim().min(1).optional().nullable(),
}).superRefine((value, ctx) => {
  const hasShipment = value.shipmentId != null;
  const hasExpiry = !!value.expiresAt;
  if (hasShipment === hasExpiry) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Phải chọn đúng một phạm vi: theo lô hàng hoặc theo ngày hết hạn',
      path: ['shipmentId'],
    });
  }
});

const listSchema = z.object({
  customerId: z.coerce.number().int().positive().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(500).optional(),
  sortBy: z.enum(CREDIT_OVERRIDE_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

function parseRequestId(rawId: string | string[]): number {
  const id = Array.isArray(rawId) ? Number.NaN : Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      message: 'Đề nghị vượt hạn mức không hợp lệ',
      path: ['id'],
    }]);
  }
  return id;
}

const CREDIT_OVERRIDE_CREATE_ENDPOINT = 'credit-overrides.create';

function requireIdempotencyKey(req: Request): string {
  const idempotencyKey = getRequestIdempotencyKey(req);
  if (!idempotencyKey) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác vượt hạn mức tín dụng.');
  }
  return idempotencyKey;
}

const router = Router();

router.get(
  '/finance/credit-overrides',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const filters = listSchema.parse(req.query);
    res.json(await listCreditOverrideRequests(filters, getUser(req).role));
  }),
);

router.get(
  '/finance/credit-overrides/:id',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    res.json(await getCreditOverrideRequest(parseRequestId(req.params.id), getUser(req).role));
  }),
);

router.post(
  '/finance/credit-overrides',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const payload = createCreditOverrideSchema.parse(req.body);
    const actor = getUser(req);
    const { result, replayed, statusCode } = await runIdempotent({
      endpoint: CREDIT_OVERRIDE_CREATE_ENDPOINT,
      idempotencyKey: requireIdempotencyKey(req),
      payload: { actorId: actor.userId, actorRole: actor.role, ...payload },
      createdBy: actor.userId,
      entityType: 'credit_override',
      responseStatusCode: 201,
      // 2026-09-11 user directive: phê duyệt removed ENTIRELY (AR R4) — every
      // authorized role's override applies in-request via the retained
      // make→check→approve service chain; no tier gate, nothing stays pending.
      create: async (tx) => {
        const created = await createCreditOverrideRequest(payload, {
          userId: actor.userId,
          role: actor.role,
        }, tx);
        const checked = await checkCreditOverrideRequest(created.id, {
          userId: actor.userId,
          role: actor.role,
        }, { expectedVersion: created.version }, tx);
        const approval = await approveCreditOverrideRequest(created.id, {
          userId: actor.userId,
          role: actor.role,
        }, { expectedVersion: checked.version }, tx);
        return approval.request;
      },
    });
    const request = replayed ? { ...result, replayed } : result;
    res.locals.auditEntityId = request.id;
    res.locals.auditEntityKey = `credit-override-${request.id}`;
    res.status(statusCode).json(request);
  }),
);

export default router;
