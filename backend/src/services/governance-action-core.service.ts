/**
 * Governance action core — the governed-write primitive shared by every
 * governed domain.
 *
 * 2026-09-11 user directive: remove the maker-checker flow entirely. Actions
 * APPLY DIRECTLY in-request: there is no persisted governance_actions table
 * anymore (dropped by migration 0068). What survives is the part that made
 * governed writes safe — policy assertions, evidence-completeness checks,
 * apply adapters, ledger entries, durable effects, audit rows — executed
 * against a TRANSIENT action record inside the caller's transaction. Only the
 * wait-for-a-second-person step (and the row that parked it) is gone.
 *
 * Keep this module a LEAF: only errors, governance-policy and durable-effect
 * imports — never another governance domain service.
 */
import { db } from '../db';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  assertCanApproveGovernanceAction,
  assertCanCheckGovernanceAction,
  getMissingGovernanceEvidence,
} from './governance-policy';
import { enqueueDurableEffects, type DurableEffectInput } from './durable-effect.service';

export interface GovernanceActionRecord {
  /** Synthetic, unique per process; never a database id. */
  id: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  status: 'PENDING_CHECK' | 'PENDING_APPROVAL' | 'APPROVED' | 'RETURNED_FOR_EVIDENCE' | 'REJECTED' | 'CANCELED';
  actionKind: string;
  subjectType: string;
  subjectId: number | null;
  subjectKey: string | null;
  reason: string | null;
  originalVersion: number | null;
  originalPeriodLockId: number | null;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  deltaSnapshot: unknown;
  makerId: number;
  makerRole: string;
  checkerId: number | null;
  checkerRole: string | null;
  checkedAt: Date | null;
  approverId: number | null;
  approverRole: string | null;
  approvedAt: Date | null;
  appliedAt: Date | null;
  ledgerEntryId: number | null;
  applicationResult: Record<string, unknown> | null;
  returnedBy: number | null;
  returnedRole: string | null;
  returnedAt: Date | null;
  returnReason: string | null;
  rejectedBy: number | null;
  rejectedRole: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  canceledBy: number | null;
  canceledRole: string | null;
  canceledAt: Date | null;
  cancelReason: string | null;
}

/** Compatibility alias: every apply adapter still speaks "the action row". */
export type GovernanceActionRow = GovernanceActionRecord;

export interface GovernanceApplyResult {
  ledgerEntryId?: number | null;
  applicationResult?: Record<string, unknown> | null;
  durableEffects?: DurableEffectInput[];
}

export type GovernanceApplyAdapter = (
  tx: Tx,
  action: GovernanceActionRow,
) => Promise<GovernanceApplyResult | void>;

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

export function setGovernanceApprovalAfterApplyHookForTest(
  hook: null | ((action: GovernanceActionRow) => void | Promise<void>),
) {
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

let transientActionIdSeq = 0;

/**
 * Build the transient action record for a governed write. The values mirror
 * what the old governance_actions insert carried — adapters and policy
 * assertions read the same fields, so governed behavior is unchanged.
 */
export function buildGovernanceAction(
  values: Pick<GovernanceActionRecord, 'actionKind' | 'subjectType' | 'makerId' | 'makerRole'>
    & Partial<GovernanceActionRecord>,
): GovernanceActionRecord {
  const now = new Date();
  return {
    id: --transientActionIdSeq,
    version: 1,
    createdAt: now,
    updatedAt: now,
    status: 'PENDING_CHECK',
    subjectId: null,
    subjectKey: null,
    reason: null,
    originalVersion: null,
    originalPeriodLockId: null,
    beforeSnapshot: null,
    afterSnapshot: null,
    deltaSnapshot: null,
    checkerId: null,
    checkerRole: null,
    checkedAt: null,
    approverId: null,
    approverRole: null,
    approvedAt: null,
    appliedAt: null,
    ledgerEntryId: null,
    applicationResult: null,
    returnedBy: null,
    returnedRole: null,
    returnedAt: null,
    returnReason: null,
    rejectedBy: null,
    rejectedRole: null,
    rejectedAt: null,
    rejectionReason: null,
    canceledBy: null,
    canceledRole: null,
    canceledAt: null,
    cancelReason: null,
    ...values,
  };
}

/**
 * Run the full governed lifecycle for a transient action in one request:
 * check stage (policy + evidence completeness), approve stage (policy), then
 * the domain apply adapter — all inside the caller's transaction. This is the
 * direct-apply replacement for the old make→check→approve row machine; the
 * requesting actor performs every stage, exactly like the auto-apply chain
 * that preceded the table drop.
 */
export async function applyGovernanceActionDirect(input: {
  action: GovernanceActionRow;
  actorId: number;
  actorRole: string;
  apply: GovernanceApplyAdapter;
  transaction?: Tx;
}): Promise<{
  action: GovernanceActionRow;
  result: GovernanceApplyResult | void;
}> {
  const execute = async (tx: Tx) => {
    const actor = { actorId: input.actorId, actorRole: input.actorRole };
    assertCanCheckGovernanceAction(input.action, actor);
    const missingEvidence = getMissingGovernanceEvidence(
      input.action.actionKind,
      input.action.deltaSnapshot as Record<string, unknown> | null,
    );
    if (missingEvidence.length > 0) {
      // The old check stage parked the request as RETURNED_FOR_EVIDENCE; with
      // nothing persisted to park, the same gap rejects the request outright.
      throw new ApiError(422, `Thiếu bằng chứng bắt buộc: ${missingEvidence.join(', ')}`);
    }
    const now = new Date();
    const checked: GovernanceActionRow = {
      ...input.action,
      status: 'PENDING_APPROVAL',
      checkerId: input.actorId,
      checkerRole: input.actorRole,
      checkedAt: now,
      version: input.action.version + 1,
      updatedAt: now,
    };
    assertCanApproveGovernanceAction(checked, actor);
    // Adapters get the authoritative decision actor so immutable domain rows
    // record the actual approver.
    const forApply: GovernanceActionRow = {
      ...checked,
      approverId: input.actorId,
      approverRole: input.actorRole,
      approvedAt: now,
    };
    const result = await applyWithinActiveApproval(tx, forApply, input.apply);
    if (result?.durableEffects?.length) {
      await enqueueDurableEffects(tx, result.durableEffects);
    }
    if (afterGovernanceApplyHookForTest) {
      await afterGovernanceApplyHookForTest(forApply);
    }
    const applied: GovernanceActionRow = {
      ...forApply,
      status: 'APPROVED',
      appliedAt: now,
      ledgerEntryId: result?.ledgerEntryId ?? null,
      applicationResult: result?.applicationResult ?? null,
      version: checked.version + 1,
      updatedAt: now,
    };
    return { action: applied, result };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  // A bare call still owns its transaction so adapters always run inside one.
  return db.transaction(execute) as Promise<{ action: GovernanceActionRow; result: GovernanceApplyResult | void }>;
}
