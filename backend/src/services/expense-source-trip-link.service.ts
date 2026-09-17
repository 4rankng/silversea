import { and, eq, isNull, ne } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { hydrateExpenseAccountingSource, type ExpenseAccountingSource } from './expense-accounting-source.service';

/** Resolve only real transport work. A shipment with multiple work items requires an explicit choice. */
export async function expenseTripCandidates(tx: Tx, source: Pick<ExpenseAccountingSource, 'shipmentId' | 'shipmentContainerId'>) {
  const candidates = await tx.select({ id: s.trips.id }).from(s.trips)
    .where(and(eq(s.trips.shipmentId, source.shipmentId), isNull(s.trips.deletedAt), ne(s.trips.status, 'CANCELED')));
  if (source.shipmentContainerId) {
    const containers = await tx.select({ tripId: s.tripContainers.tripId }).from(s.tripContainers)
      .where(eq(s.tripContainers.sourceShipmentContainerId, source.shipmentContainerId));
    return candidates.filter(t => containers.some(c => c.tripId === t.id));
  }
  return candidates;
}

export async function linkExpenseToRealTrip(tx: Tx, source: ExpenseAccountingSource, requestedTripId?: number) {
  if (source.tripId) {
    if (requestedTripId && requestedTripId !== source.tripId) throw new ApiError(409, 'Khoản chi đã gắn chuyến; không chuyển nguồn đã ghi nhận sang chuyến khác.');
    return source;
  }
  const candidates = await expenseTripCandidates(tx, source);
  let tripId = requestedTripId;
  if (tripId && !candidates.some(t => t.id === tripId)) throw new ApiError(400, 'Chuyến không thuộc lô/container của khoản chi.');
  if (!tripId) {
    const work = await tx.select({ id: s.shipmentFulfillments.id }).from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, source.shipmentId));
    if (candidates.length !== 1 || (!source.shipmentContainerId && work.length > 1)) return source;
    tripId = candidates[0].id;
  }
  await lockTripFinancialAuthority(tx, [tripId]);
  const [link] = await tx.update(s.expenseAccountingSources).set({ tripId, updatedAt: new Date() })
    .where(and(eq(s.expenseAccountingSources.id, source.id), isNull(s.expenseAccountingSources.tripId))).returning();
  return link ? hydrateExpenseAccountingSource(tx, link) : source;
}
