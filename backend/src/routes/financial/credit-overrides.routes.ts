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
  rejectCreditOverrideRequest,
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

const decisionSchema = z.object({
  expectedVersion: z.coerce.number().int().positive('Phiên bản đề nghị không hợp lệ'),
});

const rejectSchema = decisionSchema.extend({
  reason: z.string().trim().min(1, 'Lý do từ chối là bắt buộc').max(1000),
});

const listSchema = z.object({
  customerId: z.coerce.number().int().positive().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
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
const CREDIT_OVERRIDE_CHECK_ENDPOINT = 'credit-overrides.check';
const CREDIT_OVERRIDE_APPROVE_ENDPOINT = 'credit-overrides.approve';
const CREDIT_OVERRIDE_REJECT_ENDPOINT = 'credit-overrides.reject';

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
      create: (tx) => createCreditOverrideRequest(payload, {
        userId: actor.userId,
        role: actor.role,
      }, tx),
    });
    const request = replayed ? { ...result, replayed } : result;
    res.locals.auditEntityId = request.id;
    res.locals.auditEntityKey = `credit-override-${request.id}`;
    res.status(statusCode).json(request);
  }),
);

router.post(
  '/finance/credit-overrides/:id/check',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const id = parseRequestId(req.params.id);
    const payload = decisionSchema.parse(req.body);
    const actor = getUser(req);
    const { result, replayed } = await runIdempotent({
      endpoint: CREDIT_OVERRIDE_CHECK_ENDPOINT,
      idempotencyKey: requireIdempotencyKey(req),
      payload: {
        actorId: actor.userId,
        actorRole: actor.role,
        expectedVersion: payload.expectedVersion,
        id,
      },
      createdBy: actor.userId,
      entityType: 'credit_override',
      create: (tx) => checkCreditOverrideRequest(id, {
        userId: actor.userId,
        role: actor.role,
      }, payload, tx),
      getEntityId: () => id,
    });
    const request = replayed ? { ...result, replayed } : result;
    res.locals.auditEntityId = request.id;
    res.locals.auditEntityKey = `credit-override-${request.id}`;
    res.json(request);
  }),
);

router.post(
  '/finance/credit-overrides/:id/approve',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const id = parseRequestId(req.params.id);
    const payload = decisionSchema.parse(req.body);
    const actor = getUser(req);
    const { result, replayed } = await runIdempotent({
      endpoint: CREDIT_OVERRIDE_APPROVE_ENDPOINT,
      idempotencyKey: requireIdempotencyKey(req),
      payload: {
        actorId: actor.userId,
        actorRole: actor.role,
        expectedVersion: payload.expectedVersion,
        id,
      },
      createdBy: actor.userId,
      entityType: 'credit_override',
      create: async (tx) => {
        const approval = await approveCreditOverrideRequest(id, {
          userId: actor.userId,
          role: actor.role,
        }, payload, tx);
        return approval.request;
      },
      getEntityId: () => id,
    });
    const request = replayed ? { ...result, replayed } : result;
    res.locals.auditEntityId = request.id;
    res.locals.auditEntityKey = `credit-override-${request.id}`;
    res.json(request);
  }),
);

router.post(
  '/finance/credit-overrides/:id/reject',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const id = parseRequestId(req.params.id);
    const payload = rejectSchema.parse(req.body);
    const actor = getUser(req);
    const { result, replayed } = await runIdempotent({
      endpoint: CREDIT_OVERRIDE_REJECT_ENDPOINT,
      idempotencyKey: requireIdempotencyKey(req),
      payload: {
        actorId: actor.userId,
        actorRole: actor.role,
        expectedVersion: payload.expectedVersion,
        id,
        reason: payload.reason,
      },
      createdBy: actor.userId,
      entityType: 'credit_override',
      create: (tx) => rejectCreditOverrideRequest(id, {
        userId: actor.userId,
        role: actor.role,
      }, payload, tx),
      getEntityId: () => id,
    });
    const request = replayed ? { ...result, replayed } : result;
    res.locals.auditEntityId = request.id;
    res.locals.auditEntityKey = `credit-override-${request.id}`;
    res.json(request);
  }),
);

export default router;
