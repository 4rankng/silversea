/**
 * Forwarder advance requests and settlements: lists, creation, export,
 * and preview. Handler bodies moved verbatim from routes/forwarder.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { throwValidation } from '../../lib/validation';
import { createAdvanceRequest, listAdvanceRequests, getAdvanceRequestCounts, listAdvanceRequestsPaginated, createAdvanceSettlement, listAdvanceSettlementsPaginated, getAdvanceSettlement, getOutstandingAdvanceBalance } from '../../services/advance.service';
import { approveAdvanceRequest } from '../../services/advance-request.service';
import { approveAdvanceSettlement } from '../../services/advance-settlement.service';
import { runIdempotent } from '../../services/idempotency.service';

import {
  exportSettlementXlsx, exportSettlementHtml, previewSettlementHtml, previewSettlementXlsx,
} from '../../services/settlement-export.service';
import { formatLocalDate } from '../../lib/format';
import { parsePagination } from '../utils/pagination';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import {
  createAdvanceRequestSchema, createAdvanceSettlementSchema,
} from '@tingting/shared';

const router = Router();

// ── Advance Requests ──

router.get('/advance-requests', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const status = req.query.status as string | undefined;
  const excludeLinkedToActiveSettlement = req.query.eligibleForSettlement === 'true';
  if (excludeLinkedToActiveSettlement) {
    // Eligibility is a bounded set consumed by the settlement form; the
    // exclusion filter has no paginated variant, so this caller keeps the
    // legacy full-array shape.
    const [items, counts] = await Promise.all([
      listAdvanceRequests({ requesterId: forwarder.id, status, excludeLinkedToActiveSettlement }),
      getAdvanceRequestCounts(forwarder.id),
    ]);
    return res.json({ items, counts });
  }
  // Default limit is the max so no-param callers (the advances overview) keep
  // the legacy full-list behavior; the requests list page passes explicit
  // page/limit.
  const { page, limit } = parsePagination(req, { limit: 500, maxLimit: 500 });
  const result = await listAdvanceRequestsPaginated({ requesterId: forwarder.id, status, page, limit });
  // `counts` alias keeps the live overview page's KPI math whole until its
  // migration to the paginated envelope.
  res.json({ ...result, counts: result.statusCounts });
}));

router.post('/advance-requests', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = createAdvanceRequestSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: 'forwarder.advance-requests.create',
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...parsed.data },
    createdBy: forwarder.id,
    entityType: 'advance_request',
    responseStatusCode: 201,
    create: async (tx) => {
      // 2026-09-10 (phê duyệt removed): the requester's advance applies in
      // the same transaction — status APPROVED, approvedBy self, OPS_ADVANCE
      // ledger entry posted. No PENDING window, no second approver.
      const created = await createAdvanceRequest(forwarder.id, parsed.data, tx);
      return approveAdvanceRequest(created.id, forwarder.id, undefined, tx);
    },
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

// ── Advance Balance (F1) ──

router.get('/advance-balance', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const outstanding = await getOutstandingAdvanceBalance(forwarder.id);
  res.json({ outstanding: String(outstanding) });
}));

// ── Advance Settlements ──

router.get('/advance-settlements', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  // Default limit is the max so no-param callers (e.g. the advances overview,
  // which filters the whole set client-side) keep the legacy full-list
  // behavior; the settlements list page passes explicit page/limit.
  const { page, limit } = parsePagination(req, { limit: 500, maxLimit: 500 });
  res.json(await listAdvanceSettlementsPaginated({ forwarderId: forwarder.id, status, page, limit }));
}));

router.get('/advance-settlements/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const settlement = await getAdvanceSettlement(Number(req.params.id));
  if (!settlement) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
  if (settlement.forwarderId !== forwarder.id) return res.status(403).json({ error: 'Không có quyền truy cập' });
  res.json(settlement);
}));

router.get('/advance-settlements/:id/export', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const id = Number(req.params.id);
  const settlement = await getAdvanceSettlement(id);
  if (!settlement) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
  if (settlement.forwarderId !== forwarder.id) return res.status(403).json({ error: 'Không có quyền truy cập' });

  const format = (req.query.format as string) || 'xlsx';
  if (format === 'pdf' || format === 'html') {
    const html = await exportSettlementHtml(id);
    if (!html) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
    return;
  }

  const dateStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=phieu-thanh-toan-${id}-${dateStr}.xlsx`);
  await exportSettlementXlsx(id, res);
}));

router.post('/advance-settlements/preview', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = createAdvanceSettlementSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const { advanceRequestIds, tripExpenseIds, refundAmount, note } = parsed.data;

  const format = (req.query.format as string) || 'html';
  const input = { forwarderId: forwarder.id, advanceRequestIds, tripExpenseIds, refundAmount, note: note ?? undefined };

  if (format === 'xlsx') {
    const dateStr = formatLocalDate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=phieu-thanh-toan-xem-truoc-${dateStr}.xlsx`);
    await previewSettlementXlsx(input, res);
    return;
  }

  const html = await previewSettlementHtml(input);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

router.post('/advance-settlements', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = createAdvanceSettlementSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const { note, ...rest } = parsed.data;
  const input = { ...rest, note: note ?? undefined };
  const idempotencyKey = getRequestIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: 'forwarder.advance-settlements.create',
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...input },
    createdBy: forwarder.id,
    entityType: 'advance_settlement',
    responseStatusCode: 201,
    create: async (tx) => {
      // 2026-09-10 (phê duyệt removed, TC-CHUNK4-009): the settlement applies
      // at creation — status APPROVED in ONE call, linked expenses approved,
      // ledger entries posted. The check/approve/reject endpoints are gone.
      const created = await createAdvanceSettlement(forwarder.id, input, tx);
      return approveAdvanceSettlement(created.id, forwarder.id, undefined, {
        transaction: tx,
        emitNotification: false,
      });
    },
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

// ── Expense Photos ──


export default router;
