/**
 * Advance settlements (phiếu hoàn ứng) — creation, listings, accounting
 * check, and approval with ledger posting. Split from advance.service.ts;
 * re-exported through the advance.service facade.
 */
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, desc, inArray, isNull, notInArray, ne, sql, count, sum } from 'drizzle-orm';
import { NotificationType, TxnType, round2dp } from '@tingting/shared';
import { ApiError } from '../errors';
import { LedgerService } from './ledger.service';
import { emitNotification } from './notification.service';
import {
  AdvanceError,
  assertCurrentForwarderExpenseAssignments,
  validateSettlementInputs,
} from './settlement-validation';
import type { Tx } from './trip-shared';
import {
  resolveCustomerPaymentDueDate,
  type PaymentDatePolicy,
} from './business-calendar.service';
import { propagateExpenseApprovals } from './source-change.service';
import {
  assertExpectedVersion,
  clampPageLimit,
  enrichSettlementWithRequests,
  enrichWithNames,
  expenseSnapshot,
  generateSettlementCode,
  type DbLike,
} from './advance-shared.service';

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

function buildAdvanceSettlementConditions(filters?: { forwarderId?: number; status?: string }) {
  const conditions = [];
  if (filters?.forwarderId) conditions.push(eq(s.advanceSettlements.forwarderId, filters.forwarderId));
  if (filters?.status) {
    // Comma-separated status lists (e.g. "PENDING,CHECKED_BY_ACCOUNTANT")
    // select a composite tab in one query. Vocabulary derives from the schema
    // enum so a new status only changes the enum, never these call sites.
    type SettlementStatus = typeof s.advanceSettlementStatusEnum.enumValues[number];
    const statuses = filters.status.split(',').map((v) => v.trim()).filter(Boolean);
    // Unknown labels would reach Postgres as an invalid enum literal (22P02)
    // and 500 the list endpoint; validate against the same enum vocabulary.
    const valid = new Set<string>(s.advanceSettlementStatusEnum.enumValues);
    const unknown = statuses.filter((v) => !valid.has(v));
    if (unknown.length > 0) {
      throw new ApiError(400, `Trạng thái tất toán không hợp lệ: ${unknown.join(', ')}`);
    }
    const typed = statuses as SettlementStatus[];
    conditions.push(typed.length === 1
      ? eq(s.advanceSettlements.status, typed[0])
      : inArray(s.advanceSettlements.status, typed));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listAdvanceSettlements(filters?: { forwarderId?: number; status?: string; page?: number; limit?: number }) {
  const where = buildAdvanceSettlementConditions(filters);

  const base = db.select()
    .from(s.advanceSettlements)
    .where(where)
    .orderBy(desc(s.advanceSettlements.createdAt));
  // Pagination is applied in SQL (never a client-side slice of the full set);
  // callers that omit page/limit keep the full-array behavior.
  const rows = filters?.limit != null
    ? await base.limit(filters.limit).offset((Math.max(1, filters.page ?? 1) - 1) * filters.limit)
    : await base;

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
  /** Full-set totalExpenseAmount per status for the page's KPI strip. */
  statusAmounts: Record<string, number>;
  /** Full-set totals for the page's KPI strip. */
  totals: { totalExpenseAmount: number; pendingCount: number };
}

/**
 * SQL-paginated + summarized listing for the HTTP list routes. Page rows come
 * from a LIMIT/OFFSET query (never an in-memory slice of the full set).
 * statusCounts/totals are FULL-set aggregates (status filter excluded) so
 * KPIs/filter pills stay stable across tabs; total/totalPages describe the
 * filtered set for the pager. Callers that need the full array (admin ops)
 * keep calling listAdvanceSettlements directly.
 */
export async function listAdvanceSettlementsPaginated(filters: {
  forwarderId?: number;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedAdvanceSettlements> {
  const { page, limit } = clampPageLimit(filters.page, filters.limit, 50);
  const where = buildAdvanceSettlementConditions(filters);
  const whereAll = buildAdvanceSettlementConditions({ forwarderId: filters.forwarderId });

  const [enriched, aggRows, statusRows, filteredCountRows] = await Promise.all([
    listAdvanceSettlements({ ...filters, page, limit }),
    db.select({
      total: count(),
      totalExpenseAmount: sum(s.advanceSettlements.totalExpenseAmount),
    }).from(s.advanceSettlements).where(whereAll),
    db.select({
      status: s.advanceSettlements.status,
      count: count(),
      totalExpenseAmount: sum(s.advanceSettlements.totalExpenseAmount),
    }).from(s.advanceSettlements).where(whereAll).groupBy(s.advanceSettlements.status),
    db.select({ total: count() }).from(s.advanceSettlements).where(where),
  ]);

  const statusCounts: Record<string, number> = {};
  const statusAmounts: Record<string, number> = {};
  for (const row of statusRows) {
    statusCounts[row.status] = row.count;
    statusAmounts[row.status] = Number(row.totalExpenseAmount ?? 0);
  }
  const filteredTotal = Number(filteredCountRows[0]?.total ?? 0);
  return {
    items: enriched,
    page,
    limit,
    total: filteredTotal,
    totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
    statusCounts,
    statusAmounts,
    totals: {
      totalExpenseAmount: Number(aggRows[0]?.totalExpenseAmount ?? 0),
      pendingCount: statusCounts['PENDING'] ?? 0,
    },
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
    // 2026-09-10 (phê duyệt removed): settlements apply at creation — the
    // creator self-approves (approvedBy = forwarder), so the segregation
    // guards (forwarder-self, expense-maker, checker≠approver) are gone.
    // PENDING is the live path; CHECKED_BY_ACCOUNTANT remains accepted for
    // legacy rows approved through internal callers.
    if (settlement.status !== 'CHECKED_BY_ACCOUNTANT' && settlement.status !== 'PENDING') {
      throw new AdvanceError(409, `Cannot approve settlement with status ${settlement.status}`);
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
    // 2026-09-10 (phê duyệt removed): the expense-maker self-approval guard is
    // gone — the settlement applies at creation with the forwarder (whose own
    // expenses are in it) as the approver.

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
        inArray(s.advanceSettlements.status, ['PENDING', 'CHECKED_BY_ACCOUNTANT']),
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
