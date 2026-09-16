import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { ApiError } from '../../errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { getDashboardStats, getPnlReport, getReceivablesSummary, previewDistribution, getDistributionHistory, requestProfitDistributionGovernance } from '../../services/reporting.service';
import { getFuelVarianceReport } from '../../services/pnl.service';
import { getPaymentTermEvalReport } from '../../services/payment-term.service';
import { getTotalArReport } from '../../services/total-ar-report.service';
import { cacheGet } from '../../lib/redis';
import { getDashboardWidgets } from '../../services/dashboard-widgets.service';
import { totalArRangeKey } from '../../lib/report-cache';
import { getCustomerAgingList, customerAgingSortQuerySchema } from '../../services/aging.service';
import { parsePagination } from '../utils/pagination';
import { throwValidation } from '../../lib/validation';
import { exportReceivablesAgingXlsx, attachmentDisposition } from '../../services/statement.service';
import { formatLocalDate } from '../../lib/format';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import {
  PROFIT_DISTRIBUTION_TRANSACTION_OPTIONS,
  runProfitDistributionWithSerializationRetry,
} from '../../services/profit-distribution.service';
import { exportProfitabilityReport, getProfitabilityReport, PROFITABILITY_DIMENSIONS } from '../../services/profitability.service';
import { autoApplyGovernanceAction } from '../../services/adjustment-governance.service';
import { applyDirectMoneyGovernanceAction } from '../../services/governance-transition.service';
import { AuditEvent } from '../../services/audit-types';

const router = Router();

// ─── Dashboard ───────────────────────────────────────────────────────────────

router.get('/reports/dashboard', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getDashboardStats({ includeExecutive: true }));
}));

// 2026-09-10 (phê duyệt removed, chunk 7): GET /dashboard/approval-queue is
// GONE — every flow that fed the queue now applies at request time. Clients
// still calling it get 404.

// ─── P&L report ──────────────────────────────────────────────────────────────

router.get('/reports/pnl', asyncHandler(async (req: Request, res: Response) => {
  const month = parseInt(req.query.month as string);
  const year = parseInt(req.query.year as string) || new Date().getFullYear();
  if (!month || month < 1 || month > 12) {
    throw new ApiError(400, 'Tháng là bắt buộc (month 1-12)');
  }
  res.json(await getPnlReport(month, year));
}));

router.get('/reports/profitability', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year) || new Date().getFullYear();
  const requestedDimension = String(req.query.dimension ?? 'CUSTOMER').toUpperCase();
  const validDimension = requestedDimension === 'VEHICLE'
    || PROFITABILITY_DIMENSIONS.includes(requestedDimension as typeof PROFITABILITY_DIMENSIONS[number]);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    throw new ApiError(400, 'Tháng và năm báo cáo không hợp lệ');
  }
  if (!validDimension) {
    throw new ApiError(400, 'Chiều báo cáo lợi nhuận không hợp lệ');
  }
  const { page, limit } = parsePagination(req, { limit: 50, maxLimit: 100 });
  const lowMarginOnly = req.query.alert === 'LOW_MARGIN';
  if (req.query.alert != null && !['ALL', 'LOW_MARGIN'].includes(String(req.query.alert))) {
    throw new ApiError(400, 'Bộ lọc cảnh báo biên lợi nhuận không hợp lệ');
  }
  res.json(await getProfitabilityReport({
    month,
    year,
    dimension: requestedDimension as typeof PROFITABILITY_DIMENSIONS[number] | 'VEHICLE',
    page,
    limit,
    lowMarginOnly,
  }));
}));

router.get('/reports/profitability/export', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year) || new Date().getFullYear();
  const requestedDimension = String(req.query.dimension ?? 'CUSTOMER').toUpperCase();
  const validDimension = requestedDimension === 'VEHICLE'
    || PROFITABILITY_DIMENSIONS.includes(requestedDimension as typeof PROFITABILITY_DIMENSIONS[number]);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || !validDimension) {
    throw new ApiError(400, 'Kỳ hoặc chiều báo cáo lợi nhuận không hợp lệ');
  }
  const lowMarginOnly = req.query.alert === 'LOW_MARGIN';
  if (req.query.alert != null && !['ALL', 'LOW_MARGIN'].includes(String(req.query.alert))) {
    throw new ApiError(400, 'Bộ lọc cảnh báo biên lợi nhuận không hợp lệ');
  }
  const buffer = await exportProfitabilityReport({
    month,
    year,
    dimension: requestedDimension as typeof PROFITABILITY_DIMENSIONS[number] | 'VEHICLE',
    lowMarginOnly,
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachmentDisposition(`loi-nhuan-${year}-${String(month).padStart(2, '0')}.xlsx`));
  res.send(buffer);
}));

// ─── Receivables summary ──────────────────────────────────────────────────────

router.get('/reports/receivables-summary', asyncHandler(async (req: Request, res: Response) => {
  const asOfDate = typeof req.query.asOfDate === 'string' ? req.query.asOfDate : undefined;
  res.json(await getReceivablesSummary({ asOfDate }));
}));

router.get('/reports/receivables-aging', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const asOfDate = typeof req.query.asOfDate === 'string' ? req.query.asOfDate : undefined;
  const { page, limit } = parsePagination(req, { limit: 500, maxLimit: 500 });
  const rawBucket = typeof req.query.bucket === 'string' ? req.query.bucket : undefined;
  const bucket = rawBucket && ['current', 'd30', 'd60', 'over90'].includes(rawBucket)
    ? (rawBucket as 'current' | 'd30' | 'd60' | 'over90')
    : 'all';
  // Sort params are whitelist-validated separately so the rest of this route's
  // hand-parsed query surface (search/asOfDate/bucket) stays untouched.
  const sort = customerAgingSortQuerySchema.safeParse(req.query);
  if (!sort.success) throwValidation(sort.error);
  res.json(await getCustomerAgingList({ search, asOfDate, page, limit, bucket, ...sort.data }));
}));

router.get('/reports/receivables-aging/export', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const asOfDate = typeof req.query.asOfDate === 'string' ? req.query.asOfDate : undefined;
  const data = await getCustomerAgingList({ search, asOfDate, page: 1, limit: 10000 });
  const dateStr = formatLocalDate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachmentDisposition(`cong-no-phai-thu-${dateStr}.xlsx`));
  await exportReceivablesAgingXlsx(data.customers, dateStr, res);
}));

// ─── Total AR report (M5.5) ──────────────────────────────────────────────────
// Per-customer AR aging over a date range, cached briefly like the other
// ledger-derived reports. Every ledger-writing path busts the total-AR
// pattern via the single report-cache registry (lib/report-cache.ts) —
// invalidation sites derive their keys from there; do not hand-spell them.
router.get('/reports/total-ar', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const rangeFrom = typeof req.query.rangeFrom === 'string' ? req.query.rangeFrom : '';
  const rangeTo = typeof req.query.rangeTo === 'string' ? req.query.rangeTo : '';
  if (!DATE_RE.test(rangeFrom) || !DATE_RE.test(rangeTo) || rangeFrom > rangeTo) {
    throw new ApiError(400, 'Khoảng ngày báo cáo không hợp lệ (cần rangeFrom ≤ rangeTo, định dạng YYYY-MM-DD)');
  }
  res.json(await cacheGet(
    totalArRangeKey(rangeFrom, rangeTo),
    120,
    () => getTotalArReport(rangeFrom, rangeTo),
  ));
}));

// ─── Fuel variance report ────────────────────────────────────────────────────

router.get('/reports/fuel-variance', asyncHandler(async (req: Request, res: Response) => {
  const month = parseInt(req.query.month as string);
  const year = parseInt(req.query.year as string) || new Date().getFullYear();
  if (!month || month < 1 || month > 12) {
    throw new ApiError(400, 'Tháng là bắt buộc (month 1-12)');
  }
  res.json(await getFuelVarianceReport(month, year));
}));

// Profit distribution — ADMIN/MANAGER/ACCOUNTANT
router.get('/reports/distribution-history', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getDistributionHistory());
}));

router.post('/reports/distribute-profit/preview', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const { quarter, year } = req.body;
  if (!quarter || !year) throw new ApiError(400, 'Cần nhập quý và năm');
  if (quarter < 1 || quarter > 4) throw new ApiError(400, 'Quý phải từ 1 đến 4');
  res.json(await previewDistribution(quarter, year));
}));

// Execute distribution — ADMIN/MANAGER only. ACCOUNTANT can preview but not execute per spec.
router.post('/reports/distribute-profit', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const { quarter, year, reason } = req.body;
  if (!quarter || !year) throw new ApiError(400, 'Cần nhập quý và năm');
  if (quarter < 1 || quarter > 4) throw new ApiError(400, 'Quý phải từ 1 đến 4');
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, statusCode, replayed } = await runProfitDistributionWithSerializationRetry(() => (
    runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.PROFIT_DISTRIBUTE,
      idempotencyKey,
      payload: { actorId: user.userId, quarter, year, reason: reason ?? null },
      createdBy: user.userId,
      entityType: 'profit_distribution',
      responseStatusCode: 201,
      transactionOptions: PROFIT_DISTRIBUTION_TRANSACTION_OPTIONS,
      create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestProfitDistributionGovernance({
        quarter,
        year,
        reason: typeof reason === 'string' ? reason : '',
        makerId: user.userId,
        makerRole: user.role,
        transaction: tx,
      }),
      apply: applyDirectMoneyGovernanceAction,
      actorId: user.userId,
      actorRole: user.role,
      transaction: tx,
    }),
    })
  ));
  res.locals.auditEntityId = result.id;
  // 2026-09-10 (phê duyệt removed): money applies at request time — emit the
  // distribution audit event the old approve step used to write.
  if (!replayed) {
    res.locals.auditEvent = AuditEvent.PROFIT_DISTRIBUTED;
  }
  res.status(statusCode).json(result);
}));

// M11.4 — payment-term evaluation report. Per-customer days-to-pay +
// overdue analysis. ADMIN/MANAGER/ACCOUNTANT only.
router.get('/reports/payment-term-eval', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ items: await getPaymentTermEvalReport() });
}));

// M11.5 — director dashboard widgets (two-way-cargo ratio, fleet attention,
// period-over-period). ADMIN/MANAGER/ACCOUNTANT only.
router.get('/reports/dashboard-widgets', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
  res.json(await getDashboardWidgets(month, year));
}));

export default router;
