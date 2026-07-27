import { and, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { getCustomerArSummary } from './ar-status.service';
import { getAppSettings } from './app-settings.service';

const DEFAULT_WARNING_THRESHOLD = 0.8;
const TIER_ONE_MAX_RATIO = 0.1;
const CREDIT_REQUESTABLE_ROLES = new Set<Role>([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]);
const TIER_ONE_APPROVER_ROLES = new Set<Role>([Role.ADMIN, Role.ACCOUNTANT]);
const DIRECTOR_APPROVER_ROLES = new Set<Role>([Role.ADMIN, Role.MANAGER]);

type DbLike = Tx | typeof db;
type CreditOverrideRow = typeof s.creditOverrideRequests.$inferSelect;

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
  request: CreditOverrideRow;
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
  const [{ creditLimit, warningThreshold }, { outstanding }, approvedUncollected] = await Promise.all([
    loadCustomerCreditProfile(customerId, executor),
    getCustomerArSummary(customerId),
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
): Promise<CreditOverrideRow> {
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

  return db.transaction(async (tx) => {
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
    return request;
  });
}

export async function approveCreditOverrideRequest(
  requestId: number,
  actor: CreditOverrideActor,
  input: CreditOverrideDecisionInput,
): Promise<CreditOverrideApprovalResult> {
  return db.transaction(async (tx) => {
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
    if (request.version !== input.expectedVersion) {
      throw new ApiError(409, 'Đề nghị đã được cập nhật. Vui lòng tải lại trước khi duyệt');
    }
    if (request.requestedBy === actor.userId) {
      throw new ApiError(403, 'Người tạo đề nghị không được tự duyệt');
    }
    if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(409, 'Đề nghị vượt hạn mức đã hết hạn');
    }
    assertCanApproveTier(actor.role, request.requiredTier);
    const [approved] = await tx.update(s.creditOverrideRequests)
      .set({
        status: 'APPROVED',
        approvedBy: actor.userId,
        approvedRole: actor.role,
        approvedAt: new Date(),
        version: sql`${s.creditOverrideRequests.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.creditOverrideRequests.id, requestId),
        eq(s.creditOverrideRequests.status, 'PENDING'),
        eq(s.creditOverrideRequests.version, input.expectedVersion),
      ))
      .returning();
    if (!approved) {
      throw new ApiError(409, 'Đề nghị đã được xử lý bởi người khác');
    }
    return {
      request: approved,
      approvedBy: actor.userId,
    };
  });
}

export async function rejectCreditOverrideRequest(
  requestId: number,
  actor: CreditOverrideActor,
  input: CreditOverrideRejectionInput,
): Promise<CreditOverrideRow> {
  const reason = normalizeReason(input.reason);
  if (!reason) {
    throw new ApiError(400, 'Lý do từ chối là bắt buộc');
  }

  return db.transaction(async (tx) => {
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
    if (request.version !== input.expectedVersion) {
      throw new ApiError(409, 'Đề nghị đã được cập nhật. Vui lòng tải lại trước khi từ chối');
    }
    if (request.requestedBy === actor.userId) {
      throw new ApiError(403, 'Người tạo đề nghị không được tự từ chối');
    }
    assertCanApproveTier(actor.role, request.requiredTier);

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
        eq(s.creditOverrideRequests.version, input.expectedVersion),
      ))
      .returning();
    if (!rejected) {
      throw new ApiError(409, 'Đề nghị đã được xử lý bởi người khác');
    }
    return rejected;
  });
}

export async function listCreditOverrideRequests(filters: {
  customerId?: number;
  status?: CreditOverrideRow['status'];
  limit?: number;
} = {}): Promise<CreditOverrideRow[]> {
  const conditions = [
    filters.customerId != null
      ? eq(s.creditOverrideRequests.customerId, filters.customerId)
      : undefined,
    filters.status != null
      ? eq(s.creditOverrideRequests.status, filters.status)
      : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => condition != null);

  return db.select()
    .from(s.creditOverrideRequests)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(s.creditOverrideRequests.createdAt))
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));
}

export async function getCreditOverrideRequest(requestId: number): Promise<CreditOverrideRow> {
  const [request] = await db.select()
    .from(s.creditOverrideRequests)
    .where(eq(s.creditOverrideRequests.id, requestId))
    .limit(1);
  if (!request) {
    throw new ApiError(404, 'Không tìm thấy đề nghị vượt hạn mức');
  }
  return request;
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
