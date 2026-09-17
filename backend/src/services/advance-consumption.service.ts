import { and, eq, inArray, isNull, ne, notInArray } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { getAdvanceFundedAmounts } from './advance-funding.service';

/** All consumers of an advance share this authority while holding lock 6101. */
export async function getAdvanceConsumedAmounts(
  executor: Tx | typeof db,
  advanceRequestIds: number[],
  excludeSettlementId?: number,
): Promise<Map<number, number>> {
  if (!advanceRequestIds.length) return new Map();
  const legacy = await executor.select({ id: s.advanceSettlementRequests.advanceRequestId, amount: s.advanceSettlementRequests.allocatedAmount })
    .from(s.advanceSettlementRequests)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.advanceSettlementRequests.settlementId))
    .where(and(inArray(s.advanceSettlementRequests.advanceRequestId, advanceRequestIds),
      notInArray(s.advanceSettlements.status, ['VOIDED', 'REVERSED']),
      excludeSettlementId == null ? undefined : ne(s.advanceSettlements.id, excludeSettlementId)));
  const current = await executor.select({ id: s.expenseReconciliationAdvances.advanceRequestId, amount: s.expenseReconciliationAdvances.amount })
    .from(s.expenseReconciliationAdvances)
    .innerJoin(s.expenseReconciliations, eq(s.expenseReconciliations.id, s.expenseReconciliationAdvances.reconciliationId))
    .where(and(inArray(s.expenseReconciliationAdvances.advanceRequestId, advanceRequestIds), isNull(s.expenseReconciliations.voidedAt)));
  const result = new Map<number, number>();
  for (const row of [...legacy, ...current]) result.set(row.id, (result.get(row.id) ?? 0) + Number(row.amount));
  return result;
}

/**
 * The legacy settlement form selects whole requests, unlike accounting's
 * amount-based reconciliation. Offer only fully funded, completely unallocated
 * requests; partial balances remain available in the accounting workspace.
 */
export async function filterWholeSettlementAdvances<T extends { id: number; amount: string; status: string }>(
  executor: Tx | typeof db,
  candidates: readonly T[],
  excludeSettlementId?: number,
): Promise<T[]> {
  const ids = candidates.map(row => row.id);
  const [funded, consumed] = await Promise.all([
    getAdvanceFundedAmounts(executor, ids),
    getAdvanceConsumedAmounts(executor, ids, excludeSettlementId),
  ]);
  return candidates.filter(row => row.status === 'RECORDED'
    && Number(row.amount) > 0
    && (funded.get(row.id) ?? 0) >= Number(row.amount)
    && (consumed.get(row.id) ?? 0) === 0);
}
