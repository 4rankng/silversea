import { and, count, desc, eq, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { ROLE_LABELS, Role, TripStatus } from '@tingting/shared';
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { getAppSettings } from './app-settings.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  approveGovernanceActionWithAdapter,
  checkGovernanceAction,
  rejectGovernanceAction,
  type GovernanceActionRow,
  type GovernanceApplyResult,
} from './governance-action-core.service';

const DEFAULT_WARNING_THRESHOLD = 0.8;
const TIER_ONE_MAX_RATIO = 0.1;
const CREDIT_REQUESTABLE_ROLES = new Set<Role>([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]);
const TIER_ONE_APPROVER_ROLES = new Set<Role>([Role.ADMIN, Role.ACCOUNTANT]);
const DIRECTOR_APPROVER_ROLES = new Set<Role>([Role.ADMIN, Role.MANAGER]);

type DbLike = Tx | typeof db;
type CreditOverrideRow = typeof s.creditOverrideRequests.$inferSelect;
type CreditOverrideDecisionRow = typeof s.governanceActions.$inferSelect;
export type CreditOverrideView = Omit<CreditOverrideRow, 'version'> & {
  version: number;
  requestVersion: number;
  workflowStatus: CreditOverrideDecisionRow['status'];
  governanceActionId: number | null;
  checkedBy: number | null;
  checkedAt: Date | null;
  customerName?: string | null;
  shipmentCode?: string | null;
  requestedByName?: string | null;
  checkedByName?: string | null;
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

export interface CreditOverrideApprovalResult {
  request: CreditOverrideView;
  approvedBy: number;
}

export interface CreditOverrideDecisionInput {
  expectedVersion: number;
}

export interface CreditOverrideRejectionInput extends CreditOverrideDecisionInput {
  reason: string;
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

function assertCanApproveTier(role: Role, tier: CreditOverrideRow['requiredTier']): void {
  if (tier === 'FINANCE_TIER_1' && TIER_ONE_APPROVER_ROLES.has(role)) {
    return;
  }
  if (tier === 'DIRECTOR' && DIRECTOR_APPROVER_ROLES.has(role)) {
    return;
  }
  throw new ApiError(403, 'Vai trò hiện tại không được duyệt đề nghị này');
}

async function findCreditOverrideDecision(
  executor: DbLike,
  requestId: number,
): Promise<CreditOverrideDecisionRow | undefined> {
  const [action] = await executor.select().from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'CREDIT_OVERRIDE'),
      eq(s.governanceActions.subjectId, requestId),
      eq(s.governanceActions.actionKind, 'CREDIT_OVERRIDE_APPROVAL'),
    ))
    .orderBy(desc(s.governanceActions.id))
    .limit(1);
  return action;
}

async function findCreditOverrideDecisions(
  executor: DbLike,
  requestIds: readonly number[],
): Promise<Map<number, CreditOverrideDecisionRow>> {
  if (requestIds.length === 0) return new Map();
  const actions = await executor.select().from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'CREDIT_OVERRIDE'),
      inArray(s.governanceActions.subjectId, [...requestIds]),
      eq(s.governanceActions.actionKind, 'CREDIT_OVERRIDE_APPROVAL'),
    ))
    .orderBy(desc(s.governanceActions.id));
  const latestByRequestId = new Map<number, CreditOverrideDecisionRow>();
  for (const action of actions) {
    if (action.subjectId != null && !latestByRequestId.has(action.subjectId)) {
      latestByRequestId.set(action.subjectId, action);
    }
  }
  return latestByRequestId;
}

async function loadCreditOverrideDecision(
  executor: DbLike,
  requestId: number,
): Promise<CreditOverrideDecisionRow> {
  const action = await findCreditOverrideDecision(executor, requestId);
  if (!action) {
    throw new ApiError(409, 'Đề nghị vượt hạn mức chưa có quy trình kiểm tra ba bước');
  }
  return action;
}

function toCreditOverrideView(
  request: CreditOverrideRow,
  action?: CreditOverrideDecisionRow,
): CreditOverrideView {
  const legacyWorkflowStatus = request.status === 'APPROVED'
    ? 'APPROVED'
    : request.status === 'REJECTED'
      ? 'REJECTED'
      : request.status === 'CANCELED'
        ? 'CANCELED'
        : 'PENDING_CHECK';
  return {
    ...request,
    version: action?.version ?? request.version,
    requestVersion: request.version,
    workflowStatus: action?.status ?? legacyWorkflowStatus,
    governanceActionId: action?.id ?? null,
    checkedBy: action?.checkerId ?? null,
    checkedAt: action?.checkedAt ?? null,
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
    views.flatMap((view) => [view.requestedBy, view.checkedBy])
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
    checkedByName: view.checkedBy == null ? null : userNames.get(view.checkedBy) ?? null,
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
      eq(s.creditOverrideRequests.status, 'APPROVED'),
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
      eq(s.creditOverrideRequests.status, 'APPROVED'),
    ));
  return Number(row?.total ?? 0) > 0;
}

function buildOverLimitMessage(result: CreditCheckResult): string {
  const limit = result.creditLimit?.toLocaleString('vi-VN') ?? '0';
  const exposure = result.totalExposure.toLocaleString('vi-VN');
  const excess = result.overLimitAmount.toLocaleString('vi-VN');
  return `Khách hàng đã vượt hạn mức tín dụng (hạn mức: ${limit} ₫, phơi nhiễm: ${exposure} ₫, phần vượt: ${excess} ₫). Cần phê duyệt để tiếp tục.`;
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
  assertCanMakeGovernanceAction('CREDIT_OVERRIDE_APPROVAL', actor.role);
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
    const [request] = await tx.insert(s.creditOverrideRequests).values({
      customerId: input.customerId,
      shipmentId: input.shipmentId ?? null,
      scopeType,
      status: 'PENDING',
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
    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'CREDIT_OVERRIDE',
      subjectId: request.id,
      subjectKey: `credit-override:${request.id}`,
      actionKind: 'CREDIT_OVERRIDE_APPROVAL',
      reason,
      originalVersion: request.version,
      beforeSnapshot: {
        status: 'PENDING',
        customerId: request.customerId,
        creditLimit: request.creditLimit,
        totalExposure: request.totalExposure,
        overLimitAmount: request.overLimitAmount,
        requiredTier: request.requiredTier,
      },
      afterSnapshot: {
        status: 'APPROVED',
        proposedAmount: request.proposedAmount,
        scopeType: request.scopeType,
        shipmentId: request.shipmentId,
        expiresAt: request.expiresAt?.toISOString() ?? null,
      },
      deltaSnapshot: {
        proposedAmount: request.proposedAmount,
        overLimitAmount: request.overLimitAmount,
        overLimitRatio: request.overLimitRatio,
      },
      makerId: actor.userId,
      makerRole: actor.role,
    }).returning();
    return toCreditOverrideView(request, action);
  };
  return runInTx(transaction, execute);
}

export async function approveCreditOverrideRequest(
  requestId: number,
  actor: CreditOverrideActor,
  input: CreditOverrideDecisionInput,
  transaction?: Tx,
): Promise<CreditOverrideApprovalResult> {
  const execute = async (tx: Tx) => {
    const action = await loadCreditOverrideDecision(tx, requestId);
    const approvedAction = await approveGovernanceActionWithAdapter({
      actionId: action.id,
      approverId: actor.userId,
      approverRole: actor.role,
      expectedVersion: input.expectedVersion,
      apply: applyCreditOverrideGovernanceAction,
      transaction: tx,
    });
    const [approved] = await tx.select().from(s.creditOverrideRequests)
      .where(eq(s.creditOverrideRequests.id, requestId))
      .limit(1);
    if (!approved) throw new ApiError(404, 'Không tìm thấy đề nghị vượt hạn mức');
    return {
      request: toCreditOverrideView(approved, approvedAction),
      approvedBy: actor.userId,
    };
  };
  return runInTx(transaction, execute);
}

export async function checkCreditOverrideRequest(
  requestId: number,
  actor: CreditOverrideActor,
  input: CreditOverrideDecisionInput,
  transaction?: Tx,
): Promise<CreditOverrideView> {
  const execute = async (tx: Tx) => {
    const action = await loadCreditOverrideDecision(tx, requestId);
    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actor.userId,
      checkerRole: actor.role,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    });
    const [request] = await tx.select().from(s.creditOverrideRequests)
      .where(eq(s.creditOverrideRequests.id, requestId))
      .limit(1);
    if (!request) throw new ApiError(404, 'Không tìm thấy đề nghị vượt hạn mức');
    return toCreditOverrideView(request, checked);
  };
  return runInTx(transaction, execute);
}

export async function applyCreditOverrideGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (
    action.subjectType !== 'CREDIT_OVERRIDE'
    || action.actionKind !== 'CREDIT_OVERRIDE_APPROVAL'
    || action.subjectId == null
    || action.approverId == null
    || !action.approverRole
  ) {
    throw new ApiError(409, 'Yêu cầu không thuộc phê duyệt vượt hạn mức tín dụng');
  }
  const [request] = await tx.select().from(s.creditOverrideRequests)
    .where(eq(s.creditOverrideRequests.id, action.subjectId))
    .limit(1)
    .for('update');
  if (!request) throw new ApiError(404, 'Không tìm thấy đề nghị vượt hạn mức');
  if (request.status !== 'PENDING') {
    throw new ApiError(409, 'Đề nghị vượt hạn mức không còn ở trạng thái chờ duyệt');
  }
  if (request.version !== action.originalVersion) {
    throw new ApiError(409, 'Đề nghị đã được cập nhật. Vui lòng tải lại trước khi duyệt');
  }
  if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(409, 'Đề nghị vượt hạn mức đã hết hạn');
  }
  assertCanApproveTier(action.approverRole as Role, request.requiredTier);
  const now = action.approvedAt ?? new Date();
  const [approved] = await tx.update(s.creditOverrideRequests)
    .set({
      status: 'APPROVED',
      approvedBy: action.approverId,
      approvedRole: action.approverRole,
      approvedAt: now,
      version: sql`${s.creditOverrideRequests.version} + 1`,
      updatedAt: now,
    })
    .where(and(
      eq(s.creditOverrideRequests.id, request.id),
      eq(s.creditOverrideRequests.status, 'PENDING'),
      eq(s.creditOverrideRequests.version, action.originalVersion),
    ))
    .returning({ id: s.creditOverrideRequests.id });
  if (!approved) throw new ApiError(409, 'Đề nghị đã được xử lý bởi người khác');
  return {
    applicationResult: {
      creditOverrideRequestId: request.id,
      approvedBy: action.approverId,
    },
  };
}

export async function rejectCreditOverrideRequest(
  requestId: number,
  actor: CreditOverrideActor,
  input: CreditOverrideRejectionInput,
  transaction?: Tx,
): Promise<CreditOverrideRow> {
  const reason = normalizeReason(input.reason);
  if (!reason) {
    throw new ApiError(400, 'Lý do từ chối là bắt buộc');
  }

  const execute = async (tx: Tx) => {
    const [request] = await tx.select()
      .from(s.creditOverrideRequests)
      .where(eq(s.creditOverrideRequests.id, requestId))
      .limit(1)
      .for('update');
    if (!request) {
      throw new ApiError(404, 'Không tìm thấy đề nghị vượt hạn mức');
    }
    if (request.status !== 'PENDING') {
      throw new ApiError(409, 'Đề nghị vượt hạn mức không còn ở trạng thái chờ duyệt');
    }
    assertCanApproveTier(actor.role, request.requiredTier);
    const action = await loadCreditOverrideDecision(tx, requestId);
    if (action.status !== 'PENDING_APPROVAL') {
      throw new ApiError(409, 'Đề nghị phải được một người khác kiểm tra trước khi từ chối');
    }
    const rejectedAction = await rejectGovernanceAction({
      actionId: action.id,
      actorId: actor.userId,
      actorRole: actor.role,
      expectedVersion: input.expectedVersion,
      reason,
      transaction: tx,
    });

    const [rejected] = await tx.update(s.creditOverrideRequests)
      .set({
        status: 'REJECTED',
        rejectedBy: actor.userId,
        rejectedRole: actor.role,
        rejectedAt: new Date(),
        rejectionReason: reason,
        version: sql`${s.creditOverrideRequests.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.creditOverrideRequests.id, requestId),
        eq(s.creditOverrideRequests.status, 'PENDING'),
        eq(s.creditOverrideRequests.version, action.originalVersion),
      ))
      .returning();
    if (!rejected) {
      throw new ApiError(409, 'Đề nghị đã được xử lý bởi người khác');
    }
    return toCreditOverrideView(rejected, rejectedAction);
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
    const decisions = await findCreditOverrideDecisions(db, requests.map((request) => request.id));
    const items = await enrichCreditOverrideViews(
      requests.map((request) => toCreditOverrideView(request, decisions.get(request.id))),
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
    toCreditOverrideView(request, await findCreditOverrideDecision(db, request.id)),
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
    throw new ApiError(404, 'Không tìm thấy phê duyệt vượt hạn mức');
  }
  if (request.customerId !== customerId) {
    throw new ApiError(400, 'Phê duyệt vượt hạn mức không thuộc khách hàng của chuyến đi');
  }
  if (request.status !== 'APPROVED') {
    throw new ApiError(409, 'Phê duyệt vượt hạn mức chưa được duyệt');
  }
  if (request.scopeType === 'SHIPMENT') {
    if (shipmentId == null || request.shipmentId !== shipmentId) {
      throw new ApiError(409, 'Phê duyệt vượt hạn mức không áp dụng cho lô hàng này');
    }
    if (request.consumedAt != null) {
      throw new ApiError(409, 'Phê duyệt vượt hạn mức này đã được sử dụng');
    }
  }
  if (request.scopeType === 'EXPIRY') {
    if (!request.expiresAt || request.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(409, 'Phê duyệt vượt hạn mức đã hết hạn');
    }
  }
  return request;
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
      throw new ApiError(409, 'Phơi nhiễm hiện tại đã vượt mức được duyệt');
    }
    if (result.proposedAmount > toMoney(overrideRequest.proposedAmount)) {
      throw new ApiError(409, 'Giá trị chuyến đi vượt quá giá trị đã được duyệt');
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
    throw new ApiError(409, 'Phê duyệt vượt hạn mức đã được sử dụng bởi tác vụ khác');
  }
}
