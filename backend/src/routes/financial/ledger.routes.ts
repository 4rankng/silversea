import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ApiError } from '../../errors';
import { LedgerService } from '../../services/ledger.service';
import * as financialService from '../../services/financial.service';
import { getStatementData, exportStatementXlsx, exportStatementHtml, attachmentDisposition, normalizeDateParam } from '../../services/statement.service';
import { formatLocalDate } from '../../lib/format';
import { parsePagination } from '../utils/pagination';

const router = Router();

// ─── Ledger ──────────────────────────────────────────────────────────────────

router.get('/ledger', asyncHandler(async (req: Request, res: Response) => {
  const entityTypeVal = (req.query.entityType || req.query.entity_type) as string;
  const entityIdVal = (req.query.entityId || req.query.entity_id) as string;

  // Same defaults as before, now with clamping (maxLimit mirrors the service's
  // 10k cap) instead of accepting arbitrarily large limits.
  const { page, limit } = parsePagination(req, { limit: 50, maxLimit: 10_000 });
  const result = await LedgerService.getEntries({
    entityType: entityTypeVal,
    entityId: entityIdVal ? parseInt(entityIdVal, 10) : undefined,
    page,
    limit,
  });
  res.json(result);
}));

router.get('/ledger/balances', asyncHandler(async (req: Request, res: Response) => {
  const entityType = (req.query.entityType || req.query.entity_type) as string;
  if (!entityType) throw new ApiError(400, 'entityType is required');
  res.json(await financialService.getEntityBalances(entityType));
}));

// ─── Customer statement ──────────────────────────────────────────────────────

router.get('/ledger/customers/:id/statement', asyncHandler(async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.id as string, 10);
  const dateFrom = normalizeDateParam((req.query.dateFrom || req.query.date_from) as string | undefined);
  const dateTo = normalizeDateParam((req.query.dateTo || req.query.date_to) as string | undefined);
  const data = await getStatementData(customerId, dateFrom, dateTo);
  if (!data) throw new ApiError(404, 'Không tìm thấy khách hàng');
  res.json(data);
}));

// ─── Customer statement export (XLSX / HTML print) ──────────────────────────

router.get('/ledger/customers/:id/statement/export', asyncHandler(async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.id as string, 10);
  const format = (req.query.format as string) || 'xlsx';
  const dateFrom = normalizeDateParam((req.query.dateFrom || req.query.date_from) as string | undefined);
  const dateTo = normalizeDateParam((req.query.dateTo || req.query.date_to) as string | undefined);
  const data = await getStatementData(customerId, dateFrom, dateTo);
  if (!data) throw new ApiError(404, 'Không tìm thấy khách hàng');

  const dateStr = formatLocalDate();

  if (format === 'pdf') {
    const html = await exportStatementHtml(data, dateStr);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
    return;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachmentDisposition(`sao-ke-${data.customer.name}-${dateStr}.xlsx`));
  await exportStatementXlsx(data, dateStr, res);
}));

export default router;
