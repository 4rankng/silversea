import { db } from '../db';
import type { Tx } from './trip-shared';
export type { Tx };
import * as s from '../db/schema';
import type { GuardedResult } from './approval.service';
import { eq, and, isNull, desc, notInArray, inArray, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
export {
  getForwarderTrips,
  latestTripPhotoKey,
  listTripPhotoKeys,
  getForwarderTripCounts,
  getForwarderTripDetail,
} from './forwarder-trip-query.service';
export {
  derivePrimarySealNumber,
  createTripContainer,
  updateTripContainer,
  listTripContainers,
  batchUpsertContainerSeals,
  batchUpsertTripContainers,
} from './forwarder-container.service';

/**
 * Either the singleton db client or an in-flight transaction client. Both
 * expose the same query-builder surface (select/insert/update/delete), so the
 * expense helpers accept either and route through whichever the caller holds.
 */
type DbOrTx = typeof db | Tx;

type TripExpenseRequiredFieldState = {
  expenseType: string;
  declarationNumber: string | null;
};

type SettlementOpsCompletionGroup = {
  tripContainerId: number | null;
  containerNumber: string | null;
  expenseCount: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
};

type SettlementOpsCompletionTrip = {
  tripId: number;
  tripCode: string | null;
  departureDate: string | null;
  completedGroupCount: number;
  totalGroupCount: number;
  groups: SettlementOpsCompletionGroup[];
};

type SettlementOpsCompletionSummary = {
  tripCount: number;
  completedGroupCount: number;
  totalGroupCount: number;
  trips: SettlementOpsCompletionTrip[];
};

export function getTripExpenseRequiredFieldError(state: TripExpenseRequiredFieldState): string | null {
  if (state.expenseType === 'CUSTOMS' && !state.declarationNumber?.trim()) {
    return 'Số tờ khai là bắt buộc cho phí hải quan';
  }
  return null;
}

async function resetExpenseScope(
  txOrDb: DbOrTx,
  tripId: number,
  tripContainerId: number | null,
) {
  const scopeWhere = tripContainerId == null
    ? and(eq(s.tripExpenseCompletionScopes.tripId, tripId), isNull(s.tripExpenseCompletionScopes.tripContainerId))
    : eq(s.tripExpenseCompletionScopes.tripContainerId, tripContainerId);
  await txOrDb.update(s.tripExpenseCompletionScopes).set({
    status: 'IN_PROGRESS',
    completedBy: null,
    completedAt: null,
    updatedAt: new Date(),
  }).where(scopeWhere);
}

export async function setTripExpenseCompletion(
  tripId: number,
  tripContainerId: number | null,
  completed: boolean,
  actorId: number,
) {
  return db.transaction(async (tx) => {
    const scopeKey = tripContainerId ?? -tripId;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
    const [trip] = await tx.select({ status: s.trips.status }).from(s.trips)
      .where(eq(s.trips.id, tripId)).limit(1);
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (trip.status === 'LOCKED' || trip.status === 'CANCELED') {
      throw new ApiError(409, 'Không thể cập nhật kê khai của chuyến đã khóa hoặc đã hủy');
    }
    if (tripContainerId != null) {
      const [container] = await tx.select({ tripId: s.tripContainers.tripId })
        .from(s.tripContainers).where(eq(s.tripContainers.id, tripContainerId)).limit(1);
      if (!container || container.tripId !== tripId) {
        throw new ApiError(400, 'Container không thuộc chuyến này');
      }
    }
    if (!completed) {
      const expenseScope = tripContainerId == null
        ? and(eq(s.tripExpenses.tripId, tripId), isNull(s.tripExpenses.tripContainerId))
        : eq(s.tripExpenses.tripContainerId, tripContainerId);
      const [activeSettlement] = await tx.select({ id: s.advanceSettlements.id })
        .from(s.tripExpenses)
        .innerJoin(s.settlementExpenses, eq(s.settlementExpenses.tripExpenseId, s.tripExpenses.id))
        .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
        .where(and(
          expenseScope,
          notInArray(s.advanceSettlements.status, ['REJECTED']),
        )).limit(1);
      if (activeSettlement) {
        throw new ApiError(409, 'Chi phí đã gửi kế toán, không thể mở lại kê khai');
      }
    }

    const scopeWhere = tripContainerId == null
      ? and(eq(s.tripExpenseCompletionScopes.tripId, tripId), isNull(s.tripExpenseCompletionScopes.tripContainerId))
      : eq(s.tripExpenseCompletionScopes.tripContainerId, tripContainerId);
    const [existing] = await tx.select({ id: s.tripExpenseCompletionScopes.id })
      .from(s.tripExpenseCompletionScopes).where(scopeWhere).limit(1);
    const values = {
      status: completed ? 'COMPLETED' : 'IN_PROGRESS',
      completedBy: completed ? actorId : null,
      completedAt: completed ? new Date() : null,
      updatedAt: new Date(),
    };
    if (existing) {
      const [updated] = await tx.update(s.tripExpenseCompletionScopes)
        .set(values).where(eq(s.tripExpenseCompletionScopes.id, existing.id)).returning();
      return updated;
    }
    const [inserted] = await tx.insert(s.tripExpenseCompletionScopes).values({
      tripId,
      tripContainerId,
      ...values,
    }).returning();
    return inserted;
  });
}

export async function getTripExpenseCompletionScopes(tripId: number) {
  return db.select({
    tripId: s.tripExpenseCompletionScopes.tripId,
    tripContainerId: s.tripExpenseCompletionScopes.tripContainerId,
    status: s.tripExpenseCompletionScopes.status,
    completedBy: s.tripExpenseCompletionScopes.completedBy,
    completedAt: s.tripExpenseCompletionScopes.completedAt,
    completedByName: s.users.fullName,
  }).from(s.tripExpenseCompletionScopes)
    .leftJoin(s.users, eq(s.users.id, s.tripExpenseCompletionScopes.completedBy))
    .where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
}

export class NoForwarderProfileError extends Error {
  status = 404;
  constructor() {
    super('Không tìm thấy thông tin nhân viên giao nhận');
    this.name = 'NoForwarderProfileError';
  }
}


export async function getForwarderByUserId(userId: number) {
  const [user] = await db.select({
    id: s.users.id,
    username: s.users.username,
    fullName: s.users.fullName,
    role: s.users.role,
  }).from(s.users)
    .where(and(eq(s.users.id, userId), eq(s.users.role, 'FORWARDER'), eq(s.users.status, 'ACTIVE')))
    .limit(1);
  if (!user) throw new NoForwarderProfileError();
  return user;
}


export async function createTripExpense(
  txOrDb: DbOrTx,
  data: {
    tripId: number;
    forwarderId: number | null;
    expenseType: string;
    buyAmount: string;
    sellAmount?: string;
    settlementMethod?: string;
    supplierId?: number | null;
    approvalStatus?: string;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    declarationNumber?: string | null;
    containerNumber?: string | null;
    /** B5: authoritative container FK. When set, the loose containerNumber is
     *  mirrored from this row so settlement grouping never drifts. */
    tripContainerId?: number | null;
    note: string | null;
  },
) {
  // Spec §4.9: locked trips are immutable — reject expense creation on LOCKED trips.
  const [trip] = await txOrDb.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, data.tripId)).limit(1);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  if (trip.status === 'LOCKED') {
    throw new ApiError(409, 'Không thể thêm chi phí cho chuyến đã chốt');
  }

  // B5: resolve an authoritative container FK when provided. The container must
  // belong to this trip; we also mirror its label into the (deprecated)
  // free-text column so legacy grouping keeps working until fully migrated.
  const tripContainerId = data.tripContainerId ?? null;
  let containerLabel = data.containerNumber ?? null;
  if (tripContainerId != null) {
    const [container] = await txOrDb
      .select({
        id: s.tripContainers.id,
        cTripId: s.tripContainers.tripId,
        containerNumber: s.tripContainers.containerNumber,
      })
      .from(s.tripContainers)
      .where(eq(s.tripContainers.id, tripContainerId))
      .limit(1);
    if (!container || container.cTripId !== data.tripId) {
      throw new ApiError(400, 'Container không thuộc chuyến này');
    }
    containerLabel = container.containerNumber;
  }
  const scopeKey = tripContainerId ?? -data.tripId;
  await txOrDb.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);

  // Ancillary service/ocean-fee rows are now receivables-only for debit notes
  // and customer AR. They no longer require a payable counterparty because no
  // vendor/forwarder payable is posted when the trip is completed.

  // By default, forwarder-owned rows need manager approval. Office routes can
  // explicitly mark a row APPROVED when accountant/manager staff enter it on a
  // forwarder's behalf after checking the invoice.
  const approvalStatus = data.approvalStatus ?? (data.forwarderId == null ? 'APPROVED' : 'PENDING');

  const [inserted] = await txOrDb.insert(s.tripExpenses).values({
    tripId: data.tripId,
    forwarderId: data.forwarderId,
    expenseType: data.expenseType,
    buyAmount: data.buyAmount,
    sellAmount: data.sellAmount ?? '0',
    settlementMethod: data.settlementMethod ?? 'FORWARDER_ADVANCE',
    supplierId: data.supplierId ?? null,
    invoiceNumber: data.invoiceNumber ?? null,
    invoiceDate: data.invoiceDate ?? null,
    declarationNumber: data.declarationNumber ?? null,
    containerNumber: containerLabel,
    tripContainerId,
    approvalStatus,
    note: data.note,
  }).returning();
  if (data.forwarderId != null) {
    await resetExpenseScope(txOrDb, data.tripId, tripContainerId);
  }
  return inserted;
}

export async function updateTripExpense(
  txOrDb: DbOrTx,
  id: number,
  patch: {
    expenseType?: string;
    buyAmount?: string;
    sellAmount?: string;
    settlementMethod?: string;
    supplierId?: number | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    declarationNumber?: string | null;
    containerNumber?: string | null;
    /** B5: authoritative container FK; validated against the expense's trip. */
    tripContainerId?: number | null;
    note?: string | null;
  },
) {
  await txOrDb.execute(sql`SELECT pg_advisory_xact_lock(6102, ${id})`);
  // Fetch existing to check forwarderId — if forwarder-owned and sellAmount
  // is being updated, re-pend for manager review.
  // Also check parent trip status (spec §4.9: locked trips are immutable).
  const [existing] = await txOrDb
    .select({
      forwarderId: s.tripExpenses.forwarderId,
      tripId: s.tripExpenses.tripId,
      tripContainerId: s.tripExpenses.tripContainerId,
      expenseType: s.tripExpenses.expenseType,
      declarationNumber: s.tripExpenses.declarationNumber,
    })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, id))
    .limit(1);

  if (!existing) return null;
  if (existing.forwarderId != null) {
    const [activeLink] = await txOrDb.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
      .where(and(
        eq(s.settlementExpenses.tripExpenseId, id),
        notInArray(s.advanceSettlements.status, ['REJECTED']),
      )).limit(1);
    if (activeLink) throw new ApiError(409, 'Chi phí đã gửi kế toán, chỉ được điều chỉnh trên phiếu hoàn ứng');
  }
  const scopeKeys = [...new Set([
    existing.tripContainerId ?? -existing.tripId,
    patch.tripContainerId === undefined ? (existing.tripContainerId ?? -existing.tripId) : (patch.tripContainerId ?? -existing.tripId),
  ])].sort((a, b) => a - b);
  for (const scopeKey of scopeKeys) {
    await txOrDb.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
  }

  // Guard: reject edits on expenses belonging to LOCKED trips
  const [trip] = await txOrDb.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, existing.tripId)).limit(1);
  if (trip?.status === 'LOCKED') {
    throw new ApiError(409, 'Không thể sửa chi phí của chuyến đã chốt');
  }

  const requiredFieldError = getTripExpenseRequiredFieldError({
    expenseType: patch.expenseType ?? existing.expenseType,
    declarationNumber: patch.declarationNumber === undefined
      ? existing.declarationNumber
      : patch.declarationNumber,
  });
  if (requiredFieldError) throw new ApiError(400, requiredFieldError);

  const setPatch: Record<string, unknown> = { ...patch, updatedAt: new Date() };

  if (patch.sellAmount !== undefined && existing.forwarderId != null) {
    setPatch.approvalStatus = 'PENDING';
  }

  // B5: resolve an authoritative container change against this trip. An
  // explicit null clears the link (and the mirrored free-text label); a number
  // is validated against the trip and its label mirrored.
  if (patch.tripContainerId !== undefined) {
    if (patch.tripContainerId == null) {
      setPatch.tripContainerId = null;
      setPatch.containerNumber = null;
    } else {
      const [container] = await txOrDb
        .select({
          id: s.tripContainers.id,
          cTripId: s.tripContainers.tripId,
          containerNumber: s.tripContainers.containerNumber,
        })
        .from(s.tripContainers)
        .where(eq(s.tripContainers.id, patch.tripContainerId))
        .limit(1);
      if (!container || container.cTripId !== existing.tripId) {
        throw new ApiError(400, 'Container không thuộc chuyến này');
      }
      setPatch.containerNumber = container.containerNumber;
    }
  }

  const [updated] = await txOrDb
    .update(s.tripExpenses)
    .set(setPatch)
    .where(eq(s.tripExpenses.id, id))
    .returning();
  await resetExpenseScope(txOrDb, existing.tripId, existing.tripContainerId);
  if (patch.tripContainerId !== undefined && patch.tripContainerId !== existing.tripContainerId) {
    await resetExpenseScope(txOrDb, existing.tripId, patch.tripContainerId);
  }
  return updated;
}

export async function updateForwarderTripExpense(
  expenseId: number,
  forwarderId: number,
  patch: Parameters<typeof updateTripExpense>[2],
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    const [expense] = await tx.select({
      id: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      ownerId: s.tripExpenses.forwarderId,
      tripContainerId: s.tripExpenses.tripContainerId,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
    if (!expense) throw new ApiError(404, 'Không tìm thấy chi phí');
    if (expense.ownerId !== forwarderId) throw new ApiError(403, 'Không có quyền sửa chi phí này');
    const [activeLink] = await tx.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
      .where(and(
        eq(s.settlementExpenses.tripExpenseId, expenseId),
        notInArray(s.advanceSettlements.status, ['REJECTED']),
      )).limit(1);
    if (activeLink) throw new ApiError(409, 'Chi phí đã gửi kế toán, không thể sửa');
    return updateTripExpense(tx, expenseId, patch);
  });
}

export async function getTripExpenses(txOrDb: DbOrTx, tripId: number) {
  return txOrDb.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    forwarderId: s.tripExpenses.forwarderId,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    settlementMethod: s.tripExpenses.settlementMethod,
    supplierId: s.tripExpenses.supplierId,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    invoiceDate: s.tripExpenses.invoiceDate,
    declarationNumber: s.tripExpenses.declarationNumber,
    containerNumber: s.tripExpenses.containerNumber,
    tripContainerId: s.tripExpenses.tripContainerId,
    approvalStatus: s.tripExpenses.approvalStatus,
    note: s.tripExpenses.note,
    createdAt: s.tripExpenses.createdAt,
    updatedAt: s.tripExpenses.updatedAt,
    forwarderName: s.users.fullName,
    expenseTypeName: s.forwarderExpenseTypes.name,
    supplierName: s.suppliers.name,
  }).from(s.tripExpenses)
    .leftJoin(s.users, eq(s.tripExpenses.forwarderId, s.users.id))
    .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
    .where(eq(s.tripExpenses.tripId, tripId))
    .orderBy(desc(s.tripExpenses.createdAt));
}

export async function deleteTripExpense(expenseId: number, forwarderId: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    const [existing] = await tx.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, expenseId)).limit(1);
    if (!existing) return null;
    if (existing.forwarderId == null || existing.forwarderId !== forwarderId) return 'FORBIDDEN';
    const scopeKey = existing.tripContainerId ?? -existing.tripId;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
    const [trip] = await tx.select({ status: s.trips.status }).from(s.trips)
      .where(eq(s.trips.id, existing.tripId)).limit(1);
    if (trip?.status === 'LOCKED') throw new ApiError(409, 'Không thể xóa chi phí của chuyến đã chốt');
    const [activeLink] = await tx.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
      .where(and(
        eq(s.settlementExpenses.tripExpenseId, expenseId),
        notInArray(s.advanceSettlements.status, ['REJECTED']),
      )).limit(1);
    if (activeLink) throw new ApiError(409, 'Chi phí đã gửi kế toán, không thể xóa');
    await tx.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
    await resetExpenseScope(tx, existing.tripId, existing.tripContainerId);
    return 'DELETED';
  });
}

/**
 * Fetch expense audit info (type name, amounts, trip code, supplier) for logging.
 * Returns null if expense not found.
 */
export async function getTripExpenseAuditInfo(expenseId: number) {
  const [expense] = await db.select({
    buyAmount: s.tripExpenses.buyAmount,
    typeName: s.forwarderExpenseTypes.name,
    tripCode: s.trips.tripCode,
    supplierName: s.suppliers.name,
  }).from(s.tripExpenses)
    .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  return expense ?? null;
}

/**
 * Hard-delete a trip expense with business guards:
 * - Trip must not be LOCKED
 * - Expense must not be linked to any settlement
 * Must be called from the trips route (not the forwarder portal).
 */
export async function deleteTripExpenseGuarded(tripId: number, expenseId: number): Promise<GuardedResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    const [expense] = await tx.select({
      tripId: s.tripExpenses.tripId,
      tripContainerId: s.tripExpenses.tripContainerId,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
    if (!expense || expense.tripId !== tripId) {
      return { error: 'Không tìm thấy chi phí của chuyến xe', status: 404 };
    }
    const scopeKey = expense.tripContainerId ?? -expense.tripId;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
    // Guard: trip must not be locked
    const [trip] = await tx.select({ status: s.trips.status })
      .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
    if (!trip) return { error: 'Không tìm thấy chuyến xe', status: 404 };
    if (trip.status === 'LOCKED') return { error: 'Không thể xóa chi phí trên chuyến đã khóa', status: 400 };
    // Keep historical settlement snapshots referentially intact, including
    // rejected submissions. Corrections can be edited and resubmitted instead.
    const [link] = await tx.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses)
      .where(eq(s.settlementExpenses.tripExpenseId, expenseId)).limit(1);
    if (link) return { error: 'Không thể xóa chi phí đã được thanh toán', status: 400 };
    await tx.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
    await resetExpenseScope(tx, expense.tripId, expense.tripContainerId);
    return { ok: true as const };
  });
}

/**
 * List trip expenses belonging to a forwarder that are NOT yet linked to a
 * non-rejected settlement. Used in the settlement form for expense selection.
 */
export async function listUnlinkedTripExpenses(forwarderId: number) {
  // Get all expense IDs already linked to non-rejected settlements
  const linked = await db.select({ tripExpenseId: s.settlementExpenses.tripExpenseId })
    .from(s.settlementExpenses)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
    .where(notInArray(s.advanceSettlements.status, ['REJECTED']));
  const linkedIds = new Set(linked.map(l => l.tripExpenseId));

  const rows = await db.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    approvalStatus: s.tripExpenses.approvalStatus,
    tripContainerId: s.tripExpenses.tripContainerId,
    completionStatus: sql<string>`COALESCE((
      SELECT scope.status FROM trip_expense_completion_scopes scope
      WHERE scope.trip_id = ${s.tripExpenses.tripId}
        AND (scope.trip_container_id = ${s.tripExpenses.tripContainerId}
          OR (scope.trip_container_id IS NULL AND ${s.tripExpenses.tripContainerId} IS NULL))
      LIMIT 1
    ), 'IN_PROGRESS')`,
    note: s.tripExpenses.note,
    createdAt: s.tripExpenses.createdAt,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    truckPlate: s.trucks.licensePlate,
    containerNumbers: s.tripContainers.containerNumber,
  }).from(s.tripExpenses)
    .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.tripContainers, eq(s.tripExpenses.tripContainerId, s.tripContainers.id))
    // Intentionally scoped to forwarder-owned expenses only (forwarderId IS NOT NULL).
    // Accountant-created expenses (forwarderId = null) are excluded by design —
    // they are not eligible for forwarder advance settlement.
    .where(and(
      eq(s.tripExpenses.forwarderId, forwarderId),
      inArray(s.tripExpenses.approvalStatus, ['PENDING', 'APPROVED']),
    ))
    .orderBy(desc(s.tripExpenses.createdAt));

  return rows.filter(r => !linkedIds.has(r.id));
}
export async function listTripExpenses(filters?: { tripId?: number; forwarderId?: number; expenseType?: string }) {
  const conditions = [];
  if (filters?.tripId) conditions.push(eq(s.tripExpenses.tripId, filters.tripId));
  if (filters?.forwarderId) conditions.push(eq(s.tripExpenses.forwarderId, filters.forwarderId));
  if (filters?.expenseType) conditions.push(eq(s.tripExpenses.expenseType, filters.expenseType));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    forwarderId: s.tripExpenses.forwarderId,
    expenseType: s.tripExpenses.expenseType,
    amount: s.tripExpenses.buyAmount,
    note: s.tripExpenses.note,
    createdAt: s.tripExpenses.createdAt,
    forwarderName: s.users.fullName,
    tripCode: s.trips.tripCode,
  }).from(s.tripExpenses)
    .leftJoin(s.users, eq(s.tripExpenses.forwarderId, s.users.id))
    .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .where(where)
    .orderBy(desc(s.tripExpenses.createdAt));
}

export async function listSettlementOpsCompletionSummaries(settlementIds: number[]) {
  const ids = [...new Set(
    settlementIds
      .filter((value) => Number.isInteger(value) && value > 0),
  )];
  if (ids.length === 0) return [];

  const settlements = await db
    .select({
      settlementId: s.advanceSettlements.id,
      forwarderId: s.advanceSettlements.forwarderId,
    })
    .from(s.advanceSettlements)
    .where(inArray(s.advanceSettlements.id, ids));
  if (settlements.length === 0) return [];

  const linkedTrips = await db
    .select({
      settlementId: s.settlementExpenses.settlementId,
      forwarderId: s.advanceSettlements.forwarderId,
      tripId: s.tripExpenses.tripId,
    })
    .from(s.settlementExpenses)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
    .innerJoin(s.tripExpenses, eq(s.tripExpenses.id, s.settlementExpenses.tripExpenseId))
    .where(inArray(s.settlementExpenses.settlementId, ids));

  const settlementTripKeys = new Map<number, Set<string>>();
  for (const row of linkedTrips) {
    const key = `${row.forwarderId}:${row.tripId}`;
    const current = settlementTripKeys.get(row.settlementId);
    if (current) current.add(key);
    else settlementTripKeys.set(row.settlementId, new Set([key]));
  }

  const tripIds = [...new Set(linkedTrips.map((row) => row.tripId))];
  if (tripIds.length === 0) {
    return settlements.map((settlement) => ({
      settlementId: settlement.settlementId,
      opsCompletion: {
        tripCount: 0,
        completedGroupCount: 0,
        totalGroupCount: 0,
        trips: [],
      } satisfies SettlementOpsCompletionSummary,
    }));
  }

  const [scopeRows, expenseRows, containerRows] = await Promise.all([
    db.select({
      tripId: s.tripExpenseCompletionScopes.tripId,
      tripContainerId: s.tripExpenseCompletionScopes.tripContainerId,
      status: s.tripExpenseCompletionScopes.status,
    })
      .from(s.tripExpenseCompletionScopes)
      .where(inArray(s.tripExpenseCompletionScopes.tripId, tripIds)),
    db.select({
      forwarderId: s.tripExpenses.forwarderId,
      tripId: s.tripExpenses.tripId,
      tripCode: s.trips.tripCode,
      departureDate: s.trips.departureDate,
      tripContainerId: s.tripExpenses.tripContainerId,
      containerNumber: sql<string | null>`COALESCE(${s.tripContainers.containerNumber}, ${s.tripExpenses.containerNumber})`.as('resolved_container_number'),
    })
      .from(s.tripExpenses)
      .leftJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
      .leftJoin(s.tripContainers, eq(s.tripContainers.id, s.tripExpenses.tripContainerId))
      .where(inArray(s.tripExpenses.tripId, tripIds)),
    db.select({
      tripId: s.tripContainers.tripId,
      tripContainerId: s.tripContainers.id,
      containerNumber: s.tripContainers.containerNumber,
    })
      .from(s.tripContainers)
      .where(inArray(s.tripContainers.tripId, tripIds)),
  ]);

  const relevantTripKeys = new Set<string>(linkedTrips.map((row) => `${row.forwarderId}:${row.tripId}`));
  const scopeByGroup = new Map<string, 'IN_PROGRESS' | 'COMPLETED'>(
    scopeRows.map((row) => [
      `${row.tripId}:${row.tripContainerId ?? 'general'}`,
      row.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
    ] as const),
  );

  const tripSummaryByKey = new Map<string, {
    tripId: number;
    tripCode: string | null;
    departureDate: string | null;
    groups: Map<string, SettlementOpsCompletionGroup>;
  }>();

  for (const expense of expenseRows) {
    if (expense.forwarderId == null) continue;
    const tripKey = `${expense.forwarderId}:${expense.tripId}`;
    if (!relevantTripKeys.has(tripKey)) continue;

    let tripSummary = tripSummaryByKey.get(tripKey);
    if (!tripSummary) {
      tripSummary = {
        tripId: expense.tripId,
        tripCode: expense.tripCode ?? null,
        departureDate: expense.departureDate ?? null,
        groups: new Map(),
      };
      tripSummaryByKey.set(tripKey, tripSummary);
    }

    const groupKey = `${expense.tripId}:${expense.tripContainerId ?? 'general'}`;
    const normalizedContainerNumber = expense.containerNumber?.trim() || null;
    const existingGroup = tripSummary.groups.get(groupKey);
    if (existingGroup) {
      existingGroup.expenseCount += 1;
      if (!existingGroup.containerNumber && normalizedContainerNumber) {
        existingGroup.containerNumber = normalizedContainerNumber;
      }
      continue;
    }

    tripSummary.groups.set(groupKey, {
      tripContainerId: expense.tripContainerId,
      containerNumber: normalizedContainerNumber,
      expenseCount: 1,
      status: scopeByGroup.get(groupKey) ?? 'IN_PROGRESS',
    });
  }

  // A zero-expense container is still a real Ops scope. Surface every
  // container plus the general scope so Accounting can see what is still being
  // entered instead of learning about a scope only after its first expense.
  for (const tripKey of relevantTripKeys) {
    const tripSummary = tripSummaryByKey.get(tripKey);
    if (!tripSummary) continue;

    for (const container of containerRows) {
      if (container.tripId !== tripSummary.tripId) continue;
      const groupKey = `${container.tripId}:${container.tripContainerId}`;
      if (tripSummary.groups.has(groupKey)) continue;
      tripSummary.groups.set(groupKey, {
        tripContainerId: container.tripContainerId,
        containerNumber: container.containerNumber?.trim() || null,
        expenseCount: 0,
        status: scopeByGroup.get(groupKey) ?? 'IN_PROGRESS',
      });
    }

    const generalKey = `${tripSummary.tripId}:general`;
    if (!tripSummary.groups.has(generalKey)) {
      tripSummary.groups.set(generalKey, {
        tripContainerId: null,
        containerNumber: null,
        expenseCount: 0,
        status: scopeByGroup.get(generalKey) ?? 'IN_PROGRESS',
      });
    }
  }

  return settlements.map((settlement) => {
    const tripKeys = [...(settlementTripKeys.get(settlement.settlementId) ?? new Set<string>())];
    const trips = tripKeys
      .map((key) => tripSummaryByKey.get(key))
      .filter((trip): trip is NonNullable<typeof trip> => Boolean(trip))
      .map((trip) => {
        const groups = [...trip.groups.values()].sort((left, right) => {
          if (left.tripContainerId == null && right.tripContainerId != null) return 1;
          if (left.tripContainerId != null && right.tripContainerId == null) return -1;
          const leftLabel = left.containerNumber ?? '';
          const rightLabel = right.containerNumber ?? '';
          return leftLabel.localeCompare(rightLabel, 'vi');
        });
        const completedGroupCount = groups.filter((group) => group.status === 'COMPLETED').length;
        return {
          tripId: trip.tripId,
          tripCode: trip.tripCode,
          departureDate: trip.departureDate,
          completedGroupCount,
          totalGroupCount: groups.length,
          groups,
        } satisfies SettlementOpsCompletionTrip;
      })
      .sort((left, right) => {
        const leftDate = left.departureDate ?? '';
        const rightDate = right.departureDate ?? '';
        if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
        return (left.tripCode ?? '').localeCompare(right.tripCode ?? '', 'vi');
      });

    const completedGroupCount = trips.reduce((sum, trip) => sum + trip.completedGroupCount, 0);
    const totalGroupCount = trips.reduce((sum, trip) => sum + trip.totalGroupCount, 0);

    return {
      settlementId: settlement.settlementId,
      opsCompletion: {
        tripCount: trips.length,
        completedGroupCount,
        totalGroupCount,
        trips,
      } satisfies SettlementOpsCompletionSummary,
    };
  });
}

// ─── Trip Expense Photos ──────────────────────────────────────────────────────

export async function addExpensePhoto(tripExpenseId: number, storageKey: string, uploadedBy: number | null) {
  const [inserted] = await db.insert(s.tripExpensePhotos).values({
    tripExpenseId,
    storageKey,
    uploadedBy,
  }).returning();
  return inserted;
}

export async function getExpensePhotos(tripExpenseId: number) {
  return db.select({
    id: s.tripExpensePhotos.id,
    storageKey: s.tripExpensePhotos.storageKey,
    uploadedAt: s.tripExpensePhotos.uploadedAt,
  }).from(s.tripExpensePhotos)
    .where(eq(s.tripExpensePhotos.tripExpenseId, tripExpenseId))
    .orderBy(desc(s.tripExpensePhotos.uploadedAt));
}

/**
 * N1 ownership precheck for the forwarder expense-photo endpoints. Returns the
 * expense id when `tripExpenses.forwarderId === forwarderId`, else null. A NULL
 * forwarderId (accountant/manager-created) never matches a forwarder. GET-list
 * and POST gate on this so an unowned expense yields 404 — not 403 — which
 * removes the photo-id existence oracle on a security-sensitive path.
 */
export async function getForwarderOwnedExpenseId(
  expenseId: number,
  forwarderId: number,
): Promise<number | null> {
  const [row] = await db.select({ id: s.tripExpenses.id })
    .from(s.tripExpenses)
    .where(and(eq(s.tripExpenses.id, expenseId), eq(s.tripExpenses.forwarderId, forwarderId)))
    .limit(1);
  return row?.id ?? null;
}

export async function deleteExpensePhoto(photoId: number, forwarderId: number) {
  // Verify the photo belongs to an expense owned by this forwarder. Unowned and
  // not-found both return null → route maps to 404 (N1: no existence oracle).
  // (NULL forwarderId → accountant-created → null !== forwarderId → null.)
  const [photo] = await db.select({
    id: s.tripExpensePhotos.id,
    storageKey: s.tripExpensePhotos.storageKey,
    forwarderId: s.tripExpenses.forwarderId,
  }).from(s.tripExpensePhotos)
    .innerJoin(s.tripExpenses, eq(s.tripExpensePhotos.tripExpenseId, s.tripExpenses.id))
    .where(eq(s.tripExpensePhotos.id, photoId))
    .limit(1);
  if (!photo || photo.forwarderId !== forwarderId) return null;
  await db.delete(s.tripExpensePhotos).where(eq(s.tripExpensePhotos.id, photoId));
  return { storageKey: photo.storageKey };
}

export async function listActiveSuppliersForForwarder() {
  return db
    .select({ id: s.suppliers.id, name: s.suppliers.name, contactPerson: s.suppliers.contactPerson, phone: s.suppliers.phone })
    .from(s.suppliers)
    .where(and(isNull(s.suppliers.deletedAt), eq(s.suppliers.status, 'ACTIVE')));
}
