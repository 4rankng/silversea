// Card 20260921_21 — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP (accounting chốt-debit CORE).
// Office reads + adjustment request/confirm/withdraw. The writes are
// transition-safe WITHOUT Idempotency-Key: create is INSERT..WHERE NOT
// EXISTS-guarded (one live PENDING per lot), confirm/withdraw only move
// PENDING rows (guarded UPDATE, returning counts) — replays are no-ops.
import { Router } from 'express';
import { Role } from '@tingting/shared';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { getUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';
import { requireRoles } from '../middleware/casbin';
import {
  getAccountingDebitBoard,
  createRateAdjustmentRequests,
  confirmRateAdjustmentRequests,
  withdrawRateAdjustmentRequests,
} from '../services/accounting-debit-close.service';

const accountingDebitRoutes = Router();

const OFFICE_ROLES = requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT);

const boardQuerySchema = z.object({
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

const adjustmentRequestSchema = z.object({
  shipmentIds: z.array(z.number().int().positive()).min(1, 'Vui lòng chọn ít nhất một lô.').max(200),
  ghiChu: z.string().trim().max(500).optional(),
});

const decisionSchema = z.object({
  requestIds: z.array(z.number().int().positive()).min(1).max(200),
});

accountingDebitRoutes.get('/debit-board', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const parsed = boardQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => i.message).join('; '));
  res.json(await getAccountingDebitBoard(parsed.data));
}));

accountingDebitRoutes.post('/debit-board/rate-adjustments', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = adjustmentRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => i.message).join('; '));
  const result = await createRateAdjustmentRequests({
    shipmentIds: parsed.data.shipmentIds,
    ghiChu: parsed.data.ghiChu,
    userId: user.userId,
  });
  res.status(201).json(result);
}));

accountingDebitRoutes.post('/debit-board/rate-adjustments/confirm', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => i.message).join('; '));
  res.json(await confirmRateAdjustmentRequests({ requestIds: parsed.data.requestIds, userId: user.userId }));
}));

accountingDebitRoutes.post('/debit-board/rate-adjustments/withdraw', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => i.message).join('; '));
  res.json(await withdrawRateAdjustmentRequests({ requestIds: parsed.data.requestIds, userId: user.userId }));
}));

export default accountingDebitRoutes;
