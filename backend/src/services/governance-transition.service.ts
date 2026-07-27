import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
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

export type GovernanceActionRow = typeof s.governanceActions.$inferSelect;

export interface GovernanceApplyResult {
  ledgerEntryId?: number | null;
  applicationResult?: Record<string, unknown> | null;
}

export type GovernanceApplyAdapter = (
  tx: Tx,
  action: GovernanceActionRow,
) => Promise<GovernanceApplyResult | void>;

export type GovernanceActionView = GovernanceActionRow & {
  allowedActions: GovernanceAllowedAction[];
};

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
}) {
  return db.transaction(async (tx) => {
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
  });
}

export async function approveGovernanceActionWithAdapter(input: {
  actionId: number;
  approverId: number;
  approverRole: string;
  expectedVersion: number;
  apply: GovernanceApplyAdapter;
}) {
  return db.transaction(async (tx) => {
    const action = await lockGovernanceAction(tx, input.actionId);
    assertExpectedActionVersion(action.version, input.expectedVersion);
    if (action.status !== 'PENDING_APPROVAL' || action.checkerId == null) {
      throw new ApiError(409, 'Yêu cầu chưa được kiểm tra hoặc đã được xử lý');
    }
    assertCanApproveGovernanceAction(action, {
      actorId: input.approverId,
      actorRole: input.approverRole,
    });

    const effect = await input.apply(tx, action);
    const now = new Date();
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
      eq(s.governanceActions.status, 'PENDING_APPROVAL'),
      eq(s.governanceActions.version, input.expectedVersion),
    )).returning();
    if (!approved) {
      throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
    }
    return approved;
  });
}

async function recordNegativeDecision(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason: string;
  kind: 'REJECT' | 'RETURN_FOR_EVIDENCE';
}) {
  return db.transaction(async (tx) => {
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
  });
}

export async function rejectGovernanceAction(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason: string;
}) {
  return recordNegativeDecision({ ...input, kind: 'REJECT' });
}

export async function returnGovernanceActionForEvidence(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason: string;
}) {
  return recordNegativeDecision({ ...input, kind: 'RETURN_FOR_EVIDENCE' });
}

export async function cancelGovernanceAction(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason: string;
}) {
  return db.transaction(async (tx) => {
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
  });
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
  const rows = await db.select().from(s.governanceActions)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(s.governanceActions.id))
    .limit(input.query.limit)
    .offset(input.query.offset);
  const actor = { actorId: input.actorId, actorRole: input.actorRole };
  return rows.map(action => withAllowedActions(action, actor));
}
