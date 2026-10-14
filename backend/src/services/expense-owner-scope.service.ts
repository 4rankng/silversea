import { and, eq, isNull } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import * as s from '../db/schema';
import { db } from '../db';
import type { Executor } from './trip-shared';
import type { ExpenseAccountingSource } from './expense-accounting-source.service';
import { ApiError } from '../errors';

/**
 * The OPS role's lot-cost policy (accountant P0 "các lô hàng nhập lên hoàn
 * toàn không khai chi phí được", testplan CPB-01): any OPS user may declare
 * costs on any live lot. The former per-person grant (manual user↔lot link,
 * active truck assignment hauling the lot, own prior expense) is gone — a
 * newly entered lot satisfied none of its branches, so the role was blocked
 * outright. Per-person/per-container scoping is Wave C's lane, not this gate.
 *
 * What still refuses: a missing or soft-deleted lot — 404, not a permission
 * verdict, so the caller can tell "no such lot" from "not yours".
 */
export async function assertOpsLotCostPolicy(executor: Pick<Executor, 'select'>, shipmentId: number) {
  const [lot] = await executor.select({ id: s.shipments.id }).from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!lot) throw new ApiError(404, 'Không tìm thấy lô hàng.');
}

/**
 * Read-only verdict for the expense dialog's open-time check (card
 * 071026210510): the SAME policy predicate as the save-time assert above —
 * never a second copy of it — so the dialog and the save can never disagree.
 * Non-403/404 errors propagate: an infrastructure failure must surface as a
 * 500, not masquerade as a permission denial.
 *
 * The executor defaults to the db client so route callers never import it
 * (routes → services layering rule; ops.ts was the last offender).
 */
export async function opsExpenseWriteScope(shipmentId: number, executor: Pick<Executor, 'select'> = db): Promise<{ writable: boolean; reason: string | null }> {
  try {
    await assertOpsLotCostPolicy(executor, shipmentId);
    return { writable: true, reason: null };
  } catch (error) {
    if (error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404)) {
      return { writable: false, reason: error.message };
    }
    throw error;
  }
}

export async function assertExpenseOwnerWriteScope(executor: Executor, actor: { userId: number; role: Role }, source: ExpenseAccountingSource) {
  if (actor.role === Role.OPS) await assertOpsLotCostPolicy(executor, source.shipmentId);
  if (actor.role === Role.DRIVER) {
    const [trip] = source.tripId ? await executor.select({ id: s.trips.id }).from(s.trips)
      .innerJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
      .where(and(eq(s.trips.id, source.tripId), eq(s.drivers.userId, actor.userId), eq(s.drivers.status, 'ACTIVE'), isNull(s.trips.deletedAt)))
      .for('share') : [];
    if (!trip) throw new ApiError(403, 'Bạn không còn được phân công chuyến đi này. Tải lại danh sách công việc.');
  }
}
