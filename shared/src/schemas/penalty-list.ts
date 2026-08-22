import { z } from 'zod';
import { PenaltyStatus } from '../constants';

/**
 * GET /api/penalties — admin penalty log query contract.
 *
 * Server-side pagination + filters replace the previous full-list fetch that
 * the frontend paginated and aggregated client-side. Dates are ISO
 * (YYYY-MM-DD), inclusive on both ends, and scope `penalties.date`.
 */
export const penaltyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().optional(),
  driverId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  status: z.nativeEnum(PenaltyStatus).optional(),
}).strict().refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
  message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc',
  path: ['dateTo'],
});

export type PenaltyListQuery = z.infer<typeof penaltyListQuerySchema>;

/**
 * GET /api/penalties/insights — server-computed KPI block (month figures via
 * salary-period boundaries, YTD totals, streak scoreboard) mirroring what
 * PenaltyTable used to derive client-side. Defaults to the current period.
 */
export const penaltyInsightsQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
}).strict();

export type PenaltyInsightsQuery = z.infer<typeof penaltyInsightsQuerySchema>;
