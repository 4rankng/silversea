// Card 20260921_21 — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP (accounting chốt-debit CORE).
// Office reads + adjustment request/confirm/withdraw. Every write reaches the
// durable idempotency boundary (runIdempotent): the create is INSERT..WHERE
// NOT EXISTS-guarded (one live PENDING per lot), confirm/withdraw only move
// PENDING rows (guarded UPDATE, returning counts) — replays return the first
// outcome instead of re-applying.
import { Router } from 'express';
import { Role } from '@tingting/shared';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { getUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';
import { requireRoles } from '../middleware/casbin';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from '../services/idempotency.service';
import { getRequestIdempotencyKey } from './utils/idempotency';
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
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DEBIT_BOARD_RATE_ADJUSTMENT_REQUEST,
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { ...parsed.data, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 201,
    create: (tx) => createRateAdjustmentRequests({
      shipmentIds: parsed.data.shipmentIds,
      ghiChu: parsed.data.ghiChu,
      userId: user.userId,
    }, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

accountingDebitRoutes.post('/debit-board/rate-adjustments/confirm', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => i.message).join('; '));
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DEBIT_BOARD_RATE_ADJUSTMENT_CONFIRM,
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { ...parsed.data, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 200,
    create: (tx) => confirmRateAdjustmentRequests({ requestIds: parsed.data.requestIds, userId: user.userId }, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

accountingDebitRoutes.post('/debit-board/rate-adjustments/withdraw', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => i.message).join('; '));
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DEBIT_BOARD_RATE_ADJUSTMENT_WITHDRAW,
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { ...parsed.data, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 200,
    create: (tx) => withdrawRateAdjustmentRequests({ requestIds: parsed.data.requestIds, userId: user.userId }, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

export default accountingDebitRoutes;
