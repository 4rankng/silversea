import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import {
  approveCreditOverrideRequest,
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
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function parseRequestId(rawId: string | string[]): number {
  const id = Array.isArray(rawId) ? Number.NaN : Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      message: 'ID đề nghị vượt hạn mức không hợp lệ',
      path: ['id'],
    }]);
  }
  return id;
}

const router = Router();

router.get(
  '/finance/credit-overrides',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const filters = listSchema.parse(req.query);
    res.json(await listCreditOverrideRequests(filters));
  }),
);

router.get(
  '/finance/credit-overrides/:id',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    res.json(await getCreditOverrideRequest(parseRequestId(req.params.id)));
  }),
);

router.post(
  '/finance/credit-overrides',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const payload = createCreditOverrideSchema.parse(req.body);
    const actor = getUser(req);
    const request = await createCreditOverrideRequest(payload, {
      userId: actor.userId,
      role: actor.role,
    });
    res.locals.auditEntityId = request.id;
    res.locals.auditEntityKey = `credit-override-${request.id}`;
    res.status(201).json(request);
  }),
);

router.post(
  '/finance/credit-overrides/:id/approve',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const id = parseRequestId(req.params.id);
    const payload = decisionSchema.parse(req.body);
    const actor = getUser(req);
    const result = await approveCreditOverrideRequest(id, {
      userId: actor.userId,
      role: actor.role,
    }, payload);
    res.locals.auditEntityId = result.request.id;
    res.locals.auditEntityKey = `credit-override-${result.request.id}`;
    res.json(result.request);
  }),
);

router.post(
  '/finance/credit-overrides/:id/reject',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const id = parseRequestId(req.params.id);
    const payload = rejectSchema.parse(req.body);
    const actor = getUser(req);
    const request = await rejectCreditOverrideRequest(id, {
      userId: actor.userId,
      role: actor.role,
    }, payload);
    res.locals.auditEntityId = request.id;
    res.locals.auditEntityKey = `credit-override-${request.id}`;
    res.json(request);
  }),
);

export default router;
