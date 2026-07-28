/**
 * Shared validation logic for advance settlements.
 * Used by both preview (settlement-export.service) and create (advance.service)
 * to avoid duplication and ensure consistent error messages.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, inArray, notInArray, isNull, ne, sql } from 'drizzle-orm';

/** Minimal type that accepts both `db` and `tx` (transaction). */
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Error class ────────────────────────────────────────────────────────────

export class AdvanceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'AdvanceError';
  }
}

// ─── Shared validation ──────────────────────────────────────────────────────

export interface ValidatedSettlementInputs {
  advanceRequests: typeof s.advanceRequests.$inferSelect[];
  tripExpenses: typeof s.tripExpenses.$inferSelect[];
}

export async function assertCurrentForwarderExpenseAssignments(opts: {
  dbOrTx: DbOrTx;
  forwarderId: number;
  tripExpenseIds: number[];
  lock?: 'share' | 'update';
}): Promise<void> {
  const { dbOrTx, forwarderId, tripExpenseIds, lock = 'share' } = opts;
  if (tripExpenseIds.length === 0) return;
  const uniqueExpenseIds = [...new Set(tripExpenseIds)];
  const currentAssignments = await dbOrTx.select({
    tripExpenseId: s.tripExpenses.id,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
    .innerJoin(s.userShipmentLinks, and(
      eq(s.userShipmentLinks.shipmentId, s.trips.shipmentId),
      eq(s.userShipmentLinks.userId, forwarderId),
    ))
    .where(inArray(s.tripExpenses.id, uniqueExpenseIds))
    .for(lock, { of: s.userShipmentLinks });
  const assignedExpenseIds = new Set(currentAssignments.map((row) => row.tripExpenseId));
  const unassignedExpenseId = uniqueExpenseIds.find((id) => !assignedExpenseIds.has(id));
  if (unassignedExpenseId !== undefined) {
    throw new AdvanceError(400, `Chi phí #${unassignedExpenseId} không còn thuộc lô hàng được giao`);
  }
}

/**
 * Validate advance requests and trip expenses for a settlement.
 * Works with both `db` (preview) and `tx` (create inside transaction).
 *
 * When `checkAlreadyLinked` is true (create path), also verifies that
 * none of the resources are already committed to another non-rejected settlement.
 */
export async function validateSettlementInputs(opts: {
  dbOrTx: DbOrTx;
  forwarderId: number;
  advanceRequestIds: number[];
  tripExpenseIds?: number[];
  checkAlreadyLinked?: boolean;
  excludeSettlementId?: number;
  requireCurrentAssignment?: boolean;
}): Promise<{ advanceRequests: typeof s.advanceRequests.$inferSelect[]; tripExpenses: typeof s.tripExpenses.$inferSelect[] }> {
  const {
    dbOrTx,
    forwarderId,
    advanceRequestIds,
    tripExpenseIds,
    checkAlreadyLinked,
    excludeSettlementId,
    requireCurrentAssignment = false,
  } = opts;

  // Serialize eligibility checks for the same business resources. Active-link
  // uniqueness spans a link table and settlement status, so PostgreSQL cannot
  // express it as a simple partial unique index.
  if (checkAlreadyLinked) {
    for (const id of [...new Set(advanceRequestIds)].sort((a, b) => a - b)) {
      await dbOrTx.execute(sql`SELECT pg_advisory_xact_lock(6101, ${id})`);
    }
    for (const id of [...new Set(tripExpenseIds ?? [])].sort((a, b) => a - b)) {
      await dbOrTx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${id})`);
    }
  }

  // 1. Validate advance requests exist
  const requests = await dbOrTx.select()
    .from(s.advanceRequests)
    .where(inArray(s.advanceRequests.id, advanceRequestIds));

  if (requests.length !== advanceRequestIds.length) {
    throw new AdvanceError(400, 'Một hoặc nhiều yêu cầu tạm ứng không tồn tại');
  }

  for (const req of requests) {
    if (req.requesterId !== forwarderId) {
      throw new AdvanceError(400, `Yêu cầu tạm ứng #${req.id} không thuộc về bạn`);
    }
    if (req.status !== 'APPROVED') {
      throw new AdvanceError(400, `Yêu cầu tạm ứng #${req.id} chưa được duyệt`);
    }
  }

  // 2. Check already-linked advance requests (create only)
  if (checkAlreadyLinked) {
    const activeLinkConditions = [
      inArray(s.advanceSettlementRequests.advanceRequestId, advanceRequestIds),
      notInArray(s.advanceSettlements.status, ['REJECTED']),
    ];
    if (excludeSettlementId !== undefined) activeLinkConditions.push(ne(s.advanceSettlements.id, excludeSettlementId));
    const existingLinks = await dbOrTx.select({ advanceRequestId: s.advanceSettlementRequests.advanceRequestId })
      .from(s.advanceSettlementRequests)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.advanceSettlementRequests.settlementId))
      .where(and(...activeLinkConditions));
    if (existingLinks.length > 0) {
      const dupIds = existingLinks.map(l => l.advanceRequestId).join(', ');
      throw new AdvanceError(400, `Yêu cầu tạm ứng đã được liên kết với phiếu thanh toán khác: ${dupIds}`);
    }
  }

  // 3. Validate trip expenses (if provided)
  let expenseRows: typeof s.tripExpenses.$inferSelect[] = [];
  if (tripExpenseIds && tripExpenseIds.length > 0) {
    expenseRows = await dbOrTx.select()
      .from(s.tripExpenses)
      .where(inArray(s.tripExpenses.id, tripExpenseIds));

    if (expenseRows.length !== tripExpenseIds.length) {
      throw new AdvanceError(400, 'Một hoặc nhiều chi phí không tồn tại');
    }

    if (requireCurrentAssignment) {
      await assertCurrentForwarderExpenseAssignments({
        dbOrTx,
        forwarderId,
        tripExpenseIds,
        lock: checkAlreadyLinked ? 'update' : 'share',
      });
    }

    for (const exp of expenseRows) {
      if (exp.forwarderId !== forwarderId) {
        throw new AdvanceError(400, `Chi phí #${exp.id} không thuộc về bạn`);
      }
      if (exp.approvalStatus === 'REJECTED') {
        throw new AdvanceError(400, `Chi phí #${exp.id} đã bị từ chối`);
      }
      const scopeWhere = exp.tripContainerId == null
        ? and(eq(s.tripExpenseCompletionScopes.tripId, exp.tripId), isNull(s.tripExpenseCompletionScopes.tripContainerId))
        : eq(s.tripExpenseCompletionScopes.tripContainerId, exp.tripContainerId);
      const [scope] = await dbOrTx.select({ status: s.tripExpenseCompletionScopes.status })
        .from(s.tripExpenseCompletionScopes).where(scopeWhere).limit(1);
      if (scope?.status !== 'COMPLETED') {
        throw new AdvanceError(400, `Chi phí #${exp.id} chưa được Ops đánh dấu kê xong`);
      }
    }

    // 4. Check already-linked trip expenses (create only)
    if (checkAlreadyLinked) {
      const activeExpenseConditions = [
        inArray(s.settlementExpenses.tripExpenseId, tripExpenseIds),
        notInArray(s.advanceSettlements.status, ['REJECTED']),
      ];
      if (excludeSettlementId !== undefined) activeExpenseConditions.push(ne(s.advanceSettlements.id, excludeSettlementId));
      const alreadyLinked = await dbOrTx.select({ tripExpenseId: s.settlementExpenses.tripExpenseId })
        .from(s.settlementExpenses)
        .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
        .where(and(...activeExpenseConditions));
      if (alreadyLinked.length > 0) {
        const dupIds = alreadyLinked.map(l => l.tripExpenseId).join(', ');
        throw new AdvanceError(400, `Chi phí đã được liên kết với phiếu thanh toán khác: ${dupIds}`);
      }
    }
  }

  return { advanceRequests: requests, tripExpenses: expenseRows };
}
