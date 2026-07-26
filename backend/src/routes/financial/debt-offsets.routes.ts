import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role, debtOffsetSchema } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { getDualEntities, createDebtOffset, approveDebtOffset, cancelDebtOffset, listDebtOffsets } from '../../services/debtOffset.service';
import { invalidateReportCaches } from '../../lib/redis';

const router = Router();

// ─── Debt Offsets ─────────────────────────────────────────────────────────────

router.get('/finance/dual-entities', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getDualEntities());
}));

router.get('/finance/debt-offsets', asyncHandler(async (req: Request, res: Response) => {
  const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
  if (customerId !== undefined && Number.isNaN(customerId)) {
    return res.status(400).json({ error: 'customerId không hợp lệ' });
  }
  const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
  if (supplierId !== undefined && Number.isNaN(supplierId)) {
    return res.status(400).json({ error: 'supplierId không hợp lệ' });
  }
  const approvalStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await listDebtOffsets({ customerId, supplierId, approvalStatus }));
}));

router.post('/finance/debt-offsets', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const data = debtOffsetSchema.parse(req.body);
  const result = await createDebtOffset({
    ...data,
    createdBy: getUser(req).userId,
  });
  res.status(201).json(result);
}));

router.post('/finance/debt-offsets/:id/approve',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const result = await approveDebtOffset(id, getUser(req).userId, getUser(req).role);
    await invalidateReportCaches();   // was missing — approve posts ADJUSTMENT ledger entries but busted no cache
    res.json(result);
  }),
);

// M6.4 — cancel an APPROVED debt offset via reversing entries. Mirrors
// approveDebtOffset's authz (ADMIN/MANAGER). Invalidates the same caches.
router.post('/finance/debt-offsets/:id/cancel',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const result = await cancelDebtOffset(id, getUser(req).userId, getUser(req).role);
    await invalidateReportCaches();
    res.json(result);
  }),
);

export default router;
