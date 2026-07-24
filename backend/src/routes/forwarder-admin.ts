import { Router } from 'express';
import type { Request, Response } from 'express';
import { listSettlementOpsCompletionSummaries, listTripExpenses } from '../services/forwarder.service';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';

const router = Router();

router.get('/settlement-ops-completion', asyncHandler(async (req: Request, res: Response) => {
  const rawSettlementIds = String(req.query.settlementIds ?? '').trim();
  if (!rawSettlementIds) {
    res.json({ items: [] });
    return;
  }

  const settlementIds = rawSettlementIds
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (/^[1-9]\d*$/.test(value) ? Number(value) : Number.NaN));
  if (settlementIds.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new ApiError(400, 'settlementIds không hợp lệ');
  }
  if (settlementIds.length > 100) {
    throw new ApiError(400, 'Chỉ được tra cứu tối đa 100 phiếu mỗi lần');
  }

  const items = await listSettlementOpsCompletionSummaries(settlementIds);
  res.json({ items });
}));

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const filters = {
    tripId: req.query.tripId ? parseInt(req.query.tripId as string, 10) : undefined,
    forwarderId: req.query.forwarderId ? parseInt(req.query.forwarderId as string, 10) : undefined,
    expenseType: req.query.expenseType as string | undefined,
  };
  const items = await listTripExpenses(filters);
  res.json({ items });
}));

export default router;
