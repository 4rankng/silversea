import { and, count, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { ROLE_LABELS, Role, TripStatus } from '@tingting/shared';
import { db } from '../db';
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
} from './governance-transition.service';

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
};

function decodeCreditOverrideCursor(raw: string): CreditOverrideCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    const createdAt = typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : new Date(Number.NaN);
    if (!Number.isFinite(createdAt.getTime()) || !Number.isInteger(parsed.id) || Number(parsed.id) <= 0) {
      throw new Error('invalid cursor');
    }
    return { createdAt, id: Number(parsed.id) };
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
    total: sql<string>`coalesce(sum(${s.trips.revenue}), 0)`,
  }).from(s.trips)
    .where(and(
      eq(s.trips.customerId, customerId),
      isNull(s.trips.deletedAt),
      inArray(s.trips.status, [TripStatus.CREATED, TripStatus.IN_TRANSIT]),
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
  if (transaction) {
    return execute(transaction);
  }
  return db.transaction(execute);
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
  if (transaction) {
    return execute(transaction);
  }
  return db.transaction(execute);
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
  return transaction ? execute(transaction) : db.transaction(execute);
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
  if (transaction) {
    return execute(transaction);
  }
  return db.transaction(execute);
}

export async function listCreditOverrideRequests(filters: {
  customerId?: number;
  status?: CreditOverrideRow['status'];
  limit?: number;
  cursor?: string;
} = {}, requesterRole: Role = Role.ACCOUNTANT): Promise<CreditOverrideListResult> {
  const cursor = filters.cursor ? decodeCreditOverrideCursor(filters.cursor) : null;
  const conditions = [
    filters.customerId != null
      ? eq(s.creditOverrideRequests.customerId, filters.customerId)
      : undefined,
    filters.status != null
      ? eq(s.creditOverrideRequests.status, filters.status)
      : undefined,
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

  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select()
    .from(s.creditOverrideRequests)
    .where(where)
    .orderBy(desc(s.creditOverrideRequests.createdAt), desc(s.creditOverrideRequests.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const requests = rows.slice(0, limit);
  const decisions = await findCreditOverrideDecisions(db, requests.map((request) => request.id));
  const items = await enrichCreditOverrideViews(
    requests.map((request) => toCreditOverrideView(request, decisions.get(request.id))),
    requesterRole,
  );
  return {
    items,
    limit,
    hasMore,
    nextCursor: hasMore && requests.length > 0
      ? encodeCreditOverrideCursor(requests[requests.length - 1])
      : null,
  };
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
