import { Router } from 'express';
import { z } from 'zod';
import { getUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { throwValidation } from '../lib/validation';
import { ApiError } from '../errors';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from '../services/idempotency.service';
import { getRequestIdempotencyKey } from './utils/idempotency';
import {
  listDepositTrackers, createDepositTracker, updateDepositTrackerDates, markDepositRefunded, normalizeDepositDate,
} from '../services/deposit-refund-tracker.service';

const router = Router();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throwValidation(result.error);
  return result.data;
}
const dateInput = z.string().refine((value) => {
  try {
    normalizeDepositDate(value);
    return true;
  } catch {
    return false;
  }
});

router.get('/', asyncHandler(async (req, res) => {
  const query = parse(z.object({
    from: z.string().max(10).optional(), to: z.string().max(10).optional(),
    status: z.enum(['CHUA_HOAN_CUOC', 'DA_HOAN_CUOC']).optional(),
  }), req.query);
  res.json(await listDepositTrackers(getUser(req), { from: query.from, to: query.to, status: query.status }));
}));

router.post('/', asyncHandler(async (req, res) => {
  const user = getUser(req);
  const input = parse(z.object({
    billNumber: z.string().trim().min(1).max(80),
    customerName: z.string().trim().min(1).max(255),
    carrierName: z.string().trim().min(1).max(255),
    depositAmount: z.union([z.number(), z.string()]),
    cvSubmittedDate: dateInput.optional(),
    expectedRefundDate: dateInput.optional(),
    note: z.string().max(500).nullable().optional(),
  }).strict(), req.body);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DEPOSIT_TRACKER_CREATE,
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { ...input, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 201,
    create: (tx) => createDepositTracker(user, input, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.patch('/:id/dates', asyncHandler(async (req, res) => {
  const user = getUser(req);
  const trackerId = Number.parseInt(req.params.id as string, 10);
  if (!Number.isInteger(trackerId) || trackerId <= 0) throw new ApiError(400, 'ID dòng không hợp lệ');
  const input = parse(z.object({
    cvSubmittedDate: dateInput.nullable().optional(),
    expectedRefundDate: dateInput.nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  }).strict(), req.body);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DEPOSIT_TRACKER_DATES,
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { trackerId, ...input, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 200,
    create: (tx) => updateDepositTrackerDates(user, trackerId, input, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.post('/:id/refund', asyncHandler(async (req, res) => {
  const user = getUser(req);
  const trackerId = Number.parseInt(req.params.id as string, 10);
  if (!Number.isInteger(trackerId) || trackerId <= 0) throw new ApiError(400, 'ID dòng không hợp lệ');
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DEPOSIT_TRACKER_REFUND,
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { trackerId, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 200,
    create: (tx) => markDepositRefunded(user, trackerId, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

export default router;
