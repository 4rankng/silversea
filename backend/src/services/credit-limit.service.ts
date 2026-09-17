import { and, count, desc, eq, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { ROLE_LABELS, Role, TripStatus } from '@tingting/shared';
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { getAppSettings } from './app-settings.service';

const DEFAULT_WARNING_THRESHOLD = 0.8;
const TIER_ONE_MAX_RATIO = 0.1;
const CREDIT_REQUESTABLE_ROLES = new Set<Role>([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]);

type DbLike = Tx | typeof db;
type CreditOverrideRow = typeof s.creditOverrideRequests.$inferSelect;
export type CreditOverrideWorkflowStatus =
  | 'RECORDED'
  | 'PENDING_CHECK'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'RETURNED_FOR_EVIDENCE'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED';
export type CreditOverrideView = Omit<CreditOverrideRow, 'version'> & {
  version: number;
  requestVersion: number;
  workflowStatus: CreditOverrideWorkflowStatus;
  customerName?: string | null;
  shipmentCode?: string | null;
  requestedByName?: string | null;
};

export interface CreditOverrideListResult {
  items: CreditOverrideView[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

type CreditOverrideCursor = {
  createdAt: Date;
  id: number;
  /** Present only when paginating an engaged column sort: the sort identity
   * (key + dir) plus the last row's serialized sort value for keyset
   * continuation. Absent on default-order cursors, which stay byte-identical. */
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  sortValue?: string | null;
};

function decodeCreditOverrideCursor(raw: string): CreditOverrideCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
      sortKey?: unknown;
      sortDir?: unknown;
      sortValue?: unknown;
    };
    const createdAt = typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : new Date(Number.NaN);
    if (!Number.isFinite(createdAt.getTime()) || !Number.isInteger(parsed.id) || Number(parsed.id) <= 0) {
      throw new Error('invalid cursor');
    }
    const sortKey = typeof parsed.sortKey === 'string' ? parsed.sortKey : undefined;
    const sortDir = parsed.sortDir === 'asc' || parsed.sortDir === 'desc' ? parsed.sortDir : undefined;
    if ((sortKey == null) !== (sortDir == null)) throw new Error('invalid cursor');
    const sortValue = parsed.sortValue == null || typeof parsed.sortValue === 'string' ? parsed.sortValue : undefined;
    return { createdAt, id: Number(parsed.id), ...(sortKey && sortDir ? { sortKey, sortDir, sortValue: sortValue ?? null } : {}) };
  } catch {
    throw new ApiError(400, 'Vị trí trang danh sách không hợp lệ');
  }
}

function encodeCreditOverrideCursor(row: CreditOverrideRow): string {
  return Buffer.from(JSON.stringify({
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  }), 'utf8').toString('base64url');
}

function encodeCreditOverrideSortCursor(
  row: CreditOverrideRow,
  sortKey: CreditOverrideSortKey,
  sortDir: 'asc' | 'desc',
  sortValue: unknown,
): string {
  const serialized = sortValue == null
    ? null
    : sortValue instanceof Date ? sortValue.toISOString() : String(sortValue);
  return Buffer.from(JSON.stringify({
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    sortKey,
    sortDir,
    sortValue: serialized,
  }), 'utf8').toString('base64url');
}

export interface CreditCheckResult {
  customerId: number;
  creditLimit: number | null;
  warningThreshold: number;
  outstanding: number;
  approvedUncollected: number;
  proposedAmount: number;
  totalExposure: number;
  utilization: number | null;
  exceedsWarning: boolean;
  exceedsLimit: boolean;
  overLimitAmount: number;
  overLimitRatio: number;
}

export interface CreditOverrideActor {
  userId: number;
  role: Role;
}

export interface CreditOverrideRequestInput {
  customerId: number;
  proposedAmount: number;
  reason: string;
  shipmentId?: number | null;
  expiresAt?: string | null;
}

export interface CreditEnforcementResult extends CreditCheckResult {
  overridden: boolean;
  overrideRequest: CreditOverrideRow | null;
}

function toMoney(value: string | number | null | undefined): number {
  return value == null ? 0 : Number(value);
}

function normalizeReason(reason: string): string {
  return reason.trim();
}

function normalizeFutureDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, 'Ngày hết hạn không hợp lệ');
  }
  return parsed;
}

function assertCanRequestOverride(role: Role): void {
  if (!CREDIT_REQUESTABLE_ROLES.has(role)) {
    throw new ApiError(403, 'Vai trò hiện tại không được tạo đề nghị vượt hạn mức');
  }
}

function toCreditOverrideView(request: CreditOverrideRow): CreditOverrideView {
  const workflowStatus: CreditOverrideWorkflowStatus = request.status === 'AUTHORIZED' ? 'RECORDED' : request.status === 'APPROVED'
    ? 'APPROVED'
    : request.status === 'REJECTED'
      ? 'REJECTED'
      : request.status === 'CANCELED'
        ? 'CANCELED'
        : 'PENDING_CHECK';
  return {
    ...request,
    version: request.version,
    requestVersion: request.version,
    workflowStatus,
  };
}

async function enrichCreditOverrideViews(
  views: CreditOverrideView[],
  requesterRole: Role,
): Promise<CreditOverrideView[]> {
  if (views.length === 0) return views;

  const customerIds = [...new Set(views.map((view) => view.customerId))];
  const shipmentIds = [...new Set(
    views.map((view) => view.shipmentId).filter((id): id is number => id != null),
  )];
  const userIds = [...new Set(
    views.map((view) => view.requestedBy)
      .filter((id): id is number => id != null),
  )];

  const [customers, shipments, users] = await Promise.all([
    db.select({ id: s.customers.id, name: s.customers.name })
      .from(s.customers)
      .where(inArray(s.customers.id, customerIds)),
    shipmentIds.length > 0
      ? db.select({ id: s.shipments.id, code: s.shipments.shipmentCode })
        .from(s.shipments)
        .where(inArray(s.shipments.id, shipmentIds))
      : Promise.resolve([]),
    db.select({ id: s.users.id, fullName: s.users.fullName, role: s.users.role })
      .from(s.users)
      .where(and(inArray(s.users.id, userIds), isNull(s.users.deletedAt))),
  ]);

  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
  const shipmentCodes = new Map(shipments.map((shipment) => [shipment.id, shipment.code]));
  const userNames = new Map(users.map((user) => {
    const role = user.role as Role;
    const canSeeName = requesterRole === Role.ADMIN || role !== Role.ADMIN;
    return [
      user.id,
      (canSeeName ? user.fullName?.trim() : '') || ROLE_LABELS[role] || 'Người dùng',
    ];
  }));

  return views.map((view) => ({
    ...view,
    customerName: customerNames.get(view.customerId) ?? null,
    shipmentCode: view.shipmentId == null ? null : shipmentCodes.get(view.shipmentId) ?? null,
    requestedByName: userNames.get(view.requestedBy) ?? null,
  }));
}

async function getApprovedUncollectedAmount(
  customerId: number,
  executor: DbLike,
  options: { excludeCreditOverrideRequestId?: number | null } = {},
): Promise<number> {
  const [activeTrips] = await executor.select({
    total: sql<string>`coalesce(sum(${s.tripsComposite.revenue}), 0)`,
  }).from(s.tripsComposite)
    .where(and(
      eq(s.tripsComposite.customerId, customerId),
      isNull(s.tripsComposite.deletedAt),
      inArray(s.tripsComposite.status, [TripStatus.CREATED, TripStatus.IN_TRANSIT]),
    ));
  const [reservedShipmentApprovals] = await executor.select({
    total: sql<string>`coalesce(sum(${s.creditOverrideRequests.proposedAmount}), 0)`,
  }).from(s.creditOverrideRequests)
    .where(and(
      eq(s.creditOverrideRequests.customerId, customerId),
      inArray(s.creditOverrideRequests.status, ['AUTHORIZED', 'APPROVED']),
      eq(s.creditOverrideRequests.scopeType, 'SHIPMENT'),
      isNull(s.creditOverrideRequests.consumedAt),
      options.excludeCreditOverrideRequestId != null
        ? ne(s.creditOverrideRequests.id, options.excludeCreditOverrideRequestId)
        : undefined,
    ));
  return toMoney(activeTrips?.total) + toMoney(reservedShipmentApprovals?.total);
}

async function getCustomerOutstandingAmount(
  customerId: number,
  executor: DbLike,
): Promise<number> {
  const [result] = await executor.select({
    outstanding: sql<string>`greatest(
      coalesce(sum(${s.ledger.debit}), 0) - coalesce(sum(${s.ledger.credit}), 0),
      0
    )`,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
    ));
  return toMoney(result?.outstanding);
}

async function loadCustomerCreditProfile(customerId: number, executor: DbLike) {
  const [customer] = await executor.select({
    id: s.customers.id,
    creditLimit: s.customers.creditLimit,
    creditWarningThreshold: s.customers.creditWarningThreshold,
  }).from(s.customers)
    .where(and(eq(s.customers.id, customerId), isNull(s.customers.deletedAt)))
    .limit(1);
  if (!customer) {
    throw new ApiError(404, 'Không tìm thấy khách hàng');
  }
  const settings = await getAppSettings();
  const warningThreshold = customer.creditWarningThreshold != null
    ? Number(customer.creditWarningThreshold)
    : settings.creditWarningThresholdDefault ?? DEFAULT_WARNING_THRESHOLD;
  const creditLimit = customer.creditLimit != null ? Number(customer.creditLimit) : null;
  return { creditLimit, warningThreshold };
}

async function loadShipmentForOverride(shipmentId: number, customerId: number, executor: DbLike): Promise<void> {
  const [shipment] = await executor.select({
    id: s.shipments.id,
    customerId: s.shipments.customerId,
  }).from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) {
    throw new ApiError(404, 'Không tìm thấy lô hàng');
  }
  if (shipment.customerId !== customerId) {
    throw new ApiError(400, 'Lô hàng không thuộc khách hàng đề nghị vượt hạn mức');
  }
}

async function hasPriorApprovedOverride(customerId: number, executor: DbLike): Promise<boolean> {
  const [row] = await executor.select({ total: count() })
    .from(s.creditOverrideRequests)
    .where(and(
      eq(s.creditOverrideRequests.customerId, customerId),
      inArray(s.creditOverrideRequests.status, ['AUTHORIZED', 'APPROVED']),
    ));
  return Number(row?.total ?? 0) > 0;
}

function buildOverLimitMessage(result: CreditCheckResult): string {
  const limit = result.creditLimit?.toLocaleString('vi-VN') ?? '0';
  const exposure = result.totalExposure.toLocaleString('vi-VN');
  const excess = result.overLimitAmount.toLocaleString('vi-VN');
  return `Khách hàng đã vượt hạn mức tín dụng (hạn mức: ${limit} ₫, phơi nhiễm: ${exposure} ₫, phần vượt: ${excess} ₫). Chỉ người có quyền ghi nhận ngoại lệ tín dụng mới có thể tiếp tục.`;
}

export async function checkCreditLimit(
  customerId: number,
  options: {
    proposedAmount?: number;
    transaction?: Tx;
    excludeCreditOverrideRequestId?: number | null;
  } = {},
): Promise<CreditCheckResult> {
  const executor = options.transaction ?? db;
  const proposedAmount = Math.max(0, Math.trunc(options.proposedAmount ?? 0));
  const [{ creditLimit, warningThreshold }, outstanding, approvedUncollected] = await Promise.all([
    loadCustomerCreditProfile(customerId, executor),
    getCustomerOutstandingAmount(customerId, executor),
    getApprovedUncollectedAmount(customerId, executor, {
      excludeCreditOverrideRequestId: options.excludeCreditOverrideRequestId,
    }),
  ]);

  const totalExposure = outstanding + approvedUncollected + proposedAmount;
  const utilization = creditLimit && creditLimit > 0 ? totalExposure / creditLimit : null;
  const overLimitAmount = creditLimit != null ? Math.max(0, totalExposure - creditLimit) : 0;
  const overLimitRatio = creditLimit && creditLimit > 0 ? overLimitAmount / creditLimit : 0;
  const exceedsWarning = creditLimit != null && totalExposure >= creditLimit * warningThreshold;
  const exceedsLimit = creditLimit != null && totalExposure >= creditLimit;

  return {
    customerId,
    creditLimit,
    warningThreshold,
    outstanding,
    approvedUncollected,
    proposedAmount,
    totalExposure,
    utilization,
    exceedsWarning,
    exceedsLimit,
    overLimitAmount,
    overLimitRatio,
  };
}

function deriveRequiredTier(
  result: CreditCheckResult,
  tierOneAmountCap: number,
  repeatException: boolean,
): CreditOverrideRow['requiredTier'] {
  if (repeatException) return 'DIRECTOR';
  if (result.overLimitRatio > TIER_ONE_MAX_RATIO) return 'DIRECTOR';
  if (tierOneAmountCap <= 0) return 'DIRECTOR';
  if (result.overLimitAmount > tierOneAmountCap) return 'DIRECTOR';
  return 'FINANCE_TIER_1';
}

export async function createCreditOverrideRequest(
  input: CreditOverrideRequestInput,
  actor: CreditOverrideActor,
  transaction?: Tx,
): Promise<CreditOverrideView> {
  assertCanRequestOverride(actor.role);
  const reason = normalizeReason(input.reason);
  if (!reason) {
    throw new ApiError(400, 'Lý do vượt hạn mức là bắt buộc');
  }
  const scopeType = input.shipmentId != null ? 'SHIPMENT' : 'EXPIRY';
  if (scopeType === 'SHIPMENT' && input.expiresAt) {
    throw new ApiError(400, 'Đề nghị theo lô/chuyến không được có ngày hết hạn');
  }
  if (scopeType === 'EXPIRY' && !input.expiresAt) {
    throw new ApiError(400, 'Đề nghị theo thời hạn phải có ngày hết hạn');
  }
  const expiresAt = normalizeFutureDate(input.expiresAt);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new ApiError(400, 'Ngày hết hạn phải ở tương lai');
  }

  const execute = async (tx: Tx) => {
    if (input.shipmentId != null) {
      await loadShipmentForOverride(input.shipmentId, input.customerId, tx);
    }
    const [settings, result, repeatException] = await Promise.all([
      getAppSettings(),
      checkCreditLimit(input.customerId, { proposedAmount: input.proposedAmount, transaction: tx }),
      hasPriorApprovedOverride(input.customerId, tx),
    ]);
    if (result.creditLimit == null) {
      throw new ApiError(400, 'Khách hàng chưa có hạn mức tín dụng nên không cần đề nghị vượt hạn mức');
    }
    if (!result.exceedsLimit) {
      throw new ApiError(400, 'Phơi nhiễm hiện tại chưa vượt hạn mức nên không cần đề nghị');
    }
    const requiredTier = deriveRequiredTier(
      result,
      Math.max(0, Math.trunc(settings.creditTierOneAmountCap ?? 0)),
      repeatException,
    );
    if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && !(actor.role === Role.ACCOUNTANT && requiredTier === 'FINANCE_TIER_1')) {
      throw new ApiError(403, 'Ngoại lệ vượt quyền tài chính hiện tại; cần Quản lý ghi nhận trực tiếp.');
    }
    const [request] = await tx.insert(s.creditOverrideRequests).values({
      customerId: input.customerId,
      shipmentId: input.shipmentId ?? null,
      scopeType,
      status: 'AUTHORIZED',
      requiredTier,
      reason,
      requestedBy: actor.userId,
      requestedRole: actor.role,
      proposedAmount: String(result.proposedAmount),
      outstandingAmount: String(result.outstanding),
      approvedCommitmentAmount: String(result.approvedUncollected),
      totalExposure: String(result.totalExposure),
      creditLimit: String(result.creditLimit),
      warningThreshold: String(result.warningThreshold),
      overLimitAmount: String(result.overLimitAmount),
      overLimitRatio: String(result.overLimitRatio),
      repeatException,
      expiresAt,
    }).returning();

    await tx.insert(s.auditLogs).values({ userId: actor.userId, entityType: 'credit-exception', entityId: request.id, message: 'Ghi nhận ngoại lệ tín dụng trực tiếp', payload: { customerId: input.customerId, reason, scopeType, expiresAt: expiresAt?.toISOString() ?? null, totalExposure: result.totalExposure, actorRole: actor.role } });
    return toCreditOverrideView(request);
  };
  return runInTx(transaction, execute);
}

/** Sortable columns of the credit-override queue (URL-facing sortBy vocabulary). */
export const CREDIT_OVERRIDE_SORT_KEYS = [
  'createdAt',
  'customerName',
  'status',
  'requestedByName',
  'proposedAmount',
  'outstandingAmount',
  'creditLimit',
  'overLimitAmount',
  'expiresAt',
  'reason',
] as const;
export type CreditOverrideSortKey = typeof CREDIT_OVERRIDE_SORT_KEYS[number];

// Column-sort whitelist for the queue. Money/limit columns are snapshotted on
// the request row itself (numeric), so they sort directly; customer and
// requester names are attached post-query by enrichCreditOverrideViews, so
// they sort via correlated scalar subqueries — one value per row, no join
// fan-out. status ranks attention-first (PENDING before decided). `cast` is
// how a cursor's serialized sort value is typed back for keyset comparison.
type CreditOverrideSortSpec = { expr: SQL; cast: 'numeric' | 'timestamptz' | 'text' };
const CREDIT_OVERRIDE_SORT_SQL: Record<CreditOverrideSortKey, CreditOverrideSortSpec> = {
  createdAt: {
    expr: sql`${s.creditOverrideRequests.createdAt}`,
    cast: 'timestamptz',
  },
  customerName: {
    expr: sql`(
      select ${s.customers.name}
      from ${s.customers}
      where ${s.customers.id} = ${s.creditOverrideRequests.customerId}
    )`,
    cast: 'text',
  },
  status: {
    expr: sql`case
      when ${s.creditOverrideRequests.status} = 'PENDING' then 0
      when ${s.creditOverrideRequests.status} = 'APPROVED' then 1
      when ${s.creditOverrideRequests.status} = 'REJECTED' then 2
      else 3
    end`,
    cast: 'numeric',
  },
  requestedByName: {
    expr: sql`(
      select ${s.users.fullName}
      from ${s.users}
      where ${s.users.id} = ${s.creditOverrideRequests.requestedBy}
    )`,
    cast: 'text',
  },
  proposedAmount: { expr: sql`${s.creditOverrideRequests.proposedAmount}`, cast: 'numeric' },
  outstandingAmount: { expr: sql`${s.creditOverrideRequests.outstandingAmount}`, cast: 'numeric' },
  creditLimit: { expr: sql`${s.creditOverrideRequests.creditLimit}`, cast: 'numeric' },
  overLimitAmount: { expr: sql`${s.creditOverrideRequests.overLimitAmount}`, cast: 'numeric' },
  expiresAt: { expr: sql`${s.creditOverrideRequests.expiresAt}`, cast: 'timestamptz' },
  reason: { expr: sql`${s.creditOverrideRequests.reason}`, cast: 'text' },
};

/**
 * Keyset continuation for an engaged column sort: rows that come AFTER the
 * cursor row under (`expr dir nulls last`, `id desc`). Asc order continues
 * with LARGER values, desc with smaller ones. With nulls last, a non-null
 * cursor value is followed by the remaining non-null rows in sort direction
 * plus every NULL row; a NULL cursor value is followed only by NULL rows
 * with a smaller id.
 */
function creditOverrideSortContinuation(
  spec: CreditOverrideSortSpec,
  dir: 'asc' | 'desc',
  cursor: { id: number; sortValue: string | null },
): SQL {
  const idCol = s.creditOverrideRequests.id;
  if (cursor.sortValue == null) {
    return sql`(${spec.expr}) is null and ${idCol} < ${cursor.id}`;
  }
  const castValue = sql`cast(${cursor.sortValue} as ${sql.raw(spec.cast)})`;
  const after = dir === 'asc' ? sql`>` : sql`<`;
  return sql`(
    ((${spec.expr}) is not null and (
      (${spec.expr}) ${after} ${castValue}
      or ((${spec.expr}) = ${castValue} and ${idCol} < ${cursor.id})
    ))
    or (${spec.expr}) is null
  )`;
}

export async function listCreditOverrideRequests(filters: {
  customerId?: number;
  status?: CreditOverrideRow['status'];
  limit?: number;
  cursor?: string;
  sortBy?: CreditOverrideSortKey;
  sortDir?: 'asc' | 'desc';
} = {}, requesterRole: Role = Role.ACCOUNTANT): Promise<CreditOverrideListResult> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const cursor = filters.cursor ? decodeCreditOverrideCursor(filters.cursor) : null;
  if (cursor?.sortKey != null) {
    // A sorted cursor can only continue the exact sort it was built from.
    if (cursor.sortKey !== filters.sortBy
      || cursor.sortDir !== (filters.sortDir ?? 'asc')) {
      throw new ApiError(400, 'Thứ tự sắp xếp không khớp với vị trí trang');
    }
  }
  if (cursor != null && cursor.sortKey == null && filters.sortBy != null) {
    // Default-order cursor reused on a sorted request: the continuation
    // tuple would describe a different ordering — reject instead of paging wrong.
    throw new ApiError(400, 'Thứ tự sắp xếp không khớp với vị trí trang');
  }

  const baseConditions = [
    filters.customerId != null
      ? eq(s.creditOverrideRequests.customerId, filters.customerId)
      : undefined,
    filters.status != null
      ? eq(s.creditOverrideRequests.status, filters.status)
      : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => condition != null);

  const hasMoreResults = (rows: unknown[]) => rows.length > limit;
  const buildResult = async (
    requests: CreditOverrideRow[],
    hasMore: boolean,
    nextCursor: string | null,
  ): Promise<CreditOverrideListResult> => {
    const items = await enrichCreditOverrideViews(
      requests.map((request) => toCreditOverrideView(request)),
      requesterRole,
    );
    return { items, limit, hasMore, nextCursor };
  };

  // Engaged column sort: keyset pagination follows the sort column, so both
  // the WHERE continuation and the encoded cursor carry the sort value.
  if (filters.sortBy != null) {
    const spec = CREDIT_OVERRIDE_SORT_SQL[filters.sortBy];
    const dir: 'asc' | 'desc' = filters.sortDir === 'desc' ? 'desc' : 'asc';
    const continuation = cursor?.sortKey != null
      ? creditOverrideSortContinuation(spec, dir, { id: cursor.id, sortValue: cursor.sortValue ?? null })
      : undefined;
    const where = [...baseConditions, continuation]
      .filter((condition): condition is NonNullable<typeof condition> => condition != null);
    const rows = await db.select({ request: s.creditOverrideRequests, sortValue: spec.expr })
      .from(s.creditOverrideRequests)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(
        sql`${spec.expr} ${dir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
        desc(s.creditOverrideRequests.id),
      )
      .limit(limit + 1);
    const hasMore = hasMoreResults(rows);
    const page = rows.slice(0, limit);
    return buildResult(
      page.map((row) => row.request),
      hasMore,
      hasMore && page.length > 0
        ? encodeCreditOverrideSortCursor(
          page[page.length - 1].request,
          filters.sortBy,
          dir,
          page[page.length - 1].sortValue,
        )
        : null,
    );
  }

  // Default order (newest first) — unchanged behavior and cursor encoding.
  const conditions = [
    ...baseConditions,
    cursor
      ? or(
        lt(s.creditOverrideRequests.createdAt, cursor.createdAt),
        and(
          eq(s.creditOverrideRequests.createdAt, cursor.createdAt),
          lt(s.creditOverrideRequests.id, cursor.id),
        ),
      )
      : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => condition != null);
  const rows = await db.select()
    .from(s.creditOverrideRequests)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(s.creditOverrideRequests.createdAt), desc(s.creditOverrideRequests.id))
    .limit(limit + 1);
  const hasMore = hasMoreResults(rows);
  const requests = rows.slice(0, limit);
  return buildResult(
    requests,
    hasMore,
    hasMore && requests.length > 0
      ? encodeCreditOverrideCursor(requests[requests.length - 1])
      : null,
  );
}

export async function getCreditOverrideRequest(
  requestId: number,
  requesterRole: Role = Role.ACCOUNTANT,
): Promise<CreditOverrideView> {
  const [request] = await db.select()
    .from(s.creditOverrideRequests)
    .where(eq(s.creditOverrideRequests.id, requestId))
    .limit(1);
  if (!request) {
    throw new ApiError(404, 'Không tìm thấy đề nghị vượt hạn mức');
  }
  const [view] = await enrichCreditOverrideViews([
    toCreditOverrideView(request),
  ], requesterRole);
  return view;
}

async function loadApprovedOverrideForUse(
  requestId: number,
  customerId: number,
  shipmentId: number | null | undefined,
  tx: Tx,
): Promise<CreditOverrideRow> {
  const [request] = await tx.select()
    .from(s.creditOverrideRequests)
    .where(eq(s.creditOverrideRequests.id, requestId))
    .limit(1)
    .for('update');
  if (!request) {
    throw new ApiError(404, 'Không tìm thấy ngoại lệ tín dụng');
  }
  if (request.customerId !== customerId) {
    throw new ApiError(400, 'Ngoại lệ tín dụng không thuộc khách hàng của chuyến đi');
  }
  if (!['AUTHORIZED', 'APPROVED'].includes(request.status)) throw new ApiError(409, 'Ngoại lệ tín dụng không còn hiệu lực.');
  if (request.scopeType === 'SHIPMENT') {
    if (shipmentId == null || request.shipmentId !== shipmentId) {
      throw new ApiError(409, 'Ngoại lệ tín dụng không áp dụng cho lô hàng này');
    }
    if (request.consumedAt != null) {
      throw new ApiError(409, 'Ngoại lệ tín dụng này đã được sử dụng');
    }
  }
  if (request.scopeType === 'EXPIRY') {
    if (!request.expiresAt || request.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(409, 'Ngoại lệ tín dụng đã hết hạn');
    }
  }
  return request;
}

export interface DirectCreditException {
  reason: string;
  expiresAt: string;
  scopeType: 'SHIPMENT' | 'EXPIRY';
  exposureCeiling: number;
}

/** Saved in the same transaction as its trip: failed trips leave no exception or reservation. */
export async function recordTripCreditException(input: {
  customerId: number; shipmentId?: number | null; proposedAmount: number;
  exception: DirectCreditException; actorId?: number; actorRole?: Role; transaction: Tx;
}): Promise<CreditOverrideRow | null> {
  if (!input.actorId || (input.actorRole !== Role.ADMIN && input.actorRole !== Role.MANAGER)) throw new ApiError(403, 'Chỉ Quản trị viên hoặc Quản lý có quyền ghi nhận ngoại lệ khi tạo chuyến.');
  if (input.exception.scopeType !== 'SHIPMENT') throw new ApiError(400, 'Ngoại lệ khi tạo chuyến chỉ áp dụng một lần cho chuyến này.');
  const reason = normalizeReason(input.exception.reason);
  if (!reason) throw new ApiError(400, 'Nhập lý do ngoại lệ tín dụng.');
  const expiresAt = normalizeFutureDate(input.exception.expiresAt);
  if (!expiresAt || expiresAt.getTime() <= Date.now()) throw new ApiError(409, 'Ngoại lệ tín dụng đã hết hạn.');
  if (input.shipmentId != null) await loadShipmentForOverride(input.shipmentId, input.customerId, input.transaction);
  const result = await checkCreditLimit(input.customerId, { proposedAmount: input.proposedAmount, transaction: input.transaction });
  if (!Number.isSafeInteger(input.exception.exposureCeiling) || input.exception.exposureCeiling <= 0 || input.exception.exposureCeiling > 999_999_999_999_999 || result.totalExposure > input.exception.exposureCeiling) throw new ApiError(409, 'Tổng dư nợ và cam kết hiện tại vượt mức ngoại lệ đã nhập. Kiểm tra lại hạn mức trước khi lưu.');
  if (!result.exceedsLimit) return null;
  const [record] = await input.transaction.insert(s.creditOverrideRequests).values({
    customerId: input.customerId, shipmentId: input.shipmentId ?? null,
    scopeType: 'SHIPMENT', status: 'AUTHORIZED', requiredTier: 'DIRECTOR', reason,
    requestedBy: input.actorId, requestedRole: input.actorRole,
    proposedAmount: String(result.proposedAmount), outstandingAmount: String(result.outstanding),
    approvedCommitmentAmount: String(result.approvedUncollected), totalExposure: String(input.exception.exposureCeiling),
    creditLimit: String(result.creditLimit), warningThreshold: String(result.warningThreshold),
    overLimitAmount: String(result.overLimitAmount), overLimitRatio: String(result.overLimitRatio), expiresAt,
  }).returning();
  await input.transaction.insert(s.auditLogs).values({ userId: input.actorId, entityType: 'credit-exception', entityId: record.id, message: 'Ngoại lệ tín dụng cho chuyến được ghi nhận trực tiếp', payload: { reason, customerId: input.customerId, exposure: result.totalExposure, exposureCeiling: input.exception.exposureCeiling, expiresAt: expiresAt.toISOString(), singleUse: true } });
  return record;
}

export async function assertCreditLimit(input: {
  customerId: number;
  proposedAmount?: number;
  approvalRequestId?: number | null;
  shipmentId?: number | null;
  transaction: Tx;
}): Promise<CreditEnforcementResult> {
  let overrideRequest: CreditOverrideRow | null = null;
  if (input.approvalRequestId != null) {
    overrideRequest = await loadApprovedOverrideForUse(
      input.approvalRequestId,
      input.customerId,
      input.shipmentId,
      input.transaction,
    );
  }
  const result = await checkCreditLimit(input.customerId, {
    proposedAmount: input.proposedAmount,
    transaction: input.transaction,
    excludeCreditOverrideRequestId: overrideRequest?.scopeType === 'SHIPMENT' ? overrideRequest.id : null,
  });
  if (overrideRequest) {
    if (result.totalExposure > toMoney(overrideRequest.totalExposure)) {
      throw new ApiError(409, 'Phơi nhiễm hiện tại đã vượt mức đã ghi nhận');
    }
    if (result.proposedAmount > toMoney(overrideRequest.proposedAmount)) {
      throw new ApiError(409, 'Giá trị chuyến đi vượt quá giá trị đã đã ghi nhận');
    }
  }
  if (result.exceedsLimit && !overrideRequest) {
    throw new ApiError(403, buildOverLimitMessage(result));
  }
  return {
    ...result,
    overridden: overrideRequest != null,
    overrideRequest,
  };
}

export async function consumeShipmentCreditOverride(
  request: CreditOverrideRow | null,
  tripId: number,
  tx: Tx,
): Promise<void> {
  if (!request || request.scopeType !== 'SHIPMENT') return;
  const [consumed] = await tx.update(s.creditOverrideRequests)
    .set({
      consumedTripId: tripId,
      consumedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(s.creditOverrideRequests.id, request.id),
      isNull(s.creditOverrideRequests.consumedAt),
    ))
    .returning();
  if (!consumed) {
    throw new ApiError(409, 'Ngoại lệ tín dụng đã được sử dụng bởi tác vụ khác');
  }
}
