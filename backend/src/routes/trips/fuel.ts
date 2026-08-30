/**
 * Fuel voucher downloads (HTML + Excel). Handler bodies moved verbatim from
 * routes/trips.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { getFuelVoucherHtml, getFuelVoucherXlsx } from '../../services/fuel-voucher.service';

const router = Router();

// GET /api/trips/:id/fuel-voucher/html — fuel voucher HTML
router.get('/:id/fuel-voucher/html',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const html = await getFuelVoucherHtml(id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

// GET /api/trips/:id/fuel-voucher/xlsx — fuel voucher Excel download
router.get('/:id/fuel-voucher/xlsx',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=phieu-cap-nhien-lieu-${id}.xlsx`);
  await getFuelVoucherXlsx(id, res);
}));


export default router;
