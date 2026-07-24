/**
 * Receivables Report Service
 *
 * Receivables summary (delegated to aging.service), penalty statistics.
 */

import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, sql, gte } from 'drizzle-orm';
import { getReceivablesSummary as _getReceivablesSummary } from './aging.service';
import { salaryPeriodDateRange } from './reporting-shared';

/**
 * Receivables summary: aggregate customer outstanding balances bucketed by aging.
 * Delegates to the receivables service module.
 */
export const getReceivablesSummary = _getReceivablesSummary;

/**
 * Get penalty statistics for the current month
 */
export async function getPenaltyStats() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { start: monthStart, end: monthEnd } = await salaryPeriodDateRange(month, year);

  const activePenalties = await db.select({
    reasonId: s.penalties.reasonId,
    amount: s.penalties.amount,
  }).from(s.penalties).where(and(
    isNull(s.penalties.deletedAt),
    eq(s.penalties.status, 'ACTIVE'),
    gte(s.penalties.date, monthStart),
    sql`${s.penalties.date} < ${monthEnd}`
  ));

  let totalCount = 0;
  let totalAmount = 0;
  const countsByReason: Record<number, number> = {};

  for (const p of activePenalties) {
    if (p.reasonId) {
      countsByReason[p.reasonId] = (countsByReason[p.reasonId] || 0) + 1;
    }
    totalCount++;
    totalAmount += parseFloat(p.amount || '0');
  }

  return {
    totalCount,
    totalAmount,
    countsByReason,
    period: { month, year }
  };
}
