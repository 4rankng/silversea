import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { TxnType, round2dp } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';

/** A request/status is not cash. Read funded principal from the existing cash book. */
export async function getAdvanceFundedAmounts(executor: Tx | typeof db, requestIds: readonly number[], asOfDate?: string): Promise<Map<number, number>> {
  if (!requestIds.length) return new Map();
  const movements = await executor.select({ requestId: s.advanceRequests.id, id: s.treasuryMovements.id, amount: s.treasuryMovements.amount })
    .from(s.advanceRequests)
    .innerJoin(s.ledger, and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, s.advanceRequests.id),
      eq(s.ledger.entityType, 'FORWARDER'), eq(s.ledger.entityId, s.advanceRequests.requesterId)))
    .innerJoin(s.treasuryMovements, and(eq(s.treasuryMovements.ledgerEntryId, s.ledger.id),
      eq(s.treasuryMovements.direction, 'OUT'), eq(s.treasuryMovements.status, 'POSTED'), isNull(s.treasuryMovements.reversalOfId)))
    .where(and(inArray(s.advanceRequests.id, [...requestIds]), asOfDate ? lte(s.treasuryMovements.valueDate, asOfDate) : undefined));
  const reversals = movements.length ? await executor.select({ originalId: s.treasuryMovements.reversalOfId, amount: s.treasuryMovements.amount })
    .from(s.treasuryMovements).where(and(inArray(s.treasuryMovements.reversalOfId, movements.map(row => row.id)), eq(s.treasuryMovements.status, 'POSTED'), asOfDate ? lte(s.treasuryMovements.valueDate, asOfDate) : undefined)) : [];
  const result = new Map<number, number>();
  for (const movement of movements) {
    const refunded = reversals.filter(row => row.originalId === movement.id).reduce((total, row) => total + Number(row.amount), 0);
    result.set(movement.requestId, round2dp((result.get(movement.requestId) ?? 0) + Number(movement.amount) - refunded));
  }
  return result;
}
