import { eq } from 'drizzle-orm';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  Role,
  createPaymentSchema,
  createAdjustmentSchema,
  vendorPaymentSchema,
  commissionSchema,
  driverPayoutSchema,
} from '@tingting/shared';
import type { PayablesCategory } from '@tingting/shared';
import { db } from '../../db';
import { parseId } from '../utils/parse-id';
import * as s from '../../db/schema';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import * as financialService from '../../services/financial.service';
import {
  getCarrierPayableStatement,
  getSupplierStatement,
  exportSupplierStatementXlsx,
  exportSupplierStatementHtml,
  attachmentDisposition,
  normalizeDateParam,
} from '../../services/statement.service';
import { formatLocalDate } from '../../lib/format';
import { invalidateReportCaches } from '../../lib/report-cache';
import { getPayablesSummary, paginatePayablesSummary, payablesSummarySortQuerySchema } from '../../services/aging.service';
import { parsePagination } from '../utils/pagination';
import { throwValidation } from '../../lib/validation';
import { requestCommissionGovernance } from '../../services/commission.service';
import {
  requestPaymentReceiptGovernance,
  requestPaymentRefundGovernance,
} from '../../services/payment-allocation.service';
import {
  autoApplyGovernanceAction,
} from '../../services/adjustment-governance.service';
import {
  applyDirectMoneyGovernanceAction,
} from '../../services/governance-transition.service';
import { getUser } from '../../middleware/auth';
import { registerAuditEvent } from '../../services/audit-registry';
import { AuditEvent } from '../../services/audit-types';
import { IDEMPOTENCY_ENDPOINTS, resolveIdempotencyKey, runIdempotent } from '../../services/idempotency.service';
import { ApiError } from '../../errors';
import {
  getTreasuryPosition,
  requestTreasuryAccountSetup,
  requestTreasuryCutover,
  requestTreasuryMovementReversal,
  sortTreasuryPositions,
  TREASURY_SORT_KEYS,
} from '../../services/treasury.service';

const PAYABLES_CATEGORIES = new Set<string>(['fuel', 'ancillary', 'commission', 'carrier']);

const treasuryPaymentFieldsSchema = z.object({
  treasuryAccountId: z.coerce.number().int().positive().optional(),
  valueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày giá trị phải có định dạng YYYY-MM-DD').optional(),
  physicalReference: z.string().trim().min(1).max(160).optional(),
});
const createPaymentWithTreasurySchema = z.intersection(createPaymentSchema, treasuryPaymentFieldsSchema);
const vendorPaymentWithTreasurySchema = vendorPaymentSchema.merge(treasuryPaymentFieldsSchema);
const treasuryAccountSetupSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(160),
  type: z.enum(['CASH', 'BANK']),
  bankName: z.string().trim().max(160).optional(),
  bankAccountNumber: z.string().trim().max(80).optional(),
  openingBalance: z.number().int(),
  openingBalanceDate: z.string().date(),
  reason: z.string().trim().min(1).max(1000),
  openingBalanceEvidence: z.string().trim().min(1).max(255),
});
const treasuryCutoverSchema = z.object({
  expectedVersion: z.number().int().positive(),
  cutoverAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(1000),
  cutoverEvidence: z.string().trim().min(1).max(255),
});
const treasuryReversalSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
  reversalEvidence: z.string().trim().min(1).max(255),
});

const router = Router();

registerAuditEvent('POST', '/api/commissions', AuditEvent.ENTITY_CREATED);
registerAuditEvent('POST', '/api/drivers/', '/payouts', AuditEvent.DRIVER_SALARY_RECORDED);

function getRequestIdempotencyKey(req: Request): string | undefined {
  const requestBody = req.body as Record<string, unknown> | undefined;
  return resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
}

// ─── Record payment ──────────────────────────────────────────────────────────

router.post('/payments/receive', asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const data = createPaymentWithTreasurySchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE,
    idempotencyKey,
    payload: {
      customerId: data.customerId,
      receiptId: data.receiptId,
      amount: data.amount,
      payments: data.payments?.map((payment) => ({
        tripId: payment.tripId,
        amount: payment.amount,
      })),
      makerId: actor.userId,
      makerRole: actor.role,
      treasuryAccountId: data.treasuryAccountId,
      valueDate: data.valueDate,
      physicalReference: data.physicalReference,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestPaymentReceiptGovernance({
      payment: {
        customerId: data.customerId,
        receiptId: data.receiptId,
        amount: data.amount,
        payments: data.payments?.map((payment) => ({
          tripId: payment.tripId,
          amount: payment.amount,
        })),
        treasuryAccountId: data.treasuryAccountId,
        valueDate: data.valueDate,
        physicalReference: data.physicalReference,
      },
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
    }),
  });
  // Money now applies at request time (phê duyệt removed 2026-09-10) — refresh
  // report caches the way the old approve step did.
  if (!replayed) await invalidateReportCaches();
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? data.receiptId;
  res.status(replayed ? 200 : 201).json({ result, replayed });
}));

const paymentRefundRequestSchema = z.object({
  amount: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1, 'Lý do hoàn tiền là bắt buộc').max(1000),
});

router.post(
  '/payments/receipts/:id/refunds',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const paymentReceiptId = Number(req.params.id);
    if (!Number.isInteger(paymentReceiptId) || paymentReceiptId < 1) {
      throw new ApiError(400, 'paymentReceiptId không hợp lệ');
    }
    const data = paymentRefundRequestSchema.parse(req.body);
    const actor = getUser(req);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENT_REFUNDS_CREATE,
      idempotencyKey,
      payload: {
        paymentReceiptId,
        amount: data.amount,
        reason: data.reason,
        makerId: actor.userId,
        makerRole: actor.role,
      },
      createdBy: actor.userId,
      entityType: 'governance_action',
      create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestPaymentRefundGovernance({
        paymentReceiptId,
        amount: data.amount,
        reason: data.reason,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
    }),
    });
    res.locals.auditEntityId = result.id;
    res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

// ─── Adjustment ──────────────────────────────────────────────────────────────

router.post('/adjustments', asyncHandler(async (req: Request, res: Response) => {
  const data = createAdjustmentSchema.parse(req.body);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed, statusCode } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.FINANCIAL_ADJUSTMENT_CREATE,
    idempotencyKey,
    payload: {
      actorId: actor.userId,
      actorRole: actor.role,
      ...data,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    // 2026-09-11 maker-checker removal: apply directly in-request.
    // createAdjustment already calls autoApplyGovernanceAction internally —
    // wrapping again causes double-apply (version 7→8 then 8→9 mismatch).
    create: (tx) => financialService.createAdjustment({
      tripId: data.tripId,
      amount: data.amount,
      note: data.note,
      signedAgreementRef: data.signedAgreementRef,
      makerId: actor.userId,
      makerRole: actor.role,
      expectedTripVersion: data.expectedVersion,
      transaction: tx,
    }),
    getEntityId: (action) => action.id,
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey;
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/payments/vendor', asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const data = vendorPaymentWithTreasurySchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR,
    idempotencyKey,
    payload: {
      ...data,
      amount: Number(data.amount),
      makerId: actor.userId,
      makerRole: actor.role,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => financialService.requestVendorPaymentGovernance({
      payment: { ...data, amount: String(data.amount) },
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
    }),
  });
  // Money now applies at request time (phê duyệt removed 2026-09-10) — refresh
  // report caches the way the old approve step did.
  if (!replayed) await invalidateReportCaches();
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? data.receiptId;
  const statusCode = replayed ? 200 : (idempotencyKey ? 201 : 200);
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/payments/carrier', asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const data = vendorPaymentWithTreasurySchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_CARRIER,
    idempotencyKey,
    payload: {
      ...data,
      amount: Number(data.amount),
      makerId: actor.userId,
      makerRole: actor.role,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => financialService.requestCarrierPaymentGovernance({
      payment: { ...data, amount: String(data.amount) },
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
    }),
  });
  // Money now applies at request time (phê duyệt removed 2026-09-10) — refresh
  // report caches the way the old approve step did.
  if (!replayed) await invalidateReportCaches();
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? data.receiptId;
  const statusCode = replayed ? 200 : (idempotencyKey ? 201 : 200);
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.get('/ledger/suppliers/:id/statement', asyncHandler(async (req: Request, res: Response) => {
  const supplierId = parseId(req.params.id, 'ID nhà cung cấp');
  const dateFrom = normalizeDateParam((req.query.dateFrom || req.query.date_from) as string | undefined);
  const dateTo = normalizeDateParam((req.query.dateTo || req.query.date_to) as string | undefined);
  res.json(await getSupplierStatement(supplierId, dateFrom, dateTo));
}));

router.get('/ledger/carriers/:id/statement', asyncHandler(async (req: Request, res: Response) => {
  const carrierId = parseId(req.params.id, 'ID nhà vận tải');
  const dateFrom = normalizeDateParam((req.query.dateFrom || req.query.date_from) as string | undefined);
  const dateTo = normalizeDateParam((req.query.dateTo || req.query.date_to) as string | undefined);
  res.json(await getCarrierPayableStatement(carrierId, dateFrom, dateTo));
}));

router.get('/ledger/suppliers/:id/statement/export', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const supplierId = parseId(req.params.id, 'ID nhà cung cấp');
  const dateFrom = normalizeDateParam((req.query.dateFrom || req.query.date_from) as string | undefined);
  const dateTo = normalizeDateParam((req.query.dateTo || req.query.date_to) as string | undefined);
  const format = (req.query.format as string) || 'xlsx';
  const data = await getSupplierStatement(supplierId, dateFrom, dateTo);

  const dateStr = formatLocalDate();

  if (format === 'pdf') {
    const html = await exportSupplierStatementHtml(data, dateStr);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
    return;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachmentDisposition(`sao-ke-ncc-${data.supplier.name}-${dateStr}.xlsx`));
  await exportSupplierStatementXlsx(data, dateStr, res);
}));

router.get('/reports/payables-summary', asyncHandler(async (req: Request, res: Response) => {
  const asOfDate = typeof req.query.asOfDate === 'string' ? req.query.asOfDate : undefined;
  const rawCategory = typeof req.query.category === 'string' ? req.query.category : undefined;
  const category: PayablesCategory | undefined =
    rawCategory && PAYABLES_CATEGORIES.has(rawCategory) ? (rawCategory as PayablesCategory) : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const { page, limit } = parsePagination(req, { limit: 500, maxLimit: 500 });
  // Sort params are whitelist-validated separately so the rest of this route's
  // hand-parsed query surface (asOfDate/category/search) stays untouched.
  const sort = payablesSummarySortQuerySchema.safeParse(req.query);
  if (!sort.success) throwValidation(sort.error);
  const summary = await getPayablesSummary({ asOfDate, category });
  res.json(paginatePayablesSummary(summary, { search, page, limit, ...sort.data }));
}));

// ─── Commission (manual posting) ────────────────────────────────────────────
// Records a commission payable owed to a supplier (VENDOR ledger, COMMISSION
// txnType). ADMIN/MANAGER/ACCOUNTANT only.

router.post('/commissions', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const data = commissionSchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.COMMISSIONS_CREATE,
    idempotencyKey,
    payload: {
      supplierId: data.supplierId,
      amount: Number(data.amount),
      tripId: data.tripId ?? null,
      note: data.note?.trim() || '',
      makerId: actor.userId,
      makerRole: actor.role,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestCommissionGovernance({
      commission: data,
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
    }),
  });
  // Money now applies at request time (phê duyệt removed 2026-09-10) — refresh
  // report caches the way the old approve step did.
  if (!replayed) await invalidateReportCaches();
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? "Quyết định chưa có tên";
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

// ─── Driver payout (B1 — feedback202606 GAP 4) ──────────────────────────────
// Records a driver salary/cash payout. Posts a DRIVER_PAYOUT debit on the
// DRIVER ledger. MANAGER/ACCOUNTANT only — drivers may not record their own
// payouts (DRIVER/FORWARDER denied by requireRoles).

router.post('/drivers/:driverId/payouts', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(req.params.driverId as string, 10);
  if (!Number.isFinite(driverId) || driverId <= 0) {
    throw new ApiError(400, 'driverId không hợp lệ');
  }
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const data = driverPayoutSchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PAYOUT,
    idempotencyKey,
    payload: {
      driverId,
      amount: data.amount,
      method: data.method,
      payoutDate: data.payoutDate,
      note: data.note?.trim() || '',
      receiptId: data.receiptId ?? '',
      makerId: actor.userId,
      makerRole: actor.role,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => financialService.requestDriverPayoutGovernance({
      payout: {
        driverId,
        amount: data.amount,
        method: data.method,
        payoutDate: data.payoutDate,
        note: data.note,
        receiptId: data.receiptId,
      },
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
    }),
  });
  // Money now applies at request time (phê duyệt removed 2026-09-10) — refresh
  // report caches the way the old approve step did.
  if (!replayed) await invalidateReportCaches();
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? "Quyết định chưa có tên";
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

// Sort params for the treasury position table — optional; absent params keep
// the account-query order. Keys mirror TREASURY_SORT_KEYS in the service.
const treasuryPositionSortQuerySchema = z.object({
  sortBy: z.enum(TREASURY_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

router.get('/finance/treasury/position', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const parsedSort = treasuryPositionSortQuerySchema.safeParse({
    sortBy: req.query.sortBy,
    sortDir: req.query.sortDir,
  });
  if (!parsedSort.success) {
    throw new ApiError(400, 'Tham số sắp xếp không hợp lệ');
  }
  const positions = await db.transaction(async (tx) => {
    const accounts = await tx.select({ id: s.treasuryAccounts.id })
      .from(s.treasuryAccounts).where(eq(s.treasuryAccounts.status, 'ACTIVE'));
    return Promise.all(accounts.map(account => getTreasuryPosition(account.id, tx)));
  });
  res.json({
    asOf: new Date().toISOString(),
    currency: 'VND',
    coverage: positions.length === 0
      ? 'UNAVAILABLE'
      : positions.some(position => position.completeness === 'PARTIAL') ? 'PARTIAL' : 'COMPLETE',
    accounts: sortTreasuryPositions(positions, parsedSort.data.sortBy, parsedSort.data.sortDir),
  });
}));

router.post('/finance/treasury/accounts/setup', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const body = treasuryAccountSetupSchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TREASURY_ACCOUNT_SETUP,
    idempotencyKey: resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') }),
    payload: body,
    createdBy: actor.userId,
    entityType: 'governance_action',
    responseStatusCode: 202,
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestTreasuryAccountSetup({
        account: body,
        reason: body.reason,
        openingBalanceEvidence: body.openingBalanceEvidence,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
    }),
  });
  // Money now applies at request time (phê duyệt removed 2026-09-10) — refresh
  // report caches the way the old approve step did.
  if (!replayed) await invalidateReportCaches();
  res.locals.auditEntityId = result.id;
  res.status(replayed ? 200 : 202).json({ ...result, replayed });
}));

router.post('/finance/treasury/accounts/:id/cutover', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const accountId = z.coerce.number().int().positive().parse(req.params.id);
  const body = treasuryCutoverSchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TREASURY_ACCOUNT_CUTOVER,
    idempotencyKey: resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') }),
    payload: { accountId, ...body },
    createdBy: actor.userId,
    entityType: 'governance_action',
    responseStatusCode: 202,
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestTreasuryCutover({
        accountId,
        ...body,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
    }),
  });
  // Money now applies at request time (phê duyệt removed 2026-09-10) — refresh
  // report caches the way the old approve step did.
  if (!replayed) await invalidateReportCaches();
  res.locals.auditEntityId = result.id;
  res.status(replayed ? 200 : 202).json({ ...result, replayed });
}));

router.post('/finance/treasury/movements/:id/reversal', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const movementId = z.coerce.number().int().positive().parse(req.params.id);
  const body = treasuryReversalSchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TREASURY_MOVEMENT_REVERSAL,
    idempotencyKey: resolveIdempotencyKey({ headerValue: req.header('Idempotency-Key') }),
    payload: { movementId, ...body },
    createdBy: actor.userId,
    entityType: 'governance_action',
    responseStatusCode: 202,
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestTreasuryMovementReversal({
        movementId,
        ...body,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
    }),
  });
  // Money now applies at request time (phê duyệt removed 2026-09-10) — refresh
  // report caches the way the old approve step did.
  if (!replayed) await invalidateReportCaches();
  res.locals.auditEntityId = result.id;
  res.status(replayed ? 200 : 202).json({ ...result, replayed });
}));

export default router;
