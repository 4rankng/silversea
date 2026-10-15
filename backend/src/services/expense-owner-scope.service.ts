import { and, eq, isNull } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import * as s from '../db/schema';
import type { Executor } from './trip-shared';
import type { ExpenseAccountingSource } from './expense-accounting-source.service';
import { ApiError } from '../errors';

/**
 * Owner write-scope for a cost row.
 *
 * OPS has NO per-lot grant: every Ops may declare and correct expenses on any
 * lot (the old user-link / truck-assignment / prior-expense grant is gone — it
 * could never be acquired by an Ops who had not yet declared an expense).
 * Only the DRIVER side keeps a scope: the trip must still be assigned to the
 * driver, so a driver cut off mid-trip cannot keep writing on it.
 */
export async function assertExpenseOwnerWriteScope(executor: Executor, actor: { userId: number; role: Role }, source: ExpenseAccountingSource) {
  if (actor.role === Role.DRIVER) {
    const [trip] = source.tripId ? await executor.select({ id: s.trips.id }).from(s.trips)
      .innerJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
      .where(and(eq(s.trips.id, source.tripId), eq(s.drivers.userId, actor.userId), eq(s.drivers.status, 'ACTIVE'), isNull(s.trips.deletedAt)))
      .for('share') : [];
    if (!trip) throw new ApiError(403, 'Bạn không còn được phân công chuyến đi này. Tải lại danh sách công việc.');
  }
}
