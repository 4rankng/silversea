import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../db';
import * as s from '../../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../../errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { runIdempotent } from '../../services/idempotency.service';
import * as H from './config-helpers';
import { parsePagination } from '../utils/pagination';
import { queryAuditLogs } from '../../services/audit-query.service';

// Audit log routes (T3c split) — paginated audit-log query endpoint moved
// verbatim from routes/config.ts.

export const auditLogRouter = Router();
auditLogRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const viewer = getUser(req);
  res.json(await queryAuditLogs({
    page,
    limit,
    category: req.query.category as string,
    search: req.query.search as string,
    viewer: {
      userId: viewer.userId,
      role: viewer.role,
    },
  }));
}));

