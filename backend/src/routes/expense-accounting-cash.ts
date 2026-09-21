import { releaseExpenseReconciliation } from '../services/expense-reconciliation-release.service';
import { Router } from 'express';
import { lockExpenseCashSources } from '../services/expense-cash-lock.service';
import { replayCashAction } from '../services/cash-command-replay.service';
import { prepareExpenseCashCommand } from '../services/expense-cash-command.service';
import type { GovernanceActionRow } from '../services/governance-action-core.service';
import { z } from 'zod';
import { expenseDateSchema, expenseReconciliationSchema, expenseVndSchema, expenseVoucherSchema } from '@tingting/shared';
import { getUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { throwValidation } from '../lib/validation';
import { requireExpenseFinance } from '../services/expense-accounting-write.service';
import { allocateOutstandingExpenseVoucher, createExpenseVoucher, reverseExpenseVoucher } from '../services/expense-accounting-voucher.service';
import { createExpenseReconciliation, recordFundedOpsAdvance, refundExpenseReconciliation } from '../services/expense-accounting-reconciliation.service';
import { getExpenseReconciliation, getExpenseVoucher, listExpenseReconciliations, listExpenseVouchers } from '../services/expense-accounting-reads.service';
import { IDEMPOTENCY_ENDPOINTS, resolveIdempotencyKey, runIdempotent } from '../services/idempotency.service';
import { normalizeTreasuryPhysicalReference } from '../services/treasury.service';
import { listFundBook } from '../services/treasury-fund-book.service';
import { listOpsCostReview } from '../services/ops-cost-review.service';
import { listMonthlyReconciliationReport } from '../services/ops-reconciliation-report.service';

const router = Router();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throwValidation(result.error);
  return result.data;
}
// Owner-scoped reads run before the finance-only mutation guard.
router.get('/reconciliations', asyncHandler(async (req, res) => res.json({ items: await listExpenseReconciliations(getUser(req)) })));
router.get('/reconciliations/:id', asyncHandler(async (req, res) => res.json(await getExpenseReconciliation(getUser(req), parse(z.coerce.number().int().positive(), req.params.id)))));
router.use(['/vouchers', '/reconciliations', '/advances'], (req, _res, next) => { requireExpenseFinance(getUser(req)); next(); });
const positiveId = z.coerce.number().int().positive();
const fund = { treasuryAccountId: positiveId, valueDate: expenseDateSchema, physicalReference: z.string().trim().min(1).max(160) };

router.post('/reconciliations/:id/release', asyncHandler(async (req, res) => {
  const actor = getUser(req); const id = parse(positiveId, req.params.id);
  const input = parse(z.object({ reason: z.string().trim().min(1).max(1000) }).strict(), req.body);
  const result = await runIdempotent({ endpoint: 'expense-reconciliation.release', idempotencyKey: resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') }),
    payload: { id, ...input }, createdBy: actor.userId, responseStatusCode: 200,
    create: async tx => { await releaseExpenseReconciliation(tx, actor, id, input.reason); return getExpenseReconciliation(actor, id, tx); } });
  res.status(result.statusCode).json(result.result);
}));
router.get('/vouchers', asyncHandler(async (req, res) => res.json({ items: await listExpenseVouchers(getUser(req)) })));
// Card 20260921_9 phase 1 — the per-source sổ quỹ: finance-only read of one
// fund source's append-only book (COMPANY = TK công ty ACB | TM = Tiền mặt).
router.get('/fund-book', asyncHandler(async (req, res) => {
  requireExpenseFinance(getUser(req));
  const source = parse(z.enum(['COMPANY', 'TM']), req.query.source);
  res.json(await listFundBook(source));
}));
// Card 20260921_10 — the ops cost review table (finance-only): rows carry
// confirmRef so tick/tick-all posts the EXISTING batch /confirm — no forked
// confirmation path.
router.get('/ops-review', asyncHandler(async (req, res) => {
  requireExpenseFinance(getUser(req));
  const query = parse(z.object({
    from: expenseDateSchema.optional(), to: expenseDateSchema.optional(),
    payerId: z.coerce.number().int().positive().optional(),
    progress: z.enum(['CHUA_XAC_NHAN', 'DA_XAC_NHAN', 'DA_LAP_PHIEU']).optional(),
    page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
  }), req.query);
  res.json(await listOpsCostReview(getUser(req), query));
}));
// Card 20260921_11 — the monthly reconciliation summary (finance-only):
// per-staff ĐNTT vs held advances with labeled sign semantics; vouchers ride
// the existing engine.
router.get('/reconciliation-report', asyncHandler(async (req, res) => {
  requireExpenseFinance(getUser(req));
  const query = parse(z.object({
    from: expenseDateSchema.optional(), to: expenseDateSchema.optional(),
  }), req.query);
  res.json(await listMonthlyReconciliationReport(getUser(req), query));
}));
router.post('/vouchers', asyncHandler(async (req, res) => {
  const actor = getUser(req); const input = parse(expenseVoucherSchema, req.body);
  const command = await prepareExpenseCashCommand(actor, input);
  const key = resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') });
  if (command) {
    const result = await runIdempotent<GovernanceActionRow>({ endpoint: command.endpoint, idempotencyKey: key,
      payload: command.payload, createdBy: actor.userId, entityType: 'governance_action', responseStatusCode: 201,
      create: async tx => {
        await lockExpenseCashSources(tx, input.entries);
        const action = await command.create(tx);
        const voucher = await createExpenseVoucher(tx, actor, input, action);
        return { ...action, applicationResult: { ...action.applicationResult, expenseVoucherId: voucher.id } };
      },
      replayResult: async (snapshot, tx) => {
        const actionKind = command.endpoint === IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE ? 'PAYMENT_RECEIPT'
          : command.endpoint === IDEMPOTENCY_ENDPOINTS.DRIVER_PAYOUT ? 'DRIVER_PAYOUT'
          : 'VENDOR_PAYMENT';
        const action = await replayCashAction(tx, snapshot, actor, actionKind);
        const voucher = await createExpenseVoucher(tx, actor, input, action);
        return { ...action, applicationResult: { ...action.applicationResult, expenseVoucherId: voucher.id } };
      },
    });
    const id = Number(result.result.applicationResult?.expenseVoucherId);
    res.status(result.statusCode).json({ ...(await getExpenseVoucher(actor, id)), replayed: result.replayed });
    return;
  }
  const result = await runIdempotent({ endpoint: 'expenses.ops-reimburse', idempotencyKey: key,
    payload: { ...input, physicalReference: normalizeTreasuryPhysicalReference(input.physicalReference),
      entries: [...input.entries].sort((a, b) => a.sourceKind.localeCompare(b.sourceKind) || a.sourceId - b.sourceId) },
    createdBy: actor.userId, entityType: 'expense_cash_voucher', responseStatusCode: 201,
    create: async tx => { const row = await createExpenseVoucher(tx, actor, input); return getExpenseVoucher(actor, row.id, tx); } });
  res.status(result.statusCode).json({ ...result.result, replayed: result.replayed });
}));
router.post('/vouchers/:id/reverse', asyncHandler(async (req, res) => {
  const actor = getUser(req); const id = parse(positiveId, req.params.id);
  const input = parse(z.object({ expectedVersion: positiveId, reason: z.string().trim().min(1).max(2000), valueDate: expenseDateSchema, physicalReference: fund.physicalReference }).strict(), req.body);
  const result = await runIdempotent({ endpoint: 'expense-cash.reverse', idempotencyKey: resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') }),
    payload: { id, ...input }, createdBy: actor.userId, entityType: 'expense_cash_voucher',
    create: async tx => { await reverseExpenseVoucher(tx, actor, id, input); return getExpenseVoucher(actor, id, tx); } });
  res.json({ ...result.result, replayed: result.replayed });
}));
router.post('/vouchers/:id/allocate', asyncHandler(async (req, res) => {
  const actor = getUser(req); const id = parse(positiveId, req.params.id);
  const input = parse(z.object({ expectedVersion: positiveId }).strict(), req.body);
  const result = await runIdempotent({ endpoint: 'expense-cash.allocate', idempotencyKey: resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') }),
    payload: { id, ...input }, createdBy: actor.userId, entityType: 'expense_cash_voucher',
    create: async tx => { await allocateOutstandingExpenseVoucher(tx, actor, id, input.expectedVersion); return getExpenseVoucher(actor, id, tx); } });
  res.json({ ...result.result, replayed: result.replayed });
}));
router.post('/reconciliations', asyncHandler(async (req, res) => {
  const actor = getUser(req); const input = parse(expenseReconciliationSchema, req.body);
  const result = await runIdempotent({ endpoint: 'expenses.reconcile', idempotencyKey: resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') }),
    payload: input, createdBy: actor.userId, entityType: 'expense_reconciliation', responseStatusCode: 201,
    create: async tx => { const row = await createExpenseReconciliation(tx, actor, input); return getExpenseReconciliation(actor, row.id, tx); } });
  res.status(result.statusCode).json({ ...result.result, replayed: result.replayed });
}));
router.post('/reconciliations/:id/refund', asyncHandler(async (req, res) => {
  const actor = getUser(req); const id = parse(positiveId, req.params.id);
  const input = parse(z.object({ ...fund, amount: expenseVndSchema.refine(v => v > 0), reason: z.string().trim().min(1).max(2000) }).strict(), req.body);
  const result = await runIdempotent({ endpoint: 'expenses.reconciliation.refund', idempotencyKey: resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') }),
    payload: { id, ...input }, createdBy: actor.userId, entityType: 'expense_cash_voucher',
    create: async tx => { const row = await refundExpenseReconciliation(tx, actor, id, input); return getExpenseVoucher(actor, row.id, tx); } });
  res.json({ ...result.result, replayed: result.replayed });
}));
router.post('/advances', asyncHandler(async (req, res) => {
  const actor = getUser(req);
  const input = parse(z.object({ ...fund, opsUserId: positiveId, amount: expenseVndSchema.refine(v => v > 0), reason: z.string().trim().min(1).max(2000), advanceRequestId: positiveId.optional() }).strict(), req.body);
  const result = await runIdempotent({ endpoint: IDEMPOTENCY_ENDPOINTS.OPS_ADVANCE_REQUEST_CREATE, idempotencyKey: resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') }),
    payload: input, createdBy: actor.userId, entityType: 'advance_request', responseStatusCode: 201,
    create: tx => recordFundedOpsAdvance(tx, actor, input) });
  res.status(result.statusCode).json({ ...result.result, replayed: result.replayed });
}));
export default router;
