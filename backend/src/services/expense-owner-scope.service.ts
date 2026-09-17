import { and, eq, isNull } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import type { ExpenseAccountingSource } from './expense-accounting-source.service';
import { ApiError } from '../errors';

/** Lock the current assignment for the duration of a write; revocation wins
 * before the write or waits for its transaction, never produces partial scope. */
export async function assertOpsExpenseAssignment(tx: Tx, userId: number, shipmentId: number) {
  const [assignment] = await tx.select({ id: s.userShipmentLinks.id }).from(s.userShipmentLinks)
    .innerJoin(s.shipments, eq(s.shipments.id, s.userShipmentLinks.shipmentId))
    .where(and(eq(s.userShipmentLinks.userId, userId), eq(s.userShipmentLinks.shipmentId, shipmentId), isNull(s.shipments.deletedAt)))
    .for('share');
  if (!assignment) throw new ApiError(403, 'Bạn không còn được phân công lô hàng này. Tải lại danh sách công việc.');
}

export async function assertExpenseOwnerWriteScope(tx: Tx, actor: { userId: number; role: Role }, source: ExpenseAccountingSource) {
  if (actor.role === Role.OPS) await assertOpsExpenseAssignment(tx, actor.userId, source.shipmentId);
  if (actor.role === Role.DRIVER) {
    const [trip] = source.tripId ? await tx.select({ id: s.trips.id }).from(s.trips)
      .innerJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
      .where(and(eq(s.trips.id, source.tripId), eq(s.drivers.userId, actor.userId), eq(s.drivers.status, 'ACTIVE'), isNull(s.trips.deletedAt)))
      .for('share') : [];
    if (!trip) throw new ApiError(403, 'Bạn không còn được phân công chuyến đi này. Tải lại danh sách công việc.');
  }
}
