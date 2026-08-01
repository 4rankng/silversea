import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { requireWorkflowActive } from '../../middleware/workflow-rollout';
import { getDashboardStats, getPnlReport, getReceivablesSummary, previewDistribution, getDistributionHistory, requestProfitDistributionGovernance } from '../../services/reporting.service';
import { getFuelVarianceReport } from '../../services/pnl.service';
import { getPaymentTermEvalReport } from '../../services/payment-term.service';
import { getDashboardWidgets } from '../../services/dashboard-widgets.service';
import { getCustomerAgingList } from '../../services/receivables.service';
import { getApprovalQueue } from '../../services/approval-queue.service';
import { parsePagination } from '../utils/pagination';
import { exportReceivablesAgingXlsx, attachmentDisposition } from '../../services/statement.service';
import { formatLocalDate } from '../../lib/format';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import {
  PROFIT_DISTRIBUTION_TRANSACTION_OPTIONS,
  runProfitDistributionWithSerializationRetry,
} from '../../services/profit-distribution.service';
import { getProfitabilityReport, PROFITABILITY_DIMENSIONS } from '../../services/profitability.service';

const router = Router();

// ─── Dashboard ───────────────────────────────────────────────────────────────

router.get('/reports/dashboard', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getDashboardStats());
}));

router.get('/dashboard/approval-queue', asyncHandler(async (req: Request, res: Response) => {
  const result = await getApprovalQueue(getUser(req).userId, getUser(req).role);
  res.json(result);
}));

// ─── P&L report ──────────────────────────────────────────────────────────────

router.get('/reports/pnl', asyncHandler(async (req: Request, res: Response) => {
  const month = parseInt(req.query.month as string);
  const year = parseInt(req.query.year as string) || new Date().getFullYear();
  if (!month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Tháng là bắt buộc (month 1-12)' });
  }
  res.json(await getPnlReport(month, year));
}));

router.get('/reports/profitability', requireWorkflowActive, requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year) || new Date().getFullYear();
  const requestedDimension = String(req.query.dimension ?? 'CUSTOMER').toUpperCase();
  const validDimension = requestedDimension === 'VEHICLE'
    || PROFITABILITY_DIMENSIONS.includes(requestedDimension as typeof PROFITABILITY_DIMENSIONS[number]);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    return res.status(400).json({ error: 'Tháng và năm báo cáo không hợp lệ' });
  }
  if (!validDimension) {
    return res.status(400).json({ error: 'Chiều báo cáo lợi nhuận không hợp lệ' });
  }
  const { page, limit } = parsePagination(req, { limit: 50, maxLimit: 100 });
  res.json(await getProfitabilityReport({
    month,
    year,
    dimension: requestedDimension as typeof PROFITABILITY_DIMENSIONS[number] | 'VEHICLE',
    page,
    limit,
  }));
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
  res.json(await getCustomerAgingList({ search, asOfDate, page, limit }));
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

// ─── Fuel variance report ────────────────────────────────────────────────────

router.get('/reports/fuel-variance', asyncHandler(async (req: Request, res: Response) => {
  const month = parseInt(req.query.month as string);
  const year = parseInt(req.query.year as string) || new Date().getFullYear();
  if (!month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Tháng là bắt buộc (month 1-12)' });
  }
  res.json(await getFuelVarianceReport(month, year));
}));

// Profit distribution — ADMIN/MANAGER/ACCOUNTANT
router.get('/reports/distribution-history', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getDistributionHistory());
}));

router.post('/reports/distribute-profit/preview', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const { quarter, year } = req.body;
  if (!quarter || !year) return res.status(400).json({ error: 'Cần nhập quý và năm' });
  if (quarter < 1 || quarter > 4) return res.status(400).json({ error: 'Quý phải từ 1 đến 4' });
  res.json(await previewDistribution(quarter, year));
}));

// Execute distribution — ADMIN/MANAGER only. ACCOUNTANT can preview but not execute per spec.
router.post('/reports/distribute-profit', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const { quarter, year, reason } = req.body;
  if (!quarter || !year) return res.status(400).json({ error: 'Cần nhập quý và năm' });
  if (quarter < 1 || quarter > 4) return res.status(400).json({ error: 'Quý phải từ 1 đến 4' });
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, statusCode } = await runProfitDistributionWithSerializationRetry(() => (
    runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.PROFIT_DISTRIBUTE,
      idempotencyKey,
      payload: { actorId: user.userId, quarter, year, reason: reason ?? null },
      createdBy: user.userId,
      entityType: 'profit_distribution',
      responseStatusCode: 201,
      transactionOptions: PROFIT_DISTRIBUTION_TRANSACTION_OPTIONS,
      create: (tx) => requestProfitDistributionGovernance({
        quarter,
        year,
        reason: typeof reason === 'string' ? reason : '',
        makerId: user.userId,
        makerRole: user.role,
        transaction: tx,
      }),
    })
  ));
  res.locals.auditEntityId = result.id;
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
