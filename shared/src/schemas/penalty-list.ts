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
 * GET /api/penalties/summary — KPI aggregates (status totals, per-driver
 * counts/amounts, streak and YTD figures) over the same driver/date filters,
 * so the frontend no longer computes them over the full dataset.
 */
export const penaltySummaryQuerySchema = z.object({
  driverId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
}).strict().refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
  message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc',
  path: ['dateTo'],
});

export type PenaltySummaryQuery = z.infer<typeof penaltySummaryQuerySchema>;
