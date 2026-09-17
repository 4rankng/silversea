import { getAdvanceFundedAmounts } from './advance-funding.service';
import { getAdvanceConsumedAmounts } from './advance-consumption.service';
/**
 * Advance domain shared helpers — version guard, expense snapshots, name
 * enrichment, and the O2C auto-offset. Used by BOTH the request and settlement
 * leaves; a leaf so siblings can import these without cycling through the
 * advance.service facade that re-exports them.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, desc, inArray, notInArray, sql } from 'drizzle-orm';
import { TxnType, round2dp } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { AdvanceError } from './settlement-validation';
import type { Tx } from './trip-shared';

export type DbLike = typeof db | Tx;

export function assertExpectedVersion(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new AdvanceError(
      409,
      `${label} đã thay đổi (phiên bản hiện tại ${actual}); vui lòng tải lại trước khi tiếp tục`,
    );
  }
}

export type ExpenseSnapshotSource = Pick<typeof s.tripExpenses.$inferSelect,
  'expenseType' | 'buyAmount' | 'sellAmount' | 'containerNumber' |
  'invoiceNumber' | 'invoiceDate' | 'declarationNumber' | 'note'>;

export function expenseSnapshot(expense: ExpenseSnapshotSource): Record<string, unknown> {
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

export type EnrichableRow = {
  requesterId?: number | null;
  approvedBy?: number | null;
  forwarderId?: number | null;
  checkedBy?: number | null;
  /** Durable name captured at creation; used when the live user row is gone. */
  requesterNameSnapshot?: string | null;
};

export type EnrichedWithNames<T> = T & {
  requesterName: string | null;
  approverName: string | null;
  forwarderName: string | null;
  checkerName: string | null;
};

export async function enrichWithNames<T extends EnrichableRow>(
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
    // Live name wins while the account exists (renames stay visible); the
    // creation-time snapshot keeps completed approvals legible after removal.
    requesterName: nameMap.get(r.requesterId) ?? r.requesterNameSnapshot ?? null,
    approverName: nameMap.get(r.approvedBy) ?? null,
    forwarderName: nameMap.get(r.forwarderId) ?? null,
    checkerName: nameMap.get(r.checkedBy) ?? null,
  }));
}

export async function enrichSettlementWithRequests<T extends typeof s.advanceSettlements.$inferSelect & Record<string, unknown>>(
  settlement: T,
  executor: DbLike = db,
) {
  const links = await executor.select()
    .from(s.advanceSettlementRequests)
    .where(eq(s.advanceSettlementRequests.settlementId, settlement.id));
  const requestIds = links.map(l => l.advanceRequestId);
  let linkedRequests: Array<typeof s.advanceRequests.$inferSelect & { allocatedAmount: string }> = [];
  if (requestIds.length > 0) {
    const requests = await executor.select()
      .from(s.advanceRequests)
      .where(inArray(s.advanceRequests.id, requestIds));
    const linkByRequest = new Map(links.map(link => [link.advanceRequestId, link]));
    linkedRequests = requests.map(request => ({
      ...request,
      allocatedAmount: linkByRequest.get(request.id)?.allocatedAmount ?? request.amount,
    }));
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

/** Clamp shared by both advance list paginators. */
export function clampPageLimit(page: number | undefined, limit: number | undefined, defaultLimit: number): { page: number; limit: number } {
  return {
    page: Math.max(1, Math.floor(page || 1)),
    limit: Math.min(500, Math.max(1, Math.floor(limit || defaultLimit))),
  };
}

/**
 * Compatibility for recorded trip expenses explicitly paid from OPS_ADVANCE.
 * Reconcile only funded, unconsumed advances against the existing expense;
 * this offset does not create a cash movement. Accounting-source expenses use
 * the explicit reconciliation command instead and are excluded here.
 *
 * Guarded so it never double-posts:
 *  - skips when the expense is already linked to a non-dead settlement (the
 *    manual batch flow records expenses via the same hook);
 *  - skips unless settlementMethod = OPS_ADVANCE with a forwarderId
 *    (COMPANY_DIRECT expenses were never fronted by Ops; drivers have no
 *    advances today — PRD's "Lái xe" is forwarder-scoped here);
 *  - skips when the forwarder has no outstanding advance (nothing to offset).
 *
 * Idempotent: re-running on an already-offset expense finds the existing link
 * and returns early.
 */
export async function autoOffsetRecordedExpense(tx: Tx, expenseId: number): Promise<void> {
  const [initialExpense] = await tx.select()
    .from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);

  if (!initialExpense) return;
  if (!['RECORDED', 'APPROVED'].includes(initialExpense.approvalStatus)) return;
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
      eq(s.advanceRequests.status, 'RECORDED'),
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
  if (!['RECORDED', 'APPROVED'].includes(expense.approvalStatus)) return;
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
      notInArray(s.advanceSettlements.status, ['VOIDED', 'REVERSED']),
    ))
    .limit(1);
  if (existingLink) return;
  // Sources managed by expense accounting allocate advances explicitly in the
  // reconciliation command. Confirmation alone must never consume the balance.
  const [accountingSource] = await tx.select({ id: s.expenseAccountingSources.id })
    .from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.linkedTripExpenseId, expenseId)).limit(1);
  if (accountingSource) return;

  // Lock recorded requests before calculating their cash-backed residuals.
  const candidates = await tx.select({
    id: s.advanceRequests.id,
    amount: s.advanceRequests.amount,
    approvedAt: s.advanceRequests.approvedAt,
  }).from(s.advanceRequests)
    .where(and(
      eq(s.advanceRequests.requesterId, forwarderId),
      eq(s.advanceRequests.status, 'RECORDED'),
    ))
    .orderBy(desc(s.advanceRequests.approvedAt), s.advanceRequests.id)
    .for('update');

  const allocatedByRequest = await getAdvanceConsumedAmounts(tx, candidates.map(candidate => candidate.id));
  const fundedByRequest = await getAdvanceFundedAmounts(tx, candidates.map(candidate => candidate.id));

  // approvedAt is the retained legacy timestamp for direct recording.
  // Consume the oldest funded requests first.
  const available = candidates
    .map((candidate) => ({
      ...candidate,
      remainingAmount: round2dp(
        Math.min(Number(candidate.amount), fundedByRequest.get(candidate.id) ?? 0) - (allocatedByRequest.get(candidate.id) ?? 0),
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

  // If funded advances cannot cover the expense, leave it for explicit
  // reconciliation instead of overdrawing the available principal.
  if (remainingExpenseAmount > 0) return;

  // Record the allocation with its expense link and ledger effect atomically.
  const code = await generateSettlementCode(tx);
  const [trip] = await tx.select({ tripCode: s.trips.tripCode })
    .from(s.trips).where(eq(s.trips.id, expense.tripId)).limit(1);
  const [settlement] = await tx.insert(s.advanceSettlements).values({
    code,
    forwarderId,
    totalExpenseAmount: String(amount),
    refundAmount: '0',
    status: 'RECORDED',
    autoOffsetExpenseId: expense.id,
    note: `Tự đối trừ tạm ứng chi hộ chuyến ${trip?.tripCode ?? expense.tripId} (O2C Bước 4)`,
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
    note: `Đối trừ tạm ứng khi ghi nhận chi hộ chuyến ${trip?.tripCode ?? expense.tripId}`,
  });
}

// Cash-backed remaining principal, shared by the wallet, catalog and legacy
// settlement entry points. A RECORDED request without money is not an advance.
export async function getOutstandingAdvanceBalances(forwarderUserId?: number): Promise<{
  totalOutstanding: number;
  items: Array<{ forwarderId: number; name: string | null; outstanding: number }>;
}> {
  const rows = await db.select({ request: s.advanceRequests, name: s.users.fullName }).from(s.advanceRequests)
    .innerJoin(s.users, eq(s.users.id, s.advanceRequests.requesterId))
    .where(and(eq(s.advanceRequests.status, 'RECORDED'), forwarderUserId ? eq(s.advanceRequests.requesterId, forwarderUserId) : undefined));
  const ids = rows.map(row => row.request.id);
  const [funded, consumed] = await Promise.all([getAdvanceFundedAmounts(db, ids), getAdvanceConsumedAmounts(db, ids)]);
  const grouped = new Map<number, { forwarderId: number; name: string | null; outstanding: number }>();
  for (const { request, name } of rows) {
    const amount = Math.max(0, Math.min(Number(request.amount), funded.get(request.id) ?? 0) - (consumed.get(request.id) ?? 0));
    if (!amount) continue;
    const row = grouped.get(request.requesterId) ?? { forwarderId: request.requesterId, name, outstanding: 0 };
    row.outstanding = round2dp(row.outstanding + amount); grouped.set(request.requesterId, row);
  }
  const items = [...grouped.values()];
  return { items, totalOutstanding: round2dp(items.reduce((total, row) => total + row.outstanding, 0)) };
}
export async function getOutstandingAdvanceBalance(forwarderUserId?: number): Promise<number> {
  return (await getOutstandingAdvanceBalances(forwarderUserId)).totalOutstanding;
}
