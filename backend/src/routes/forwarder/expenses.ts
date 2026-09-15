/**
 * Forwarder expense CRUD, expense completion, and unlinked-expense reads.
 * Thin route layer since 2026-09-01: zod parse → idempotency key → command
 * service call → response envelope. The write commands (lift-pricing
 * resolution, advisory locks, audit key building) live in
 * services/forwarder-expense-commands.service.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { throwValidation } from '../../lib/validation';
import { listUnlinkedTripExpenses } from '../../services/forwarder.service';
import {
  createForwarderExpenseCommand,
  deleteForwarderExpenseCommand,
  setForwarderExpenseCompletionCommand,
  updateForwarderExpenseCommand,
} from '../../services/forwarder-expense-commands.service';
import {
  requireExpectedUpdatedAt, requireForwarderIdempotencyKey,
} from './forwarder-shared';
import {
  tripExpenseSchema, tripExpensePatchSchema, tripExpenseCompletionSchema,
} from '@tingting/shared';
import { validateActiveExpenseTypeCode } from '../../services/forwarder-expense-commands.service';

const router = Router();

router.post('/expenses', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  await validateActiveExpenseTypeCode(req.body?.expenseType);
  const parsed = tripExpenseSchema.safeParse({ ...req.body, forwarderId: forwarder.id });
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await createForwarderExpenseCommand({
    forwarderId: forwarder.id,
    data: parsed.data,
    idempotencyKey,
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.patch('/expenses/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);
  const parsed = tripExpensePatchSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  if (parsed.data.expenseType !== undefined) {
    await validateActiveExpenseTypeCode(parsed.data.expenseType);
  }
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản chi phí mới nhất trước khi cập nhật.',
  );
  const outcome = await updateForwarderExpenseCommand({
    forwarderId: forwarder.id,
    expenseId,
    data: parsed.data,
    expectedUpdatedAt,
    idempotencyKey,
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.put('/trips/:tripId/expense-completion', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const tripId = parseInt(req.params.tripId as string, 10);
  const parsed = tripExpenseCompletionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await setForwarderExpenseCompletionCommand({
    forwarderId: forwarder.id,
    tripId,
    data: parsed.data,
    idempotencyKey,
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
  const outcome = await deleteForwarderExpenseCommand({
    forwarderId: forwarder.id,
    expenseId,
    expectedUpdatedAt,
    idempotencyKey,
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
