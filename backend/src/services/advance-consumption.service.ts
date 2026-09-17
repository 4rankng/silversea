import { and, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';

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
    .where(inArray(s.expenseReconciliationAdvances.advanceRequestId, advanceRequestIds));
  const result = new Map<number, number>();
  for (const row of [...legacy, ...current]) result.set(row.id, (result.get(row.id) ?? 0) + Number(row.amount));
  return result;
}
