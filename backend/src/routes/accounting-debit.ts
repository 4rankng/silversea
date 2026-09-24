// Adjustment results and writes share the deployed idempotency transaction;
// per-lot service locks serialize competing requests.
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
import { requireShipmentIdempotencyKey } from './shipments/shipment-shared';
import {
  getAccountingDebitBoard,
  createRateAdjustmentRequests,
  confirmRateAdjustmentRequests,
  withdrawRateAdjustmentRequests,
} from '../services/accounting-debit-close.service';
import {
  createDebitSettlementRound,
  listDebitSettlementRounds,
} from '../services/debit-settlement-rounds.service';

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

// Card 20260923_12 — Chọn Debit settlement round: lần/tháng are the accountant's
// free choices (PDF); vatRate is the 0/5/8/10 set; the carrier + customer sides
// are DERIVED server-side from the selected lots' active trips.
const settlementRoundSchema = z.object({
  shipmentIds: z.array(z.number().int().positive()).min(1, 'Vui lòng chọn ít nhất một lô.').max(200),
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
  roundNo: z.number().int().min(1, 'Lần phải từ 1 trở lên.').max(99),
  month: z.number().int().min(1, 'Tháng phải từ 1 đến 12.').max(12, 'Tháng phải từ 1 đến 12.'),
  year: z.number().int().min(2000).max(2100),
  direction: z.enum(['THU', 'TRA']),
  vatRate: z.union([z.literal(0), z.literal(5), z.literal(8), z.literal(10)]),
  ghiChu: z.string().trim().max(500).optional(),
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
  requireShipmentIdempotencyKey(req, 'Idempotency-Key là bắt buộc.');
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
  requireShipmentIdempotencyKey(req, 'Idempotency-Key là bắt buộc.');
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
  requireShipmentIdempotencyKey(req, 'Idempotency-Key là bắt buộc.');
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

accountingDebitRoutes.get('/debit-board/settlement-rounds', OFFICE_ROLES, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listDebitSettlementRounds());
}));

accountingDebitRoutes.post('/debit-board/settlement-rounds', OFFICE_ROLES, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = settlementRoundSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => i.message).join('; '));
  requireShipmentIdempotencyKey(req, 'Idempotency-Key là bắt buộc.');
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DEBIT_BOARD_SETTLEMENT_ROUND_CREATE,
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { ...parsed.data, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 201,
    create: (tx) => createDebitSettlementRound({ ...parsed.data, userId: user.userId }, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

export default accountingDebitRoutes;
