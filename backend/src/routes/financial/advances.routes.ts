import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role, accountantSettlementExpensePatchSchema, updateAdvanceSettlementSchema } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { getAdvanceSettlement } from '../../services/advance.service';
import { exportSettlementXlsx, exportSettlementHtml } from '../../services/settlement-export.service';
import { listAdvanceRequests, approveAdvanceRequest, rejectAdvanceRequest, listAdvanceSettlements, checkAdvanceSettlement, approveAdvanceSettlement, rejectAdvanceSettlement, getOutstandingAdvanceBalances, adjustSettlementExpense, updateAdvanceSettlement } from '../../services/advance.service';
import { throwValidation } from '../../lib/validation';
import { formatLocalDate } from '../../lib/format';

const router = Router();

// ─── Advance Requests (admin) ─────────────────────────────────────────────────

router.get('/advance-requests', asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const items = await listAdvanceRequests({ status });
  res.json({ items });
}));

router.post('/advance-requests/:id/approve', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const result = await approveAdvanceRequest(id, getUser(req).userId);
  res.json(result);
}));

router.post('/advance-requests/:id/reject', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const result = await rejectAdvanceRequest(id, getUser(req).userId);
  res.json(result);
}));

// ─── Advance Balances (admin) — F1 outstanding per forwarder ──────────────────

router.get('/advance-balances', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (_req: Request, res: Response) => {
  const { totalOutstanding, items } = await getOutstandingAdvanceBalances();
  res.json({
    totalOutstanding: String(totalOutstanding),
    items: items.map(i => ({ forwarderId: i.forwarderId, name: i.name, outstanding: String(i.outstanding) })),
  });
}));

// ─── Advance Settlements (admin) ──────────────────────────────────────────────

router.get('/advance-settlements', asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const items = await listAdvanceSettlements({ status });
  res.json({ items });
}));

router.post('/advance-settlements/:id/check', requireRoles(Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const result = await checkAdvanceSettlement(id, getUser(req).userId);
  res.json(result);
}));

router.post('/advance-settlements/:id/approve', requireRoles(Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const result = await approveAdvanceSettlement(id, getUser(req).userId);
  res.json(result);
}));

router.post('/advance-settlements/:id/reject', requireRoles(Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const result = await rejectAdvanceSettlement(id, getUser(req).userId);
  res.json(result);
}));

router.put('/advance-settlements/:id', requireRoles(Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const parsed = updateAdvanceSettlementSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const result = await updateAdvanceSettlement(id, parsed.data);
  if (!result) return res.status(404).json({ error: 'Không tìm thấy phiếu hoàn ứng' });
  res.locals.auditEntityKey = `phiếu hoàn ứng ${result.code}`;
  res.json(result);
}));

router.patch(
  '/advance-settlements/:id/expenses/:expenseId',
  requireRoles(Role.ADMIN, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const settlementId = parseInt(req.params.id as string, 10);
    const expenseId = parseInt(req.params.expenseId as string, 10);
    const parsed = accountantSettlementExpensePatchSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const result = await adjustSettlementExpense(
      settlementId,
      expenseId,
      getUser(req).userId,
      {
        expenseType: parsed.data.expenseType,
        buyAmount: parsed.data.buyAmount,
        sellAmount: parsed.data.sellAmount,
        ...(parsed.data.supplierId !== undefined ? { supplierId: parsed.data.supplierId ?? null } : {}),
        ...(parsed.data.invoiceNumber !== undefined ? { invoiceNumber: parsed.data.invoiceNumber ?? null } : {}),
        ...(parsed.data.invoiceDate !== undefined ? { invoiceDate: parsed.data.invoiceDate ?? null } : {}),
        ...(parsed.data.declarationNumber !== undefined ? { declarationNumber: parsed.data.declarationNumber ?? null } : {}),
        ...(parsed.data.containerNumber !== undefined ? { containerNumber: parsed.data.containerNumber ?? null } : {}),
        ...(parsed.data.tripContainerId !== undefined ? { tripContainerId: parsed.data.tripContainerId ?? null } : {}),
        ...(parsed.data.note !== undefined ? { note: parsed.data.note ?? null } : {}),
        adjustmentReason: parsed.data.adjustmentReason,
      },
    );
    res.locals.auditEntityKey = `phiếu hoàn ứng ${settlementId}, điều chỉnh chi phí: ${parsed.data.adjustmentReason}`;
    res.json(result);
  }),
);

// ─── Advance Settlement detail & export (admin) ───────────────────────────

router.get('/advance-settlements/:id', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const settlement = await getAdvanceSettlement(id);
  if (!settlement) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
  res.json(settlement);
}));

router.get('/advance-settlements/:id/export', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const format = (req.query.format as string) || 'xlsx';
  const dateStr = formatLocalDate();

  if (format === 'pdf' || format === 'html') {
    const html = await exportSettlementHtml(id);
    if (!html) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
    return;
  }

  // Default: xlsx
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=phieu-thanh-toan-${id}-${dateStr}.xlsx`);
  const ok = await exportSettlementXlsx(id, res);
  if (!ok) {
    return;
  }
}));

export default router;
