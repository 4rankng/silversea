/**
 * Advance requests (tạm ứng) — creation, listings, and maker/checker/approver
 * governance. Split from advance.service.ts; re-exported through the
 * advance.service facade.
 */
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, desc, inArray, notInArray, ilike, sql, count, sum, type SQL } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { AdvanceError } from './settlement-validation';
import type { Tx } from './trip-shared';
import { escapeLikeTerm } from '../lib/format';
import { assertCanMakeGovernanceAction } from './governance-policy';
import type { GovernanceApplyResult, GovernanceActionRow } from './governance-transition.service';
import { assertExpectedVersion, clampPageLimit, enrichWithNames } from './advance-shared.service';

export async function createAdvanceRequest(
  requesterId: number,
  data: { amount: number; reason: string },
  transaction?: Tx,
) {
  const executor = transaction ?? db;
  // Snapshot the requester's name up front so the approval trail survives
  // later account removal (enrichWithNames falls back to this snapshot).
  const [requester] = await executor.select({ fullName: s.users.fullName })
    .from(s.users)
    .where(eq(s.users.id, requesterId))
    .limit(1);
  const [inserted] = await executor.insert(s.advanceRequests).values({
    requesterId,
    requesterNameSnapshot: requester?.fullName?.trim() || null,
    amount: String(data.amount),
    reason: data.reason,
    status: 'PENDING',
  }).returning();
  const [enriched] = await enrichWithNames([inserted], executor);
  return enriched;
}

function buildAdvanceRequestConditions(filters?: {
  requesterId?: number;
  status?: string;
  search?: string;
  excludeLinkedToActiveSettlement?: boolean;
}) {
  const conditions = [];
  if (filters?.requesterId) conditions.push(eq(s.advanceRequests.requesterId, filters.requesterId));
  if (filters?.status) conditions.push(eq(s.advanceRequests.status, filters.status as typeof s.advanceRequests.$inferSelect.status));
  if (filters?.search) {
    // Requester names are attached post-query by enrichWithNames, so search runs
    // in SQL as an IN subquery over users.fullName — it composes with the
    // LIMIT/OFFSET pagination instead of post-filtering the page.
    const pattern = `%${escapeLikeTerm(filters.search)}%`;
    conditions.push(inArray(
      s.advanceRequests.requesterId,
      db.select({ id: s.users.id }).from(s.users).where(ilike(s.users.fullName, pattern)),
    ));
  }
  if (filters?.excludeLinkedToActiveSettlement) {
    const claimedRequestIds = db.select({ id: s.advanceSettlementRequests.advanceRequestId })
      .from(s.advanceSettlementRequests)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.advanceSettlementRequests.settlementId))
      .where(notInArray(s.advanceSettlements.status, ['REJECTED', 'REVERSED']));
    conditions.push(notInArray(s.advanceRequests.id, claimedRequestIds));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Sortable columns of the advance-requests list (URL-facing sortBy vocabulary). */
export const ADVANCE_REQUEST_SORT_KEYS = [
  'requesterName',
  'amount',
  'createdAt',
  'status',
  'reason',
] as const;
export type AdvanceRequestSortKey = typeof ADVANCE_REQUEST_SORT_KEYS[number];

// Column-sort whitelist. Requester names are attached post-query by
// enrichWithNames, so requesterName sorts via a correlated scalar subquery
// over users.fullName — one value per row, no row-multiplying join. status
// ranks attention-first (PENDING before decided) instead of by the enum's
// alphabetical order.
const ADVANCE_REQUEST_SORT_SQL: Record<AdvanceRequestSortKey, SQL> = {
  requesterName: sql`(
    select ${s.users.fullName}
    from ${s.users}
    where ${s.users.id} = ${s.advanceRequests.requesterId}
  )`,
  amount: sql`${s.advanceRequests.amount}`,
  createdAt: sql`${s.advanceRequests.createdAt}`,
  status: sql`case
    when ${s.advanceRequests.status} = 'PENDING' then 0
    when ${s.advanceRequests.status} = 'APPROVED' then 1
    else 2
  end`,
  reason: sql`${s.advanceRequests.reason}`,
};

function advanceRequestOrderBy(filters?: {
  sortBy?: AdvanceRequestSortKey;
  sortDir?: 'asc' | 'desc';
}): SQL[] {
  if (!filters?.sortBy) return [desc(s.advanceRequests.createdAt)];
  return [
    sql`${ADVANCE_REQUEST_SORT_SQL[filters.sortBy]} ${filters.sortDir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
    desc(s.advanceRequests.id),
  ];
}

export async function listAdvanceRequests(filters?: {
  requesterId?: number;
  status?: string;
  search?: string;
  excludeLinkedToActiveSettlement?: boolean;
  page?: number;
  limit?: number;
  sortBy?: AdvanceRequestSortKey;
  sortDir?: 'asc' | 'desc';
}) {
  const where = buildAdvanceRequestConditions(filters);

  const base = db.select()
    .from(s.advanceRequests)
    .where(where)
    .orderBy(...advanceRequestOrderBy(filters));
  // Pagination is applied in SQL (never a client-side slice of the full set);
  // callers that omit page/limit keep the full-array behavior.
  const rows = filters?.limit != null
    ? await base.limit(filters.limit).offset((Math.max(1, filters.page ?? 1) - 1) * filters.limit)
    : await base;
  return enrichWithNames(rows);
}

export interface PaginatedAdvanceRequests {
  items: Awaited<ReturnType<typeof listAdvanceRequests>>;
  page: number;
  limit: number;
  /** Alias of `limit` for PaginatedResponse-shaped consumers. */
  pageSize: number;
  total: number;
  totalPages: number;
  /** Full-set status counts for the page's filter pills. */
  statusCounts: Record<string, number>;
  /** Full-set amount totals per status for the page's KPI strip. */
  statusAmounts: Record<string, number>;
}

/**
 * SQL-paginated listing for the HTTP list routes (admin + forwarder-scoped).
 * statusCounts/statusAmounts are FULL-set aggregates (status/search/eligibility
 * filters excluded) so KPIs/filter pills stay stable across tabs;
 * total/totalPages describe the filtered set for the pager.
 */
export async function listAdvanceRequestsPaginated(filters: {
  requesterId?: number;
  status?: string;
  search?: string;
  excludeLinkedToActiveSettlement?: boolean;
  page?: number;
  limit?: number;
  sortBy?: AdvanceRequestSortKey;
  sortDir?: 'asc' | 'desc';
}): Promise<PaginatedAdvanceRequests> {
  const { page, limit } = clampPageLimit(filters.page, filters.limit, 50);
  const where = buildAdvanceRequestConditions(filters);
  const whereAll = buildAdvanceRequestConditions({ requesterId: filters.requesterId });

  const [items, statusRows, filteredCountRows] = await Promise.all([
    listAdvanceRequests({ ...filters, page, limit }),
    db.select({
      status: s.advanceRequests.status,
      count: count(),
      amount: sum(s.advanceRequests.amount),
    }).from(s.advanceRequests)
      .where(whereAll)
      .groupBy(s.advanceRequests.status),
    db.select({ total: count() }).from(s.advanceRequests).where(where),
  ]);

  const statusCounts: Record<string, number> = {};
  const statusAmounts: Record<string, number> = {};
  for (const row of statusRows) {
    statusCounts[row.status] = row.count;
    statusAmounts[row.status] = Number(row.amount ?? 0);
  }
  const filteredTotal = Number(filteredCountRows[0]?.total ?? 0);
  return {
    items,
    page,
    limit,
    pageSize: limit,
    total: filteredTotal,
    totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
    statusCounts,
    statusAmounts,
  };
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
