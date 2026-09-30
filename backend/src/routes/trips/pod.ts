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
import { declareNonMaterialWrite } from '../../middleware/material-write';

const router = Router()

router.post('/:id/pod-recovered', declareNonMaterialWrite('O2C POD-recovery flag setter (accountant/CUS); no direct financial mutation — the completion transition that consumes it runs its own durable boundary.'), requireRoles(Role.ACCOUNTANT, Role.CUS), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const expectedVersion = getExpectedVersion(req.body);
  const user = getUser(req);
  const updated = await markTripPodRecovered(id, user.userId, expectedVersion);
  res.json(updated);
}));

// ─── O2C field-ops hand-off timestamps (phase-04) ────────────────────────────
// Ops (FORWARDER) records the paper-order hand-off; Driver confirms order receipt.
router.post('/:id/paper-order-collected', declareNonMaterialWrite('O2C field-ops hand-off timestamp (Ops); operational marker, no financial mutation.'), requireRoles(Role.OPS), asyncHandler(async (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Đường dẫn này đã ngừng dùng. Vui lòng dùng xác nhận bàn giao lệnh gốc trong cổng FORWARDER theo chuyến được giao.',
  });
}));

router.post('/:id/driver-order-accepted', declareNonMaterialWrite('O2C field-ops hand-off timestamp (Driver); operational marker, no financial mutation.'), requireRoles(Role.DRIVER), asyncHandler(async (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Đường dẫn này đã ngừng dùng. Tài xế phải dùng mốc "Đã nhận lệnh gốc" trong cổng DRIVER để ghi nhận theo chuỗi chuẩn.',
  });
}));


export default router;
