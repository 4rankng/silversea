/**
 * Shared pagination parser for route handlers.
 *
 * Eliminates the inconsistent `parseInt(req.query.page) || 1` pattern
 * scattered across route files — some clamped, some didn't, some used
 * different defaults. All routes now go through here for consistent
 * clamping and offset computation.
 */
import type { Request } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(
  req: Request,
  defaults?: { page?: number; limit?: number; maxLimit?: number },
): PaginationParams {
  const defaultPage = defaults?.page ?? 1;
  const defaultLimit = defaults?.limit ?? 50;
  const maxLimit = defaults?.maxLimit ?? 100;

  const page = Math.max(1, parseInt(req.query.page as string, 10) || defaultPage);
  const limit = Math.min(maxLimit, parseInt(req.query.limit as string, 10) || defaultLimit);

  return { page, limit, offset: (page - 1) * limit };
}
