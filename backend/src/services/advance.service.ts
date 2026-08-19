import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, desc, inArray, isNull, notInArray, ne, sql, count } from 'drizzle-orm';
import { NotificationType, TxnType, round2dp } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { emitNotification } from './notification.service';
import {
  AdvanceError,
  assertCurrentForwarderExpenseAssignments,
  validateSettlementInputs,
} from './settlement-validation';
import type { Tx } from './trip-shared';
import { getTripExpenseRequiredFieldError } from './forwarder.service';
import {
  resolveCustomerPaymentDueDate,
  type PaymentDatePolicy,
} from './business-calendar.service';
import { propagateExpenseApprovals } from './source-change.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import type { GovernanceApplyResult, GovernanceActionRow } from './governance-transition.service';
type DbLike = typeof db | Tx;

function assertExpectedVersion(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new AdvanceError(
      409,
      `${label} đã thay đổi (phiên bản hiện tại ${actual}); vui lòng tải lại trước khi tiếp tục`,
    );
  }
}

type ExpenseSnapshotSource = Pick<typeof s.tripExpenses.$inferSelect,
  'expenseType' | 'buyAmount' | 'sellAmount' | 'containerNumber' |
  'invoiceNumber' | 'invoiceDate' | 'declarationNumber' | 'note'>;

function expenseSnapshot(expense: ExpenseSnapshotSource): Record<string, unknown> {
  return {
    expenseType: expense.expenseType,
    buyAmount: expense.buyAmount,
    sellAmount: expense.sellAmount,
    containerNumber: expense.containerNumber,
    invoiceNumber: expense.invoiceNumber,
    invoiceDate: expense.invoiceDate,
    declarationNumber: expense.declarationNumber,
    note: expense.note,
  };
}

export async function generateSettlementCode(tx: Tx, now: Date = new Date()): Promise<string> {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `PT-${yy}${mm}`;

  await tx.execute(sql`SELECT pg_advisory_xact_lock(6001, hashtext(${prefix}))`);

  const [row] = await tx.select({ maxCode: sql<string | null>`max(${s.advanceSettlements.code})` })
    .from(s.advanceSettlements)
    .where(sql`${s.advanceSettlements.code} like ${prefix + '%'}`);

  let seq = 1;
  if (row?.maxCode) {
    const lastSeq = parseInt(row.maxCode.split('-').pop() || '0', 10);
    seq = lastSeq + 1;
  }

  return `${prefix}-${String(seq).padStart(4, '0')}`;
}


// Re-export AdvanceError for backward compatibility with route imports
export { AdvanceError } from './settlement-validation';

type EnrichableRow = {
  requesterId?: number | null;
  approvedBy?: number | null;
  forwarderId?: number | null;
  checkedBy?: number | null;
};

type EnrichedWithNames<T> = T & {
  requesterName: string | null;
  approverName: string | null;
  forwarderName: string | null;
  checkerName: string | null;
};

async function enrichWithNames<T extends EnrichableRow>(
  rows: T[],
  executor: DbLike = db,
): Promise<EnrichedWithNames<T>[]> {
  if (rows.length === 0) return rows as EnrichedWithNames<T>[];
  const userIds = new Set<number>();
  rows.forEach(r => {
    if (r.requesterId) userIds.add(r.requesterId);
    if (r.approvedBy) userIds.add(r.approvedBy);
    if (r.forwarderId) userIds.add(r.forwarderId);
    if (r.checkedBy) userIds.add(r.checkedBy);
  });
  if (userIds.size === 0) return rows as EnrichedWithNames<T>[];
  const users = await executor.select({ id: s.users.id, fullName: s.users.fullName })
    .from(s.users).where(inArray(s.users.id, [...userIds]));
  const nameMap = new Map<number | null | undefined, string | null>(users.map(u => [u.id, u.fullName]));
  return rows.map(r => ({
    ...r,
    requesterName: nameMap.get(r.requesterId) ?? null,
    approverName: nameMap.get(r.approvedBy) ?? null,
    forwarderName: nameMap.get(r.forwarderId) ?? null,
    checkerName: nameMap.get(r.checkedBy) ?? null,
  }));
}

async function enrichSettlementWithRequests(
  settlement: typeof s.advanceSettlements.$inferSelect & Record<string, unknown>,
  executor: DbLike = db,
) {
  const links = await executor.select()
    .from(s.advanceSettlementRequests)
    .where(eq(s.advanceSettlementRequests.settlementId, settlement.id));
  const requestIds = links.map(l => l.advanceRequestId);
  let linkedRequests: typeof s.advanceRequests.$inferSelect[] = [];
  if (requestIds.length > 0) {
    linkedRequests = await executor.select()
      .from(s.advanceRequests)
      .where(inArray(s.advanceRequests.id, requestIds));
  }

  // Also fetch linked trip expenses with breakdown by type + print form fields
  const expenseLinks = await executor.select()
    .from(s.settlementExpenses)
    .where(eq(s.settlementExpenses.settlementId, settlement.id));
  const expenseIds = expenseLinks.map(l => l.tripExpenseId);
  let linkedExpenses: {
    id: number;
    tripId: number;
    expenseType: string;
    buyAmount: string;
    sellAmount: string;
    containerNumber: string | null;
    invoiceNumber: string | null;
    note: string | null;
    createdAt: Date;
    tripCode: string | null;
    departureDate: string | null;
    customerName: string | null;
  }[] = [];
  if (expenseIds.length > 0) {
    linkedExpenses = await executor.select({
      id: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      expenseType: s.tripExpenses.expenseType,
      buyAmount: s.tripExpenses.buyAmount,
      sellAmount: s.tripExpenses.sellAmount,
      containerNumber: sql<string | null>`COALESCE(${s.tripContainers.containerNumber}, ${s.tripExpenses.containerNumber})`.as('resolved_container_number'),
      invoiceNumber: s.tripExpenses.invoiceNumber,
      note: s.tripExpenses.note,
      createdAt: s.tripExpenses.createdAt,
      tripCode: s.trips.tripCode,
      departureDate: s.trips.departureDate,
      customerName: s.customers.name,
    }).from(s.tripExpenses)
      .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
      .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
      .leftJoin(s.tripContainers, eq(s.tripExpenses.tripContainerId, s.tripContainers.id))
      .where(inArray(s.tripExpenses.id, expenseIds));
    const linkByExpense = new Map(expenseLinks.map(link => [link.tripExpenseId, link]));
    linkedExpenses = linkedExpenses.map(expense => {
      const link = linkByExpense.get(expense.id);
      const snapshot = (link?.adjustedSnapshot ?? {}) as Record<string, unknown>;
      return Object.assign(expense, snapshot, {
        buyAmount: String(snapshot.buyAmount ?? link?.adjustedBuyAmount ?? expense.buyAmount),
        sellAmount: String(snapshot.sellAmount ?? expense.sellAmount),
        submittedBuyAmount: link?.originalBuyAmount ?? null,
        submittedSellAmount: link?.submittedSellAmount ?? null,
        adjustmentReason: link?.adjustmentReason ?? null,
        adjustedAt: link?.adjustedAt ?? null,
      });
    });
  }

  return { ...settlement, linkedRequests, linkedExpenses };
}

export async function createAdvanceRequest(
  requesterId: number,
  data: { amount: number; reason: string },
  transaction?: Tx,
) {
  const executor = transaction ?? db;
  const [inserted] = await executor.insert(s.advanceRequests).values({
    requesterId,
    amount: String(data.amount),
    reason: data.reason,
    status: 'PENDING',
  }).returning();
  const [enriched] = await enrichWithNames([inserted], executor);
  return enriched;
}

export async function listAdvanceRequests(filters?: {
  requesterId?: number;
  status?: string;
  excludeLinkedToActiveSettlement?: boolean;
}) {
  const conditions = [];
  if (filters?.requesterId) conditions.push(eq(s.advanceRequests.requesterId, filters.requesterId));
  if (filters?.status) conditions.push(eq(s.advanceRequests.status, filters.status as ('PENDING' | 'APPROVED' | 'REJECTED')));
  if (filters?.excludeLinkedToActiveSettlement) {
    const claimedRequestIds = db.select({ id: s.advanceSettlementRequests.advanceRequestId })
      .from(s.advanceSettlementRequests)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.advanceSettlementRequests.settlementId))
      .where(notInArray(s.advanceSettlements.status, ['REJECTED', 'REVERSED']));
    conditions.push(notInArray(s.advanceRequests.id, claimedRequestIds));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select()
    .from(s.advanceRequests)
    .where(where)
    .orderBy(desc(s.advanceRequests.createdAt));
  return enrichWithNames(rows);
}

export async function getAdvanceRequestCounts(requesterId?: number) {
  const conditions = [];
  if (requesterId) conditions.push(eq(s.advanceRequests.requesterId, requesterId));

  const rows = await db.select({
    status: s.advanceRequests.status,
    count: count(),
  }).from(s.advanceRequests)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(s.advanceRequests.status);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

export async function getAdvanceRequest(id: number) {
  const [row] = await db.select()
    .from(s.advanceRequests)
    .where(eq(s.advanceRequests.id, id));
  if (!row) return null;
  const [enriched] = await enrichWithNames([row]);
  return enriched;
}

export async function requestAdvanceRequestApprovalGovernance(input: {
  advanceRequestId: number;
  expectedVersion: number;
  reason: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('ADVANCE_REQUEST_APPROVAL', input.makerRole);
  const reason = input.reason.trim();
  if (!reason) {
    throw new AdvanceError(400, 'Lý do là bắt buộc');
  }

  const execute = async (tx: Tx) => {
    const [request] = await tx.select()
      .from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, input.advanceRequestId))
      .limit(1)
      .for('update');
    if (!request) throw new AdvanceError(404, 'Advance request not found');
    assertExpectedVersion(request.version, input.expectedVersion, 'Yêu cầu tạm ứng');
    if (request.status !== 'PENDING') {
      throw new AdvanceError(409, `Cannot submit approval for request with status ${request.status}`);
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'ADVANCE_REQUEST',
      subjectId: request.id,
      subjectKey: `advance-request:${request.id}:approve`,
      actionKind: 'ADVANCE_REQUEST_APPROVAL',
      reason,
      originalVersion: request.version,
      beforeSnapshot: {
        requesterId: request.requesterId,
        amount: request.amount,
        reason: request.reason,
        status: request.status,
        version: request.version,
      },
      afterSnapshot: {
        status: 'APPROVED',
      },
      deltaSnapshot: {
        amount: request.amount,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };

  return runInTx(input.transaction, execute);
}

export async function requestAdvanceRequestRejectionGovernance(input: {
  advanceRequestId: number;
  expectedVersion: number;
  reason: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('ADVANCE_REQUEST_REJECTION', input.makerRole);
  const reason = input.reason.trim();
  if (!reason) throw new AdvanceError(400, 'Lý do từ chối là bắt buộc');

  const execute = async (tx: Tx) => {
    const [request] = await tx.select()
      .from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, input.advanceRequestId))
      .limit(1)
      .for('update');
    if (!request) throw new AdvanceError(404, 'Advance request not found');
    assertExpectedVersion(request.version, input.expectedVersion, 'Yêu cầu tạm ứng');
    if (request.status !== 'PENDING') {
      throw new AdvanceError(409, `Cannot submit rejection for request with status ${request.status}`);
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'ADVANCE_REQUEST',
      subjectId: request.id,
      subjectKey: `advance-request:${request.id}:reject`,
      actionKind: 'ADVANCE_REQUEST_REJECTION',
      reason,
      originalVersion: request.version,
      beforeSnapshot: {
        requesterId: request.requesterId,
        amount: request.amount,
        reason: request.reason,
        status: request.status,
        version: request.version,
      },
      afterSnapshot: { status: 'REJECTED' },
      deltaSnapshot: { amount: request.amount },
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };

  return runInTx(input.transaction, execute);
}

export async function approveAdvanceRequest(
  id: number,
  approvedBy: number,
  expectedVersion?: number,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [request] = await tx.select()
      .from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, id))
      .for('update');
    if (!request) throw new AdvanceError(404, 'Advance request not found');
    const version = expectedVersion ?? request.version;
    assertExpectedVersion(request.version, version, 'Yêu cầu tạm ứng');
    if (request.status !== 'PENDING') {
      throw new AdvanceError(409, `Cannot approve request with status ${request.status}`);
    }
    if (request.requesterId === approvedBy) {
      throw new AdvanceError(403, 'Không thể duyệt yêu cầu tạm ứng của chính mình');
    }

    const [user] = await tx.select({ fullName: s.users.fullName })
      .from(s.users)
      .where(eq(s.users.id, request.requesterId));
    const requesterName = user?.fullName?.trim() || 'Nhân viên giao nhận';

    const now = new Date();
    const [updated] = await tx.update(s.advanceRequests)
      .set({
        status: 'APPROVED',
        approvedBy,
        approvedAt: now,
        updatedAt: now,
        version: sql`${s.advanceRequests.version} + 1`,
      })
      .where(and(
        eq(s.advanceRequests.id, id),
        eq(s.advanceRequests.status, 'PENDING'),
        eq(s.advanceRequests.version, version),
      ))
      .returning();
    if (!updated) throw new AdvanceError(409, 'Request was modified by another operation');

    await LedgerService.postEntry(tx, {
      txnType: TxnType.OPS_ADVANCE,
      txnId: request.id,
      entityType: 'FORWARDER',
      entityId: request.requesterId,
      debit: 0,
      credit: Number(request.amount),
      note: `Tạm ứng cho ${requesterName}`,
    });

    const [enriched] = await enrichWithNames([updated]);
    return enriched;
  };

  return runInTx(transaction, execute);
}

export async function rejectAdvanceRequest(
  id: number,
  rejectedBy: number,
  expectedVersion?: number,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [request] = await tx.select()
      .from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, id))
      .for('update');
    if (!request) throw new AdvanceError(404, 'Advance request not found');
    const version = expectedVersion ?? request.version;
    assertExpectedVersion(request.version, version, 'Yêu cầu tạm ứng');
    if (request.status !== 'PENDING') {
      throw new AdvanceError(409, `Cannot reject request with status ${request.status}`);
    }

    const now = new Date();
    const [updated] = await tx.update(s.advanceRequests)
      .set({
        status: 'REJECTED',
        approvedBy: rejectedBy,
        approvedAt: now,
        updatedAt: now,
        version: sql`${s.advanceRequests.version} + 1`,
      })
      .where(and(
        eq(s.advanceRequests.id, id),
        eq(s.advanceRequests.status, 'PENDING'),
        eq(s.advanceRequests.version, version),
      ))
      .returning();
    if (!updated) throw new AdvanceError(409, 'Request was modified by another operation');

    const [enriched] = await enrichWithNames([updated]);
    return enriched;
  };

  return runInTx(transaction, execute);
}

export async function applyAdvanceRequestGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (!['ADVANCE_REQUEST_APPROVAL', 'ADVANCE_REQUEST_REJECTION'].includes(action.actionKind)
    || action.subjectType !== 'ADVANCE_REQUEST'
    || action.subjectId == null) {
    throw new AdvanceError(409, 'Loại yêu cầu không thuộc quyết định tạm ứng');
  }

  const decided = action.actionKind === 'ADVANCE_REQUEST_REJECTION'
    ? await rejectAdvanceRequest(action.subjectId, action.approverId!, action.originalVersion, tx)
    : await approveAdvanceRequest(action.subjectId, action.approverId!, action.originalVersion, tx);

  return {
    applicationResult: {
      subjectType: 'ADVANCE_REQUEST',
      subjectId: decided.id,
      status: decided.status,
      resultingVersion: decided.version,
    },
  };
}

export async function createAdvanceSettlement(
  forwarderId: number,
  data: { totalExpenseAmount?: number; refundAmount?: number; note?: string; advanceRequestIds: number[]; tripExpenseIds?: number[] },
  transaction?: Tx,
) {
  if (!data.advanceRequestIds || data.advanceRequestIds.length === 0) {
    throw new AdvanceError(400, 'At least one advance request ID is required');
  }

  const execute = async (tx: Tx) => {
    // Serialize claims before validation. After a concurrent creator commits,
    // READ COMMITTED makes the subsequent validation see its new links.
    for (const requestId of [...data.advanceRequestIds].sort((a, b) => a - b)) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6101, ${requestId})`);
    }
    const requestedExpenseIds = [...(data.tripExpenseIds ?? [])].sort((a, b) => a - b);
    for (const expenseId of requestedExpenseIds) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    }
    if (requestedExpenseIds.length > 0) {
      // Match forwarder expense mutation lock order:
      // expense resource → assignment row → completion scope.
      await assertCurrentForwarderExpenseAssignments({
        dbOrTx: tx,
        forwarderId,
        tripExpenseIds: requestedExpenseIds,
        lock: 'update',
      });
      const scopes = await tx.select({
        tripId: s.tripExpenses.tripId,
        tripContainerId: s.tripExpenses.tripContainerId,
      }).from(s.tripExpenses).where(inArray(s.tripExpenses.id, requestedExpenseIds));
      const scopeKeys = [...new Set(scopes.map(scope => scope.tripContainerId ?? -scope.tripId))].sort((a, b) => a - b);
      for (const scopeKey of scopeKeys) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
      }
    }
    // Shared validation: existence, ownership, status, and already-linked checks
    const { advanceRequests: advanceRequestRows, tripExpenses: tripExpenseRows } =
      await validateSettlementInputs({
        dbOrTx: tx,
        forwarderId,
        advanceRequestIds: data.advanceRequestIds,
        tripExpenseIds: data.tripExpenseIds,
        checkAlreadyLinked: true,
        // The assignment was validated and locked before the completion scope
        // to avoid a lock-order inversion with forwarder expense mutations.
        requireCurrentAssignment: false,
      });

    // Auto-calculate total from selected expenses
    let totalExpenseAmount = data.totalExpenseAmount ?? 0;
    if (tripExpenseRows.length > 0) {
      totalExpenseAmount = tripExpenseRows.reduce((sum, exp: typeof s.tripExpenses.$inferSelect) => sum + Number(exp.buyAmount), 0);
    }

    const code = await generateSettlementCode(tx);

    const [settlement] = await tx.insert(s.advanceSettlements).values({
      code,
      forwarderId,
      totalExpenseAmount: String(totalExpenseAmount),
      refundAmount: String(data.refundAmount ?? 0),
      status: 'PENDING',
      note: data.note ?? null,
    }).returning();

    await tx.insert(s.advanceSettlementRequests).values(
      data.advanceRequestIds.map(advanceRequestId => ({
        settlementId: settlement.id,
        advanceRequestId,
        allocatedAmount: advanceRequestRows.find((request) => request.id === advanceRequestId)!.amount,
      })),
    );

    // Link trip expenses to settlement
    if (data.tripExpenseIds && data.tripExpenseIds.length > 0) {
      await tx.insert(s.settlementExpenses).values(
        tripExpenseRows.map(expense => ({
          settlementId: settlement.id,
          tripExpenseId: expense.id,
          originalBuyAmount: expense.buyAmount,
          adjustedBuyAmount: expense.buyAmount,
          submittedSellAmount: expense.sellAmount,
          originalSnapshot: expenseSnapshot(expense),
          adjustedSnapshot: expenseSnapshot(expense),
        })),
      );
    }

    return enrichSettlementWithRequests(settlement, tx);
  };

  return runInTx(transaction, execute);
}

/**
 * O2C "Ranh giới Tạm ứng" (PRD Bước 4, O2C Flow.md:72 / O2C dev-rev1.md:87):
 * "Ngay khi phí chi hộ được Kế toán duyệt, hệ thống tự động sinh bút toán cấn
 * trừ vào dư nợ tạm ứng của cá nhân Ops/Lái xe."
 *
 * Fires on every trip-expense approval (called from propagateExpenseApproval in
 * source-change.service.ts). Auto-creates an APPROVED settlement that FIFO-links
 * the forwarder's outstanding advances and posts the OPS_SETTLEMENT offset
 * — no second human approval (PRD: "tự động sinh"). The four required pieces for
 * getOutstandingAdvanceBalance to drop are created: APPROVED settlement +
 * advance-request link + expense link + ledger debit.
 *
 * Guarded so it never double-posts:
 *  - skips when the expense is already linked to a non-dead settlement (the
 *    manual batch flow approves expenses via the same hook);
 *  - skips unless settlementMethod = OPS_ADVANCE with a forwarderId
 *    (COMPANY_DIRECT expenses were never fronted by Ops; drivers have no
 *    advances today — PRD's "Lái xe" is forwarder-scoped here);
 *  - skips when the forwarder has no outstanding advance (nothing to offset).
 *
 * Idempotent: re-running on an already-offset expense finds the existing link
 * and returns early.
 */
export async function autoOffsetExpenseApproval(tx: Tx, expenseId: number): Promise<void> {
  const [initialExpense] = await tx.select()
    .from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);

  if (!initialExpense) return;
  if (initialExpense.approvalStatus !== 'APPROVED') return;
  if (initialExpense.settlementMethod !== 'OPS_ADVANCE') return;
  const initialForwarderId = initialExpense.forwarderId ?? initialExpense.createdBy;
  if (!initialForwarderId) return;

  // Different expenses for the same Ops balance must allocate serially so they
  // cannot both consume the same residual advance snapshot.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6202, ${initialForwarderId})`);

  // Share the established manual-settlement lock order: advance requests first,
  // then expense. This closes races between automatic and governed settlement
  // creation without introducing a request/expense lock inversion.
  const candidateRequestIds = await tx.select({ id: s.advanceRequests.id })
    .from(s.advanceRequests)
    .where(and(
      eq(s.advanceRequests.requesterId, initialForwarderId),
      eq(s.advanceRequests.status, 'APPROVED'),
    ));
  for (const requestId of candidateRequestIds.map((row) => row.id).sort((a, b) => a - b)) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6101, ${requestId})`);
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);

  // Re-read every eligibility field and link only after all shared locks are
  // held. A stale pre-lock snapshot must never authorize a financial posting.
  const [expense] = await tx.select()
    .from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
  if (!expense) return;
  if (expense.approvalStatus !== 'APPROVED') return;
  if (expense.settlementMethod !== 'OPS_ADVANCE') return;
  const forwarderId = expense.forwarderId ?? expense.createdBy;
  if (!forwarderId || forwarderId !== initialForwarderId) return;
  const amount = round2dp(Number(expense.buyAmount));
  if (amount <= 0) return;

  // Double-post guard: skip if this expense is already linked to a non-dead
  // settlement (covers both the manual batch flow and a prior auto-offset run).
  const [existingLink] = await tx.select({ id: s.settlementExpenses.id })
    .from(s.settlementExpenses)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
    .where(and(
      eq(s.settlementExpenses.tripExpenseId, expenseId),
      notInArray(s.advanceSettlements.status, ['REJECTED', 'REVERSED']),
    ))
    .limit(1);
  if (existingLink) return;

  // FIFO-select approved advances and lock them before calculating residuals.
  const candidates = await tx.select({
    id: s.advanceRequests.id,
    amount: s.advanceRequests.amount,
    approvedAt: s.advanceRequests.approvedAt,
  }).from(s.advanceRequests)
    .where(and(
      eq(s.advanceRequests.requesterId, forwarderId),
      eq(s.advanceRequests.status, 'APPROVED'),
    ))
    .orderBy(desc(s.advanceRequests.approvedAt), s.advanceRequests.id)
    .for('update');

  const activeAllocations = candidates.length === 0
    ? []
    : await tx.select({
        advanceRequestId: s.advanceSettlementRequests.advanceRequestId,
        allocatedAmount: sql<string>`coalesce(sum(${s.advanceSettlementRequests.allocatedAmount}::numeric), 0)`,
      })
        .from(s.advanceSettlementRequests)
        .innerJoin(
          s.advanceSettlements,
          eq(s.advanceSettlementRequests.settlementId, s.advanceSettlements.id),
        )
        .where(and(
          inArray(s.advanceSettlementRequests.advanceRequestId, candidates.map((candidate) => candidate.id)),
          notInArray(s.advanceSettlements.status, ['REJECTED', 'REVERSED']),
        ))
        .groupBy(s.advanceSettlementRequests.advanceRequestId);
  const allocatedByRequest = new Map(
    activeAllocations.map((allocation) => [allocation.advanceRequestId, Number(allocation.allocatedAmount)]),
  );

  // FIFO by earliest approvedAt: sort ascending (DESC fetch then reverse, or
  // use asc). Use ascending order to consume oldest advances first.
  const available = candidates
    .map((candidate) => ({
      ...candidate,
      remainingAmount: round2dp(
        Number(candidate.amount) - (allocatedByRequest.get(candidate.id) ?? 0),
      ),
    }))
    .filter((candidate) => candidate.remainingAmount > 0)
    .sort((a, b) => {
      const ta = a.approvedAt ? new Date(a.approvedAt).getTime() : 0;
      const tb = b.approvedAt ? new Date(b.approvedAt).getTime() : 0;
      return ta - tb;
    });

  if (available.length === 0) return; // nothing to offset against — no-op

  const allocations: Array<{ advanceRequestId: number; allocatedAmount: number }> = [];
  let remainingExpenseAmount = amount;
  for (const req of available) {
    if (remainingExpenseAmount <= 0) break;
    const allocatedAmount = Math.min(req.remainingAmount, remainingExpenseAmount);
    allocations.push({ advanceRequestId: req.id, allocatedAmount });
    remainingExpenseAmount = round2dp(remainingExpenseAmount - allocatedAmount);
  }

  // An automatic settlement is atomic: if approved advances cannot fully cover
  // the expense, leave it for the governed manual flow instead of overdrawing.
  if (remainingExpenseAmount > 0) return;

  // Create the APPROVED auto-settlement (PRD: "tự động sinh" — no maker-checker).
  const code = await generateSettlementCode(tx);
  const [trip] = await tx.select({ tripCode: s.trips.tripCode })
    .from(s.trips).where(eq(s.trips.id, expense.tripId)).limit(1);
  const [settlement] = await tx.insert(s.advanceSettlements).values({
    code,
    forwarderId,
    totalExpenseAmount: String(amount),
    refundAmount: '0',
    status: 'APPROVED',
    autoOffsetExpenseId: expense.id,
    note: `Tự quyết toán khi duyệt chi hộ chuyến ${trip?.tripCode ?? expense.tripId} (O2C Bước 4)`,
    approvedAt: new Date(),
    updatedAt: new Date(),
  }).returning();

  await tx.insert(s.advanceSettlementRequests).values(
    allocations.map((allocation) => ({
      settlementId: settlement.id,
      advanceRequestId: allocation.advanceRequestId,
      allocatedAmount: String(allocation.allocatedAmount),
    })),
  );

  // Reuse the canonical expense snapshot for the link row.
  await tx.insert(s.settlementExpenses).values({
    settlementId: settlement.id,
    tripExpenseId: expense.id,
    originalBuyAmount: expense.buyAmount,
    adjustedBuyAmount: expense.buyAmount,
    submittedSellAmount: expense.sellAmount,
    originalSnapshot: expenseSnapshot(expense),
    adjustedSnapshot: expenseSnapshot(expense),
  });

  // Post the offset ledger entry — mirrors the manual settlement posting shape
  // (advance.service.ts:1166-1174) so the forwarder balance behaves identically.
  await LedgerService.postEntry(tx, {
    txnType: TxnType.OPS_SETTLEMENT,
    txnId: settlement.id,
    entityType: 'FORWARDER',
    entityId: forwarderId,
    debit: amount,
    credit: 0,
    note: `Tự quyết toán chi hộ chuyến ${trip?.tripCode ?? expense.tripId}`,
  });
}

export async function listAdvanceSettlements(filters?: { forwarderId?: number; status?: string }) {
  const conditions = [];
  if (filters?.forwarderId) conditions.push(eq(s.advanceSettlements.forwarderId, filters.forwarderId));
  if (filters?.status) conditions.push(eq(s.advanceSettlements.status, filters.status as ('PENDING' | 'CHECKED_BY_ACCOUNTANT' | 'APPROVED' | 'REJECTED' | 'REVERSED')));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select()
    .from(s.advanceSettlements)
    .where(where)
    .orderBy(desc(s.advanceSettlements.createdAt));

  const enriched = await enrichWithNames(rows);

  if (enriched.length > 0) {
    const settlementIds = enriched.map(s => s.id);

    const links = await db.select()
      .from(s.advanceSettlementRequests)
      .where(inArray(s.advanceSettlementRequests.settlementId, settlementIds));

    if (links.length > 0) {
      const requestIds = [...new Set(links.map(l => l.advanceRequestId))];
      const requests = await db.select()
        .from(s.advanceRequests)
        .where(inArray(s.advanceRequests.id, requestIds));

      const requestMap = new Map(requests.map(r => [r.id, r]));
      const linksBySettlement = new Map<number, typeof links>();

      for (const link of links) {
        if (!linksBySettlement.has(link.settlementId)) {
          linksBySettlement.set(link.settlementId, []);
        }
        linksBySettlement.get(link.settlementId)!.push(link);
      }

      for (const settlement of enriched) {
        const settlementLinks = linksBySettlement.get(settlement.id) || [];
        (settlement as typeof s.advanceSettlements.$inferSelect & {
          linkedRequests?: typeof s.advanceRequests.$inferSelect[];
        }).linkedRequests = settlementLinks
          .map(l => requestMap.get(l.advanceRequestId))
          .filter((r): r is typeof s.advanceRequests.$inferSelect => Boolean(r));
      }
    }

    // Attach linked trip expenses plus transport-plan context so the approval
    // list can render one decision row per trip. Batched across all settlements.
    const expenseLinks = await db.select()
      .from(s.settlementExpenses)
      .where(inArray(s.settlementExpenses.settlementId, settlementIds));
    if (expenseLinks.length > 0) {
      const expenseIds = [...new Set(expenseLinks.map(l => l.tripExpenseId))];
      const expenses = await db.select({
        id: s.tripExpenses.id,
        tripId: s.tripExpenses.tripId,
        expenseType: s.tripExpenses.expenseType,
        buyAmount: s.tripExpenses.buyAmount,
        containerNumber: sql<string | null>`COALESCE(${s.tripContainers.containerNumber}, ${s.tripExpenses.containerNumber})`.as('resolved_container_number'),
        note: s.tripExpenses.note,
        createdAt: s.tripExpenses.createdAt,
        tripCode: s.trips.tripCode,
        departureDate: s.trips.departureDate,
        customerName: s.customers.name,
        routeName: s.routes.name,
        tripContainerCount: s.trips.containerCount,
        expenseTypeName: s.forwarderExpenseTypes.name,
        truckPlate: s.trucks.licensePlate,
      }).from(s.tripExpenses)
        .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
        .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
        .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
        .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
        .leftJoin(s.tripContainers, eq(s.tripExpenses.tripContainerId, s.tripContainers.id))
        .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
        .where(inArray(s.tripExpenses.id, expenseIds));
      const expenseById = new Map(expenses.map(e => [e.id, e]));
      const bySettlement = new Map<number, typeof expenses>();
      for (const l of expenseLinks) {
        const rawExpense = expenseById.get(l.tripExpenseId);
        if (!rawExpense) continue;
        const snapshot = (l.adjustedSnapshot ?? {}) as Record<string, unknown>;
        const exp = Object.assign({}, rawExpense, snapshot, {
          buyAmount: String(snapshot.buyAmount ?? l.adjustedBuyAmount ?? rawExpense.buyAmount),
        });
        const arr = bySettlement.get(l.settlementId);
        if (arr) arr.push(exp); else bySettlement.set(l.settlementId, [exp]);
      }
      for (const settlement of enriched) {
        (settlement as typeof s.advanceSettlements.$inferSelect & {
          linkedExpenses?: typeof expenses;
        }).linkedExpenses = bySettlement.get(settlement.id) ?? [];
      }
    }
  }

  return enriched;
}

export type AdvanceSettlementRow = Awaited<ReturnType<typeof listAdvanceSettlements>>[number];

export interface PaginatedAdvanceSettlements {
  items: AdvanceSettlementRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Full-set status counts for the page's filter pills. */
  statusCounts: Record<string, number>;
  /** Full-set totals for the page's KPI strip. */
  totals: { totalExpenseAmount: number; pendingCount: number };
}

/**
 * Paginated + summarized wrapper over listAdvanceSettlements for the HTTP
 * list route. Callers that need the full array (admin ops, agent tools) keep
 * calling listAdvanceSettlements directly; page/limit here are always
 * bounded, and statusCounts/totals describe the whole filtered set.
 */
export async function listAdvanceSettlementsPaginated(filters: {
  forwarderId?: number;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedAdvanceSettlements> {
  const enriched = await listAdvanceSettlements(filters);
  const page = Math.max(1, Math.floor(filters.page || 1));
  const limit = Math.min(500, Math.max(1, Math.floor(filters.limit || 25)));
  const total = enriched.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const statusCounts: Record<string, number> = {};
  let totalExpenseAmount = 0;
  let pendingCount = 0;
  for (const s of enriched) {
    statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
    totalExpenseAmount += Number(s.totalExpenseAmount);
    if (s.status === 'PENDING') pendingCount++;
  }
  return {
    items: enriched.slice(start, start + limit),
    page,
    limit,
    total,
    totalPages,
    statusCounts,
    totals: { totalExpenseAmount, pendingCount },
  };
}

export async function getAdvanceSettlement(id: number, executor: DbLike = db) {
  const [row] = await executor.select()
    .from(s.advanceSettlements)
    .where(eq(s.advanceSettlements.id, id));
  if (!row) return null;
  const [enriched] = await enrichWithNames([row], executor);
  const detail = await enrichSettlementWithRequests(enriched, executor);
  const [blockedRequests, blockedExpenses, requestCandidates, expenseCandidates] = await Promise.all([
    executor.select({ id: s.advanceSettlementRequests.advanceRequestId })
      .from(s.advanceSettlementRequests)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.advanceSettlementRequests.settlementId))
      .where(and(ne(s.advanceSettlements.id, id), notInArray(s.advanceSettlements.status, ['REJECTED', 'REVERSED']))),
    executor.select({ id: s.settlementExpenses.tripExpenseId })
      .from(s.settlementExpenses)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
      .where(and(ne(s.advanceSettlements.id, id), notInArray(s.advanceSettlements.status, ['REJECTED', 'REVERSED']))),
    executor.select().from(s.advanceRequests).where(and(
      eq(s.advanceRequests.requesterId, row.forwarderId),
      eq(s.advanceRequests.status, 'APPROVED'),
    )).orderBy(desc(s.advanceRequests.createdAt)),
    executor.select({
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
      tripCode: s.trips.tripCode,
      departureDate: s.trips.departureDate,
      completionStatus: sql<string>`COALESCE((
        SELECT scope.status FROM trip_expense_completion_scopes scope
        WHERE scope.trip_id = ${s.tripExpenses.tripId}
          AND (scope.trip_container_id = ${s.tripExpenses.tripContainerId}
            OR (scope.trip_container_id IS NULL AND ${s.tripExpenses.tripContainerId} IS NULL))
        LIMIT 1
      ), 'IN_PROGRESS')`,
    }).from(s.tripExpenses)
      .leftJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
      .innerJoin(s.userShipmentLinks, and(
        eq(s.userShipmentLinks.shipmentId, s.trips.shipmentId),
        eq(s.userShipmentLinks.userId, row.forwarderId),
      ))
      .where(and(
        eq(s.tripExpenses.forwarderId, row.forwarderId),
        inArray(s.tripExpenses.approvalStatus, ['PENDING', 'APPROVED']),
      )).orderBy(desc(s.tripExpenses.createdAt)),
  ]);
  const blockedRequestIds = new Set(blockedRequests.map(item => item.id));
  const blockedExpenseIds = new Set(blockedExpenses.map(item => item.id));
  return {
    ...detail,
    eligibleAdvanceRequests: requestCandidates.filter(item => !blockedRequestIds.has(item.id)),
    eligibleExpenses: expenseCandidates.filter(item =>
      !blockedExpenseIds.has(item.id) && item.completionStatus === 'COMPLETED',
    ),
  };
}

function assertSettlementBalanced(input: {
  advanceRequests: Array<{ amount: string }>;
  tripExpenses: Array<{ buyAmount: string }>;
  refundAmount: number;
}) {
  const advanceTotal = round2dp(input.advanceRequests.reduce((sum, item) => sum + Number(item.amount), 0));
  const expenseTotal = round2dp(input.tripExpenses.reduce((sum, item) => sum + Number(item.buyAmount), 0));
  const difference = round2dp(advanceTotal - expenseTotal - input.refundAmount);
  if (Math.abs(difference) > 1) {
    throw new AdvanceError(400, `Phiếu chưa cân đối: tạm ứng ${advanceTotal}, chi phí ${expenseTotal}, hoàn lại ${input.refundAmount}`);
  }
  return { advanceTotal, expenseTotal };
}

export async function updateAdvanceSettlement(
  settlementId: number,
  data: { expectedVersion?: number; advanceRequestIds: number[]; tripExpenseIds: number[]; refundAmount: number; note?: string | null },
  options: { transaction?: Tx; emitNotification?: boolean } = {},
) {
  const execute = async (tx: Tx) => {
    const [settlement] = await tx.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlementId)).for('update');
    if (!settlement) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng');
    const version = data.expectedVersion ?? settlement.version;
    assertExpectedVersion(settlement.version, version, 'Phiếu hoàn ứng');
    if (settlement.status !== 'PENDING' && settlement.status !== 'CHECKED_BY_ACCOUNTANT') {
      throw new AdvanceError(409, 'Chỉ được sửa phiếu đang chờ kế toán');
    }
    for (const requestId of [...data.advanceRequestIds].sort((a, b) => a - b)) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6101, ${requestId})`);
    }
    const expenseIds = [...data.tripExpenseIds].sort((a, b) => a - b);
    for (const expenseId of expenseIds) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    }
    if (expenseIds.length > 0) {
      const scopes = await tx.select({ tripId: s.tripExpenses.tripId, tripContainerId: s.tripExpenses.tripContainerId })
        .from(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds));
      const scopeKeys = [...new Set(scopes.map(scope => scope.tripContainerId ?? -scope.tripId))].sort((a, b) => a - b);
      for (const scopeKey of scopeKeys) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
      }
    }
    const validated = await validateSettlementInputs({
      dbOrTx: tx,
      forwarderId: settlement.forwarderId,
      advanceRequestIds: data.advanceRequestIds,
      tripExpenseIds: data.tripExpenseIds,
      checkAlreadyLinked: true,
      excludeSettlementId: settlementId,
    });
    const existingExpenseLinks = await tx.select().from(s.settlementExpenses)
      .where(eq(s.settlementExpenses.settlementId, settlementId));
    const existingByExpense = new Map(existingExpenseLinks.map(link => [link.tripExpenseId, link]));
    const effectiveTripExpenses = validated.tripExpenses.map(expense => {
      const existing = existingByExpense.get(expense.id);
      return existing
        ? { ...expense, buyAmount: existing.adjustedBuyAmount }
        : expense;
    });
    const { expenseTotal } = assertSettlementBalanced({
      advanceRequests: validated.advanceRequests,
      tripExpenses: effectiveTripExpenses,
      refundAmount: data.refundAmount,
    });

    const retainedExpenseIds = new Set(validated.tripExpenses.map(expense => expense.id));
    const removedLinks = existingExpenseLinks.filter(
      link => !retainedExpenseIds.has(link.tripExpenseId),
    );
    if (removedLinks.length > 0) {
      const [correctedRemoval] = await tx.select({ id: s.settlementExpenseAdjustments.id })
        .from(s.settlementExpenseAdjustments)
        .where(inArray(
          s.settlementExpenseAdjustments.settlementExpenseId,
          removedLinks.map(link => link.id),
        ))
        .limit(1);
      if (correctedRemoval) {
        throw new AdvanceError(
          409,
          'Không thể gỡ khoản chi đã có lịch sử điều chỉnh; hãy từ chối phiếu và lập phiếu mới',
        );
      }
    }
    await tx.delete(s.advanceSettlementRequests).where(eq(s.advanceSettlementRequests.settlementId, settlementId));
    await tx.insert(s.advanceSettlementRequests).values(data.advanceRequestIds.map(advanceRequestId => ({
      settlementId,
      advanceRequestId,
      allocatedAmount: validated.advanceRequests.find((request) => request.id === advanceRequestId)!.amount,
    })));
    if (removedLinks.length > 0) {
      await tx.delete(s.settlementExpenses)
        .where(inArray(s.settlementExpenses.id, removedLinks.map(link => link.id)));
    }
    const addedExpenses = validated.tripExpenses.filter(
      expense => !existingByExpense.has(expense.id),
    );
    if (addedExpenses.length > 0) {
      await tx.insert(s.settlementExpenses).values(addedExpenses.map(expense => ({
          settlementId,
          tripExpenseId: expense.id,
          originalBuyAmount: expense.buyAmount,
          adjustedBuyAmount: expense.buyAmount,
          submittedSellAmount: expense.sellAmount,
          originalSnapshot: expenseSnapshot(expense),
          adjustedSnapshot: expenseSnapshot(expense),
      })));
    }
    await tx.update(s.advanceSettlements).set({
      status: 'PENDING',
      checkedBy: null,
      checkedAt: null,
      totalExpenseAmount: String(expenseTotal),
      refundAmount: String(data.refundAmount),
      note: data.note ?? null,
      updatedAt: new Date(),
      version: sql`${s.advanceSettlements.version} + 1`,
    }).where(and(
      eq(s.advanceSettlements.id, settlementId),
      eq(s.advanceSettlements.version, version),
    ));
  };

  if (options.transaction) {
    await execute(options.transaction);
  } else {
    await db.transaction(execute);
  }
  const detail = await getAdvanceSettlement(settlementId, options.transaction ?? db);
  if (!detail) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng sau khi cập nhật');
  if (options.emitNotification !== false) {
    emitNotification({
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Kế toán đã cập nhật phiếu hoàn ứng',
      message: `Phiếu ${detail.code} đã được cập nhật danh sách tạm ứng, chi phí hoặc số tiền hoàn lại.`,
      relatedEntityType: 'advance_settlements',
      relatedEntityId: settlementId,
      targetUserId: detail.forwarderId,
      targetRoles: [],
    });
  }
  return detail;
}

export async function checkAdvanceSettlement(
  id: number,
  checkedBy: number,
  expectedVersion?: number,
  transaction?: Tx,
) {
  // Deprecated compatibility transition for stale clients. New clients call
  // approve directly; an old "check" action must not unexpectedly post ledger.
  const execute = async (tx: Tx) => {
    const [settlement] = await tx.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, id)).for('update');
    if (!settlement) throw new AdvanceError(404, 'Advance settlement not found');
    const version = expectedVersion ?? settlement.version;
    assertExpectedVersion(settlement.version, version, 'Phiếu hoàn ứng');
    if (settlement.status !== 'PENDING') {
      throw new AdvanceError(409, `Cannot check settlement with status ${settlement.status}`);
    }
    if (settlement.forwarderId === checkedBy) {
      throw new AdvanceError(403, 'Người lập phiếu không được tự kiểm tra phiếu hoàn ứng của mình');
    }
    const [correctionMakerConflict] = await tx.select({
      adjustedBy: s.settlementExpenseAdjustments.adjustedBy,
    }).from(s.settlementExpenseAdjustments).where(and(
      eq(s.settlementExpenseAdjustments.settlementId, id),
      eq(s.settlementExpenseAdjustments.adjustedBy, checkedBy),
      isNull(s.settlementExpenseAdjustments.approvedAt),
    )).limit(1);
    if (correctionMakerConflict) {
      throw new AdvanceError(
        403,
        'Người điều chỉnh không được tự kiểm tra điều chỉnh của mình',
      );
    }
    const now = new Date();
    const [updated] = await tx.update(s.advanceSettlements).set({
      status: 'CHECKED_BY_ACCOUNTANT',
      checkedBy,
      checkedAt: now,
      updatedAt: now,
      version: sql`${s.advanceSettlements.version} + 1`,
    }).where(and(
      eq(s.advanceSettlements.id, id),
      eq(s.advanceSettlements.status, 'PENDING'),
      eq(s.advanceSettlements.version, version),
    )).returning();
    if (!updated) throw new AdvanceError(409, 'Request was modified by another operation');
    const [enriched] = await enrichWithNames([updated], tx);
    return enrichSettlementWithRequests(enriched, tx);
  };

  return runInTx(transaction, execute);
}

export async function approveAdvanceSettlement(
  id: number,
  approvedBy: number,
  expectedVersion?: number,
  options: { transaction?: Tx; emitNotification?: boolean } = {},
) {
  const execute = async (tx: Tx) => {
    const [settlement] = await tx.select()
      .from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, id))
      .for('update');
    if (!settlement) throw new AdvanceError(404, 'Advance settlement not found');
    const version = expectedVersion ?? settlement.version;
    assertExpectedVersion(settlement.version, version, 'Phiếu hoàn ứng');
    if (settlement.status !== 'CHECKED_BY_ACCOUNTANT') {
      if (settlement.status === 'PENDING') {
        throw new AdvanceError(409, 'Phiếu hoàn ứng phải được kế toán kiểm tra trước khi duyệt');
      }
      throw new AdvanceError(409, `Cannot approve settlement with status ${settlement.status}`);
    }
    if (settlement.forwarderId === approvedBy) {
      throw new AdvanceError(403, 'Không thể duyệt phiếu thanh toán của chính mình');
    }
    if (settlement.checkedBy == null) {
      throw new AdvanceError(409, 'Phiếu hoàn ứng thiếu thông tin người kiểm tra');
    }
    if (settlement.checkedBy === approvedBy) {
      throw new AdvanceError(403, 'Người kiểm tra không được đồng thời phê duyệt phiếu hoàn ứng');
    }
    const [correctionConflict] = await tx.select({
      adjustedBy: s.settlementExpenseAdjustments.adjustedBy,
    }).from(s.settlementExpenseAdjustments).where(and(
      eq(s.settlementExpenseAdjustments.settlementId, id),
      eq(s.settlementExpenseAdjustments.adjustedBy, approvedBy),
      isNull(s.settlementExpenseAdjustments.approvedAt),
    )).limit(1);
    if (correctionConflict) {
      throw new AdvanceError(
        403,
        'Người điều chỉnh không được tự phê duyệt điều chỉnh của mình',
      );
    }

    const requestLinks = await tx.select({ id: s.advanceSettlementRequests.advanceRequestId })
      .from(s.advanceSettlementRequests)
      .where(eq(s.advanceSettlementRequests.settlementId, id));
    const expenseLinkIds = await tx.select({ id: s.settlementExpenses.tripExpenseId })
      .from(s.settlementExpenses)
      .where(eq(s.settlementExpenses.settlementId, id));
    const linkedExpenseIds = expenseLinkIds.map(link => link.id);
    // Keep the exact completion scopes stable from eligibility validation until
    // approval commits. This uses the same lock namespace/order as Ops updates.
    for (const expenseId of [...new Set(linkedExpenseIds)].sort((a, b) => a - b)) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    }
    const approvalScopes = linkedExpenseIds.length === 0
      ? []
      : await tx.select({
        tripId: s.tripExpenses.tripId,
        tripContainerId: s.tripExpenses.tripContainerId,
      }).from(s.tripExpenses).where(inArray(s.tripExpenses.id, linkedExpenseIds));
    const scopeKeys = [...new Set(approvalScopes.map(expense =>
      expense.tripContainerId ?? -expense.tripId,
    ))].sort((a, b) => a - b);
    for (const scopeKey of scopeKeys) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
    }
    const validated = await validateSettlementInputs({
      dbOrTx: tx,
      forwarderId: settlement.forwarderId,
      advanceRequestIds: requestLinks.map(link => link.id),
      tripExpenseIds: linkedExpenseIds,
      checkAlreadyLinked: true,
      excludeSettlementId: id,
    });
    const effectiveExpenseAmounts = linkedExpenseIds.length === 0
      ? []
      : await tx.select({ buyAmount: s.settlementExpenses.adjustedBuyAmount })
        .from(s.settlementExpenses)
        .where(eq(s.settlementExpenses.settlementId, id));
    assertSettlementBalanced({
      advanceRequests: validated.advanceRequests,
      tripExpenses: effectiveExpenseAmounts,
      refundAmount: Number(settlement.refundAmount),
    });

    const links = await tx.select({
      expenseId: s.tripExpenses.id,
      buyAmount: s.settlementExpenses.adjustedBuyAmount,
      sellAmount: s.tripExpenses.sellAmount,
      adjustedSnapshot: s.settlementExpenses.adjustedSnapshot,
      approvalStatus: s.tripExpenses.approvalStatus,
      createdBy: s.tripExpenses.createdBy,
      tripStatus: s.trips.status,
      customerId: s.trips.customerId,
      tripCode: s.trips.tripCode,
      departureDate: s.trips.departureDate,
      adjustmentReason: s.settlementExpenses.adjustmentReason,
    }).from(s.settlementExpenses)
      .innerJoin(s.tripExpenses, eq(s.tripExpenses.id, s.settlementExpenses.tripExpenseId))
      .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
      .where(eq(s.settlementExpenses.settlementId, id));

    const unknownMaker = links.find(link => link.createdBy == null);
    if (unknownMaker) {
      throw new AdvanceError(
        409,
        'Không xác định được người tạo chi phí; cần đối soát thủ công trước khi duyệt phiếu hoàn ứng',
      );
    }
    const makerConflict = links.find(link =>
      link.approvalStatus === 'PENDING' && link.createdBy === approvedBy,
    );
    if (makerConflict) {
      throw new AdvanceError(
        403,
        'Người tạo chi phí không được tự phê duyệt chi phí trong phiếu hoàn ứng',
      );
    }

    const totalExpenseAmount = round2dp(links.reduce((sum, link) => sum + Number(link.buyAmount), 0));
    const now = new Date();
    const [updated] = await tx.update(s.advanceSettlements)
      .set({
        status: 'APPROVED',
        totalExpenseAmount: String(totalExpenseAmount),
        approvedBy,
        approvedAt: now,
        updatedAt: now,
        version: sql`${s.advanceSettlements.version} + 1`,
      })
      .where(and(
        eq(s.advanceSettlements.id, id),
        eq(s.advanceSettlements.status, 'CHECKED_BY_ACCOUNTANT'),
        eq(s.advanceSettlements.version, version),
      ))
      .returning();
    if (!updated) throw new AdvanceError(409, 'Request was modified by another operation');

    await tx.update(s.settlementExpenseAdjustments).set({
      approvedBy,
      approvedAt: now,
    }).where(and(
      eq(s.settlementExpenseAdjustments.settlementId, id),
      isNull(s.settlementExpenseAdjustments.approvedAt),
    ));

    const pendingExpenseIds = links.filter(link => link.approvalStatus === 'PENDING').map(link => link.expenseId);
    if (pendingExpenseIds.length > 0) {
      await tx.update(s.tripExpenses).set({ approvalStatus: 'APPROVED', updatedAt: now })
        .where(inArray(s.tripExpenses.id, pendingExpenseIds));
    }

    // If the trip was already completed, post the accepted service fee now.
    // Existing rows are never mutated; corrections become ADJUSTMENT entries.
    for (const link of links) {
      if (link.tripStatus !== 'COMPLETED') continue;
      const adjustedSnapshot = link.adjustedSnapshot as Record<string, unknown>;
      const currentSell = Number(adjustedSnapshot.sellAmount ?? link.sellAmount);
      const existingRows = await tx.select({
        id: s.ledger.id,
        debit: s.ledger.debit,
        credit: s.ledger.credit,
        originalDueDate: s.ledger.originalDueDate,
        processingDueDate: s.ledger.processingDueDate,
        paymentTermDaysApplied: s.ledger.paymentTermDaysApplied,
        paymentDatePolicyApplied: s.ledger.paymentDatePolicyApplied,
      })
        .from(s.ledger)
        .where(and(eq(s.ledger.txnType, TxnType.SERVICE_FEE), eq(s.ledger.txnId, link.expenseId)));
      const posted = existingRows.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
      const delta = round2dp(currentSell - posted);
      if (delta === 0) continue;
      const existingAuthority = [...existingRows]
        .sort((left, right) => right.id - left.id)
        .find((row) => row.originalDueDate && row.processingDueDate);
      const resolvedAuthority = existingAuthority
        ? null
        : await resolveCustomerPaymentDueDate(
            tx,
            link.customerId,
            String(link.departureDate).slice(0, 10),
          );
      const dueDateFields = existingAuthority
        ? {
            originalDueDate: existingAuthority.originalDueDate,
            processingDueDate: existingAuthority.processingDueDate,
            paymentTermDaysApplied: existingAuthority.paymentTermDaysApplied,
            paymentDatePolicyApplied:
              existingAuthority.paymentDatePolicyApplied as PaymentDatePolicy | null,
          }
        : {
            originalDueDate: resolvedAuthority!.originalDate,
            processingDueDate: resolvedAuthority!.processingDate,
            paymentTermDaysApplied: resolvedAuthority!.paymentTermDays,
            paymentDatePolicyApplied: resolvedAuthority!.policy,
          };
      await LedgerService.postEntry(tx, {
        txnType: existingRows.length === 0 ? TxnType.SERVICE_FEE : TxnType.ADJUSTMENT,
        txnId: link.expenseId,
        entityType: 'CUSTOMER',
        entityId: link.customerId,
        debit: delta > 0 ? delta : 0,
        credit: delta < 0 ? Math.abs(delta) : 0,
        note: `Điều chỉnh phí chi hộ chuyến ${link.tripCode ?? ''}`.trim(),
        ...dueDateFields,
      });
    }

    if (pendingExpenseIds.length > 0) {
      await propagateExpenseApprovals(tx, pendingExpenseIds);
    }

    const totalAmount = totalExpenseAmount + Number(settlement.refundAmount);
    await LedgerService.postEntry(tx, {
      txnType: TxnType.OPS_SETTLEMENT,
      txnId: settlement.id,
      entityType: 'FORWARDER',
      entityId: settlement.forwarderId,
      debit: totalAmount,
      credit: 0,
      note: 'Thanh toán và quyết toán tạm ứng',
    });

    return {
      updated,
      adjustmentCount: links.filter(link => Boolean(link.adjustmentReason)).length,
    };
  };

  const approved = options.transaction
    ? await execute(options.transaction)
    : await db.transaction(execute);

  if (options.emitNotification !== false) {
    emitNotification({
      type: NotificationType.ADVANCE_SETTLEMENT_APPROVED,
      title: 'Phiếu hoàn ứng đã duyệt',
      message: `Phiếu ${approved.updated.code} được duyệt ${Number(approved.updated.totalExpenseAmount).toLocaleString('vi-VN')} ₫${approved.adjustmentCount > 0 ? `, có ${approved.adjustmentCount} khoản kế toán điều chỉnh` : ''}.`,
      relatedEntityType: 'advance_settlements',
      relatedEntityId: approved.updated.id,
      targetUserId: approved.updated.forwarderId,
      targetRoles: [],
    });
  }

  const executor = options.transaction ?? db;
  const [enriched] = await enrichWithNames([approved.updated], executor);
  return enrichSettlementWithRequests(enriched, executor);
}

export async function adjustSettlementExpense(
  settlementId: number,
  expenseId: number,
  actorId: number,
  patch: {
    expectedVersion?: number;
    expenseType?: string;
    buyAmount?: number;
    sellAmount?: number;
    supplierId?: number | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    declarationNumber?: string | null;
    containerNumber?: string | null;
    tripContainerId?: number | null;
    note?: string | null;
    adjustmentReason: string;
  },
  options: { transaction?: Tx; emitNotification?: boolean; actorRole?: string } = {},
) {
  const reason = patch.adjustmentReason.trim();
  if (!reason) {
    throw new AdvanceError(400, 'Lý do điều chỉnh là bắt buộc');
  }
  const execute = async (tx: Tx) => {
    const [settlement] = await tx.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlementId)).for('update');
    if (!settlement) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng');
    const version = patch.expectedVersion ?? settlement.version;
    assertExpectedVersion(settlement.version, version, 'Phiếu hoàn ứng');
    const isApprovedCorrection = settlement.status === 'APPROVED';
    if (!isApprovedCorrection && settlement.status !== 'PENDING' && settlement.status !== 'CHECKED_BY_ACCOUNTANT') {
      throw new AdvanceError(409, 'Chỉ được sửa phiếu đang chờ kế toán hoặc tạo điều chỉnh cho phiếu đã duyệt');
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    const [linked] = await tx.select({
      linkId: s.settlementExpenses.id,
      expenseId: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      expenseType: s.tripExpenses.expenseType,
      buyAmount: s.tripExpenses.buyAmount,
      sellAmount: s.tripExpenses.sellAmount,
      supplierId: s.tripExpenses.supplierId,
      invoiceNumber: s.tripExpenses.invoiceNumber,
      invoiceDate: s.tripExpenses.invoiceDate,
      declarationNumber: s.tripExpenses.declarationNumber,
      containerNumber: s.tripExpenses.containerNumber,
      tripContainerId: s.tripExpenses.tripContainerId,
      note: s.tripExpenses.note,
      adjustedSnapshot: s.settlementExpenses.adjustedSnapshot,
    }).from(s.settlementExpenses)
      .innerJoin(s.tripExpenses, eq(s.tripExpenses.id, s.settlementExpenses.tripExpenseId))
      .where(and(
        eq(s.settlementExpenses.settlementId, settlementId),
        eq(s.settlementExpenses.tripExpenseId, expenseId),
      )).limit(1);
    if (!linked) throw new AdvanceError(404, 'Khoản chi không thuộc phiếu hoàn ứng này');

    const [trip] = await tx.select({ status: s.trips.status }).from(s.trips)
      .where(eq(s.trips.id, linked.tripId)).limit(1);
    if (!isApprovedCorrection && (trip?.status === 'COMPLETED' || trip?.status === 'CANCELED')) {
      throw new AdvanceError(409, 'Không thể sửa chi phí của chuyến đã hoàn thành hoặc đã hủy');
    }

    const currentSnapshot: Record<string, unknown> = {
      expenseType: linked.expenseType,
      buyAmount: linked.buyAmount,
      sellAmount: linked.sellAmount,
      supplierId: linked.supplierId,
      invoiceNumber: linked.invoiceNumber,
      invoiceDate: linked.invoiceDate,
      declarationNumber: linked.declarationNumber,
      containerNumber: linked.containerNumber,
      tripContainerId: linked.tripContainerId,
      note: linked.note,
      ...linked.adjustedSnapshot as Record<string, unknown>,
    };
    const requiredFieldError = getTripExpenseRequiredFieldError({
      expenseType: String(patch.expenseType ?? currentSnapshot.expenseType),
      declarationNumber: patch.declarationNumber === undefined
        ? currentSnapshot.declarationNumber as string | null
        : patch.declarationNumber,
    });
    if (requiredFieldError) throw new AdvanceError(400, requiredFieldError);

    const {
      adjustmentReason: _adjustmentReason,
      expectedVersion: _expectedVersion,
      ...expensePatch
    } = patch;
    void _adjustmentReason;
    void _expectedVersion;
    const values: Record<string, unknown> = {
      ...currentSnapshot,
      ...expensePatch,
    };
    if (expensePatch.buyAmount !== undefined) values.buyAmount = String(expensePatch.buyAmount);
    if (expensePatch.sellAmount !== undefined) values.sellAmount = String(expensePatch.sellAmount);
    if (expensePatch.buyAmount !== undefined && expensePatch.sellAmount === undefined) {
      const effectiveType = expensePatch.expenseType ?? String(currentSnapshot.expenseType);
      const [typeConfig] = await tx.select({ defaultMarkup: s.forwarderExpenseTypes.defaultMarkup })
        .from(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.code, effectiveType)).limit(1);
      if (!typeConfig?.defaultMarkup) values.sellAmount = String(expensePatch.buyAmount);
    }
    if (expensePatch.tripContainerId !== undefined) {
      if (expensePatch.tripContainerId == null) {
        values.tripContainerId = null;
        values.containerNumber = null;
      } else {
        const [container] = await tx.select({ tripId: s.tripContainers.tripId, number: s.tripContainers.containerNumber })
          .from(s.tripContainers).where(eq(s.tripContainers.id, expensePatch.tripContainerId)).limit(1);
        if (!container || container.tripId !== linked.tripId) {
          throw new AdvanceError(400, 'Container không thuộc chuyến này');
        }
        values.containerNumber = container.number;
      }
    }
    if (isApprovedCorrection) {
      if (!options.actorRole) {
        throw new AdvanceError(403, 'Thiếu vai trò người tạo điều chỉnh');
      }
      assertCanMakeGovernanceAction('ADVANCE_SETTLEMENT_CORRECTION', options.actorRole);
      const oldBuyAmount = Number(currentSnapshot.buyAmount ?? 0);
      const newBuyAmount = Number(values.buyAmount ?? oldBuyAmount);
      const correctedRefundAmount = round2dp(
        Number(settlement.refundAmount) - (newBuyAmount - oldBuyAmount),
      );
      if (correctedRefundAmount < 0) {
        throw new AdvanceError(
          400,
          'Điều chỉnh làm số hoàn lại âm; cần hoàn tác phiếu và lập phiếu mới',
        );
      }
      const [action] = await tx.insert(s.governanceActions).values({
        subjectType: 'ADVANCE_SETTLEMENT',
        subjectId: settlement.id,
        subjectKey: `advance-settlement:${settlement.id}:expense:${expenseId}`,
        actionKind: 'ADVANCE_SETTLEMENT_CORRECTION',
        reason,
        originalVersion: settlement.version,
        beforeSnapshot: {
          settlementStatus: settlement.status,
          settlementVersion: settlement.version,
          settlementExpenseId: linked.linkId,
          tripExpenseId: linked.expenseId,
          totalExpenseAmount: settlement.totalExpenseAmount,
          expense: currentSnapshot,
        },
        afterSnapshot: {
          expense: values,
          refundAmount: String(correctedRefundAmount),
        },
        deltaSnapshot: {
          oldBuyAmount: String(oldBuyAmount),
          newBuyAmount: String(newBuyAmount),
          oldRefundAmount: settlement.refundAmount,
          newRefundAmount: String(correctedRefundAmount),
          oldSellAmount: String(currentSnapshot.sellAmount ?? 0),
          newSellAmount: String(values.sellAmount ?? 0),
        },
        makerId: actorId,
        makerRole: options.actorRole,
      }).returning();
      return {
        item: {
          id: linked.expenseId,
          tripId: linked.tripId,
          ...currentSnapshot,
        },
        governanceAction: action,
        totalExpenseAmount: settlement.totalExpenseAmount,
        settlementCode: settlement.code,
        forwarderId: settlement.forwarderId,
        adjustmentReason: reason,
      };
    }
    const now = new Date();
    const [latestAdjustment] = await tx.select({
      sequence: s.settlementExpenseAdjustments.sequence,
    }).from(s.settlementExpenseAdjustments)
      .where(eq(s.settlementExpenseAdjustments.settlementExpenseId, linked.linkId))
      .orderBy(desc(s.settlementExpenseAdjustments.sequence))
      .limit(1);
    const nextSequence = (latestAdjustment?.sequence ?? 0) + 1;
    await tx.insert(s.settlementExpenseAdjustments).values({
      settlementId,
      settlementExpenseId: linked.linkId,
      tripExpenseId: linked.expenseId,
      sequence: nextSequence,
      sourceVersion: nextSequence,
      beforeSnapshot: currentSnapshot,
      afterSnapshot: values,
      reason,
      adjustedBy: actorId,
      adjustedAt: now,
    });
    const [updatedLink] = await tx.update(s.settlementExpenses).set({
      adjustmentReason: reason,
      adjustedBuyAmount: String(values.buyAmount),
      adjustedSnapshot: values,
      adjustedBy: actorId,
      adjustedAt: now,
    }).where(eq(s.settlementExpenses.id, linked.linkId)).returning();
    const totals = await tx.select({ buyAmount: s.settlementExpenses.adjustedBuyAmount })
      .from(s.settlementExpenses)
      .where(eq(s.settlementExpenses.settlementId, settlementId));
    const totalExpenseAmount = round2dp(totals.reduce((sum, row) => sum + Number(row.buyAmount), 0));
    await tx.update(s.advanceSettlements).set({
      status: 'PENDING',
      checkedBy: null,
      checkedAt: null,
      totalExpenseAmount: String(totalExpenseAmount),
      updatedAt: now,
      version: sql`${s.advanceSettlements.version} + 1`,
    }).where(and(
      eq(s.advanceSettlements.id, settlementId),
      eq(s.advanceSettlements.version, version),
    ));
    return {
      item: {
        id: linked.expenseId,
        tripId: linked.tripId,
        ...values,
      },
      adjustment: updatedLink,
      totalExpenseAmount: String(totalExpenseAmount),
      settlementCode: settlement.code,
      forwarderId: settlement.forwarderId,
      adjustmentReason: reason,
    };
  };
  const result = options.transaction
    ? await execute(options.transaction)
    : await db.transaction(execute);
  if (options.emitNotification !== false) {
    emitNotification({
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Kế toán đã điều chỉnh phiếu hoàn ứng',
      message: `Phiếu ${result.settlementCode}: ${result.adjustmentReason}.`,
      relatedEntityType: 'advance_settlements',
      relatedEntityId: settlementId,
      targetUserId: result.forwarderId,
      targetRoles: [],
    });
  }
  return {
    item: result.item,
    totalExpenseAmount: result.totalExpenseAmount,
    governanceAction: 'governanceAction' in result ? result.governanceAction : null,
  };
}

export async function requestAdvanceSettlementReversal(input: {
  settlementId: number;
  expectedVersion: number;
  reason: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('ADVANCE_SETTLEMENT_REVERSAL', input.makerRole);
  const reason = input.reason.trim();
  if (!reason) throw new AdvanceError(400, 'Lý do hoàn tác là bắt buộc');

  const execute = async (tx: Tx) => {
    const [settlement] = await tx.select().from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, input.settlementId))
      .limit(1)
      .for('update');
    if (!settlement) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng');
    assertExpectedVersion(settlement.version, input.expectedVersion, 'Phiếu hoàn ứng');
    if (settlement.status !== 'APPROVED') {
      throw new AdvanceError(409, 'Chỉ phiếu đã duyệt mới được hoàn tác');
    }
    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'ADVANCE_SETTLEMENT',
      subjectId: settlement.id,
      subjectKey: `advance-settlement:${settlement.id}:reverse`,
      actionKind: 'ADVANCE_SETTLEMENT_REVERSAL',
      reason,
      originalVersion: settlement.version,
      beforeSnapshot: {
        status: settlement.status,
        version: settlement.version,
        totalExpenseAmount: settlement.totalExpenseAmount,
        refundAmount: settlement.refundAmount,
      },
      afterSnapshot: { status: 'REVERSED' },
      deltaSnapshot: {
        reversalAmount: String(
          round2dp(Number(settlement.totalExpenseAmount) + Number(settlement.refundAmount)),
        ),
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };

  return runInTx(input.transaction, execute);
}

async function applyApprovedSettlementCorrection(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  const before = action.beforeSnapshot as Record<string, unknown>;
  const after = action.afterSnapshot as Record<string, unknown>;
  const expense = after.expense as Record<string, unknown> | undefined;
  const settlementExpenseId = Number(before.settlementExpenseId);
  const tripExpenseId = Number(before.tripExpenseId);
  if (!expense || !Number.isInteger(settlementExpenseId) || !Number.isInteger(tripExpenseId)) {
    throw new AdvanceError(409, 'Dữ liệu điều chỉnh phiếu hoàn ứng không hợp lệ');
  }

  const [settlement] = await tx.select().from(s.advanceSettlements)
    .where(eq(s.advanceSettlements.id, action.subjectId!))
    .limit(1)
    .for('update');
  if (!settlement) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng');
  assertExpectedVersion(settlement.version, action.originalVersion, 'Phiếu hoàn ứng');
  if (settlement.status !== 'APPROVED') {
    throw new AdvanceError(409, 'Phiếu hoàn ứng không còn ở trạng thái đã duyệt');
  }

  const [linked] = await tx.select({
    id: s.settlementExpenses.id,
    adjustedBuyAmount: s.settlementExpenses.adjustedBuyAmount,
    adjustedSnapshot: s.settlementExpenses.adjustedSnapshot,
    tripId: s.tripExpenses.tripId,
    sellAmount: s.tripExpenses.sellAmount,
    expenseDate: s.tripExpenses.expenseDate,
    customerId: s.trips.customerId,
    tripCode: s.trips.tripCode,
    tripStatus: s.trips.status,
  }).from(s.settlementExpenses)
    .innerJoin(s.tripExpenses, eq(s.tripExpenses.id, s.settlementExpenses.tripExpenseId))
    .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
    .where(and(
      eq(s.settlementExpenses.id, settlementExpenseId),
      eq(s.settlementExpenses.settlementId, settlement.id),
      eq(s.settlementExpenses.tripExpenseId, tripExpenseId),
    ))
    .limit(1);
  if (!linked) throw new AdvanceError(404, 'Khoản chi không thuộc phiếu hoàn ứng này');

  const oldBuyAmount = Number(linked.adjustedBuyAmount);
  const newBuyAmount = Number(expense.buyAmount ?? oldBuyAmount);
  const oldSnapshot = linked.adjustedSnapshot as Record<string, unknown>;
  const oldSellAmount = Number(oldSnapshot.sellAmount ?? linked.sellAmount);
  const newSellAmount = Number(expense.sellAmount ?? oldSellAmount);
  const newRefundAmount = Number(after.refundAmount);
  if (![newBuyAmount, newSellAmount, newRefundAmount].every(Number.isFinite) || newRefundAmount < 0) {
    throw new AdvanceError(400, 'Số tiền điều chỉnh không hợp lệ');
  }
  const buyDelta = round2dp(newBuyAmount - oldBuyAmount);
  const now = action.approvedAt ?? new Date();
  const [latestAdjustment] = await tx.select({
    sequence: s.settlementExpenseAdjustments.sequence,
  }).from(s.settlementExpenseAdjustments)
    .where(eq(s.settlementExpenseAdjustments.settlementExpenseId, linked.id))
    .orderBy(desc(s.settlementExpenseAdjustments.sequence))
    .limit(1);
  const nextSequence = (latestAdjustment?.sequence ?? 0) + 1;
  await tx.insert(s.settlementExpenseAdjustments).values({
    settlementId: settlement.id,
    settlementExpenseId: linked.id,
    tripExpenseId,
    sequence: nextSequence,
    sourceVersion: nextSequence,
    beforeSnapshot: oldSnapshot,
    afterSnapshot: expense,
    reason: action.reason,
    adjustedBy: action.makerId,
    adjustedAt: action.createdAt,
    approvedBy: action.approverId,
    approvedAt: now,
  });
  await tx.update(s.settlementExpenses).set({
    adjustmentReason: action.reason,
    adjustedBuyAmount: String(newBuyAmount),
    adjustedSnapshot: expense,
    adjustedBy: action.makerId,
    adjustedAt: action.createdAt,
  }).where(eq(s.settlementExpenses.id, linked.id));

  const newTotalExpenseAmount = round2dp(Number(settlement.totalExpenseAmount) + buyDelta);
  const [updated] = await tx.update(s.advanceSettlements).set({
    totalExpenseAmount: String(newTotalExpenseAmount),
    refundAmount: String(newRefundAmount),
    updatedAt: now,
    version: sql`${s.advanceSettlements.version} + 1`,
  }).where(and(
    eq(s.advanceSettlements.id, settlement.id),
    eq(s.advanceSettlements.status, 'APPROVED'),
    eq(s.advanceSettlements.version, action.originalVersion),
  )).returning({ id: s.advanceSettlements.id, version: s.advanceSettlements.version });
  if (!updated) throw new AdvanceError(409, 'Phiếu hoàn ứng đã được tác vụ khác cập nhật');

  const originalBalancedTotal = round2dp(
    Number(settlement.totalExpenseAmount) + Number(settlement.refundAmount),
  );
  const correctedBalancedTotal = round2dp(newTotalExpenseAmount + newRefundAmount);
  if (correctedBalancedTotal !== originalBalancedTotal) {
    throw new AdvanceError(409, 'Điều chỉnh làm phiếu hoàn ứng mất cân đối');
  }

  if (
    newSellAmount !== oldSellAmount
    && linked.tripStatus === 'COMPLETED'
  ) {
    const existingRows = await tx.select({
      id: s.ledger.id,
      debit: s.ledger.debit,
      credit: s.ledger.credit,
      originalDueDate: s.ledger.originalDueDate,
      processingDueDate: s.ledger.processingDueDate,
      paymentTermDaysApplied: s.ledger.paymentTermDaysApplied,
      paymentDatePolicyApplied: s.ledger.paymentDatePolicyApplied,
    }).from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'CUSTOMER'),
        eq(s.ledger.entityId, linked.customerId),
        eq(s.ledger.txnId, tripExpenseId),
        inArray(s.ledger.txnType, [TxnType.SERVICE_FEE, TxnType.ADJUSTMENT]),
      ));
    const posted = existingRows.reduce(
      (sum, row) => sum + Number(row.debit) - Number(row.credit),
      0,
    );
    const sellDelta = round2dp(newSellAmount - posted);
    if (sellDelta !== 0) {
      const existingAuthority = [...existingRows]
        .sort((left, right) => right.id - left.id)
        .find((row) => row.originalDueDate && row.processingDueDate);
      const resolvedAuthority = existingAuthority
        ? null
        : await resolveCustomerPaymentDueDate(
            tx,
            linked.customerId,
            String(linked.expenseDate).slice(0, 10),
          );
      await LedgerService.postEntry(tx, {
        txnType: existingRows.length === 0 ? TxnType.SERVICE_FEE : TxnType.ADJUSTMENT,
        txnId: tripExpenseId,
        entityType: 'CUSTOMER',
        entityId: linked.customerId,
        debit: sellDelta > 0 ? sellDelta : 0,
        credit: sellDelta < 0 ? Math.abs(sellDelta) : 0,
        note: `Điều chỉnh phí chi hộ chuyến ${linked.tripCode ?? ''}`.trim(),
        originalDueDate: existingAuthority?.originalDueDate ?? resolvedAuthority!.originalDate,
        processingDueDate: existingAuthority?.processingDueDate ?? resolvedAuthority!.processingDate,
        paymentTermDaysApplied:
          existingAuthority?.paymentTermDaysApplied ?? resolvedAuthority!.paymentTermDays,
        paymentDatePolicyApplied:
          (existingAuthority?.paymentDatePolicyApplied as PaymentDatePolicy | null | undefined)
          ?? resolvedAuthority!.policy,
      });
    }
  }

  return {
    applicationResult: {
      settlementId: settlement.id,
      tripExpenseId,
      totalExpenseAmount: String(newTotalExpenseAmount),
      refundAmount: String(newRefundAmount),
      resultingVersion: updated.version,
    },
  };
}

async function applyApprovedSettlementReversal(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  const [settlement] = await tx.select().from(s.advanceSettlements)
    .where(eq(s.advanceSettlements.id, action.subjectId!))
    .limit(1)
    .for('update');
  if (!settlement) throw new AdvanceError(404, 'Không tìm thấy phiếu hoàn ứng');
  assertExpectedVersion(settlement.version, action.originalVersion, 'Phiếu hoàn ứng');
  if (settlement.status !== 'APPROVED') {
    throw new AdvanceError(409, 'Phiếu hoàn ứng không còn ở trạng thái đã duyệt');
  }
  const now = action.approvedAt ?? new Date();
  const reversalAmount = round2dp(
    Number(settlement.totalExpenseAmount) + Number(settlement.refundAmount),
  );
  const reversalEntry = await LedgerService.postEntry(tx, {
    txnType: TxnType.ADJUSTMENT,
    txnId: settlement.id,
    entityType: 'FORWARDER',
    entityId: settlement.forwarderId,
    debit: 0,
    credit: reversalAmount,
    note: `Hoàn tác phiếu hoàn ứng ${settlement.code}: ${action.reason}`,
  });
  const [updated] = await tx.update(s.advanceSettlements).set({
    status: 'REVERSED',
    updatedAt: now,
    version: sql`${s.advanceSettlements.version} + 1`,
  }).where(and(
    eq(s.advanceSettlements.id, settlement.id),
    eq(s.advanceSettlements.status, 'APPROVED'),
    eq(s.advanceSettlements.version, action.originalVersion),
  )).returning({ version: s.advanceSettlements.version });
  if (!updated) throw new AdvanceError(409, 'Phiếu hoàn ứng đã được tác vụ khác cập nhật');
  return {
    ledgerEntryId: reversalEntry.id,
    applicationResult: {
      settlementId: settlement.id,
      status: 'REVERSED',
      reversalAmount: String(reversalAmount),
      resultingVersion: updated.version,
    },
  };
}

export async function applyAdvanceSettlementGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (
    action.subjectType !== 'ADVANCE_SETTLEMENT'
    || action.subjectId == null
    || action.approverId == null
  ) {
    throw new AdvanceError(409, 'Yêu cầu không thuộc điều chỉnh phiếu hoàn ứng');
  }
  if (action.actionKind === 'ADVANCE_SETTLEMENT_CORRECTION') {
    return applyApprovedSettlementCorrection(tx, action);
  }
  if (action.actionKind === 'ADVANCE_SETTLEMENT_REVERSAL') {
    return applyApprovedSettlementReversal(tx, action);
  }
  throw new AdvanceError(409, 'Loại điều chỉnh phiếu hoàn ứng không hợp lệ');
}

export async function rejectAdvanceSettlement(
  id: number,
  rejectedBy: number,
  expectedVersion?: number,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [settlement] = await tx.select()
      .from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, id))
      .for('update');
    if (!settlement) throw new AdvanceError(404, 'Advance settlement not found');
    const version = expectedVersion ?? settlement.version;
    assertExpectedVersion(settlement.version, version, 'Phiếu hoàn ứng');
    if (settlement.status !== 'PENDING' && settlement.status !== 'CHECKED_BY_ACCOUNTANT') {
      throw new AdvanceError(409, `Cannot reject settlement with status ${settlement.status}`);
    }

    const now = new Date();
    const [updated] = await tx.update(s.advanceSettlements)
      .set({
        status: 'REJECTED',
        approvedBy: rejectedBy,
        approvedAt: now,
        updatedAt: now,
        version: sql`${s.advanceSettlements.version} + 1`,
      })
      .where(and(
        eq(s.advanceSettlements.id, id),
        inArray(s.advanceSettlements.status, ['PENDING', 'CHECKED_BY_ACCOUNTANT']),
        eq(s.advanceSettlements.version, version),
      ))
      .returning();
    if (!updated) throw new AdvanceError(409, 'Request was modified by another operation');

    const [enriched] = await enrichWithNames([updated], tx);
    return enrichSettlementWithRequests(enriched, tx);
  };

  return runInTx(transaction, execute);
}

// ── Outstanding advance balance (F1) ─────────────────────────────────────────
//
// Locked formula (partial-allocation authority):
//   outstanding = Σ max(APPROVED advance amount - APPROVED allocations, 0)
// Pending/checked allocations reserve a request from concurrent auto-use but do
// not reduce the reported balance until approval. LedgerService is intentionally
// not used because unrelated forwarder debits share that ledger.
const approvedAllocatedAmount = sql<string>`coalesce((
  select sum(allocation.allocated_amount::numeric)
  from advance_settlement_requests allocation
  inner join advance_settlements settlement
    on settlement.id = allocation.settlement_id
  where allocation.advance_request_id = ${s.advanceRequests.id}
    and settlement.status = 'APPROVED'
), 0)`;

/**
 * Sum the unallocated residual of every APPROVED advance request.
 * Pass `forwarderUserId` to scope to one forwarder; omit for the cross-forwarder total.
 */
export async function getOutstandingAdvanceBalance(forwarderUserId?: number): Promise<number> {
  const conditions = [
    eq(s.advanceRequests.status, 'APPROVED'),
  ];
  if (forwarderUserId) {
    conditions.push(eq(s.advanceRequests.requesterId, forwarderUserId));
  }

  const [row] = await db.select({
    total: sql<string>`coalesce(sum(greatest(${s.advanceRequests.amount}::numeric - ${approvedAllocatedAmount}, 0)), 0)`,
  }).from(s.advanceRequests)
    .where(and(...conditions));

  return round2dp(Number(row?.total ?? 0));
}

/**
 * Per-forwarder breakdown of outstanding advance balances across ALL forwarders.
 * Drops zero-outstanding rows. `totalOutstanding` is the sum of all items.
 */
export async function getOutstandingAdvanceBalances(): Promise<{
  totalOutstanding: number;
  items: Array<{ forwarderId: number; name: string | null; outstanding: number }>;
}> {
  const rows = await db.select({
    forwarderId: s.advanceRequests.requesterId,
    name: s.users.fullName,
    outstanding: sql<string>`sum(greatest(${s.advanceRequests.amount}::numeric - ${approvedAllocatedAmount}, 0))`,
  }).from(s.advanceRequests)
    .innerJoin(s.users, eq(s.advanceRequests.requesterId, s.users.id))
    .where(and(
      eq(s.advanceRequests.status, 'APPROVED'),
    ))
    .groupBy(s.advanceRequests.requesterId, s.users.fullName);

  const items = rows
    .map(r => ({ forwarderId: r.forwarderId, name: r.name, outstanding: round2dp(Number(r.outstanding)) }))
    .filter(r => r.outstanding > 0);

  const totalOutstanding = round2dp(items.reduce((sum, r) => sum + r.outstanding, 0));
  return { totalOutstanding, items };
}
