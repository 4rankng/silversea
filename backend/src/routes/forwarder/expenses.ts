/**
 * Forwarder expense CRUD, expense completion, and unlinked-expense reads.
 * Handler bodies moved verbatim from routes/forwarder.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import * as s from '../../db/schema';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Tx } from '../../services/trip-shared';
import { ApiError } from '../../errors';
import { throwValidation } from '../../lib/validation';
import {
  assertForwarderMutableTripScope,
  createTripExpense, deleteTripExpenseInTx, listUnlinkedTripExpenses,
  getTripExpenseAuditInfo, updateForwarderTripExpenseInTx, setTripExpenseCompletion,
} from '../../services/forwarder.service';
import { runIdempotent, findIdempotencyRecord, waitForIdempotencyRecord } from '../../services/idempotency.service';
import {
  FORWARDER_IDEMPOTENCY_ENDPOINTS, isLiftExpenseType, resolveLiftPricingForWrite,
} from './forwarder-shared';
import {
  assertTripShipmentAccountingUnlocked,
} from '../../services/shipment-accounting-lock.service';
import {
  tripExpenseSchema, tripExpensePatchSchema, tripExpenseCompletionSchema,
} from '@tingting/shared';
import {
  requireExpectedUpdatedAt, requireForwarderIdempotencyKey,
} from './forwarder-shared';

const router = Router();

router.post('/expenses', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = tripExpenseSchema.safeParse({ ...req.body, forwarderId: forwarder.id });
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_CREATE,
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...parsed.data },
    createdBy: forwarder.id,
    responseStatusCode: 201,
    create: async (tx) => {
      await assertForwarderMutableTripScope(parsed.data.tripId, forwarder.id, tx);
      const liftPricing = isLiftExpenseType(parsed.data.expenseType)
        ? await resolveLiftPricingForWrite(tx, {
            tripId: parsed.data.tripId,
            tripContainerId: parsed.data.tripContainerId,
            expenseType: parsed.data.expenseType,
            expenseDate: parsed.data.expenseDate,
            portId: parsed.data.portId,
            containerTypeId: parsed.data.containerTypeId,
            loadState: parsed.data.loadState,
            requestedBuyAmount: parsed.data.buyAmount,
          })
        : null;
      return createTripExpense(tx, {
        tripId: parsed.data.tripId,
        forwarderId: forwarder.id,
        createdBy: forwarder.id,
        expenseType: parsed.data.expenseType,
        buyAmount: String(liftPricing?.snapshot.unitPrice ?? parsed.data.buyAmount),
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
        liftPricingId: liftPricing?.liftPricingId ?? null,
        liftPricingSnapshot: liftPricing?.snapshot ?? null,
        note: parsed.data.note ?? null,
        noInvoiceEvidenceTypes: parsed.data.noInvoiceEvidenceTypes ?? [],
      });
    },
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.patch('/expenses/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);
  const parsed = tripExpensePatchSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản chi phí mới nhất trước khi cập nhật.',
  );
  const patch: Parameters<typeof updateForwarderTripExpenseInTx>[3] = {
    expenseType: parsed.data.expenseType,
    buyAmount: parsed.data.buyAmount !== undefined ? String(parsed.data.buyAmount) : undefined,
    sellAmount: parsed.data.sellAmount !== undefined ? String(parsed.data.sellAmount) : undefined,
    settlementMethod: parsed.data.settlementMethod,
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
  };
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_UPDATE,
    idempotencyKey,
    payload: {
      expenseId,
      forwarderId: forwarder.id,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
      ...patch,
      portId: parsed.data.portId,
      containerTypeId: parsed.data.containerTypeId,
      loadState: parsed.data.loadState,
    },
    createdBy: forwarder.id,
    responseStatusCode: 200,
    create: async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
      const [existing] = await tx.select({
        tripId: s.tripExpenses.tripId,
        expenseType: s.tripExpenses.expenseType,
        buyAmount: s.tripExpenses.buyAmount,
        expenseDate: s.tripExpenses.expenseDate,
        tripContainerId: s.tripExpenses.tripContainerId,
        liftPricingId: s.tripExpenses.liftPricingId,
        liftPricingSnapshot: s.tripExpenses.liftPricingSnapshot,
      }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
      if (!existing) throw new ApiError(404, 'Không tìm thấy chi phí');

      const nextExpenseType = parsed.data.expenseType ?? existing.expenseType;
      const pricingInputsChanged = [
        parsed.data.expenseType,
        parsed.data.buyAmount,
        parsed.data.expenseDate,
        parsed.data.tripContainerId,
        parsed.data.portId,
        parsed.data.containerTypeId,
        parsed.data.loadState,
      ].some((value) => value !== undefined);
      if (isLiftExpenseType(nextExpenseType) && (pricingInputsChanged || existing.liftPricingId == null)) {
        const prior = existing.liftPricingSnapshot;
        const liftPricing = await resolveLiftPricingForWrite(tx, {
          tripId: existing.tripId,
          tripContainerId: parsed.data.tripContainerId === undefined
            ? existing.tripContainerId
            : parsed.data.tripContainerId,
          expenseType: nextExpenseType,
          expenseDate: parsed.data.expenseDate === undefined
            ? existing.expenseDate
            : parsed.data.expenseDate,
          portId: parsed.data.portId ?? prior?.portId,
          containerTypeId: parsed.data.containerTypeId ?? prior?.containerTypeId,
          loadState: parsed.data.loadState ?? prior?.loadState,
          requestedBuyAmount: parsed.data.buyAmount ?? Number(existing.buyAmount),
        });
        patch.buyAmount = String(liftPricing.snapshot.unitPrice);
        patch.liftPricingId = liftPricing.liftPricingId;
        patch.liftPricingSnapshot = liftPricing.snapshot;
      } else if (!isLiftExpenseType(nextExpenseType) && isLiftExpenseType(existing.expenseType)) {
        patch.liftPricingId = null;
        patch.liftPricingSnapshot = null;
      }
      return updateForwarderTripExpenseInTx(
        tx,
        expenseId,
        forwarder.id,
        patch,
        expectedUpdatedAt,
      );
    },
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.put('/trips/:tripId/expense-completion', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const tripId = parseInt(req.params.tripId as string, 10);
  const parsed = tripExpenseCompletionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_COMPLETION,
    idempotencyKey,
    payload: { forwarderId: forwarder.id, tripId, ...parsed.data },
    createdBy: forwarder.id,
    responseStatusCode: 200,
    create: async (tx) => {
      await assertForwarderMutableTripScope(tripId, forwarder.id, tx);
      return setTripExpenseCompletion(
        tripId,
        parsed.data.tripContainerId,
        parsed.data.completed,
        forwarder.id,
        tx,
      );
    },
  });
  res.json(outcome.result);
}));

router.delete('/expenses/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản chi phí mới nhất trước khi xóa.',
  );
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_DELETE,
    idempotencyKey,
    payload: {
      expenseId,
      forwarderId: forwarder.id,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
    },
    createdBy: forwarder.id,
    responseStatusCode: 200,
    create: async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
      const expense = await getTripExpenseAuditInfo(expenseId, tx);
      const result = await deleteTripExpenseInTx(tx, expenseId, forwarder.id, expectedUpdatedAt);
      if (result === null) throw new ApiError(404, 'Không tìm thấy chi phí');
      if (result === 'FORBIDDEN') throw new ApiError(403, 'Không có quyền xóa chi phí này');
      const auditEntityKey = expense
        ? `phí ${expense.typeName || 'hộ'} với số tiền chi ${Number(expense.buyAmount).toLocaleString('vi-VN')} ₫${expense.tripCode ? ` cho chuyến ${expense.tripCode}` : ''}${expense.supplierName ? ` (Nhà cung cấp: ${expense.supplierName})` : ''}`
        : null;
      return { success: true as const, auditEntityKey };
    },
  });
  if (outcome.result.auditEntityKey) {
    res.locals.auditEntityKey = outcome.result.auditEntityKey;
  }
  res.status(outcome.statusCode).json({ success: true });
}));

// ── Unlinked Trip Expenses (for settlement form) ──

router.get('/unlinked-expenses', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const items = await listUnlinkedTripExpenses(forwarder.id);
  res.json({ items });
}));


export default router;
