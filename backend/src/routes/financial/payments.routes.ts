import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  Role,
  NotificationType,
  createPaymentSchema,
  createAdjustmentSchema,
  vendorPaymentSchema,
  commissionSchema,
  driverPayoutSchema,
  governanceActionVersionSchema,
} from '@tingting/shared';
import type { PayablesCategory } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { emitNotification } from '../../services/notification.service';
import * as financialService from '../../services/financial.service';
import { getCarrierPayableStatement, getSupplierStatement, exportSupplierStatementXlsx, exportSupplierStatementHtml, attachmentDisposition, normalizeDateParam } from '../../services/statement.service';
import { formatLocalDate } from '../../lib/format';
import { invalidateReportCaches } from '../../lib/redis';
import { getPayablesSummary } from '../../services/payables.service';
import { recordCommissionIdempotent } from '../../services/commission.service';
import {
  approveGovernanceAction,
  checkGovernanceAction,
} from '../../services/adjustment-governance.service';
import { getUser } from '../../middleware/auth';
import { registerAuditEvent } from '../../services/audit-registry';
import { AuditEvent } from '../../services/audit-types';
import { resolveIdempotencyKey } from '../../services/idempotency.service';
import { parseActionId } from './governance-action-input';

const PAYABLES_CATEGORIES = new Set<string>(['fuel', 'ancillary', 'commission', 'carrier']);

const router = Router();

registerAuditEvent('POST', '/api/commissions', AuditEvent.ENTITY_CREATED);
registerAuditEvent('POST', '/api/drivers/', '/payouts', AuditEvent.DRIVER_SALARY_RECORDED);

// ─── Record payment ──────────────────────────────────────────────────────────

router.post('/payments/receive', asyncHandler(async (req: Request, res: Response) => {
  const requestBody = req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
  const data = createPaymentSchema.parse(req.body);
  const { result, replayed } = await financialService.recordPaymentReceiptIdempotent({
    input: {
      customerId: data.customerId,
      receiptId: data.receiptId,
      amount: data.amount,
      payments: data.payments?.map((p) => ({ tripId: p.tripId, amount: p.amount })),
    },
    idempotencyKey,
    createdBy: getUser(req).userId,
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.receiptId;
  if (!replayed) {
    await invalidateReportCaches();
    emitNotification({
      type: NotificationType.PAYMENT_RECEIVED,
      title: 'Thanh toán nhận được',
      message: `Phiếu thu ${result.receiptId} đã được ghi nhận`,
      relatedEntityType: 'payments',
      relatedEntityId: result.id,
    });
  }
  res.status(replayed ? 200 : 201).json({ result, replayed });
}));

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
    const action = await checkGovernanceAction({
      actionId: parseActionId(req.params.id),
      checkerId: getUser(req).userId,
      checkerRole: getUser(req).role,
      expectedVersion: input.expectedVersion,
    });
    res.json(action);
  }),
);

router.post(
  '/governance-actions/:id/approve',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const input = governanceActionVersionSchema.parse(req.body);
    const action = await approveGovernanceAction({
      actionId: parseActionId(req.params.id),
      approverId: getUser(req).userId,
      approverRole: getUser(req).role,
      expectedVersion: input.expectedVersion,
    });
    await invalidateReportCaches();
    if (action.actionKind === 'TRIP_REOPEN') {
      emitNotification({
        type: NotificationType.TRIP_UNLOCKED,
        title: 'Chuyến đã mở khóa',
        message: `Yêu cầu mở khóa chuyến #${action.subjectId} đã được phê duyệt`,
        relatedEntityType: 'trips',
        relatedEntityId: action.subjectId ?? undefined,
      });
    }
    res.json(action);
  }),
);

router.post('/payments/vendor', asyncHandler(async (req: Request, res: Response) => {
  const requestBody = req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
  const data = vendorPaymentSchema.parse(req.body);
  const { result, replayed } = await financialService.recordVendorPaymentIdempotent({
    input: { ...data, amount: String(data.amount) },
    idempotencyKey,
    createdBy: getUser(req).userId,
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.receiptId ?? `#${result.id}`;
  if (!replayed) {
    await invalidateReportCaches();
  }
  const statusCode = replayed ? 200 : (idempotencyKey ? 201 : 200);
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/payments/carrier', asyncHandler(async (req: Request, res: Response) => {
  const requestBody = req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
  const data = vendorPaymentSchema.parse(req.body);
  const { result, replayed } = await financialService.recordCarrierPaymentIdempotent({
    input: { ...data, amount: String(data.amount) },
    idempotencyKey,
    createdBy: getUser(req).userId,
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.receiptId ?? `#${result.id}`;
  if (!replayed) {
    await invalidateReportCaches();
  }
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
  const requestBody = req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
  const data = commissionSchema.parse(req.body);
  const { result, replayed } = await recordCommissionIdempotent({
    input: data,
    idempotencyKey,
    createdBy: getUser(req).userId,
  });
  res.locals.auditEntityId = result.ledgerId;
  res.locals.auditEntityKey = `#${result.ledgerId}`;
  if (!replayed) {
    await invalidateReportCaches();
  }
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
  const requestBody = req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
  const data = driverPayoutSchema.parse(req.body);
  const { result, replayed } = await financialService.recordDriverPayoutIdempotent({
    input: {
      driverId,
      amount: data.amount,
      method: data.method,
      payoutDate: data.payoutDate,
      note: data.note,
      receiptId: data.receiptId,
    },
    idempotencyKey,
    createdBy: getUser(req).userId,
  });
  res.locals.auditEntityId = result.id;
  res.locals.auditEntityKey = result.receiptId ?? `#${result.id}`;
  if (!replayed) {
    await invalidateReportCaches();
  }
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

export default router;
