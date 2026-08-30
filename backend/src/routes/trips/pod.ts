/**
 * POD recovery and paper-order/driver-order acceptance marks. Handler
 * bodies moved verbatim from routes/trips.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { markTripPodRecovered } from '../../services/trip-mutations.service';
import { getExpectedVersion } from './trips-shared';

const router = Router();

router.post('/:id/pod-recovered', requireRoles(Role.ACCOUNTANT, Role.CUS), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const expectedVersion = getExpectedVersion(req.body);
  const user = getUser(req);
  const updated = await markTripPodRecovered(id, user.userId, expectedVersion);
  res.json(updated);
}));

// ─── O2C field-ops hand-off timestamps (phase-04) ────────────────────────────
// Ops (FORWARDER) records the paper-order hand-off; Driver confirms order receipt.
router.post('/:id/paper-order-collected', requireRoles(Role.OPS), asyncHandler(async (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Đường dẫn này đã ngừng dùng. Vui lòng dùng xác nhận bàn giao lệnh gốc trong cổng FORWARDER theo chuyến được giao.',
  });
}));

router.post('/:id/driver-order-accepted', requireRoles(Role.DRIVER), asyncHandler(async (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Đường dẫn này đã ngừng dùng. Tài xế phải dùng mốc "Đã nhận lệnh gốc" trong cổng DRIVER để ghi nhận theo chuỗi chuẩn.',
  });
}));


export default router;
