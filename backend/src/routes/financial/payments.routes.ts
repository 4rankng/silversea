import { eq } from 'drizzle-orm';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  Role,
  TripStatus,
  NotificationType,
  createPaymentSchema,
  createAdjustmentSchema,
  vendorPaymentSchema,
  commissionSchema,
  driverPayoutSchema,
  governanceActionVersionSchema,
} from '@tingting/shared';
import type { PayablesCategory } from '@tingting/shared';
import { db } from '../../db';
import * as s from '../../db/schema';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { emitNotification } from '../../services/notification.service';
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
import { cacheInvalidatePattern, invalidateReportCaches } from '../../lib/redis';
import { getPayablesSummary } from '../../services/payables.service';
import { requestCommissionGovernance } from '../../services/commission.service';
import {
  requestPaymentReceiptGovernance,
  requestPaymentRefundGovernance,
} from '../../services/payment-allocation.service';
import {
  approveGovernanceAction,
} from '../../services/adjustment-governance.service';
import {
  approveDirectMoneyGovernanceAction,
  checkGovernanceAction,
  isDirectMoneyGovernanceActionKind,
} from '../../services/governance-transition.service';
import { getUser } from '../../middleware/auth';
import { registerAuditEvent } from '../../services/audit-registry';
import { AuditEvent } from '../../services/audit-types';
import { IDEMPOTENCY_ENDPOINTS, resolveIdempotencyKey, runIdempotent } from '../../services/idempotency.service';
import { ApiError } from '../../errors';
import { parseActionId } from './governance-action-input';
import { processTripGpsCaptureJobForAction } from '../../services/trip-gps-capture-job.service';
import {
  PROFIT_DISTRIBUTION_TRANSACTION_OPTIONS,
  runProfitDistributionWithSerializationRetry,
} from '../../services/profit-distribution.service';

const PAYABLES_CATEGORIES = new Set<string>(['fuel', 'ancillary', 'commission', 'carrier']);

const router = Router();

registerAuditEvent('POST', '/api/commissions', AuditEvent.ENTITY_CREATED);
registerAuditEvent('POST', '/api/drivers/', '/payouts', AuditEvent.DRIVER_SALARY_RECORDED);

async function loadGovernanceActionKind(actionId: number): Promise<string> {
  const [action] = await db.select({
    actionKind: s.governanceActions.actionKind,
  }).from(s.governanceActions)
    .where(eq(s.governanceActions.id, actionId))
    .limit(1);
  if (!action) {
    throw new ApiError(404, 'Không tìm thấy yêu cầu điều chỉnh');
  }
  return action.actionKind;
}

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
  const data = createPaymentSchema.parse(req.body);
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
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: (tx) => requestPaymentReceiptGovernance({
      payment: {
        customerId: data.customerId,
        receiptId: data.receiptId,
        amount: data.amount,
        payments: data.payments?.map((payment) => ({
          tripId: payment.tripId,
          amount: payment.amount,
        })),
      },
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
  });
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
      create: (tx) => requestPaymentRefundGovernance({
        paymentReceiptId,
        amount: data.amount,
        reason: data.reason,
        makerId: actor.userId,
        makerRole: actor.role,
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
  const action = await financialService.createAdjustment({
    tripId: data.tripId,
    amount: data.amount,
    note: data.note,
    signedAgreementRef: data.signedAgreementRef,
    makerId: getUser(req).userId,
    makerRole: getUser(req).role,
    expectedTripVersion: data.expectedVersion,
  });
  res.status(201).json(action);
}));

router.post(
  '/governance-actions/:id/check',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const input = governanceActionVersionSchema.parse(req.body);
    const actor = getUser(req);
    const actionId = parseActionId(req.params.id);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK,
      idempotencyKey,
      payload: {
        actionId,
        actorId: actor.userId,
        actorRole: actor.role,
        expectedVersion: input.expectedVersion,
      },
      createdBy: actor.userId,
      entityType: 'governance_action',
      create: (tx) => checkGovernanceAction({
        actionId,
        checkerId: actor.userId,
        checkerRole: actor.role,
        expectedVersion: input.expectedVersion,
        transaction: tx,
      }),
    });
    res.json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

router.post(
  '/governance-actions/:id/approve',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const input = governanceActionVersionSchema.parse(req.body);
    const actor = getUser(req);
    const actionId = parseActionId(req.params.id);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const actionKind = await loadGovernanceActionKind(actionId);
    const executeApproval = () => runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE,
      idempotencyKey,
      payload: {
        actionId,
        actorId: actor.userId,
        actorRole: actor.role,
        expectedVersion: input.expectedVersion,
      },
      createdBy: actor.userId,
      entityType: 'governance_action',
      transactionOptions: actionKind === 'PROFIT_DISTRIBUTION'
        ? PROFIT_DISTRIBUTION_TRANSACTION_OPTIONS
        : undefined,
      create: (tx) => (
        isDirectMoneyGovernanceActionKind(actionKind)
          ? approveDirectMoneyGovernanceAction({
            actionId,
            approverId: actor.userId,
            approverRole: actor.role,
            expectedVersion: input.expectedVersion,
            transaction: tx,
          })
          : approveGovernanceAction({
            actionId,
            approverId: actor.userId,
            approverRole: actor.role,
            expectedVersion: input.expectedVersion,
            transaction: tx,
          })
      ),
    });
    const { result, replayed } = actionKind === 'PROFIT_DISTRIBUTION'
      ? await runProfitDistributionWithSerializationRetry(executeApproval)
      : await executeApproval();

    if (!replayed) {
      if (result.actionKind === 'PENALTY_CREATE' || result.actionKind === 'PENALTY_CANCEL') {
        await cacheInvalidatePattern('reports:pnl:*');
      } else {
        await invalidateReportCaches();
      }
    }

    if (!replayed && result.actionKind === 'TRIP_REOPEN') {
      emitNotification({
        type: NotificationType.TRIP_UNLOCKED,
        title: 'Chuyến đã mở khóa',
        message: `Yêu cầu mở khóa chuyến #${result.subjectId} đã được phê duyệt`,
        relatedEntityType: 'trips',
        relatedEntityId: result.subjectId ?? undefined,
      });
    }

    if (result.actionKind === 'TRIP_FINANCIAL_CLOSE' && result.subjectId != null) {
      await processTripGpsCaptureJobForAction(result.id);
    }

    if (result.actionKind === 'TRIP_FINANCIAL_CLOSE') {
      res.locals.auditEvent = AuditEvent.TRIP_COMPLETED;
    } else if (
      result.actionKind === 'TRIP_FINANCIAL_CHANGE'
      && result.applicationResult?.status === TripStatus.CANCELED
    ) {
      res.locals.auditEvent = AuditEvent.TRIP_CANCELED;
    } else if (result.actionKind === 'TRIP_FINANCIAL_CHANGE') {
      res.locals.auditEvent = AuditEvent.TRIP_UPDATED_ACTUALS;
    } else if (!replayed && result.actionKind === 'PROFIT_DISTRIBUTION') {
      res.locals.auditEvent = AuditEvent.PROFIT_DISTRIBUTED;
      const quarter = result.applicationResult?.quarter;
      const year = result.applicationResult?.year;
      if (typeof quarter === 'number' && typeof year === 'number') {
        res.locals.auditEntityKey = `Quý ${quarter}/${year}`;
      }
    }
    if (
      result.actionKind === 'TRIP_FINANCIAL_CLOSE'
      || result.actionKind === 'TRIP_FINANCIAL_CHANGE'
    ) {
      res.locals.auditEntityId = result.subjectId;
      res.locals.auditEntityKey = result.subjectKey;
    }

    if (!replayed && result.actionKind === 'PAYMENT_RECEIPT') {
      const receiptId = typeof result.applicationResult?.receiptId === 'string'
        ? result.applicationResult.receiptId
        : null;
      const paymentReceiptId = typeof result.applicationResult?.paymentReceiptId === 'number'
        ? result.applicationResult.paymentReceiptId
        : result.subjectId;
      if (receiptId && paymentReceiptId != null) {
        emitNotification({
          type: NotificationType.PAYMENT_RECEIVED,
          title: 'Thanh toán nhận được',
          message: `Phiếu thu ${receiptId} đã được phê duyệt và ghi nhận`,
          relatedEntityType: 'payments',
          relatedEntityId: paymentReceiptId,
        });
      }
    }

    if (!replayed && result.actionKind === 'PENALTY_CREATE') {
      const penaltyId = typeof result.applicationResult?.penaltyId === 'number'
        ? result.applicationResult.penaltyId
        : result.subjectId;
      const driverId = typeof result.applicationResult?.driverId === 'number'
        ? result.applicationResult.driverId
        : undefined;
      if (penaltyId != null) {
        emitNotification({
          type: NotificationType.PENALTY_CREATED,
          title: 'Phạt mới',
          message: `Kỷ luật #${penaltyId} đã được phê duyệt`,
          relatedEntityType: 'penalties',
          relatedEntityId: penaltyId,
          targetDriverId: driverId,
        });
      }
    }

    if (!replayed && result.actionKind === 'PENALTY_CANCEL') {
      const penaltyId = typeof result.applicationResult?.penaltyId === 'number'
        ? result.applicationResult.penaltyId
        : result.subjectId;
      const driverId = typeof result.applicationResult?.driverId === 'number'
        ? result.applicationResult.driverId
        : undefined;
      if (penaltyId != null) {
        emitNotification({
          type: NotificationType.PENALTY_CANCELED,
          title: 'Hủy phạt',
          message: `Kỷ luật #${penaltyId} đã được hủy theo phê duyệt`,
          relatedEntityType: 'penalties',
          relatedEntityId: penaltyId,
          targetDriverId: driverId,
        });
      }
    }

    res.json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

router.post('/payments/vendor', asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const data = vendorPaymentSchema.parse(req.body);
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
    create: (tx) => financialService.requestVendorPaymentGovernance({
      payment: { ...data, amount: String(data.amount) },
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? data.receiptId;
  const statusCode = replayed ? 200 : (idempotencyKey ? 201 : 200);
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/payments/carrier', asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const data = vendorPaymentSchema.parse(req.body);
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
    create: (tx) => financialService.requestCarrierPaymentGovernance({
      payment: { ...data, amount: String(data.amount) },
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? data.receiptId;
  const statusCode = replayed ? 200 : (idempotencyKey ? 201 : 200);
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.get('/ledger/suppliers/:id/statement', asyncHandler(async (req: Request, res: Response) => {
  const supplierId = Number(req.params.id);
  const dateFrom = normalizeDateParam((req.query.dateFrom || req.query.date_from) as string | undefined);
  const dateTo = normalizeDateParam((req.query.dateTo || req.query.date_to) as string | undefined);
  res.json(await getSupplierStatement(supplierId, dateFrom, dateTo));
}));

router.get('/ledger/carriers/:id/statement', asyncHandler(async (req: Request, res: Response) => {
  const carrierId = Number(req.params.id);
  const dateFrom = normalizeDateParam((req.query.dateFrom || req.query.date_from) as string | undefined);
  const dateTo = normalizeDateParam((req.query.dateTo || req.query.date_to) as string | undefined);
  res.json(await getCarrierPayableStatement(carrierId, dateFrom, dateTo));
}));

router.get('/ledger/suppliers/:id/statement/export', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const supplierId = parseInt(req.params.id as string, 10);
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
  res.json(await getPayablesSummary({ asOfDate, category }));
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
    create: (tx) => requestCommissionGovernance({
      commission: data,
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? `#${result.id}`;
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

// ─── Driver payout (B1 — feedback202606 GAP 4) ──────────────────────────────
// Records a driver salary/cash payout. Posts a DRIVER_PAYOUT debit on the
// DRIVER ledger. MANAGER/ACCOUNTANT only — drivers may not record their own
// payouts (DRIVER/FORWARDER denied by requireRoles).

router.post('/drivers/:driverId/payouts', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(req.params.driverId as string, 10);
  if (!Number.isFinite(driverId) || driverId <= 0) {
    return res.status(400).json({ error: 'driverId không hợp lệ' });
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
    create: (tx) => financialService.requestDriverPayoutGovernance({
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
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.subjectKey ?? `#${result.id}`;
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

export default router;
