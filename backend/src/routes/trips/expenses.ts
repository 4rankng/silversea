/**
 * Trip expenses: direct adjustments and expense CRUD
 * decisions. Handler bodies moved verbatim from routes/trips.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createAdjustmentSchema, tripExpenseSchema, tripExpensePatchSchema,
} from '@tingting/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import * as financialService from '../../services/financial.service';
import { validateActiveExpenseTypeCode } from '../../services/forwarder-expense-commands.service';
import {
  getTripExpensesForRoute, createTripExpense, updateTripExpense, deleteTripExpenseGuarded,
  getTripExpenseAuditInfo, latestTripPhotoKey, listTripPhotoKeys, listTripContainers,
} from '../../services/forwarder.service';
import { ApiError } from '../../errors';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { throwValidation } from '../../lib/validation';

const router = Router();

router.get('/:id/adjustments', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string);
  const postedItems = await financialService.getTripAdjustments(tripId);
  res.json({ items: postedItems });
}));

// Create adjustment for a specific trip
router.post('/:id/adjustment', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string);
  const data = createAdjustmentSchema.parse({ ...req.body, tripId });
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: action, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_ADJUSTMENT,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, tripId, data },
    createdBy: user.userId,
    entityType: 'governance_action',
    create: (tx) => financialService.createAdjustment({
      tripId,
      amount: data.amount,
      note: data.note,
      signedAgreementRef: data.signedAgreementRef,
      makerId: user.userId,
      makerRole: user.role,
      expectedTripVersion: data.expectedVersion,
      transaction: tx,
    }),
    getEntityId: (result) => result.id,
  });
  res.status(201).json(idempotencyKey ? { ...action, replayed } : action);
}));

// ─── Container instances per trip (accessible to ADMIN/MANAGER/ACCOUNTANT) ────
// The /api/trips route is already gated by casbin via the parent router mount,
// so authorisation is consistent with the rest of the trip endpoints.

// List container instances for a trip
router.get('/:id/containers', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  // Include the trip's latest cont/seal photo keys so the office-staff editor
  // can render persisted thumbnails (mirrors the driver detail response).
  // Also include the FULL list (newest first) so the trip detail page can
  // surface every captured photo, not just the latest. The singular fields
  // are kept for back-compat with older clients; contPhotoKeys[0] === contPhotoKey.
  const [
    items,
    contPhotoKey,
    sealPhotoKey,
    contPhotoKeys,
    sealPhotoKeys,
  ] = await Promise.all([
    listTripContainers(tripId),
    latestTripPhotoKey(tripId, 'CONTAINER'),
    latestTripPhotoKey(tripId, 'SEAL'),
    listTripPhotoKeys(tripId, 'CONTAINER'),
    listTripPhotoKeys(tripId, 'SEAL'),
  ]);
  res.json({ items, contPhotoKey, sealPhotoKey, contPhotoKeys, sealPhotoKeys });
}));

// Batch upsert container instances. Body shape: { containers: [...] }
// Inserts new rows, updates rows by id, deletes existing rows whose id
// is not in the incoming list.

router.get('/:id/expenses', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const items = await getTripExpensesForRoute(tripId);
  res.json({ items });
}));

// Authorized office entry records the validated expense immediately.
router.post('/:id/expenses', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const parsed = tripExpenseSchema.safeParse({ ...req.body, tripId });
  if (!parsed.success) throwValidation(parsed.error);
  await validateActiveExpenseTypeCode(parsed.data.expenseType);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: item, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_CREATE,
    idempotencyKey,
    payload: { actorId: user.userId, tripId, data: parsed.data },
    createdBy: user.userId,
    entityType: 'trip_expense',
    create: (tx) => createTripExpense(tx, {
      tripId,
      forwarderId: parsed.data.settlementMethod === 'OPS_ADVANCE'
        ? (parsed.data.forwarderId ?? null)
        : null,
      createdBy: user.userId,
      expenseType: parsed.data.expenseType,
      buyAmount: String(parsed.data.buyAmount),
      sellAmount: String(parsed.data.sellAmount ?? 0),
      settlementMethod: parsed.data.settlementMethod,
      supplierId: parsed.data.supplierId ?? null,
      expenseDate: parsed.data.expenseDate ?? null,
      payeeName: parsed.data.payeeName?.trim() || null,
      invoiceNumber: parsed.data.invoiceNumber ?? null,
      invoiceDate: parsed.data.invoiceDate ?? null,
      declarationNumber: parsed.data.declarationNumber ?? null,
      containerNumber: parsed.data.containerNumber ?? null,
      tripContainerId: parsed.data.tripContainerId ?? null,
      note: parsed.data.note ?? null,
      noInvoiceEvidenceTypes: parsed.data.noInvoiceEvidenceTypes ?? [],
    }),
    getEntityId: (result) => result.id,
  });
  res.status(201).json(idempotencyKey ? { ...item, replayed } : item);
}));

// PUT /api/trips/:id/expenses/:eid — update expense
router.put('/:id/expenses/:eid', asyncHandler(async (req: Request, res: Response) => {
  const eid = parseInt(req.params.eid as string, 10);
  const parsed = tripExpensePatchSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  if (parsed.data.expenseType !== undefined) {
    await validateActiveExpenseTypeCode(parsed.data.expenseType);
  }
  const tripId = parseInt(req.params.id as string, 10);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: item, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_UPDATE,
    idempotencyKey,
    payload: { actorId: user.userId, tripId, expenseId: eid, data: parsed.data },
    createdBy: user.userId,
    entityType: 'trip_expense',
    create: async (tx) => {
      const updated = await updateTripExpense(tx, eid, {
        expenseType: parsed.data.expenseType,
        buyAmount: parsed.data.buyAmount !== undefined ? String(parsed.data.buyAmount) : undefined,
        sellAmount: parsed.data.sellAmount !== undefined ? String(parsed.data.sellAmount) : undefined,
        settlementMethod: parsed.data.settlementMethod,
        // Only include nullable fields when explicitly provided (undefined = don't touch)
        ...(parsed.data.supplierId !== undefined ? { supplierId: parsed.data.supplierId ?? null } : {}),
        ...(parsed.data.expenseDate !== undefined ? { expenseDate: parsed.data.expenseDate ?? null } : {}),
        ...(parsed.data.payeeName !== undefined ? { payeeName: parsed.data.payeeName?.trim() || null } : {}),
        ...(parsed.data.invoiceNumber !== undefined ? { invoiceNumber: parsed.data.invoiceNumber ?? null } : {}),
        ...(parsed.data.invoiceDate !== undefined ? { invoiceDate: parsed.data.invoiceDate ?? null } : {}),
        ...(parsed.data.declarationNumber !== undefined ? { declarationNumber: parsed.data.declarationNumber ?? null } : {}),
        ...(parsed.data.containerNumber !== undefined ? { containerNumber: parsed.data.containerNumber ?? null } : {}),
        ...(parsed.data.tripContainerId !== undefined ? { tripContainerId: parsed.data.tripContainerId ?? null } : {}),
        ...(parsed.data.note !== undefined ? { note: parsed.data.note ?? null } : {}),
        ...(parsed.data.noInvoiceEvidenceTypes !== undefined ? { noInvoiceEvidenceTypes: parsed.data.noInvoiceEvidenceTypes ?? [] } : {}),
      }, tripId);
      if (!updated) throw new ApiError(404, 'Không tìm thấy chi phí');
      return updated;
    },
    getEntityId: (result) => result.id,
  });
  res.json(idempotencyKey ? { ...item, replayed } : item);
}));

// DELETE /api/trips/:id/expenses/:eid — hard delete (only if trip not locked)
router.delete('/:id/expenses/:eid', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const eid = parseInt(req.params.eid as string, 10);

  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: outcome, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_DELETE,
    idempotencyKey,
    payload: { actorId: user.userId, tripId, expenseId: eid },
    createdBy: user.userId,
    entityType: 'trip_expense',
    create: async (tx) => {
      const expense = await getTripExpenseAuditInfo(eid, tx);
      const result = await deleteTripExpenseGuarded(tripId, eid, tx);
      return { result, expense };
    },
    getEntityId: () => eid,
  });
  if ('error' in outcome.result) {
    throw new ApiError(outcome.result.status, outcome.result.error);
  }

  if (outcome.expense) {
    const buyAmt = Number(outcome.expense.buyAmount).toLocaleString('vi-VN') + ' ₫';
    const tripPart = outcome.expense.tripCode ? ` cho chuyến ${outcome.expense.tripCode}` : '';
    const supplierPart = outcome.expense.supplierName ? ` (Nhà cung cấp: ${outcome.expense.supplierName})` : '';
    res.locals.auditEntityKey = `phí ${outcome.expense.typeName || 'hộ'} với số tiền chi ${buyAmt}${tripPart}${supplierPart}`;
  }

  res.json(idempotencyKey ? { ok: true, replayed } : { ok: true });
}));

// Approval endpoints are retired; editing the authorized source records directly.
router.post('/:id/expenses/:eid/approve', (_req, res) => {
  res.status(410).json({ error: 'Luồng phê duyệt đã được gỡ bỏ. Chỉnh sửa chi phí trực tiếp.' });
});
router.post('/:id/expenses/:eid/reject', (_req, res) => {
  res.status(410).json({ error: 'Luồng phê duyệt đã được gỡ bỏ. Chỉnh sửa chi phí trực tiếp.' });
});

export default router;
