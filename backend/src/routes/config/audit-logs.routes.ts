import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../db';
import * as s from '../../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from '../../errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { runIdempotent } from '../../services/idempotency.service';
import * as H from './config-helpers';
import { parsePagination } from '../utils/pagination';
import { AUDIT_LOG_SORT_KEYS, queryAuditLogs } from '../../services/audit-query.service';

// Audit log routes (T3c split) — paginated audit-log query endpoint moved
// verbatim from routes/config.ts.

// Sort params — optional; absent params keep the default newest-first (id
// desc) order. Keys mirror AUDIT_SORT_SQL in the audit-query service.
const auditLogSortQuerySchema = z.object({
  sortBy: z.enum(AUDIT_LOG_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const auditLogRouter = Router();
auditLogRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const parsedSort = auditLogSortQuerySchema.safeParse({
    sortBy: req.query.sortBy,
    sortDir: req.query.sortDir,
  });
  if (!parsedSort.success) {
    throw new ApiError(400, 'Tham số sắp xếp không hợp lệ');
  }
  const viewer = getUser(req);
  res.json(await queryAuditLogs({
    page,
    limit,
    category: req.query.category as string,
    search: req.query.search as string,
    sortBy: parsedSort.data.sortBy,
    sortDir: parsedSort.data.sortDir,
    viewer: {
      userId: viewer.userId,
      role: viewer.role,
    },
  }));
}));

