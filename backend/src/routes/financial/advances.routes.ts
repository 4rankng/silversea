import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AdvanceRequestStatus,
  NotificationType,
  Role,
  accountantSettlementExpensePatchSchema,
  governanceActionDecisionSchema,
  updateAdvanceSettlementSchema,
} from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { ApiError } from '../../errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { getAdvanceSettlement } from '../../services/advance.service';
import { exportSettlementXlsx, exportSettlementHtml } from '../../services/settlement-export.service';
import {
  listAdvanceRequestsPaginated,
  listAdvanceSettlementsPaginated,
  getOutstandingAdvanceBalances,
  adjustSettlementExpense,
  updateAdvanceSettlement,
  requestAdvanceSettlementReversal,
} from '../../services/advance.service';
import { ADVANCE_REQUEST_SORT_KEYS } from '../../services/advance-request.service';
import { throwValidation } from '../../lib/validation';
import { formatLocalDate } from '../../lib/format';
import { parsePagination } from '../utils/pagination';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { emitNotification } from '../../services/notification.service';
import { autoApplyGovernanceAction } from '../../services/adjustment-governance.service';

const router = Router();

const advanceRequestListQuerySchema = z.object({
  status: z.nativeEnum(AdvanceRequestStatus).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  sortBy: z.enum(ADVANCE_REQUEST_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

// ─── Advance Requests (admin) ─────────────────────────────────────────────────

router.get('/advance-requests', asyncHandler(async (req: Request, res: Response) => {
  const parsed = advanceRequestListQuerySchema.safeParse(req.query);
  if (!parsed.success) throwValidation(parsed.error);
  const { status, search, sortBy, sortDir } = parsed.data;
  const { page, limit } = parsePagination(req, { limit: 50, maxLimit: 500 });
  res.json(await listAdvanceRequestsPaginated({ status, search, page, limit, sortBy, sortDir }));
}));

// KP-148: advance request approve/reject endpoints removed — requests apply immediately.

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
  const { page, limit } = parsePagination(req, { limit: 50, maxLimit: 500 });
  res.json(await listAdvanceSettlementsPaginated({ status, page, limit }));
}));

// 2026-09-10 (phê duyệt removed, TC-CHUNK4-009): the settlement
// check/approve/reject endpoints are GONE — settlements apply at creation
// (forwarder route chains create+approve in one transaction). Any client
// still calling these gets 404.

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
    // 2026-09-11 maker-checker removal: apply directly in-request.
    create: (tx) => autoApplyGovernanceAction({
      make: (inner) => requestAdvanceSettlementReversal({
        settlementId: id,
        expectedVersion: parsed.data.expectedVersion,
        reason: parsed.data.reason,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: inner,
      }),
      actorId: actor.userId,
      actorRole: actor.role,
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
  if (!settlement) throw new ApiError(404, 'Không tìm thấy phiếu thanh toán');
  res.json(settlement);
}));

router.get('/advance-settlements/:id/export', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const format = (req.query.format as string) || 'xlsx';
  const dateStr = formatLocalDate();

  if (format === 'pdf' || format === 'html') {
    const html = await exportSettlementHtml(id);
    if (!html) throw new ApiError(404, 'Không tìm thấy phiếu thanh toán');
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
