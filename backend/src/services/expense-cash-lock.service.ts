import { and, eq, inArray, or } from 'drizzle-orm';
import type { ExpenseSourceKind } from '@tingting/shared';
import * as s from '../db/schema';
import type { Executor } from './trip-shared';
import { lockExpenseSource } from './expense-accounting-source.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';

/**
 * Locks the accounting-source rows behind `refs`, in the same sorted order
 * every time (lock order is part of the deadlock contract, not an accident).
 *
 * Card 20260929_211: this already SELECTs the source rows, so it now RETURNS
 * them keyed by the same `sourceKind:sourceId` the caller passed in. That lets
 * a caller batch its per-source reads BEFORE the loop, instead of once per
 * entry — without resolving anything twice and without touching lock order.
 * Callers that ignore the return value are unaffected.
 */
export async function lockExpenseCashSources(executor: Executor, refs: Array<{ sourceKind: ExpenseSourceKind; sourceId: number }>) {
  const linkedIds = new Map<string, number>();
  if (!refs.length) return linkedIds;
  const links = await executor.select().from(s.expenseAccountingSources).where(or(...refs.map(ref =>
    and(eq(s.expenseAccountingSources.sourceKind, ref.sourceKind), eq(s.expenseAccountingSources.sourceId, ref.sourceId)))));
  // `ref.sourceId` is the NATIVE id (for kind OPS), never the source row id —
  // which is why the key below is the (kind, nativeId) pair, not the row id.
  for (const link of links) linkedIds.set(`${link.sourceKind}:${link.sourceId}`, link.id);
  const tripIds = links.map(link => link.tripId).filter((id): id is number => id != null);
  const trips = tripIds.length ? await executor.select().from(s.trips).where(inArray(s.trips.id, tripIds)) : [];
  const pairIds = trips.map(trip => trip.activeTripPairId).filter((id): id is number => id != null);
  const pairs = pairIds.length ? await executor.select().from(s.tripPairs).where(inArray(s.tripPairs.id, pairIds)) : [];
  await lockTripFinancialAuthority(executor, [...tripIds, ...pairs.flatMap(pair => [pair.firstTripId, pair.secondTripId])]);
  for (const ref of [...refs].sort((a, b) => `${a.sourceKind}:${a.sourceId}`.localeCompare(`${b.sourceKind}:${b.sourceId}`))) {
    await lockExpenseSource(executor, ref.sourceKind, ref.sourceId);
  }
  return linkedIds;
}
