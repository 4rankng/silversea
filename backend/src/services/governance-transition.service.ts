import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  type GovernanceActionListQuery,
  type GovernanceAllowedAction,
  type PaginatedResponse,
} from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  canViewGovernanceAction,
  getGovernanceAllowedActions,
  type GovernanceActor,
} from './governance-policy';
import {
  approveGovernanceActionWithAdapter,
  type GovernanceActionRow,
} from './governance-action-core.service';
import { attachSubjectLabels } from './governance-subject-labels.service';
// Re-export the approval core so existing importers (domain governance
// services + tests) keep one stable path; the core itself stays a leaf so the
// adjustment-governance → hub edge (and the services-graph cycle it closed)
// is gone.
export {
  approveGovernanceActionWithAdapter,
  assertActiveApprovalApplication,
  setGovernanceApprovalAfterApplyHookForTest,
  checkGovernanceAction,
  rejectGovernanceAction,
  returnGovernanceActionForEvidence,
  cancelGovernanceAction,
} from './governance-action-core.service';
export type {
  GovernanceApplyAdapter,
  GovernanceApplyResult,
  GovernanceActionRow,
} from './governance-action-core.service';
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

export type GovernanceActionView = GovernanceActionRow & {
  allowedActions: GovernanceAllowedAction[];
  /** Human-readable subject resolved server-side; null → show raw subjectKey. */
  subjectLabel?: string | null;
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
  const [withSubject] = await attachSubjectLabels([withAllowedActions(action, {
    actorId: input.actorId,
    actorRole: input.actorRole,
  })]);
  return withSubject;
}

export type GovernanceActionListResult = PaginatedResponse<GovernanceActionView> & {
  // Full-set counts by status over the same filters (ignores limit/offset);
  // per-actor "actionable" signals stay page-scoped via item allowedActions.
  statusCounts: Record<string, number>;
};

// Column-sort whitelist for the approval-center queue. status ranks
// attention-first (pending stages before decided ones) instead of by the
// enum's alphabetical order; subjectKey/reason are nullable so `nulls last`
// keeps empty cells at the bottom in both directions.
const GOVERNANCE_ACTION_SORT_SQL: Record<
  NonNullable<GovernanceActionListQuery['sortBy']>,
  SQL
> = {
  actionKind: sql`${s.governanceActions.actionKind}`,
  status: sql`case
    when ${s.governanceActions.status} = 'PENDING_CHECK' then 0
    when ${s.governanceActions.status} = 'PENDING_APPROVAL' then 1
    when ${s.governanceActions.status} = 'RETURNED_FOR_EVIDENCE' then 2
    when ${s.governanceActions.status} = 'APPROVED' then 3
    when ${s.governanceActions.status} = 'REJECTED' then 4
    when ${s.governanceActions.status} = 'CANCELED' then 5
    else 6
  end`,
  subjectKey: sql`${s.governanceActions.subjectKey}`,
  makerRole: sql`${s.governanceActions.makerRole}`,
  version: sql`${s.governanceActions.version}`,
  createdAt: sql`${s.governanceActions.createdAt}`,
  reason: sql`${s.governanceActions.reason}`,
};

export async function listGovernanceActions(input: {
  actorId: number;
  actorRole: string;
  query: GovernanceActionListQuery;
}): Promise<GovernanceActionListResult> {
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
  const where = filters.length > 0 ? and(...filters) : undefined;
  const { limit, offset } = input.query;
  // Absent sort params keep the default newest-first order exactly; an
  // explicit sort adds `nulls last` plus the id tiebreaker for stability.
  const sortOrder: SQL[] = input.query.sortBy
    ? [
        sql`${GOVERNANCE_ACTION_SORT_SQL[input.query.sortBy]} ${input.query.sortDir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
        desc(s.governanceActions.id),
      ]
    : [desc(s.governanceActions.id)];
  const rows = await db.select().from(s.governanceActions)
    .where(where)
    .orderBy(...sortOrder)
    .limit(limit)
    .offset(offset);
  const [countRow] = await db.select({ count: sql<number>`count(*)` })
    .from(s.governanceActions)
    .where(where);
  const statusRows = await db.select({
    status: s.governanceActions.status,
    count: sql<number>`count(*)`,
  }).from(s.governanceActions)
    .where(where)
    .groupBy(s.governanceActions.status);
  const statusCounts: Record<string, number> = {};
  for (const row of statusRows) {
    statusCounts[row.status] = Number(row.count);
  }
  const actor = { actorId: input.actorId, actorRole: input.actorRole };
  return {
    items: await attachSubjectLabels(rows.map(action => withAllowedActions(action, actor))),
    total: Number(countRow?.count ?? 0),
    page: Math.floor(offset / limit) + 1,
    pageSize: limit,
    statusCounts,
  };
}
