import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {
  type GovernanceActionListQuery,
  type GovernanceAllowedAction,
} from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  assertCanApproveGovernanceAction,
  assertCanCheckGovernanceAction,
  canViewGovernanceAction,
  getMissingGovernanceEvidence,
  getGovernanceAllowedActions,
  type GovernanceActor,
} from './governance-policy';
import { applyCommissionGovernanceAction } from './commission.service';
import {
  applyCarrierPaymentGovernanceAction,
  applyDriverPayoutGovernanceAction,
  applyPenaltyCancelGovernanceAction,
  applyPenaltyCreateGovernanceAction,
  applyVendorPaymentGovernanceAction,
} from './financial.service';
import {
  applyPaymentReceiptGovernanceAction,
  applyPaymentRefundGovernanceAction,
} from './payment-allocation.service';
import { applyProfitDistributionGovernanceAction } from './profit-distribution.service';
import { applyTreasuryGovernanceAction } from './treasury.service';
import {
  enqueueDurableEffects,
  type DurableEffectInput,
} from './durable-effect.service';

export type GovernanceActionRow = typeof s.governanceActions.$inferSelect;

export interface GovernanceApplyResult {
  ledgerEntryId?: number | null;
  applicationResult?: Record<string, unknown> | null;
  durableEffects?: DurableEffectInput[];
}

const activeApprovalApplications = new WeakMap<object, Set<number>>();
let afterGovernanceApplyHookForTest: null | ((action: GovernanceActionRow) => void | Promise<void>) = null;

export function assertActiveApprovalApplication(
  tx: Tx,
  actionId: number | undefined,
): void {
  if (
    !Number.isInteger(actionId)
    || !activeApprovalApplications.get(tx as object)?.has(actionId!)
  ) {
    throw new ApiError(
      409,
      'Thao tác tài chính chỉ được áp dụng bởi tiến trình phê duyệt quản trị',
    );
  }
}

export type GovernanceApplyAdapter = (
  tx: Tx,
  action: GovernanceActionRow,
) => Promise<GovernanceApplyResult | void>;

export function setGovernanceApprovalAfterApplyHookForTest(
  hook: null | ((action: GovernanceActionRow) => void | Promise<void>),
): void {
  afterGovernanceApplyHookForTest = hook;
}

async function applyWithinActiveApproval(
  tx: Tx,
  action: GovernanceActionRow,
  apply: GovernanceApplyAdapter,
): Promise<GovernanceApplyResult | void> {
  const txKey = tx as object;
  let actionIds = activeApprovalApplications.get(txKey);
  if (!actionIds) {
    actionIds = new Set<number>();
    activeApprovalApplications.set(txKey, actionIds);
  }
  if (actionIds.has(action.id)) {
    throw new ApiError(409, 'Yêu cầu quản trị đang được áp dụng');
  }
  actionIds.add(action.id);
  try {
    return await apply(tx, action);
  } finally {
    actionIds.delete(action.id);
    if (actionIds.size === 0) {
      activeApprovalApplications.delete(txKey);
    }
  }
}

export type GovernanceActionView = GovernanceActionRow & {
  allowedActions: GovernanceAllowedAction[];
};

const DIRECT_MONEY_ACTION_KINDS = new Set([
  'PAYMENT_RECEIPT',
  'PAYMENT_REFUND',
  'VENDOR_PAYMENT',
  'CARRIER_PAYMENT',
  'DRIVER_PAYOUT',
  'COMMISSION',
  'PENALTY_CREATE',
  'PENALTY_CANCEL',
  'PROFIT_DISTRIBUTION',
  'TREASURY_ACCOUNT_SETUP',
  'TREASURY_CUTOVER',
  'TREASURY_MOVEMENT_REVERSAL',
]);

function assertExpectedActionVersion(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected <= 0) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  if (actual !== expected) {
    throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
  }
}

function requireDecisionReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) throw new ApiError(400, 'Lý do là bắt buộc');
  return normalized;
}

async function lockGovernanceAction(tx: Tx, actionId: number): Promise<GovernanceActionRow> {
  const [action] = await tx.select().from(s.governanceActions)
    .where(eq(s.governanceActions.id, actionId))
    .limit(1)
    .for('update');
  if (!action) throw new ApiError(404, 'Không tìm thấy yêu cầu điều chỉnh');
  return action;
}

function assertViewer(role: string): void {
  if (!canViewGovernanceAction(role)) {
    throw new ApiError(403, 'Bạn không có quyền xem yêu cầu quản trị');
  }
}

function withAllowedActions(
  action: GovernanceActionRow,
  actor: GovernanceActor,
): GovernanceActionView {
  return {
    ...action,
    allowedActions: getGovernanceAllowedActions(action, actor),
  };
}

function assertDecisionAllowed(
  action: GovernanceActionRow,
  actor: GovernanceActor,
  allowedAction: 'REJECT' | 'RETURN_FOR_EVIDENCE',
): void {
  if (action.status === 'PENDING_CHECK') {
    assertCanCheckGovernanceAction(action, actor);
  } else if (action.status === 'PENDING_APPROVAL') {
    assertCanApproveGovernanceAction(action, actor);
  } else {
    throw new ApiError(409, 'Yêu cầu không còn ở bước ra quyết định');
  }
  if (!getGovernanceAllowedActions(action, actor).includes(allowedAction)) {
    throw new ApiError(403, 'Bạn không có quyền thực hiện bước phê duyệt này');
  }
}

export async function checkGovernanceAction(input: {
  actionId: number;
  checkerId: number;
  checkerRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  const execute = async (tx: Tx) => {
    const action = await lockGovernanceAction(tx, input.actionId);
    assertExpectedActionVersion(action.version, input.expectedVersion);
    if (action.status !== 'PENDING_CHECK') {
      throw new ApiError(409, 'Yêu cầu không còn ở bước kiểm tra');
    }
    assertCanCheckGovernanceAction(action, {
      actorId: input.checkerId,
      actorRole: input.checkerRole,
    });

    const now = new Date();
    const missingEvidence = getMissingGovernanceEvidence(
      action.actionKind,
      action.deltaSnapshot as Record<string, unknown> | null,
    );
    if (missingEvidence.length > 0) {
      const [returned] = await tx.update(s.governanceActions).set({
        status: 'RETURNED_FOR_EVIDENCE',
        returnedBy: input.checkerId,
        returnedRole: input.checkerRole,
        returnedAt: now,
        returnReason: `Thiếu bằng chứng bắt buộc: ${missingEvidence.join(', ')}`,
        updatedAt: now,
        version: sql`${s.governanceActions.version} + 1`,
      }).where(and(
        eq(s.governanceActions.id, action.id),
        eq(s.governanceActions.status, 'PENDING_CHECK'),
        eq(s.governanceActions.version, input.expectedVersion),
      )).returning();
      if (!returned) {
        throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
      }
      return returned;
    }

    const [updated] = await tx.update(s.governanceActions).set({
      status: 'PENDING_APPROVAL',
      checkerId: input.checkerId,
      checkerRole: input.checkerRole,
      checkedAt: now,
      updatedAt: now,
      version: sql`${s.governanceActions.version} + 1`,
    }).where(and(
      eq(s.governanceActions.id, action.id),
      eq(s.governanceActions.status, 'PENDING_CHECK'),
      eq(s.governanceActions.version, input.expectedVersion),
    )).returning();
    if (!updated) {
      throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
    }
    return updated;
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function approveGovernanceActionWithAdapter(input: {
  actionId: number;
  approverId: number;
  approverRole: string;
  expectedVersion: number;
  apply: GovernanceApplyAdapter;
  authorizeBeforeApply?: (action: GovernanceActionRow) => boolean;
  transaction?: Tx;
}) {
  const execute = async (tx: Tx) => {
    const action = await lockGovernanceAction(tx, input.actionId);
    assertExpectedActionVersion(action.version, input.expectedVersion);
    const isAdminPriceConfigMaker = action.actionKind === 'PRICE_CONFIG_CHANGE'
      && action.makerId === input.approverId
      && input.approverRole === 'ADMIN';
    if (
      (action.status !== 'PENDING_APPROVAL' || action.checkerId == null)
      && !(isAdminPriceConfigMaker && action.status === 'PENDING_CHECK')
    ) {
      throw new ApiError(409, 'Yêu cầu chưa được kiểm tra hoặc đã được xử lý');
    }
    assertCanApproveGovernanceAction(action, {
      actorId: input.approverId,
      actorRole: input.approverRole,
    });

    const now = new Date();
    if (input.authorizeBeforeApply?.(action)) {
      const [authorized] = await tx.update(s.governanceActions).set({
        status: 'APPROVED',
        approverId: input.approverId,
        approverRole: input.approverRole,
        approvedAt: now,
        appliedAt: null,
        ledgerEntryId: null,
        applicationResult: null,
        updatedAt: now,
        version: sql`${s.governanceActions.version} + 1`,
      }).where(and(
        eq(s.governanceActions.id, action.id),
        eq(s.governanceActions.status, action.status),
        eq(s.governanceActions.version, input.expectedVersion),
      )).returning();
      if (!authorized) {
        throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
      }
      const effect = await applyWithinActiveApproval(
        tx,
        authorized,
        input.apply,
      );
      if (effect?.durableEffects?.length) {
        await enqueueDurableEffects(tx, effect.durableEffects);
      }
      if (afterGovernanceApplyHookForTest) {
        await afterGovernanceApplyHookForTest(authorized);
      }
      const appliedAt = new Date();
      const [applied] = await tx.update(s.governanceActions).set({
        appliedAt,
        ledgerEntryId: effect?.ledgerEntryId ?? null,
        applicationResult: effect?.applicationResult ?? null,
        updatedAt: appliedAt,
        version: sql`${s.governanceActions.version} + 1`,
      }).where(and(
        eq(s.governanceActions.id, authorized.id),
        eq(s.governanceActions.status, 'APPROVED'),
        eq(s.governanceActions.version, authorized.version),
        eq(s.governanceActions.approverId, input.approverId),
        isNull(s.governanceActions.appliedAt),
      )).returning();
      if (!applied) {
        throw new ApiError(409, 'Yêu cầu đã được áp dụng hoặc thay đổi bởi tiến trình khác');
      }
      return applied;
    }
    // Adapters execute inside the same approval transaction before the
    // governance row is persisted as APPROVED. Give them the authoritative
    // decision actor so immutable domain rows can record the actual approver.
    const effect = await applyWithinActiveApproval(
      tx,
      {
        ...action,
        approverId: input.approverId,
        approverRole: input.approverRole,
        approvedAt: now,
      },
      input.apply,
    );
    if (effect?.durableEffects?.length) {
      await enqueueDurableEffects(tx, effect.durableEffects);
    }
    if (afterGovernanceApplyHookForTest) {
      await afterGovernanceApplyHookForTest(action);
    }
    const [approved] = await tx.update(s.governanceActions).set({
      status: 'APPROVED',
      approverId: input.approverId,
      approverRole: input.approverRole,
      approvedAt: now,
      appliedAt: now,
      ledgerEntryId: effect?.ledgerEntryId ?? null,
      applicationResult: effect?.applicationResult ?? null,
      updatedAt: now,
      version: sql`${s.governanceActions.version} + 1`,
    }).where(and(
      eq(s.governanceActions.id, action.id),
      eq(s.governanceActions.status, action.status),
      eq(s.governanceActions.version, input.expectedVersion),
    )).returning();
    if (!approved) {
      throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
    }
    return approved;
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export function isDirectMoneyGovernanceActionKind(actionKind: string): boolean {
  return DIRECT_MONEY_ACTION_KINDS.has(actionKind);
}

async function applyDirectMoneyGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
) {
  switch (action.actionKind) {
    case 'PAYMENT_RECEIPT':
      return applyPaymentReceiptGovernanceAction(tx, action);
    case 'PAYMENT_REFUND':
      return applyPaymentRefundGovernanceAction(tx, action);
    case 'VENDOR_PAYMENT':
      return applyVendorPaymentGovernanceAction(tx, action);
    case 'CARRIER_PAYMENT':
      return applyCarrierPaymentGovernanceAction(tx, action);
    case 'DRIVER_PAYOUT':
      return applyDriverPayoutGovernanceAction(tx, action);
    case 'COMMISSION':
      return applyCommissionGovernanceAction(tx, action);
    case 'PENALTY_CREATE':
      return applyPenaltyCreateGovernanceAction(tx, action);
    case 'PENALTY_CANCEL':
      return applyPenaltyCancelGovernanceAction(tx, action);
    case 'PROFIT_DISTRIBUTION':
      return applyProfitDistributionGovernanceAction(tx, action);
    case 'TREASURY_ACCOUNT_SETUP':
    case 'TREASURY_CUTOVER':
    case 'TREASURY_MOVEMENT_REVERSAL':
      return applyTreasuryGovernanceAction(tx, action);
    default:
      throw new ApiError(409, 'Loại yêu cầu không thuộc nhóm tiền trực tiếp');
  }
}

export async function approveDirectMoneyGovernanceAction(input: {
  actionId: number;
  approverId: number;
  approverRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  return approveGovernanceActionWithAdapter({
    ...input,
    apply: applyDirectMoneyGovernanceAction,
  });
}

async function recordNegativeDecision(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason: string;
  kind: 'REJECT' | 'RETURN_FOR_EVIDENCE';
  transaction?: Tx;
}) {
  const execute = async (tx: Tx) => {
    const action = await lockGovernanceAction(tx, input.actionId);
    assertExpectedActionVersion(action.version, input.expectedVersion);
    const actor = { actorId: input.actorId, actorRole: input.actorRole };
    assertDecisionAllowed(action, actor, input.kind);
    const reason = requireDecisionReason(input.reason);
    const now = new Date();
    const [updated] = await tx.update(s.governanceActions).set(
      input.kind === 'REJECT'
        ? {
            status: 'REJECTED',
            rejectedBy: input.actorId,
            rejectedRole: input.actorRole,
            rejectedAt: now,
            rejectionReason: reason,
            updatedAt: now,
            version: sql`${s.governanceActions.version} + 1`,
          }
        : {
            status: 'RETURNED_FOR_EVIDENCE',
            returnedBy: input.actorId,
            returnedRole: input.actorRole,
            returnedAt: now,
            returnReason: reason,
            updatedAt: now,
            version: sql`${s.governanceActions.version} + 1`,
          },
    ).where(and(
      eq(s.governanceActions.id, action.id),
      eq(s.governanceActions.status, action.status),
      eq(s.governanceActions.version, input.expectedVersion),
    )).returning();
    if (!updated) {
      throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
    }
    return updated;
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function rejectGovernanceAction(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason: string;
  transaction?: Tx;
}) {
  return recordNegativeDecision({ ...input, kind: 'REJECT' });
}

export async function returnGovernanceActionForEvidence(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason: string;
  transaction?: Tx;
}) {
  return recordNegativeDecision({ ...input, kind: 'RETURN_FOR_EVIDENCE' });
}

export async function cancelGovernanceAction(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason: string;
  transaction?: Tx;
}) {
  const execute = async (tx: Tx) => {
    const action = await lockGovernanceAction(tx, input.actionId);
    assertExpectedActionVersion(action.version, input.expectedVersion);
    if (!canViewGovernanceAction(input.actorRole)) {
      throw new ApiError(403, 'Bạn không có quyền thực hiện bước phê duyệt này');
    }
    if (action.makerId !== input.actorId) {
      throw new ApiError(403, 'Chỉ người tạo mới được hủy yêu cầu chưa áp dụng');
    }
    if (!['PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE'].includes(action.status)) {
      throw new ApiError(409, 'Chỉ có thể hủy yêu cầu chưa áp dụng');
    }
    const reason = requireDecisionReason(input.reason);
    const now = new Date();
    const [canceled] = await tx.update(s.governanceActions).set({
      status: 'CANCELED',
      canceledBy: input.actorId,
      canceledRole: input.actorRole,
      canceledAt: now,
      cancelReason: reason,
      updatedAt: now,
      version: sql`${s.governanceActions.version} + 1`,
    }).where(and(
      eq(s.governanceActions.id, action.id),
      eq(s.governanceActions.status, action.status),
      eq(s.governanceActions.version, input.expectedVersion),
    )).returning();
    if (!canceled) {
      throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
    }
    return canceled;
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function getGovernanceAction(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
}): Promise<GovernanceActionView> {
  assertViewer(input.actorRole);
  const [action] = await db.select().from(s.governanceActions)
    .where(eq(s.governanceActions.id, input.actionId))
    .limit(1);
  if (!action) throw new ApiError(404, 'Không tìm thấy yêu cầu điều chỉnh');
  return withAllowedActions(action, {
    actorId: input.actorId,
    actorRole: input.actorRole,
  });
}

export async function listGovernanceActions(input: {
  actorId: number;
  actorRole: string;
  query: GovernanceActionListQuery;
}): Promise<GovernanceActionView[]> {
  assertViewer(input.actorRole);
  const filters: SQL[] = [];
  if (input.query.status) {
    filters.push(eq(s.governanceActions.status, input.query.status));
  }
  if (input.query.actionKind) {
    filters.push(eq(s.governanceActions.actionKind, input.query.actionKind));
  }
  if (input.query.subjectType) {
    filters.push(eq(s.governanceActions.subjectType, input.query.subjectType));
  }
  if (input.query.subjectId) {
    filters.push(eq(s.governanceActions.subjectId, input.query.subjectId));
  }
  if (input.query.subjectKey) {
    filters.push(eq(s.governanceActions.subjectKey, input.query.subjectKey));
  }
  const rows = await db.select().from(s.governanceActions)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(s.governanceActions.id))
    .limit(input.query.limit)
    .offset(input.query.offset);
  const actor = { actorId: input.actorId, actorRole: input.actorRole };
  return rows.map(action => withAllowedActions(action, actor));
}
