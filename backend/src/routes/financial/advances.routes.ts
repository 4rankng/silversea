import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  NotificationType,
  Role,
  accountantSettlementExpensePatchSchema,
  advanceMutationVersionSchema,
  governanceActionDecisionSchema,
  updateAdvanceSettlementSchema,
} from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { getAdvanceSettlement } from '../../services/advance.service';
import { exportSettlementXlsx, exportSettlementHtml } from '../../services/settlement-export.service';
import {
  listAdvanceRequests,
  listAdvanceSettlements,
  checkAdvanceSettlement,
  approveAdvanceSettlement,
  rejectAdvanceSettlement,
  getOutstandingAdvanceBalances,
  adjustSettlementExpense,
  updateAdvanceSettlement,
  requestAdvanceRequestApprovalGovernance,
  requestAdvanceRequestRejectionGovernance,
  requestAdvanceSettlementReversal,
} from '../../services/advance.service';
import { throwValidation } from '../../lib/validation';
import { formatLocalDate } from '../../lib/format';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { emitNotification } from '../../services/notification.service';

const router = Router();

// ─── Advance Requests (admin) ─────────────────────────────────────────────────

router.get('/advance-requests', asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const items = await listAdvanceRequests({ status });
  res.json({ items });
}));

router.post('/advance-requests/:id/approve', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const parsed = governanceActionDecisionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_REQUEST_APPROVE,
    idempotencyKey,
    payload: { actorId: actor.userId, id, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => requestAdvanceRequestApprovalGovernance({
      advanceRequestId: id,
      expectedVersion: parsed.data.expectedVersion,
      reason: parsed.data.reason,
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
    getEntityId: () => id,
  });
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/advance-requests/:id/reject', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const parsed = governanceActionDecisionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_REQUEST_REJECT,
    idempotencyKey,
    payload: { actorId: actor.userId, id, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => requestAdvanceRequestRejectionGovernance({
      advanceRequestId: id,
      expectedVersion: parsed.data.expectedVersion,
      reason: parsed.data.reason,
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
    getEntityId: () => id,
  });
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
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
  const parsed = advanceMutationVersionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_CHECK,
    idempotencyKey,
    payload: { actorId: actor.userId, id, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'advance_settlement',
    create: (tx) => checkAdvanceSettlement(id, actor.userId, parsed.data.expectedVersion, tx),
    getEntityId: () => id,
  });
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/advance-settlements/:id/approve', requireRoles(Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const parsed = advanceMutationVersionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_APPROVE,
    idempotencyKey,
    payload: { actorId: actor.userId, id, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'advance_settlement',
    create: (tx) => approveAdvanceSettlement(id, actor.userId, parsed.data.expectedVersion, {
      transaction: tx,
      emitNotification: false,
    }),
    getEntityId: () => id,
  });
  if (!replayed) {
    emitNotification({
      type: NotificationType.ADVANCE_SETTLEMENT_APPROVED,
      title: 'Phiếu hoàn ứng đã duyệt',
      message: `Phiếu ${result.code} được duyệt ${Number(result.totalExpenseAmount).toLocaleString('vi-VN')} ₫.`,
      relatedEntityType: 'advance_settlements',
      relatedEntityId: result.id,
      targetUserId: result.forwarderId,
      targetRoles: [],
    });
  }
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/advance-settlements/:id/reject', requireRoles(Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const parsed = advanceMutationVersionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_REJECT,
    idempotencyKey,
    payload: { actorId: actor.userId, id, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'advance_settlement',
    create: (tx) => rejectAdvanceSettlement(id, actor.userId, parsed.data.expectedVersion, tx),
    getEntityId: () => id,
  });
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/advance-settlements/:id/reversal', requireRoles(Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const parsed = governanceActionDecisionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_REVERSE,
    idempotencyKey,
    payload: { actorId: actor.userId, actorRole: actor.role, id, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => requestAdvanceSettlementReversal({
      settlementId: id,
      expectedVersion: parsed.data.expectedVersion,
      reason: parsed.data.reason,
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
    getEntityId: () => id,
  });
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.put('/advance-settlements/:id', requireRoles(Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const parsed = updateAdvanceSettlementSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_UPDATE,
    idempotencyKey,
    payload: { actorId: actor.userId, id, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'advance_settlement',
    create: (tx) => updateAdvanceSettlement(id, parsed.data, {
      transaction: tx,
      emitNotification: false,
    }),
    getEntityId: () => id,
  });
  res.locals.auditEntityKey = `phiếu hoàn ứng ${result.code}`;
  if (!replayed) {
    emitNotification({
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Kế toán đã cập nhật phiếu hoàn ứng',
      message: `Phiếu ${result.code} đã được cập nhật danh sách tạm ứng, chi phí hoặc số tiền hoàn lại.`,
      relatedEntityType: 'advance_settlements',
      relatedEntityId: result.id,
      targetUserId: result.forwarderId,
      targetRoles: [],
    });
  }
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.patch(
  '/advance-settlements/:id/expenses/:expenseId',
  requireRoles(Role.ADMIN, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const settlementId = parseInt(req.params.id as string, 10);
    const expenseId = parseInt(req.params.expenseId as string, 10);
    const parsed = accountantSettlementExpensePatchSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    const patch = {
        expectedVersion: parsed.data.expectedVersion,
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
      };
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_EXPENSE_ADJUST,
      idempotencyKey,
      payload: { actorId: actor.userId, expenseId, settlementId, ...patch },
      createdBy: actor.userId,
      entityType: 'advance_settlement',
      create: (tx) => adjustSettlementExpense(
        settlementId,
        expenseId,
        actor.userId,
        patch,
        {
          transaction: tx,
          emitNotification: false,
          actorRole: actor.role,
        },
      ),
      getEntityId: () => settlementId,
    });
    res.locals.auditEntityKey = `phiếu hoàn ứng ${settlementId}, điều chỉnh chi phí: ${parsed.data.adjustmentReason}`;
    if (!replayed) {
      const settlement = await getAdvanceSettlement(settlementId);
      if (settlement) {
        emitNotification({
          type: NotificationType.SYSTEM_ANNOUNCEMENT,
          title: 'Kế toán đã điều chỉnh phiếu hoàn ứng',
          message: `Phiếu ${settlement.code}: ${parsed.data.adjustmentReason}.`,
          relatedEntityType: 'advance_settlements',
          relatedEntityId: settlementId,
          targetUserId: settlement.forwarderId,
          targetRoles: [],
        });
      }
    }
    res.json(idempotencyKey ? { ...result, replayed } : result);
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
