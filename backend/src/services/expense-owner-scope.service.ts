import { and, eq, isNull, ne } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import type { ExpenseAccountingSource } from './expense-accounting-source.service';
import { ApiError } from '../errors';

/**
 * Lock the current grant for the duration of a write; revocation wins before
 * the write or waits for its transaction, never produces partial scope.
 *
 * The OPS expense right is derived at save-time from the live tables — no
 * link-row syncing: (1) a manual user↔shipment link (admin user form),
 * (2) an active truck assignment whose truck hauls the lot on any non-canceled
 * trip (receipts legitimately arrive after completion, so COMPLETED grants;
 * only CANCELED never hauled), or (3) the ops's own saved (non-voided) expense
 * on the lot — a revoked ops keeps managing money they already declared.
 */
export async function assertOpsExpenseAssignment(tx: Pick<Tx, 'select'>, userId: number, shipmentId: number) {
  const [linked] = await tx.select({ id: s.userShipmentLinks.id }).from(s.userShipmentLinks)
    .innerJoin(s.shipments, eq(s.shipments.id, s.userShipmentLinks.shipmentId))
    .where(and(eq(s.userShipmentLinks.userId, userId), eq(s.userShipmentLinks.shipmentId, shipmentId), isNull(s.shipments.deletedAt)))
    .for('share');
  if (linked) return;
  const [hauled] = await tx.select({ id: s.truckOpsAssignments.id }).from(s.truckOpsAssignments)
    .innerJoin(s.trips, and(
      eq(s.trips.truckId, s.truckOpsAssignments.truckId),
      eq(s.trips.shipmentId, shipmentId),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ))
    .where(and(
      eq(s.truckOpsAssignments.opsUserId, userId),
      eq(s.truckOpsAssignments.isActive, true),
    ))
    .for('share');
  if (hauled) return;
  const [expensed] = await tx.select({ id: s.opsExpenseEntries.id }).from(s.opsExpenseEntries)
    .where(and(
      eq(s.opsExpenseEntries.paidById, userId),
      eq(s.opsExpenseEntries.shipmentId, shipmentId),
      ne(s.opsExpenseEntries.approvalStatus, 'VOIDED'),
    ))
    .for('share');
  if (expensed) return;
  throw new ApiError(403, 'Lô này không thuộc xe bạn phụ trách. Liên hệ Quản trị viên để được gán xe.');
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
