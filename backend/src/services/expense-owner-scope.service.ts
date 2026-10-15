import { and, eq, isNull } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import * as s from '../db/schema';
import type { Executor } from './trip-shared';
import type { ExpenseAccountingSource } from './expense-accounting-source.service';
import { ApiError } from '../errors';

/**
 * The ONE seam that decides whether an OPS user may declare costs (and, via
 * photo authz, read a lot's expense photos). Retired 2026-10-14 per the
 * accountant document "Fix lại các chi phí của từng phân hệ" (Ops section):
 * "không chia cá nhân nào nhận bao nhiêu xe, tất cả các Ops đều được điền chi
 * phí" — the former grant chain (manual user↔shipment link, active truck-ops
 * assignment whose truck hauled the lot, or the ops's own saved expense) no
 * longer restricts who may declare a lot's costs. The seam stays so a future
 * policy change lands in exactly one place and every save path keeps its
 * single chokepoint.
 */
export async function assertOpsExpenseAssignment(
  _executor: Pick<Executor, 'select'>,
  _userId: number,
  _shipmentId: number,
): Promise<void> {}

export async function assertExpenseOwnerWriteScope(executor: Executor, actor: { userId: number; role: Role }, source: ExpenseAccountingSource) {
  // OPS actors: open grant (see assertOpsExpenseAssignment above).
  if (actor.role === Role.DRIVER) {
    const [trip] = source.tripId ? await executor.select({ id: s.trips.id }).from(s.trips)
      .innerJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
      .where(and(eq(s.trips.id, source.tripId), eq(s.drivers.userId, actor.userId), eq(s.drivers.status, 'ACTIVE'), isNull(s.trips.deletedAt)))
      .for('share') : [];
    if (!trip) throw new ApiError(403, 'Bạn không còn được phân công chuyến đi này. Tải lại danh sách công việc.');
  }
}
