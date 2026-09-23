// Accounting routes — card 20260921_18 invoice tracking.
//
// Mutations are office-staff only (requireRoles); reads are additionally
// bridged for CUS by the route-scoped casbin allowance (read-only, enforced
// server-side per card AC1).

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@tingting/shared';
import type { Request, Response } from 'express';
import {
  invoiceTrackingCreateSchema,
  invoiceTrackingPatchSchema,
} from '@tingting/shared';
import { getUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS } from '../services/idempotency.service';
import {
  createInvoiceTracking,
  deleteInvoiceTracking,
  listInvoiceTracking,
  updateInvoiceTracking,
} from '../services/invoice-tracking.service';
import { requireRoles } from '../middleware/casbin';
import { runIdempotent } from '../services/idempotency.service';
import { parseId as sharedParseId } from './utils/parse-id';

function parseId(value: string | string[] | undefined, label = 'ID'): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, label + ' không hợp lệ');
  return id;
}

function requireIdempotencyKey(req: Request): string {
  const key = req.header('Idempotency-Key');
  if (!key) throw new ApiError(400, 'Thiếu Idempotency-Key');
  return key;
}

const accountingRoutes = Router();

const OFFICE_ROLES = requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT);

accountingRoutes.get('/invoice-tracking', asyncHandler(async (req: Request, res: Response) => {
  const from = String(req.query.from ?? businessDate());
  const to = String(req.query.to ?? businessDate());
  const { rows, totals } = await listInvoiceTracking(from, to);
  res.json({ rows, totals });
}));

function businessDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

accountingRoutes.post('/invoice-tracking', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = invoiceTrackingCreateSchema.parse(req.body);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.INVOICE_TRACKING_CREATE,
    idempotencyKey: requireIdempotencyKey(req),
    payload: { ...parsed, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 201,
    create: (tx) => createInvoiceTracking(user.userId, parsed, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

accountingRoutes.patch('/invoice-tracking/:id', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const id = parseId(req.params.id);
  const parsed = invoiceTrackingPatchSchema.parse(req.body);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.INVOICE_TRACKING_UPDATE,
    idempotencyKey: requireIdempotencyKey(req),
    payload: { id, patch: parsed, userId: user.userId },
    createdBy: user.userId,
    create: (tx) => updateInvoiceTracking(user.userId, id, parsed, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

accountingRoutes.delete('/invoice-tracking/:id', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const id = parseId(req.params.id);
  // Q10 (card 20260922_78): mandatory free-text reason; soft-voids the
  // tracker row and its mirrored fee row with actor + timestamp.
  const reason = z.object({ reason: z.string().trim().min(1, 'Lý do xóa là bắt buộc.').max(500) })
    .parse((req.body ?? {})).reason;
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.INVOICE_TRACKING_DELETE,
    idempotencyKey: requireIdempotencyKey(req),
    payload: { id, userId: user.userId, reason },
    createdBy: user.userId,
    create: async (tx) => {
      await deleteInvoiceTracking(user.userId, id, reason, tx);
      return { success: true };
    },
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

export default accountingRoutes;
