import { and, eq, inArray, or } from 'drizzle-orm';
import type { ExpenseSourceKind } from '@tingting/shared';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { lockExpenseSource } from './expense-accounting-source.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';

/** Sources precede account/entity locks, matching source confirmation and financial edits. */
export async function lockExpenseCashSources(tx: Tx, refs: Array<{ sourceKind: ExpenseSourceKind; sourceId: number }>) {
  if (!refs.length) return;
  const links = await tx.select().from(s.expenseAccountingSources).where(or(...refs.map(ref =>
    and(eq(s.expenseAccountingSources.sourceKind, ref.sourceKind), eq(s.expenseAccountingSources.sourceId, ref.sourceId)))));
  const tripIds = links.map(link => link.tripId).filter((id): id is number => id != null);
  const trips = tripIds.length ? await tx.select().from(s.trips).where(inArray(s.trips.id, tripIds)) : [];
  const pairIds = trips.map(trip => trip.activeTripPairId).filter((id): id is number => id != null);
  const pairs = pairIds.length ? await tx.select().from(s.tripPairs).where(inArray(s.tripPairs.id, pairIds)) : [];
  await lockTripFinancialAuthority(tx, [...tripIds, ...pairs.flatMap(pair => [pair.firstTripId, pair.secondTripId])]);
  for (const ref of [...refs].sort((a, b) => `${a.sourceKind}:${a.sourceId}`.localeCompare(`${b.sourceKind}:${b.sourceId}`))) {
    await lockExpenseSource(tx, ref.sourceKind, ref.sourceId);
  }
}
